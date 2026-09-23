import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness, requireUser } from '@/lib/access';
import { pushAudit } from '@/lib/audit';

// PERFIL DO USUÁRIO (lojista) — dados pessoais aditivos do User.
// NUNCA expõe passwordHash. "Também atende" cria/vincula Professional ao
// User SEM unir as entidades (User = login; Professional = quem atende).

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const u = auth.user;
  return NextResponse.json({
    user: {
      id: u.id, name: u.name, email: u.email, role: u.role || 'owner',
      phone: u.phone || '', photo: u.photo || '',
      title: u.title || '', conselho: u.conselho || '',
      professionalBio: u.professionalBio || '',
      createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || '',
    },
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  try {
    const body = await req.json();
    const updated = await updateDB((db) => {
      const u = db.users.find((x) => x.id === auth.user.id);
      if (!u) return null;
      if (typeof body.name === 'string' && body.name.trim()) u.name = body.name.trim().slice(0, 120);
      if (typeof body.phone === 'string') u.phone = body.phone.trim().slice(0, 40);
      if (typeof body.photo === 'string') u.photo = body.photo.trim().slice(0, 500);
      if (typeof body.title === 'string') u.title = body.title.trim().slice(0, 120);
      if (typeof body.conselho === 'string') u.conselho = body.conselho.trim().slice(0, 80);
      if (typeof body.professionalBio === 'string') u.professionalBio = body.professionalBio.trim().slice(0, 500);
      // e-mail só se mudou e não colide
      if (typeof body.email === 'string' && body.email.trim()) {
        const email = body.email.trim().toLowerCase();
        if (email !== u.email) {
          if (db.users.some((x) => x.id !== u.id && x.email.toLowerCase() === email)) {
            throw new Error('Este e-mail já está em uso por outra conta.');
          }
          u.email = email;
        }
      }
      return {
        id: u.id, name: u.name, email: u.email, role: u.role || 'owner',
        phone: u.phone || '', photo: u.photo || '',
        title: u.title || '', conselho: u.conselho || '',
        professionalBio: u.professionalBio || '',
      };
    });
    if (!updated) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, user: updated });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Não foi possível salvar o perfil.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// POST { action: 'link_as_professional', businessId, professionalName? }
// Cria (se preciso) um Professional vinculado a ESTE User na unidade.
// User e Professional permanecem entidades separadas — só o vínculo userId.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    if (body.action !== 'link_as_professional') {
      return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
    }
    const guard = await requireBusiness(req, businessId, 'catalogo');
    if (!guard.ok) return guard.res;
    const { db, ctx } = guard;

    const existing = db.professionals.find(
      (p) => p.businessId === businessId && p.userId === auth.user.id,
    );
    if (existing) {
      return NextResponse.json({
        ok: true, alreadyLinked: true,
        professional: { id: existing.id, name: existing.name, role: existing.role || '' },
      });
    }

    const created = await updateDB((d) => {
      const now = new Date().toISOString();
      // Nome padrão: "Dr. {nome}" se vier vazio — o usuário pode editar depois
      // em Profissionais. NÃO copia conselho/telefone do User para cá.
      const name = String(body.professionalName || `Dr. ${auth.user.name}`).trim().slice(0, 120) || `Dr. ${auth.user.name}`;
      // Um login só aponta para UM profissional por unidade.
      if (d.professionals.some((p) => p.businessId === businessId && p.userId === auth.user.id)) {
        const cur = d.professionals.find((p) => p.businessId === businessId && p.userId === auth.user.id)!;
        return { id: cur.id, name: cur.name, role: cur.role || '' };
      }
      const pro = {
        id: randomUUID(), businessId, name,
        role: '', photo: auth.user.photo || '', active: true,
        userId: auth.user.id, followBusinessHours: true,
      };
      d.professionals.push(pro);
      pushAudit(d, {
        action: 'member.professional_linked',
        actor: { ...ctx.user, role: ctx.role },
        businessId, supportSessionId: ctx.support?.id,
        meta: { professionalId: pro.id, userId: auth.user.id, via: 'profile' },
      });
      return { id: pro.id, name: pro.name, role: pro.role };
    });

    return NextResponse.json({
      ok: true, alreadyLinked: false,
      professional: { id: created.id, name: created.name, role: created.role },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Não foi possível vincular o profissional.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
