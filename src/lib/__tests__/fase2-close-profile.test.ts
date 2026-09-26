import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { upgradeTemplate, templateFromPreset } from '../clinic-presets';

// ═══════════════════════════════════════════════════════════════
// HOMOLOGAÇÃO · FASE 2 fechamento — Meu perfil, também atende,
// upgrade seguro de templates, docs platform admin.
// ═══════════════════════════════════════════════════════════════
const read = (p: string) => readFileSync(p, 'utf8');

describe('Meu perfil', () => {
  it('rota /perfil no catálogo (sidebar:false) + página existe', () => {
    const panel = read('src/lib/panel.ts');
    expect(panel).toMatch(/href: '\/perfil'[\s\S]*sidebar: false/);
    const page = read('src/app/(dashboard)/perfil/page.tsx');
    expect(page).toContain('Meu perfil');
    expect(page).toContain('conselho');
    expect(page).toContain('Também atende pacientes');
  });

  it('API /api/account: PATCH de perfil + link_as_professional (User ≠ Professional)', () => {
    const api = read('src/app/api/account/route.ts');
    expect(api).toContain('link_as_professional');
    expect(api).toContain('passwordHash'); // only to say it never returns it — check GET shape
    // GET must not leak passwordHash in user payload construction
    expect(api).not.toMatch(/passwordHash:\s*u\.passwordHash/);
    expect(api).toContain('userId: auth.user.id');
    // does not merge entities
    expect(api).toContain('d.professionals.push');
    expect(api).not.toContain('db.users.push');
  });

  it('User tem campos aditivos de perfil; topbar usa foto', () => {
    const types = read('src/lib/types.ts');
    expect(types).toMatch(/phone\?: string/);
    expect(types).toMatch(/photo\?: string/);
    expect(types).toMatch(/conselho\?: string/);
    const menu = read('src/components/dashboard/AccountMenu.tsx');
    expect(menu).toContain('src={user.photo');
    expect(menu).toContain('/perfil');
    const me = read('src/app/api/auth/me/route.ts');
    expect(me).toContain('photo: user.photo');
  });
});

describe('upgrade seguro de templates antigos', () => {
  it('só adiciona campos do preset; preserva customizados; não remove', () => {
    const base = templateFromPreset('veterinaria', () => 't1', '2026-01-01');
    // clínica customizou um campo e adicionou outro
    const customField = { id: 'obs_da_clinica', label: 'Obs da clínica', type: 'text' as const, required: false };
    const old = {
      ...base,
      fields: [
        { ...base.fields[0], label: 'MOTIVO EDITADO PELA CLÍNICA' }, // customizado
        // removeu vários campos do preset
        customField,
      ],
    };
    const { template, addedIds } = upgradeTemplate(old, 'veterinaria', '2026-09-23');
    // custom label preserved
    const motivo = template.fields.find((f) => f.id === 'motivo');
    expect(motivo?.label).toBe('MOTIVO EDITADO PELA CLÍNICA');
    // clinic field kept
    expect(template.fields.some((f) => f.id === 'obs_da_clinica')).toBe(true);
    // missing preset fields re-added
    expect(addedIds).toContain('apetite');
    expect(addedIds).not.toContain('motivo'); // already present — not overwritten
    expect(template.fields.length).toBeGreaterThan(old.fields.length);
    // all preset fields present now
    const presetIds = new Set(base.fields.map((f) => f.id));
    const nowIds = new Set(template.fields.map((f) => f.id));
    for (const id of presetIds) expect(nowIds.has(id)).toBe(true);
  });

  it('template custom puro não ganha campos de preset (skipped na API)', () => {
    const api = read('src/app/api/anamnese/route.ts');
    expect(api).toContain("action === 'template.upgrade'");
    expect(api).toContain("existing.preset === 'custom'");
    expect(api).toContain('skipped: true');
  });
});

describe('docs platform admin (item 14)', () => {
  it('MASTER.md documenta fundação, sem senha compartilhada, guard e Control Center futuro', () => {
    const doc = read('docs/MASTER.md');
    expect(doc).toContain('senha master compartilhada');
    expect(doc).toContain('requireMaster');
    expect(doc).toContain('Control Center');
    expect(doc).toContain('Sem UI de gestão de platform role');
  });
});
