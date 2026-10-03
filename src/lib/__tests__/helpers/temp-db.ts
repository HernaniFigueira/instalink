// Isolamento do banco em testes de integração (modo arquivo).
//
// `src/lib/db.ts` decide o caminho do banco local na AVALIAÇÃO do módulo, então
// este helper precisa ser o PRIMEIRO import do arquivo de teste: assim
// GODOUTOR_DB_FILE já está definido quando db.ts for avaliado. Nenhum dado de
// desenvolvimento (data/godoutor.db.json nem o legado data/instalink.db.json)
// é lido ou escrito por esses testes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TEMP_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'godoutor-test-'));
export const TEMP_DB_FILE = path.join(TEMP_DB_DIR, 'godoutor.db.json');

process.env.GODOUTOR_DB_FILE = TEMP_DB_FILE;
