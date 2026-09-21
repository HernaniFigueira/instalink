// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 — EXPORTAR A BASE DE CLIENTES (CSV)
// ═══════════════════════════════════════════════════════════════
// A base é da unidade: sai inteira, com os campos que a própria importação
// entende — ida e volta sem planilha intermediária. Filtros:
//
//   ?q=termo        busca por nome/telefone/e-mail/CPF (a mesma da lista)
//   ?marketing=1    só quem aceita receber promoções
//   ?max=2000       teto de linhas (o CSV não vira despejo gigante por acidente)
//
// A permissão é a de Clientes; o foco é sempre a unidade autenticada — não
// existe exportação global por aqui (o console do master tem o seu caminho).
import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite, runRelationalRead } from '@/lib/relational/slice';
import { EXPORT_LIMIT, filterContactsForExport } from '@/lib/client-export';
import { exportContactsCSV } from '@/lib/client-import';

export async function GET(req: NextRequest) {
  const businessId = String(req.nextUrl.searchParams.get('businessId') || '');
  const guard = await requireBusiness(req, businessId, 'clientes');
  if (!guard.ok) return guard.res;

  const q = String(req.nextUrl.searchParams.get('q') || '');
  const marketingOnly = req.nextUrl.searchParams.get('marketing') === '1';
  const max = Math.min(EXPORT_LIMIT, Math.max(1, Number(req.nextUrl.searchParams.get('max')) || EXPORT_LIMIT));

  let rows: any[];
  if (relationalActive()) {
    // Base da unidade vem do SQL (somente contatos); a auditoria da saída de
    // dado pessoal é gravada na mesma transação da fatia.
    const db = await runRelationalRead(businessId, { contacts: {} });
    const mine = (db.contacts || []).filter((c: any) => c.businessId === businessId);
    rows = filterContactsForExport(mine as any, { q, marketingOnly, max }) as any[];
    await runRelationalWrite(businessId, (d: any) => {
      pushAudit(d, {
        action: 'contact.exported',
        actor: guard.ctx.user,
        businessId,
        meta: { rows: rows.length, q: q.trim(), marketingOnly },
      });
      return true;
    }, { load: {} });
  } else {
    const mine = guard.db.contacts.filter((c) => c.businessId === businessId);
    rows = filterContactsForExport(mine, { q, marketingOnly, max }) as any[];

    // Exportação é saída de dado pessoal: fica registrada (quem, quando, quanto).
    await updateDB((db) => {
      pushAudit(db, {
        action: 'contact.exported',
        actor: guard.ctx.user,
        businessId,
        meta: { rows: rows.length, q: q.trim(), marketingOnly },
      });
    });
  }
  const csv = exportContactsCSV(rows as any);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="clientes-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
