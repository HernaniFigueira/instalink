import { NextRequest, NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';

// Atividade da plataforma — somente eventos REAIS já registrados.
const LABEL: Record<string, string> = {
  'organization.created': 'Organização criada',
  'unit.created': 'Unidade criada',
  'member.created': 'Usuário/membro criado',
  'member.updated': 'Membro alterado',
  'member.removed': 'Membro removido',
  'master.created': 'Master criado',
  'master.promoted': 'Master promovido',
  'master.revoked': 'Master removido',
  'support.view_started': 'Suporte (leitura) iniciado',
  'support.admin_started': 'Suporte (admin) iniciado',
  'support.ended': 'Suporte encerrado',
  'business.viewed': 'Unidade visualizada',
  'business.updated_by_master': 'Unidade editada pelo suporte',
  'user.login': 'Login',
  'feature.updated': 'Módulo alterado',
  'campaign.created': 'Campanha criada',
  'campaign.sent': 'Campanha enviada',
  'agent.updated': 'Agente configurado',
  'whatsapp.connect_requested': 'WhatsApp solicitado',
  'whatsapp.connected': 'WhatsApp conectado',
  'whatsapp.disconnected': 'WhatsApp desconectado',
  'whatsapp.onboarding_blocked': 'WhatsApp bloqueado pela plataforma',
  'whatsapp.onboarding_failed': 'WhatsApp falhou ao conectar',
};

export async function GET(req: NextRequest) {
  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { db } = guard;
  const limit = Math.min(300, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 100));
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();

  let list = db.audit
    .slice()
    .reverse()
    .slice(0, limit)
    .map((a) => {
      const business = a.businessId ? db.businesses.find((b) => b.id === a.businessId) : undefined;
      const orgId = business?.organizationId || (a.meta && (a.meta as any).organizationId) || '';
      const org = orgId ? db.organizations.find((o) => o.id === orgId) : undefined;
      return {
        id: a.id,
        at: a.at,
        action: a.action,
        label: LABEL[a.action] || a.action,
        actorEmail: a.actorEmail,
        actorRole: a.actorRole,
        businessId: a.businessId || '',
        businessName: business?.name || '',
        organizationId: orgId || '',
        organizationName: org?.name || '',
        supportSessionId: a.supportSessionId || '',
        meta: a.meta || {},
      };
    });

  if (q) {
    list = list.filter((e) =>
      (e.label + e.action + e.actorEmail + e.businessName + e.organizationName).toLowerCase().includes(q));
  }

  return NextResponse.json({ total: db.audit.length, activity: list });
}
