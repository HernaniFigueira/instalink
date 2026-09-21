import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { requireBusiness, PERMISSIONS, ROLES, isValidPermission, isValidRole, permissionsFor } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite, runRelationalRead } from '@/lib/relational/slice';
import type { BusinessMember, MemberRole, PermissionId } from '@/lib/types';
import { professionalForUser } from '@/lib/access';

// EQUIPE — logins internos da empresa (permissões por papel + individuais).
// Regras de governança:
//   • só quem tem a permissão `equipe` acessa;
//   • apenas OWNER cria/edita ADMIN ou mexe em outro OWNER;
//   • ninguém remove a si mesmo nem o proprietário;
//   • o proprietário nunca perde acesso (permissionsFor garante).
//
// VÍNCULO User → Professional (P2): o Admin liga um login existente a um
// profissional da MESMA unidade (`professionalId`). Um profissional só pode
// ter um login e um login só pode apontar para um profissional por unidade.
// O vínculo NÃO cria usuário, NÃO cria papel novo e NÃO substitui as
// permissões do papel — ele só define o escopo de agenda (o profissional vê
// apenas a própria agenda, aplicado no backend).
//
// DOIS MOTORES: as mutações são funções PURAS sobre um doc mínimo (fatia).
// O modo relacional carrega via runRelationalRead/runRelationalWrite — as
// mesmas re-checagens de governança rodam DENTRO da transação (lock por
// unidade), então nenhuma decisão usa o documento legado.
function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

/** View PURA (DOIS motores): payload da tela Equipe a partir de um doc mínimo. */
function teamView(db: any, ctx: any) {
  const businessId = ctx.business.id;
  const members = (db.members || []).filter((m: any) => m.businessId === businessId);
  const users = new Map<string, any>((db.users || []).map((u: any) => [u.id, u] as [string, any]));
  const professionals = (db.professionals || []).filter((p: any) => p.businessId === businessId);
  return {
    roles: ROLES,
    permissions: PERMISSIONS,
    // Profissionais da unidade + quem já está vinculado (para a vinculação
    // simples na tela de Equipe). Nenhum dado de outra unidade entra aqui.
    professionals: professionals.map((p: any) => ({
      id: p.id, name: p.name, role: p.role || '',
      active: p.active !== false, userId: p.userId || '',
      // A3.4 — foto: a MESMA pessoa não pode aparecer com foto numa tela e com
      // inicial genérica na outra. A foto é do Professional (fonte única).
      photo: p.photo || '',
      linkedUserName: p.userId ? (users.get(p.userId)?.name || 'Usuário removido') : '',
    })),
    me: { userId: ctx.user.id, role: ctx.role, isOwner: ctx.isOwner, permissions: ctx.permissions },
    owner: (() => {
      const o = (db.users || []).find((u: any) => u.id === ctx.business.ownerId);
      return o ? { userId: o.id, name: o.name, email: o.email, role: 'OWNER' as MemberRole } : null;
    })(),
    members: members.map((m: any) => {
      const u = users.get(m.userId);
      const linked = professionalForUser(db, businessId, m.userId);
      return {
        id: m.id, userId: m.userId, name: u?.name || 'Usuário', email: u?.email || '',
        role: m.role, permissions: permissionsFor(m.role, m.permissions),
        active: m.active !== false, note: m.note || '', createdAt: m.createdAt,
        lastLoginAt: u?.lastLoginAt || '',
        professionalId: linked?.id || '',
        professionalName: linked?.name || '',
        // A3.4: a lista de acessos usa a foto do profissional vinculado.
        professionalPhoto: linked?.photo || '',
      };
    }),
  };
}

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'equipe');
  if (!guard.ok) return guard.res;
  const { ctx } = guard;
  if (relationalActive()) {
    // Fatia DIRECIONADA: membros + profissionais da unidade e SOMENTE os
    // usuários referenciados (membros + proprietário). Nada mais.
    const db = await runRelationalRead(businessId, {
      members: {},
      professionals: {},
      users: (partial) => {
        const ids = new Set<string>((partial.members || []).map((m: any) => m.userId).filter(Boolean));
        const ownerId = partial.businesses?.[0]?.ownerId;
        if (ownerId) ids.add(ownerId);
        if (ids.size === 0) return null;
        return { global: true, where: 'id = ANY($2)', args: [[...ids]] };
      },
    });
    return NextResponse.json(teamView(db, ctx));
  }
  return NextResponse.json(teamView(guard.db, ctx));
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
    // Vínculo opcional com um profissional da unidade (validado abaixo).
    const requestedProfessionalId = String(body.professionalId || '').trim();
    const overrides: Partial<Record<PermissionId, boolean>> = {};
    if (body.permissions && typeof body.permissions === 'object') {
      for (const key of Object.keys(body.permissions)) {
        if (isValidPermission(key)) overrides[key] = body.permissions[key] === true;
      }
    }

    /** Mutação PURA (DOIS motores): cria/vincula login + membro + agenda.
     * Re-checa TUDO sob lock (mesma ordem e mensagens do legado). */
    const teamCreateTx = (db: any) => {
      // E-mail já existe = pessoa que já tem login (outro negócio). NUNCA
      // duplicamos conta nem sobrescrevemos senha: apenas vinculamos.
      if ((db.members || []).some((m: any) => (db.users || []).find((u: any) => u.id === m.userId)?.email === email)) {
        throw httpError(400, 'Esta pessoa já faz parte da equipe.');
      }
      const existingUser = (db.users || []).find((u: any) => u.email === email);
      if (requestedProfessionalId) {
        const target = (db.professionals || []).find((p: any) => p.id === requestedProfessionalId && p.businessId === businessId);
        if (!target) throw httpError(404, 'Profissional não encontrado nesta unidade.');
        if (target.userId && target.userId !== existingUser?.id) {
          throw httpError(400, 'Este profissional já está vinculado a outro login.');
        }
      }
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
      if (requestedProfessionalId) {
        const pro = (db.professionals || []).find((p: any) => p.id === requestedProfessionalId && p.businessId === businessId);
        if (pro) {
          pro.userId = userId;
          pushAudit(db, {
            action: 'member.professional_linked', actor: { ...ctx.user, role: ctx.role }, businessId,
            supportSessionId: ctx.support?.id, meta: { professionalId: pro.id, userId },
          });
        }
      }
      pushAudit(db, {
        action: 'member.created', actor: { ...ctx.user, role: ctx.role }, businessId,
        supportSessionId: ctx.support?.id, meta: { role, linkedExistingUser: !!existingUser, email },
      });
      return { member, linked: !!existingUser };
    };

    if (relationalActive()) {
      // Fatia: membros/profissionais da unidade + o usuário do e-mail
      // informado e os usuários já membros da unidade (checagem de duplicata).
      const created = await runRelationalWrite(businessId, teamCreateTx, {
        load: {
          members: {},
          professionals: {},
          users: {
            global: true,
            where: `lower(email) = $2 OR id IN (SELECT user_id FROM app.members WHERE business_id = $1)`,
            args: [email],
          },
        },
      });
      return NextResponse.json({ ok: true, linkedExistingUser: created.linked, memberId: created.member.id });
    }

    // Pré-checagem legada fora da transação (mesmo comportamento histórico);
    // a própria tx re-checa sob lock — a fn é compartilhada.
    const db0 = await readDB();
    if (db0.members.some((m) => m.businessId === businessId && db0.users.find((u) => u.id === m.userId)?.email === email)) {
      return NextResponse.json({ error: 'Esta pessoa já faz parte da equipe.' }, { status: 400 });
    }
    const existingUser = db0.users.find((u) => u.email === email);
    if (requestedProfessionalId) {
      const target = db0.professionals.find((p) => p.id === requestedProfessionalId && p.businessId === businessId);
      if (!target) return NextResponse.json({ error: 'Profissional não encontrado nesta unidade.' }, { status: 404 });
      if (target.userId && target.userId !== existingUser?.id) {
        return NextResponse.json({ error: 'Este profissional já está vinculado a outro login.' }, { status: 400 });
      }
    }
    const created = await updateDB(teamCreateTx);
    return NextResponse.json({ ok: true, linkedExistingUser: created.linked, memberId: created.member.id });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível criar o acesso.' : e.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'equipe');
    if (!guard.ok) return guard.res;
    const { ctx } = guard;

    const linkRequested = body.professionalId !== undefined;
    const nextProfessionalId = linkRequested ? String(body.professionalId || '').trim() : '';

    /** Mutação PURA (DOIS motores): papel/permissões/nota/vínculo de agenda.
     * Governança re-checada dentro da transação (mesmas mensagens do legado). */
    const teamPatchTx = (d: any) => {
      const m = (d.members || []).find((x: any) => x.id === String(body.id) && x.businessId === businessId);
      if (!m) throw httpError(404, 'Membro não encontrado.');
      if (m.role === 'OWNER') throw httpError(403, 'O proprietário não pode ser editado.');
      if (!ctx.isOwner && ctx.role !== 'ADMIN' && m.role === 'ADMIN') {
        throw httpError(403, 'Sem permissão para editar administradores.');
      }
      if (body.role !== undefined && body.role === 'ADMIN' && !ctx.isOwner && ctx.role !== 'ADMIN') {
        throw httpError(403, 'Sem permissão para promover a administrador.');
      }
      if (linkRequested && nextProfessionalId) {
        const target = (d.professionals || []).find((p: any) => p.id === nextProfessionalId && p.businessId === businessId);
        if (!target) throw httpError(404, 'Profissional não encontrado nesta unidade.');
        if (target.userId && target.userId !== m.userId) {
          throw httpError(400, 'Este profissional já está vinculado a outro login.');
        }
      }
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
      if (linkRequested) {
        // Um login aponta para no máximo UM profissional nesta unidade.
        for (const p of d.professionals || []) {
          if (p.businessId === businessId && p.userId === m.userId) p.userId = '';
        }
        if (nextProfessionalId) {
          const pro = (d.professionals || []).find((p: any) => p.id === nextProfessionalId && p.businessId === businessId);
          if (pro) pro.userId = m.userId;
        }
        pushAudit(d, {
          action: nextProfessionalId ? 'member.professional_linked' : 'member.professional_unlinked',
          actor: { ...ctx.user, role: ctx.role }, businessId,
          supportSessionId: ctx.support?.id, meta: { memberId: m.id, professionalId: nextProfessionalId },
        });
      }
      m.updatedAt = new Date().toISOString();
      pushAudit(d, {
        action: 'member.updated', actor: { ...ctx.user, role: ctx.role }, businessId,
        supportSessionId: ctx.support?.id, meta: { memberId: m.id, role: m.role, active: m.active },
      });
      return m;
    };

    let updated: any;
    if (relationalActive()) {
      updated = await runRelationalWrite(businessId, teamPatchTx, {
        load: { members: {}, professionals: {} },
      });
    } else {
      updated = await updateDB(teamPatchTx);
    }
    return NextResponse.json({ ok: true, member: { id: updated.id, role: updated.role, active: updated.active } });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar o membro.' : e.message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId') || '';
    const id = req.nextUrl.searchParams.get('id') || '';
    const guard = await requireBusiness(req, businessId, 'equipe');
    if (!guard.ok) return guard.res;
    const { ctx } = guard;

    if (relationalActive()) {
      // Pré-leitura PONTUAL (fora da fatia): papel do membro e se o login
      // sobrevive em outra unidade/unidade própria — a decisão de apagar
      // sessões é GLOBAL (membros de outras unidades não entram na fatia).
      const { getPool } = await import('@/lib/relational/pool');
      const pool = getPool();
      const mem = await pool.query(
        'SELECT id, user_id, role FROM app.members WHERE id = $1 AND business_id = $2',
        [id, businessId],
      );
      if (mem.rows.length === 0) return NextResponse.json({ error: 'Membro não encontrado.' }, { status: 404 });
      const memberUserId = String(mem.rows[0].user_id || '');
      const memberRole = String(mem.rows[0].role || '');
      if (memberUserId === ctx.user.id) {
        return NextResponse.json({ error: 'Você não pode remover seu próprio acesso.' }, { status: 400 });
      }
      if (memberRole === 'ADMIN' && !ctx.isOwner && ctx.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Sem permissão para remover administradores.' }, { status: 403 });
      }
      const surv = await pool.query(
        `SELECT EXISTS(SELECT 1 FROM app.members WHERE user_id = $1 AND id <> $2 AND active = true) AS still_member,
                EXISTS(SELECT 1 FROM app.businesses WHERE owner_id = $1) AS owns_anything`,
        [memberUserId, id],
      );
      const mayDropSessions = surv.rows[0].still_member !== true && surv.rows[0].owns_anything !== true;

      /** Mutação PURA (relacional): remove membro, desvincula agenda e,
       * se o login não sobrevive em nenhum outro lugar, derruba sessões. */
      const removeTx = (d: any) => {
        d.members = (d.members || []).filter((x: any) => x.id !== id);
        // Remove o vínculo de agenda deste login nesta unidade: sem acesso, o
        // profissional deixa de aparecer como "com login" (a categoria
        // profissional em si NÃO é apagada — só o vínculo).
        for (const p of d.professionals || []) {
          if (p.businessId === businessId && p.userId === memberUserId) p.userId = '';
        }
        if (mayDropSessions) {
          d.sessions = (d.sessions || []).filter((sess: any) => sess.userId !== memberUserId);
        }
        pushAudit(d, {
          action: 'member.removed', actor: { ...ctx.user, role: ctx.role }, businessId,
          supportSessionId: ctx.support?.id, meta: { memberId: id, role: memberRole },
        });
        return true;
      };
      await runRelationalWrite(businessId, removeTx, {
        load: {
          members: { where: 'id = $2', args: [id] },
          professionals: {},
          sessions: { global: true, where: 'user_id = $2', args: [memberUserId] },
        },
      });
      return NextResponse.json({ ok: true });
    }

    // Legado (caminho de rollback): comportamento histórico intacto.
    const legacyGuard = guard as unknown as { db: any };
    const member = legacyGuard.db.members.find((m: any) => m.id === id && m.businessId === businessId);
    if (!member) return NextResponse.json({ error: 'Membro não encontrado.' }, { status: 404 });
    if (member.userId === ctx.user.id) return NextResponse.json({ error: 'Você não pode remover seu próprio acesso.' }, { status: 400 });
    if (member.role === 'ADMIN' && !ctx.isOwner && ctx.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão para remover administradores.' }, { status: 403 });
    }
    await updateDB((d) => {
      d.members = d.members.filter((x: any) => x.id !== member.id);
      // Remove o vínculo de agenda deste login nesta unidade: sem acesso, o
      // profissional deixa de aparecer como "com login" (a categoria
      // profissional em si NÃO é apagada — só o vínculo).
      for (const p of d.professionals) {
        if (p.businessId === businessId && p.userId === member.userId) p.userId = '';
      }
      // Sessões do usuário removido caem junto (isolamento imediato).
      const stillMember = d.members.some((x: any) => x.userId === member.userId && x.active !== false);
      const ownsAnything = d.businesses.some((b: any) => b.ownerId === member.userId);
      if (!stillMember && !ownsAnything) {
        d.sessions = d.sessions.filter((s: any) => s.userId !== member.userId);
      }
      pushAudit(d, {
        action: 'member.removed', actor: { ...ctx.user, role: ctx.role }, businessId,
        supportSessionId: ctx.support?.id, meta: { memberId: member.id, role: member.role },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível remover o acesso.' : e.message }, { status });
  }
}
