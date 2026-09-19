// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 — IMPORTAR A BASE DE CLIENTES (prévia + gravação)
// ═══════════════════════════════════════════════════════════════
// Duas fases na MESMA rota, de propósito:
//
//   POST { mode: 'preview' }  → devolve o PLANO (o que cada linha faria)
//   POST { mode: 'commit' }   → aplica o plano
//
// A prévia e a gravação usam o MESMO planejador puro (`lib/client-import`), e
// a gravação RODA O PLANO DE NOVO dentro da transação — o arquivo não é fonte
// de verdade sobre a base: se alguém criou o contato no meio do caminho, a
// linha vira atualização em vez de cadastro duplicado.
//
// A identidade é a do CRM (`findContact`): telefone em dígitos, e-mail em
// minúsculas, nunca nome. A régua dos campos é a do Bloco 6.
import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { upsertContact } from '@/lib/contacts';
import { normalizeContactProfile, profileOf } from '@/lib/contact-profile';
import {
  IMPORT_MAX_CHARS, buildImportPlan, importSummary, parseImportFile,
} from '@/lib/client-import';
import type { DB } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'clientes');
    if (!guard.ok) return guard.res;

    const csv = String(body.csv || '');
    const mode = String(body.mode || 'preview') === 'commit' ? 'commit' : 'preview';
    if (!csv.trim()) return NextResponse.json({ error: 'Cole ou escolha um arquivo CSV com a base.' }, { status: 400 });
    if (csv.length > IMPORT_MAX_CHARS) {
      return NextResponse.json({ error: 'Arquivo grande demais (máximo ~2 MB). Divida em partes.' }, { status: 400 });
    }

    const parsed = parseImportFile(csv);
    if (parsed.headerError) return NextResponse.json({ error: parsed.headerError }, { status: 400 });

    const existing = guard.db.contacts.filter((c) => c.businessId === businessId);
    const plan = buildImportPlan(parsed, existing);

    if (mode === 'preview') {
      return NextResponse.json({
        ok: true,
        mode,
        summary: importSummary(plan),
        plan,
      });
    }

    // ── Gravação ────────────────────────────────────────────────
    // O plano é RECALCULADO aqui dentro: entre a prévia e a confirmação a base
    // pode ter mudado (outra pessoa cadastrou, o WhatsApp criou o contato…).
    const result = await updateDB((db: DB) => {
      const current = db.contacts.filter((c) => c.businessId === businessId);
      const fresh = buildImportPlan(parsed, current);
      const now = new Date().toISOString();
      let created = 0;
      let updated = 0;

      for (const row of fresh.rows) {
        if (row.action !== 'create' && row.action !== 'update') continue;
        const before = row.contactId ? db.contacts.find((c) => c.id === row.contactId) : undefined;
        const contact = upsertContact(db, {
          businessId,
          customerId: before?.customerId || '',
          name: row.name,
          phone: row.phone,
          email: row.email,
          // Consentimento de marketing NUNCA é presumido: só entra o que o
          // arquivo diz explicitamente (coluna ausente = não mexe).
          marketingOptIn: row.marketingOptIn ? true : (before?.marketingOptIn === true),
          source: before?.source || 'importacao',
          now,
        });
        if (!contact) continue;
        if (before) updated += 1; else created += 1;

        // Perfil rico (CPF/nascimento/endereço): MESMA normalização do cadastro,
        // aplicada por cima do que já existia — nunca apaga o que não veio no
        // arquivo (o merge é parcial por campo, como no PATCH da ficha).
        if (row.cpf || row.birthDate || row.cep || row.street || row.city || row.state) {
          const patch = {
            cpf: row.cpf || undefined,
            birthDate: row.birthDate || undefined,
            address: (row.cep || row.street || row.number || row.city || row.state) ? {
              cep: row.cep || undefined, street: row.street || undefined,
              number: row.number || undefined, city: row.city || undefined, state: row.state || undefined,
            } : undefined,
          };
          contact.profile = normalizeContactProfile(patch, profileOf(contact));
        }
      }

      pushAudit(db, {
        action: 'contact.imported',
        actor: guard.ctx.user,
        businessId,
        meta: {
          created, updated, skipped: fresh.skip, errors: fresh.error,
          total: fresh.total, columns: Object.keys(fresh.mapped),
        },
      });
      return { created, updated, skipped: fresh.skip, errors: fresh.error, total: fresh.total, rows: fresh.rows };
    });

    return NextResponse.json({
      ok: true,
      mode,
      summary: importSummary({ ...plan, rows: result.rows } as any),
      result: { created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors, total: result.total },
      plan: { ...plan, rows: result.rows },
    });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    if (status === 500) console.error('[contacts/import] falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível importar a base agora.' : e.message }, { status });
  }
}
