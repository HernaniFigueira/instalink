// ═══════════════════════════════════════════════════════════════
// GODOUTOR Clinical OS · ONDA 2 (convergência) — travas de contrato
// ═══════════════════════════════════════════════════════════════
// Cada bloco abaixo congela UMA decisão da convergência para a onda não
// regredir silenciosamente na revisão do PR. Pin de fonte (read) é usado
// onde o comportamento é estrutural (nenhum outro chamador exercita); onde
// dá para exercitar de verdade, o teste é conduta, não texto.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COOKIE_NAME, LEGACY_COOKIE_NAME, sessionCookieId, setSessionOn, clearSessionOn,
} from '../auth';
import { resolveLocalDbFile, LEGACY_DOC_TABLE } from '../db';
import { CLINIC_THEME_PRESETS, THEME_PRESETS, presetById } from '../themes';
import { NextResponse } from 'next/server';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('1 · sessão: cookie canônico com dual-read de drenagem', () => {
  it('nomes: godoutor_session é o canônico; il_session é o legado', () => {
    expect(COOKIE_NAME).toBe('godoutor_session');
    expect(LEGACY_COOKIE_NAME).toBe('il_session');
  });
  it('sessionCookieId: canônico VENCE; legado só entra como fallback de leitura', () => {
    const mk = (vals: Record<string, string>) => ({ get: (n: string) => (vals[n] ? { value: vals[n] } : undefined) });
    expect(sessionCookieId(mk({ [COOKIE_NAME]: 'A', [LEGACY_COOKIE_NAME]: 'B' }))).toBe('A');
    expect(sessionCookieId(mk({ [LEGACY_COOKIE_NAME]: 'B' }))).toBe('B');
    expect(sessionCookieId(mk({}))).toBeUndefined();
  });
  it('login grava o canônico e PURGA o legado; logout limpa os dois', () => {
    const res = NextResponse.json({ ok: true });
    setSessionOn(res, 'sess-1');
    const all = res.cookies.getAll();
    expect(all.find((c) => c.name === COOKIE_NAME)?.value).toBe('sess-1');
    const legacy = all.find((c) => c.name === LEGACY_COOKIE_NAME);
    expect(legacy?.value).toBe('');
    const setCookies = String(res.headers.get('set-cookie') || '') + JSON.stringify(all);
    expect(/il_session=;?.*Max-Age=0|il_session.*maxAge.{0,4}0/i.test(setCookies.replace(/"/g, '')), 'purga tem Max-Age=0').toBe(true);
    const out = NextResponse.json({ ok: true });
    clearSessionOn(out);
    const names = out.cookies.getAll().map((c) => c.name).sort();
    expect(names).toEqual([LEGACY_COOKIE_NAME, COOKIE_NAME].sort());
    expect(out.cookies.getAll().every((c) => c.value === '')).toBe(true);
  });
  it('leitores da app-session passaram pelo ponto único (nenhum .get(COOKIE_NAME) solto)', () => {
    // O anti-padrão que o guard de leitura única caça: `.get(COOKIE_NAME)`
    // fora do próprio auth.ts (onde é a definição) — todos os consumidores
    // leem via sessionCookieId (precedência + fallback num lugar só).
    for (const f of ['src/lib/tenant.ts', 'src/lib/public.ts', 'src/lib/access.ts', 'src/app/api/auth/logout/route.ts', 'src/app/api/auth/password/route.ts']) {
      expect(read(f), f).not.toMatch(/\.get\(COOKIE_NAME\)/);
      expect(read(f), f).not.toMatch(/get\('il_session'\)/);
    }
    expect(read('src/lib/auth.ts')).toContain('store.get(COOKIE_NAME)');
  });
});

describe('2 · ambiente: variável canônica com alias e preservação do arquivo legado', () => {
  const saved = { gd: process.env.GODOUTOR_DB_FILE, il: process.env.INSTALINK_DB_FILE };
  afterEach(() => {
    if (saved.gd === undefined) delete process.env.GODOUTOR_DB_FILE; else process.env.GODOUTOR_DB_FILE = saved.gd;
    if (saved.il === undefined) delete process.env.INSTALINK_DB_FILE; else process.env.INSTALINK_DB_FILE = saved.il;
  });
  it('GODOUTOR_DB_FILE vence; INSTALINK_DB_FILE continua sendo ALIAS de compat', () => {
    process.env.GODOUTOR_DB_FILE = '/tmp/canônico.json';
    process.env.INSTALINK_DB_FILE = '/tmp/legado.json';
    expect(resolveLocalDbFile()).toBe('/tmp/canônico.json');
    delete process.env.GODOUTOR_DB_FILE;
    expect(resolveLocalDbFile()).toBe('/tmp/legado.json');
  });
  it('sem env: se SÓ o data/instalink.db.json existir, ele é PRESERVADO (ninguém perde dado por renomeação)', () => {
    delete process.env.GODOUTOR_DB_FILE;
    delete process.env.INSTALINK_DB_FILE;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-legacydb-'));
    try {
      fs.mkdirSync(path.join(dir, 'data'));
      fs.writeFileSync(path.join(dir, 'data', 'instalink.db.json'), '{}');
      expect(resolveLocalDbFile(dir)).toBe(path.join(dir, 'data', 'instalink.db.json'));
      fs.writeFileSync(path.join(dir, 'data', 'godoutor.db.json'), '{}');
      expect(resolveLocalDbFile(dir)).toBe(path.join(dir, 'data', 'godoutor.db.json'));
      fs.rmSync(path.join(dir, 'data', 'instalink.db.json'));
      fs.rmSync(path.join(dir, 'data', 'godoutor.db.json'));
      expect(resolveLocalDbFile(dir)).toBe(path.join(dir, 'data', 'godoutor.db.json'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('tabela Postgres do doc: nome legado CONFINADO à constante com plano de migração P1', () => {
    expect(LEGACY_DOC_TABLE).toBe('instalink_doc');
    const db = read('src/lib/db.ts');
    expect(db).toContain('PLANO P1');
    // nenhum SQL cru com o identificador fora da construção via template —
    // sempre `FROM/INTO/UPDATE ${LEGACY_DOC_TABLE}`.
    expect(db).not.toMatch(/['\"](SELECT|INSERT|UPDATE) .*instalink_doc/);
    expect(db).toMatch(/FROM \$\{LEGACY_DOC_TABLE\}/);
    expect(read('scripts/seed.mjs')).toContain('Tabela LEGADAMENTE nomeada');
  });
});

describe('3 · onboarding/rotas: preset inicial e cópias sob GODOUTOR_LEGACY_PAGES', () => {
  const route = read('src/app/api/businesses/route.ts');
  it('OFF, a unidade nasce com preset clínico; o fallback por nicho só existe no ramo de compat', () => {
    expect(route).toContain("legacyPages ? defaultPresetId(niche) : 'clinica-geral'");
  });
  it('cópias da API de criação são clínicas fora do ramo legado', () => {
    expect(route).toContain("'Muitas clínicas criadas. Aguarde um pouco.'");
    expect(route).toContain("'Dê um nome à sua clínica.'");
    expect(route).toContain("'Não conseguimos criar sua clínica. Tente novamente.'");
  });
  it('payload niche/modes é documentado como COMPATIBILIDADE, não como fluxo', () => {
    expect(route).toMatch(/payload de compatibilidade/i);
  });
});

describe('4 · temas: catálogo clínico sem comércio; ids legados resolvíveis', () => {
  it('CLINIC_THEME_PRESETS exclui os modelos marcados commerce', () => {
    for (const id of ['limao', 'pordosol', 'noite', 'cafe']) {
      expect(CLINIC_THEME_PRESETS.some((p) => p.id === id), id).toBe(false);
    }
    expect(CLINIC_THEME_PRESETS.length).toBeLessThan(THEME_PRESETS.length);
  });
  it('remoção é de CATÁLOGO, não de dados: presetById resolve todo id legado', () => {
    for (const p of THEME_PRESETS) expect(presetById(p.id).id).toBe(p.id);
  });
  it('o picker aplica o filtro pela MESMA flag do produto (sem lista paralela)', () => {
    const src = read('src/app/(dashboard)/pagina/page.tsx');
    expect(src).toContain('isLegacyPagesEnabled() ? THEME_PRESETS : CLINIC_THEME_PRESETS');
  });
});

describe('5 · nav/busca: destinos legados fora do menu padrão (filtrados, nunca apagados)', () => {
  it('shell filtra /pagina do menu-busca quando a flag está OFF', () => {
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).toContain('isHiddenLegacyNavRoute(route.href, legacyPagesEnabled)');
    // a busca lê do MESMO nav.allowed (nenhum destino extra).
    expect(shell).toMatch(/nav\.allowed/);
  });
  it('/perfil continua existindo como conta do usuário (sidebar:false, fora do menu)', () => {
    const panel = read('src/lib/panel.ts');
    expect(panel).toMatch(/href: '\/perfil'[\s\S]{0,240}sidebar: false/);
  });
  it('configuracoes declara o que só aparece com a flag (endereço público legado)', () => {
    expect(read('src/app/(dashboard)/configuracoes/page.tsx')).toContain('endereço público legado — GODOUTOR_LEGACY_PAGES');
  });
});

describe('6 · branding: eventos/atores/formatters GoDoutor', () => {
  it('postMessage do widget renomeado nos DOIS lados (host e script)', () => {
    expect(read('src/app/widget/booking.js/route.ts')).toContain('godoutor:height');
    expect(read('src/components/public/AgendarFlow.tsx')).toContain('godoutor:height');
    // ids de embed: o novo é canônico e o legado CONTINUA resolvido.
    const w = read('src/app/widget/booking.js/route.ts');
    expect(w).toContain("getElementById('godoutor-booking')");
    expect(w).toContain("getElementById('instalink-booking')");
  });
  it('atores de sistema nasceram @godoutor.app', () => {
    expect(read('src/lib/instagram-api.ts')).toContain('instagram@godoutor.app');
    expect(read('src/app/api/whatsapp/webhook/route.ts')).not.toContain('@instalink.app');
  });
  it('formato do export completo de clientes é godoutor.customers.full', () => {
    expect(read('src/app/api/contacts/export-full/route.ts')).toContain("format: 'godoutor.customers.full'");
    expect(read('src/app/api/entity-deletion/route.ts')).toContain("req.headers.get('x-godoutor-action')??req.headers.get('x-instalink-action')");
  });
});

describe('7 · seed de demonstração: três clínicas, sem vitrine falsa', () => {
  const seed = read('scripts/seed.mjs');
  it('três unidades clínicas com preset por tipo (veterinária/odontológica/geral)', () => {
    for (const s of ['biz-vidavet', 'biz-odontovitta', 'biz-clinicageral']) expect(seed, s).toContain(s);
    for (const p of ['clinica-veterinaria', 'clinica-odontologica', 'clinica-geral']) expect(seed, p).toContain(p);
  });
  it('produtos/pedidos VAZIOS de propósito (ramo de compatibilidade documentado)', () => {
    expect(seed).toMatch(/products: \[\],\s*\n\s*options: \[\],\s*\n\s*optionValues: \[\],\s*\n\s*orders: \[\],/);
    expect(seed).toContain('RAMO DE COMPATIBILIDADE');
  });
  it('e2e e suítes esperam exatamente este seed (vínculos de QA)', () => {
    expect(seed).toContain("'pro-caio'");
    expect(read('scripts/smoke-agendar.mjs')).toContain('biz-vidavet');
    expect(read('scripts/smoke-agendar.mjs')).toContain('biz-odontovitta');
  });
});
