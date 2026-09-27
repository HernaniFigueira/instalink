// ═══════════════════════════════════════════════════════════════
// RECONCILIAÇÃO LEGADA DE CONVERSAS — ação explícita (§11–13)
// ═══════════════════════════════════════════════════════════════
// Vincula conversas antigas (criadas sem contactId) a contatos JÁ EXISTENTES
// da mesma unidade, usando a resolução canônica (lib/conversation-identity).
// Idempotente: repetir a ação não muda nada. NUNCA cria contato novo e nunca
// transforma número desconhecido em cliente. A escrita só acontece aqui —
// nunca em leitura.
import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { updateDB } from '@/lib/db';
import { reconcileConversations, type ReconcileOutcome } from '@/lib/conversation-identity';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    // Quem opera a base de clientes/conversas pode reconciliar.
    const guard = await requireBusiness(req, businessId, ['whatsapp', 'clientes']);
    if (!guard.ok) return guard.res;
    const outcome = await updateDB((db) => reconcileConversations(db, businessId)) as ReconcileOutcome | null;
    return NextResponse.json({
      ok: true,
      linked: outcome?.linked ?? 0,
      already: outcome?.already ?? 0,
      unresolved: outcome?.unresolved ?? 0,
      linkedIds: outcome?.linkedIds ?? [],
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível reconciliar as conversas.' }, { status: 500 });
  }
}
