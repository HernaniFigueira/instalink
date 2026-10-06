// ═══════════════════════════════════════════════════════════════
// REFINO FINAL DE CONSISTÊNCIA · identidade persistente + contraste
// estrutural + fundo único + flyout/radius/topbar (critérios travados).
//
// IDENTIDADE (testes obrigatórios A–D):
//   A) cliente existente → "Na base" e F5 NÃO regride (registered vem do
//      MESMO resolve na lista E no detalhe);
//   B) contato novo → cadastrar → link_contact persiste → F5 continua;
//   C) telefone em formatos diferentes → MESMA identidade;
//   D) nunca duplica (upsert/resolve acham o mesmo registro).
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  conversationPhoneKey, conversationRegistered, resolveConversationContact,
} from '../conversation-identity';
import { bestFgOn, contrastRatio, findAccent } from '../nav-accent';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const api = read('src/app/api/conversations/route.ts');
const view = read('src/components/dashboard/ConversationsView.tsx');
const css = read('src/app/globals.css');

const CONV = (over: Record<string, unknown> = {}) => ({
  contactId: '', customerId: '', phone: '21999999999', businessId: 'biz-1', ...over,
});
const DB = (contacts: Array<Record<string, unknown>>) => ({ contacts } as never);

describe('A — cliente existente: "Na base" e F5 NÃO regride', () => {
  it('a autoridade é única: lista E detalhe calculam registered pela MESMA função', () => {
    // lista (GET sem id)
    expect(api).toContain('registered: conversationRegistered(db, businessId, c)');
    // detalhe (GET com id) — o bug era o detalhe NÃO calcular e o badge ler
    // undefined ("Contato novo" para qualquer pessoa conhecida + regride no F5)
    expect(api).toContain('registered: conversationRegistered(db, businessId, conv)');
  });

  it('Laura reconhecida (telefone em outro formato) = registered true nas duas leituras', () => {
    const db = DB([
      { id: 'ct-laura', businessId: 'biz-1', name: 'Laura Andrade', phone: '5521999999999' },
    ]);
    // conversa com telefone em formato diferente do contato
    const conv = CONV({ phone: '(21) 99999-9999', contactId: '', customerId: '' });
    expect(resolveConversationContact(db, 'biz-1', conv)?.id).toBe('ct-laura');
    expect(conversationRegistered(db, 'biz-1', conv)).toBe(true);
  });
});

describe('B — contato novo: cadastrar persiste e F5 continua', () => {
  it('link_contact grava conversation.contactId (persistência real, não estado local)', () => {
    expect(api).toMatch(/conv\.contactId = contact\.id/);
    expect(api).toMatch(/if \(!conv\.customerId && contact\.customerId\) conv\.customerId = contact\.customerId/);
  });

  it('a UI só marca "Na base" DEPOIS do servidor confirmar o vínculo', () => {
    const i = view.indexOf('async function onQuickSaved');
    const fn = view.slice(i, i + 1200);
    // sem confirmação → erro explícito e NENHUM patch de badge
    expect(fn).toContain('if (!linked.ok)');
    expect(fn.indexOf('if (!linked.ok)')).toBeLessThan(fn.indexOf('registered: true'));
    // o patch regista o contactId local também (estado coerente com o gravado)
    expect(fn).toContain('contactId: contact.id');
  });

  it('com o vínculo gravado, o resolve acha SEMPRE (F5 = mesma resposta)', () => {
    const db = DB([{ id: 'ct-novo', businessId: 'biz-1', name: 'Novo', phone: '5511911112222' }]);
    const conv = CONV({ contactId: 'ct-novo', phone: '' }); // sem telefone: acha pelo id
    expect(conversationRegistered(db, 'biz-1', conv)).toBe(true);
  });
});

describe('C — telefone em formatos diferentes = MESMA identidade', () => {
  it('(21) 99999-9999 · 5521999999999 · 21999999999 → mesma chave', () => {
    const a = conversationPhoneKey('(21) 99999-9999');
    const b = conversationPhoneKey('5521999999999');
    const c = conversationPhoneKey('21999999999');
    expect(a).toBe('21999999999');
    expect(b).toBe('21999999999');
    expect(c).toBe('21999999999');
    const db = DB([{ id: 'ct-1', businessId: 'biz-1', name: 'X', phone: '21999999999' }]);
    for (const phone of ['(21) 99999-9999', '5521999999999', '21999999999']) {
      expect(resolveConversationContact(db, 'biz-1', CONV({ phone }))?.id, phone).toBe('ct-1');
    }
  });

  it('9º dígito ausente também casa (fixo × celular antigo)', () => {
    const db = DB([{ id: 'ct-2', businessId: 'biz-1', name: 'Y', phone: '2199999999' }]);
    expect(resolveConversationContact(db, 'biz-1', CONV({ phone: '21999999999' }))?.id).toBe('ct-2');
    expect(resolveConversationContact(db, 'biz-1', CONV({ phone: '(21) 9999-9999' }))?.id).toBe('ct-2');
  });
});

describe('D — nunca duplica', () => {
  it('o resolve sempre devolve o MESMO registro para variações do mesmo contato', () => {
    const db = DB([{ id: 'ct-u', businessId: 'biz-1', name: 'Z', phone: '5511977770001' }]);
    const ids = new Set([
      resolveConversationContact(db, 'biz-1', CONV({ phone: '(11) 97777-0001' }))?.id,
      resolveConversationContact(db, 'biz-1', CONV({ phone: '11977770001' }))?.id,
      resolveConversationContact(db, 'biz-1', CONV({ phone: '5511977770001', contactId: 'ct-u' }))?.id,
    ]);
    expect(ids.size).toBe(1);
  });
});

describe('contraste ESTRUTURAL (temas claros/escuros) — fg sempre pelo bg real', () => {
  it('branco/neutro/amarelo suave/verde/azul/vinho/ônix: par ativo AA ≥ 4.5', () => {
    for (const id of ['branco', 'neutro', 'amarelo-suave', 'verde-salvia', 'azul-clinico', 'vinho', 'onix']) {
      const preset = findAccent(id);
      expect(preset, id).toBeTruthy();
      const fg = preset!.vars['--il-nav-active-fg'];
      const bg = preset!.vars['--il-nav-active'];
      expect(contrastRatio(fg, bg), `${id} (${bg} × ${fg})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('bestFgOn: fundo escuro → fg claro; fundo claro → fg near-black', () => {
    expect(bestFgOn('#18181b')).toBe('#ffffff');
    expect(bestFgOn('#f59e0b')).toBe('#18181b'); // âmbar médio (preto vence)
    expect(bestFgOn('#fde68a')).toBe('#18181b'); // amarelo claro
    expect(bestFgOn('#ffffff')).toBe('#18181b');
    // sempre o par de maior contraste (AA mínimo em qualquer caso)
    for (const bg of ['#111827', '#3b82f6', '#fbbf24', '#fef9c3', '#14532d', '#7f1d1d', '#27272a']) {
      expect(contrastRatio(bestFgOn(bg), bg), bg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('monograma da clínica usa o par accent/contrast (nunca fg fixo)', () => {
    // MISSÃO UX CLOSURE: o monograma da clínica mudou para `.ws-clinic__mark`
    // (a IDENTIDADE vive na topbar). O contrato é o MESMO par accent/contrast.
    expect(css).toMatch(/\.ws-clinic__mark[\s\S]{0,300}background: var\(--accent\); color: var\(--accent-contrast\)/);
    // e o antigo cabeçalho da sidebar não existe mais (nem no componente, nem no CSS)
    expect(css).not.toContain('.workspace-clinic-head__mark');
  });
});

describe('fundo do workspace · UMA fonte de verdade', () => {
  it('token --workspace-bg único; shell aplica; Agenda sem bg externo', () => {
    // DS 1.0: o valor vem da fonte única; aqui é só alias.
    expect(css).toContain('--workspace-bg: var(--gd-bg-app)');
    expect(css).toContain('background: var(--workspace-bg)');
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).not.toContain("bg-[var(--bg)]"); // segunda fonte removida
  });
});

describe('flyout · radius · topbar (contrato final)', () => {
  it('flyout: zero box-shadow (só borda + contraste)', () => {
    const peek = css.slice(css.indexOf('.ws-peek {'), css.indexOf('@keyframes ws-peek-in'));
    expect(peek).toMatch(/box-shadow:\s*none/);
  });

  it('DS 1.0 §12 — sem canto decorativo: a topbar é full-width ACIMA e a divisa é a borda da sidebar', () => {
    const col = css.slice(css.indexOf('.workspace-main-col {'), css.indexOf('.workspace-content {'));
    expect(col).not.toContain('border-bottom-left-radius');
    expect(col).not.toContain('border-top-left-radius');
    // topbar 100% na primeira linha do shell; navegação abaixo dela
    expect(css).toContain('.workspace-shell > .ws-topbar { flex: 0 0 100%; width: 100%; order: -1; }');
    expect(css).toMatch(/\.il-platform \.workspace-sidebar \{[\s\S]*?top: var\(--gd-topbar-h\)/);
  });

  it('topbar: "+" e sino no MESMO contrato (repouso limpo; card só em hover)', () => {
    const plus = css.slice(css.indexOf('.ws-quickcreate-btn {'), css.indexOf('.ws-quickcreate-pop'));
    expect(plus).toContain('background: transparent');
    expect(plus).toMatch(/border: 1px solid transparent/);
    expect(plus).not.toMatch(/box-shadow:\s*0/); // nenhuma sombra no repouso
    const bell = css.slice(css.indexOf('.ws-topbar__icon-button {'), css.indexOf('.ws-topbar__nav-toggle'));
    expect(bell).toMatch(/border: 1px solid transparent/);
    // hover dos dois = surface + border (mesmo card)
    expect(plus).toContain('background: var(--surface-hover)');
    expect(bell).toContain('background: var(--surface-hover)');
    expect(plus).toContain('border-color: var(--border)');
    expect(bell).toContain('border-color: var(--border)');
  });
});
