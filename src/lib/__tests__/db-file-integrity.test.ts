import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let directory: string;
let filename: string;

beforeEach(() => {
  vi.resetModules();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'instalink-integrity-'));
  filename = path.join(directory, 'database.json');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('INSTALINK_DB_FILE', filename);
  vi.stubEnv('AUTOMATION_INLINE', '0');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('local database integrity', () => {
  it('allows first-time initialization when the file does not exist', async () => {
    const { readDB, updateDB } = await import('../db');
    expect((await readDB()).users).toEqual([]);
    await updateDB(() => undefined);
    expect(JSON.parse(fs.readFileSync(filename, 'utf8')).users).toEqual([]);
  });

  it.each(['', ' \n\t', '{"users":'])('rejects damaged content %j without overwriting the file or backup', async (content) => {
    fs.writeFileSync(filename, content);
    fs.writeFileSync(filename + '.bak', '{"recovery":"preserve"}');
    const { readDB, updateDB, updateDBWithCas } = await import('../db');
    const mutation = vi.fn(() => undefined);

    await expect(readDB()).rejects.toThrow();
    await expect(updateDB(mutation)).rejects.toThrow();
    await expect(updateDBWithCas(mutation)).rejects.toThrow();

    expect(mutation).not.toHaveBeenCalled();
    expect(fs.readFileSync(filename, 'utf8')).toBe(content);
    expect(fs.readFileSync(filename + '.bak', 'utf8')).toBe('{"recovery":"preserve"}');
    expect(fs.existsSync(filename + '.tmp')).toBe(false);
  });

  it('permits a subsequent mutation after the damaged file is restored', async () => {
    fs.writeFileSync(filename, '');
    const { emptyDB, readDB, updateDB } = await import('../db');
    await expect(updateDB(() => undefined)).rejects.toThrow();
    fs.writeFileSync(filename, JSON.stringify(emptyDB()));
    await expect(updateDB(() => 'restored')).resolves.toBe('restored');
    expect((await readDB()).users).toEqual([]);
  });
});
