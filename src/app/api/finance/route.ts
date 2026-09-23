import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { filterEntries, summarize, validateEntry, FINANCE_KINDS, FINANCE_STATUSES } from '@/lib/finance';
import type { FinanceEntry, FinanceKind, FinanceStatus } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P7 — FINANCEIRO BÁSICO (API)
// ═══════════════════════════════════════════════════════════════
// Permissão 'financeiro' (dono/admin/recepção conforme papel). Sem gateway:
// PIX/cartão aqui são FORMAS REGISTRADAS, nada é cobrado de verdade.
// GET  ?businessId= (+ filtros opcionais) → entries + summary + charts
// POST { action: 'create' | 'update' | 'delete', ... }

function parseFilters(sp: URLSearchParams): import('@/lib/finance').FinanceFilters {
  return {
    from: sp.get('from') || '',
    to: sp.get('to') || '',
    professionalId: sp.get('professionalId') || '',
    serviceId: sp.get('serviceId') || '',
    contactId: sp.get('contactId') || '',
    status: (FINANCE_STATUSES as string[]).includes(sp.get('status') || '') ? (sp.get('status') as FinanceStatus) : '',
    method: sp.get('method') || '',
    kind: FINANCE_KINDS.includes(sp.get('kind') as FinanceKind) ? (sp.get('kind') as FinanceKind) : '',
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const businessId = sp.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'financeiro');
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const all = db.financeEntries.filter((e) => e.businessId === businessId);
  const entries = filterEntries(all, parseFilters(sp))
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : a.createdAt < b.createdAt ? 1 : -1));
  // Charts usam SEMPRE o recorte de período (mesmo sem filtros de status etc).
  const period = filterEntries(all, { from: parseFilters(sp).from, to: parseFilters(sp).to });
  return NextResponse.json({
    entries,
    summary: summarize(entries),
    total: all.length,
    charts: { period, summaryAll: summarize(period) },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'financeiro');
    if (!guard.ok) return guard.res;
    const { ctx } = guard;
    const action = String(body.action || '');

    if (action === 'create' || action === 'update') {
      const input = (body.entry || {}) as Partial<FinanceEntry>;
      const problem = validateEntry({
        ...input,
        status: input.status || 'pendente',
        kind: input.kind || 'receita',
        dueDate: input.dueDate || '',
        paidAt: input.paidAt || '',
        description: input.description || '',
      });
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });

      const saved = await updateDB((db) => {
        const now = new Date().toISOString();
        const base = {
          kind: input.kind as FinanceKind,
          status: (input.status || 'pendente') as FinanceStatus,
          amount: Math.round(Number(input.amount)),
          description: String(input.description || '').trim().slice(0, 160),
          dueDate: String(input.dueDate || ''),
          paidAt: String(input.status === 'pago' ? (input.paidAt || input.dueDate || '') : (input.paidAt || '')),
          method: String(input.method || '').slice(0, 40),
          contactId: String(input.contactId || ''),
          bookingId: String(input.bookingId || ''),
          serviceId: String(input.serviceId || ''),
          professionalId: String(input.professionalId || ''),
          encounterId: String(input.encounterId || ''),
          note: String(input.note || '').slice(0, 500),
          updatedAt: now,
        };
        const id = String(input.id || '');
        const existing = id ? db.financeEntries.find((e) => e.id === id && e.businessId === businessId) : undefined;
        if (existing) {
          Object.assign(existing, base);
          return existing;
        }
        const entry: FinanceEntry = {
          id: randomUUID(), businessId, ...base, createdAt: now, createdBy: ctx.user.id,
        };
        db.financeEntries.push(entry);
        return entry;
      });
      return NextResponse.json({ ok: true, entry: saved });
    }

    if (action === 'delete') {
      const id = String(body.id || '');
      await updateDB((db) => {
        db.financeEntries = db.financeEntries.filter((e) => !(e.id === id && e.businessId === businessId));
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Não foi possível concluir a operação.' }, { status: 500 });
  }
}
