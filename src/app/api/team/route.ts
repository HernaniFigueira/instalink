import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { requireBusiness, PERMISSIONS, ROLES, isValidPermission, isValidRole, permissionsFor } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import type { BusinessMember, MemberRole, PermissionId } from '@/lib/types';
import { professionalForUser } from '@/lib/access';
import { isValidCpf } from '@/lib/contact-profile';
import { onlyDigits } from '@/lib/utils';

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
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'equipe');
  if (!guard.ok) return guard.res;
  const { db, ctx } = guard;
  const members = db.members.filter((m) => m.businessId === businessId);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const professionals = db.professionals.filter((p) => p.businessId === businessId);
  return NextResponse.json({
    roles: ROLES,
    permissions: PERMISSIONS,
    // Profissionais da unidade + quem já está vinculado (para a vinculação
    // simples na tela de Equipe). Nenhum dado de outra unidade entra aqui.
    professionals: professionals.map((p) => ({
      id: p.id, name: p.name, role: p.role || '',
      active: p.active !== false, userId: p.userId || '',
      // A3.4 — foto: a MESMA pessoa não pode aparecer com foto numa tela e com
      // inicial genérica na outra. A foto é do Professional (fonte única).
      photo: p.photo || '',
      linkedUserName: p.userId ? (users.get(p.userId)?.name || 'Usuário removido') : '',
    })),
    me: { userId: ctx.user.id, role: ctx.role, isOwner: ctx.isOwner, permissions: ctx.permissions },
    owner: (() => {
      const o = db.users.find((u) => u.id === ctx.business.ownerId);
      return o ? { userId: o.id, name: o.name, email: o.email, phone: (o as any).phone || '', cpf: (o as any).cpf || '', role: 'OWNER' as MemberRole } : null;
    })(),
    members: members.map((m) => {
      const u = users.get(m.userId);
      const linked = professionalForUser(db, businessId, m.userId);
      // phone/cpf canônicos: User é fonte primária, Member como fallback compatível
      const phone = (u as any)?.phone || (m as any)?.phone || '';
      const cpf = (u as any)?.cpf || (m as any)?.cpf || '';
      return {
        id: m.id, userId: m.userId, name: u?.name || 'Usuário', email: u?.email || '',
        role: m.role, permissions: permissionsFor(m.role, m.permissions),
        permissionOverrides: { ...(m.permissions || {}) },
        phone, cpf,
        active: m.active !== false, note: m.note || '', createdAt: m.createdAt,
        lastLoginAt: u?.lastLoginAt || '',
        professionalId: linked?.id || '',
        professionalName: linked?.name || '',
        // A3.4: a lista de acessos usa a foto do profissional vinculado.
        professionalPhoto: linked?.photo || '',
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

    // Person orchestration atômica — "Adicionar pessoa" / "Gerenciar pessoa"
    if (body.action === 'person.save') {
      const { validatePersonInput, personSaveTx } = await import('@/lib/person-orchestration');
      // Normaliza input para o domínio (reutiliza validações canônicas)
      const input: any = {
        businessId,
        mode: body.mode === 'update' ? 'update' : 'create',
        existingMemberId: body.existingMemberId || body.memberId || '',
        existingProfessionalId: body.existingProfessionalId || body.professionalId || '',
        existingUserId: body.existingUserId || body.userId || '',
        isOwner: !!body.isOwner,
        name: body.name,
        email: body.email,
        phone: body.phone,
        cpf: body.cpf,
        photo: body.photo,
        hasAccess: !!body.hasAccess,
        hasClinical: !!body.hasClinical,
        role: body.role,
        permissionOverrides: body.permissionOverrides || body.permissions,
        password: body.password,
        funcao: body.funcao || body.roleClinico || body.role,
        conselho: body.conselho,
        crmvUf: body.crmvUf,
        crmvNumero: body.crmvNumero,
        serviceIds: body.serviceIds,
        serviceSelectionExplicit: !!body.serviceSelectionExplicit,
        dispMode: body.dispMode,
        pendingServices: Array.isArray(body.pendingServices) ? body.pendingServices : [],
      };
      // Pré-validação (fora da transação) para feedback rápido, mas a transação revalida com DB fresco
      const db0 = await readDB();
      try {
        validatePersonInput(input, db0);
      } catch (e: any) {
        const status = e?.status || 400;
        return NextResponse.json({ error: e.message || 'Dados inválidos.' }, { status });
      }
      try {
        const result = await updateDB((db) => personSaveTx(db as any, input, ctx as any));
        return NextResponse.json({ ok: true, ...result });
      } catch (e: any) {
        const status = e?.status || 400;
        return NextResponse.json({ error: e.message || 'Não foi possível salvar pessoa.' }, { status });
      }
    }

    const name = String(body.name || '').trim().slice(0, 80);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 160);
    const password = String(body.password || '');
    // Clinical OS — telefone/CPF normalizados digits-only, opcionais
    const onlyDigits = (v:any)=>String(v||'').replace(/\D/g,'');
    const phone = onlyDigits(body.phone).slice(0,13);
    const cpf = onlyDigits(body.cpf).slice(0,11);
    if (phone && phone.length < 10) return NextResponse.json({ error: 'Telefone inválido.' }, { status: 400 });
    if (cpf) {
      if (cpf.length !== 11 || !isValidCpf(cpf)) return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }
    const role: MemberRole = isValidRole(body.role) ? body.role : 'ATENDENTE';
    if (!name) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 });
    if (!email.includes('@')) return NextResponse.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
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
    if (body.permissionOverrides !== undefined) {
      if (body.permissionOverrides && typeof body.permissionOverrides === 'object' && !Array.isArray(body.permissionOverrides)) {
        for (const [k, v] of Object.entries(body.permissionOverrides as Record<string, any>)) {
          if (isValidPermission(k) && typeof v === 'boolean') overrides[k as PermissionId] = v;
        }
      }
    } else if (body.permissions && typeof body.permissions === 'object') {
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
    const existingUser = db0.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    // Senha inicial: necessária somente se e-mail ainda não possui User
    if (!existingUser) {
      if (password.length < 6) return NextResponse.json({ error: 'Defina uma senha inicial com ao menos 6 caracteres para criar a conta.' }, { status: 400 });
    }
    if (requestedProfessionalId) {
      const target = db0.professionals.find((p) => p.id === requestedProfessionalId && p.businessId === businessId);
      if (!target) return NextResponse.json({ error: 'Profissional não encontrado nesta unidade.' }, { status: 404 });
      if (target.userId && target.userId !== existingUser?.id) {
        return NextResponse.json({ error: 'Este profissional já está vinculado a outro login.' }, { status: 400 });
      }
    }

    const created = await updateDB((db) => {
      const now = new Date().toISOString();
      let userId = existingUser?.id || '';
      if (!userId) {
        userId = randomUUID();
        // role de plataforma SEMPRE 'owner' — Owner/Admin NÃO promovem a master.
        // Clinical OS: armazena telefone/CPF quando fornecidos (opcionais, sem log de senha)
        const extra: Record<string,any> = {};
        if (phone) extra.phone = phone;
        if (cpf) extra.cpf = cpf;
        db.users.push({ id: userId, name, email, passwordHash: hashPassword(password), createdAt: now, role: 'owner', lastLoginAt: '', ...extra });
      }
      const member: BusinessMember = {
        id: randomUUID(), businessId, userId, role, permissions: overrides,
        active: true, note: String(body.note || '').slice(0, 200),
        invitedBy: ctx.user.id, createdAt: now, updatedAt: now,
        // Clinical OS extras (sem migração): phone/cpf armazenados como campos adicionais quando fornecidos
        ...(phone ? { phone } as any : {}),
        ...(cpf ? { cpf } as any : {}),
      } as BusinessMember;
      db.members.push(member);
      if (requestedProfessionalId) {
        const pro = db.professionals.find((p) => p.id === requestedProfessionalId && p.businessId === businessId);
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

    const linkRequested = body.professionalId !== undefined;
    const nextProfessionalId = linkRequested ? String(body.professionalId || '').trim() : '';
    if (linkRequested && nextProfessionalId) {
      const target = db.professionals.find((p) => p.id === nextProfessionalId && p.businessId === businessId);
      if (!target) return NextResponse.json({ error: 'Profissional não encontrado nesta unidade.' }, { status: 404 });
      if (target.userId && target.userId !== member.userId) {
        return NextResponse.json({ error: 'Este profissional já está vinculado a outro login.' }, { status: 400 });
      }
    }

    // Pre-validação síncrona (fora do updateDB) para e-mail/CPF/phone com leitura consistente
    let normalizedEmail: string | undefined;
    let normalizedPhone: string | undefined;
    let normalizedCpf: string | undefined;
    let normalizedName: string | undefined;
    if (body.name !== undefined) {
      const n = String(body.name || '').trim().slice(0, 80);
      if (!n) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 });
      normalizedName = n;
    }
    if (body.email !== undefined) {
      const e = String(body.email || '').trim().toLowerCase().slice(0, 160);
      if (!e.includes('@')) return NextResponse.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
      // impedir duplicado (outro user com mesmo e-mail já em member desta business ou em users)
      const clashUser = db.users.find((u) => u.email.toLowerCase() === e && u.id !== member.userId);
      if (clashUser) {
        const clashMember = db.members.find((mm) => mm.businessId === businessId && mm.userId === clashUser.id);
        // se já é membro desta unidade com e-mail diferente, bloquear
        if (clashMember || db.users.some((u) => u.id !== member.userId && u.email.toLowerCase() === e)) {
          // verificação simples: e-mail já usado por outro User (mesmo que não seja membro desta business, ainda é duplicado global)
          return NextResponse.json({ error: 'E-mail já em uso.' }, { status: 400 });
        }
      }
      // também verificar se outro member desta business já usa e-mail via User
      const otherMemberWithEmail = db.members.find((mm) => mm.businessId === businessId && mm.userId !== member.userId && db.users.find((u) => u.id === mm.userId)?.email.toLowerCase() === e);
      if (otherMemberWithEmail) return NextResponse.json({ error: 'E-mail já em uso nesta unidade.' }, { status: 400 });
      normalizedEmail = e;
    }
    if (body.phone !== undefined) {
      const p = onlyDigits(String(body.phone || '')).slice(0, 13);
      // phone opcional, mas se informado deve ter pelo menos 10 dígitos (DDD+numero)
      if (p && p.length < 10) return NextResponse.json({ error: 'Telefone inválido.' }, { status: 400 });
      normalizedPhone = p;
    }
    if (body.cpf !== undefined) {
      const raw = String(body.cpf || '').trim();
      const digits = onlyDigits(raw).slice(0, 11);
      if (digits) {
        if (digits.length !== 11 || !isValidCpf(digits)) return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
        // CPF opcional, mas validar duplicidade não necessária (não é único global), apenas formato
      }
      normalizedCpf = digits;
    }

    if (body.permissionOverrides !== undefined) {
      if (body.permissionOverrides !== null && (typeof body.permissionOverrides !== 'object' || Array.isArray(body.permissionOverrides))) {
        return NextResponse.json({ error: 'Overrides inválidos.' }, { status: 400 });
      }
      if (body.permissionOverrides) {
        for (const [k, v] of Object.entries(body.permissionOverrides as Record<string, any>)) {
          if (!isValidPermission(k)) {
            return NextResponse.json({ error: `Permissão inválida: ${k}` }, { status: 400 });
          }
          if (typeof v !== 'boolean') {
            return NextResponse.json({ error: `Valor inválido para ${k}` }, { status: 400 });
          }
        }
      }
    }

    const updated = await updateDB((d) => {
      const m = d.members.find((x) => x.id === member.id)!;
      const u = d.users.find((x) => x.id === m.userId);
      if (normalizedName !== undefined && u) u.name = normalizedName;
      if (normalizedEmail !== undefined && u) u.email = normalizedEmail;
      if (normalizedPhone !== undefined) {
        if (u) (u as any).phone = normalizedPhone;
        (m as any).phone = normalizedPhone;
      }
      if (normalizedCpf !== undefined) {
        if (u) (u as any).cpf = normalizedCpf;
        (m as any).cpf = normalizedCpf;
      }
      if (isValidRole(body.role) && body.role !== 'OWNER') m.role = body.role;
      if (typeof body.active === 'boolean') m.active = body.active;
      if (body.note !== undefined) m.note = String(body.note || '').slice(0, 200);
      if (body.permissionOverrides !== undefined) {
        const next: Record<string, boolean> = {};
        if (body.permissionOverrides) {
          for (const [k, v] of Object.entries(body.permissionOverrides as Record<string, any>)) {
            if (!isValidPermission(k)) continue;
            if (typeof v === 'boolean') next[k] = v;
          }
        }
        m.permissions = next;
      } else if (body.permissions && typeof body.permissions === 'object') {
        const next = { ...(m.permissions || {}) };
        for (const key of Object.keys(body.permissions)) {
          if (isValidPermission(key)) next[key] = body.permissions[key] === true;
        }
        m.permissions = next;
      }
      if (linkRequested) {
        // Um login aponta para no máximo UM profissional nesta unidade.
        for (const p of d.professionals) {
          if (p.businessId === businessId && p.userId === m.userId) p.userId = '';
        }
        if (nextProfessionalId) {
          const pro = d.professionals.find((p) => p.id === nextProfessionalId && p.businessId === businessId);
          if (pro) pro.userId = m.userId;
        }
        pushAudit(d, {
          action: nextProfessionalId ? 'member.professional_linked' : 'member.professional_unlinked',
          actor: { ...ctx.user, role: ctx.role }, businessId,
          supportSessionId: ctx.support?.id, meta: { memberId: m.id, professionalId: nextProfessionalId },
        });
      }
      m.updatedAt = new Date().toISOString();
      if (u) (u as any).updatedAt = new Date().toISOString();
      pushAudit(d, {
        action: 'member.updated', actor: { ...ctx.user, role: ctx.role }, businessId,
        supportSessionId: ctx.support?.id, meta: { memberId: m.id, role: m.role, active: m.active, name: normalizedName, email: normalizedEmail, phone: normalizedPhone, cpf: normalizedCpf ? '***' : undefined },
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
      // Remove o vínculo de agenda deste login nesta unidade: sem acesso, o
      // profissional deixa de aparecer como "com login" (a categoria
      // profissional em si NÃO é apagada — só o vínculo).
      for (const p of d.professionals) {
        if (p.businessId === businessId && p.userId === member.userId) p.userId = '';
      }
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
