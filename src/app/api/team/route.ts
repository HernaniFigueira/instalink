import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { requireBusiness, PERMISSIONS, ROLES, isValidPermission, isValidRole, permissionsFor } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import type { BusinessMember, MemberRole, PermissionId } from '@/lib/types';

// EQUIPE — logins internos da empresa (permissões por papel + individuais).
// Regras de governança:
//   • só quem tem a permissão `equipe` acessa;
//   • apenas OWNER cria/edita ADMIN ou mexe em outro OWNER;
//   • ninguém remove a si mesmo nem o proprietário;
//   • o proprietário nunca perde acesso (permissionsFor garante).
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'equipe');
  if (!guard.ok) return guard.res;
  const { db, ctx } = guard;
  const members = db.members.filter((m) => m.businessId === businessId);
  const users = new Map(db.users.map((u) => [u.id, u]));
  return NextResponse.json({
    roles: ROLES,
    permissions: PERMISSIONS,
    me: { userId: ctx.user.id, role: ctx.role, isOwner: ctx.isOwner, permissions: ctx.permissions },
    owner: (() => {
      const o = db.users.find((u) => u.id === ctx.business.ownerId);
      return o ? { userId: o.id, name: o.name, email: o.email, role: 'OWNER' as MemberRole } : null;
    })(),
    members: members.map((m) => {
      const u = users.get(m.userId);
      return {
        id: m.id, userId: m.userId, name: u?.name || 'Usuário', email: u?.email || '',
        role: m.role, permissions: permissionsFor(m.role, m.permissions),
        active: m.active !== false, note: m.note || '', createdAt: m.createdAt,
        lastLoginAt: u?.lastLoginAt || '',
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'equipe');
    if (!guard.ok) return guard.res;
    const { ctx } = guard;

    const name = String(body.name || '').trim().slice(0, 80);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 160);
    const password = String(body.password || '');
    const role: MemberRole = isValidRole(body.role) ? body.role : 'ATENDENTE';
    if (!name) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 });
    if (!email.includes('@')) return NextResponse.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: 'A senha precisa de ao menos 6 caracteres.' }, { status: 400 });
    // Nunca aceitar role de plataforma via equipe da Organization.
    if (String(body.role || '').toLowerCase() === 'master' || body.platformRole === 'master') {
      return NextResponse.json({ error: 'Não é possível atribuir o papel Master por esta rota.' }, { status: 403 });
    }
    if (role === 'OWNER') return NextResponse.json({ error: 'O proprietário é único. Use Administrador.' }, { status: 400 });
    if (role === 'ADMIN' && !ctx.isOwner && ctx.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Só o proprietário/administrador pode criar administradores.' }, { status: 403 });
    }
    const overrides: Partial<Record<PermissionId, boolean>> = {};
    if (body.permissions && typeof body.permissions === 'object') {
      for (const key of Object.keys(body.permissions)) {
        if (isValidPermission(key)) overrides[key] = body.permissions[key] === true;
      }
    }

    // E-mail já existe = pessoa que já tem login (outro negócio). NUNCA
    // duplicamos conta nem sobrescrevemos senha: apenas vinculamos.
    const db0 = await readDB();
    if (db0.members.some((m) => m.businessId === businessId && db0.users.find((u) => u.id === m.userId)?.email === email)) {
      return NextResponse.json({ error: 'Esta pessoa já faz parte da equipe.' }, { status: 400 });
    }
    const existingUser = db0.users.find((u) => u.email === email);

    const created = await updateDB((db) => {
      const now = new Date().toISOString();
      let userId = existingUser?.id || '';
      if (!userId) {
        userId = randomUUID();
        // role de plataforma SEMPRE 'owner' — Owner/Admin NÃO promovem a master.
        db.users.push({ id: userId, name, email, passwordHash: hashPassword(password), createdAt: now, role: 'owner', lastLoginAt: '' });
      }
      const member: BusinessMember = {
        id: randomUUID(), businessId, userId, role, permissions: overrides,
        active: true, note: String(body.note || '').slice(0, 200),
        invitedBy: ctx.user.id, createdAt: now, updatedAt: now,
      };
      db.members.push(member);
      pushAudit(db, {
        action: 'member.created', actor: { ...ctx.user, role: ctx.role }, businessId,
        supportSessionId: ctx.support?.id, meta: { role, linkedExistingUser: !!existingUser, email },
      });
      return { member, linked: !!existingUser };
    });

    return NextResponse.json({ ok: true, linkedExistingUser: created.linked, memberId: created.member.id });
  } catch {
    return NextResponse.json({ error: 'Não foi possível criar o acesso.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'equipe');
    if (!guard.ok) return guard.res;
    const { ctx, db } = guard;
    const member = db.members.find((m) => m.id === String(body.id) && m.businessId === businessId);
    if (!member) return NextResponse.json({ error: 'Membro não encontrado.' }, { status: 404 });
    if (member.role === 'OWNER') return NextResponse.json({ error: 'O proprietário não pode ser editado.' }, { status: 403 });
    if (!ctx.isOwner && ctx.role !== 'ADMIN' && member.role === 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão para editar administradores.' }, { status: 403 });
    }
    if (body.role !== undefined && body.role === 'ADMIN' && !ctx.isOwner && ctx.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão para promover a administrador.' }, { status: 403 });
    }

    const updated = await updateDB((d) => {
      const m = d.members.find((x) => x.id === member.id)!;
      if (isValidRole(body.role) && body.role !== 'OWNER') m.role = body.role;
      if (typeof body.active === 'boolean') m.active = body.active;
      if (body.note !== undefined) m.note = String(body.note || '').slice(0, 200);
      if (body.permissions && typeof body.permissions === 'object') {
        const next = { ...(m.permissions || {}) };
        for (const key of Object.keys(body.permissions)) {
          if (isValidPermission(key)) next[key] = body.permissions[key] === true;
        }
        m.permissions = next;
      }
      m.updatedAt = new Date().toISOString();
      pushAudit(d, {
        action: 'member.updated', actor: { ...ctx.user, role: ctx.role }, businessId,
        supportSessionId: ctx.support?.id, meta: { memberId: m.id, role: m.role, active: m.active },
      });
      return m;
    });
    return NextResponse.json({ ok: true, member: { id: updated.id, role: updated.role, active: updated.active } });
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar o membro.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId') || '';
    const id = req.nextUrl.searchParams.get('id') || '';
    const guard = await requireBusiness(req, businessId, 'equipe');
    if (!guard.ok) return guard.res;
    const { ctx, db } = guard;
    const member = db.members.find((m) => m.id === id && m.businessId === businessId);
    if (!member) return NextResponse.json({ error: 'Membro não encontrado.' }, { status: 404 });
    if (member.userId === ctx.user.id) return NextResponse.json({ error: 'Você não pode remover seu próprio acesso.' }, { status: 400 });
    if (member.role === 'ADMIN' && !ctx.isOwner && ctx.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão para remover administradores.' }, { status: 403 });
    }
    await updateDB((d) => {
      d.members = d.members.filter((x) => x.id !== member.id);
      // Sessões do usuário removido caem junto (isolamento imediato).
      const stillMember = d.members.some((x) => x.userId === member.userId && x.active !== false);
      const ownsAnything = d.businesses.some((b) => b.ownerId === member.userId);
      if (!stillMember && !ownsAnything) {
        d.sessions = d.sessions.filter((s) => s.userId !== member.userId);
      }
      pushAudit(d, {
        action: 'member.removed', actor: { ...ctx.user, role: ctx.role }, businessId,
        supportSessionId: ctx.support?.id, meta: { memberId: member.id, role: member.role },
      });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível remover o acesso.' }, { status: 500 });
  }
}
