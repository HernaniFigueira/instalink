// Person orchestration — operação atômica para "Adicionar pessoa" / "Gerenciar pessoa"
// Reutiliza validações canônicas de team e catalog sem duplicar lógica.
// Uma única updateDB() persiste: User/Member/Professional/Services/Categories + vínculos.
import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth';
import { isValidCpf, BRAZILIAN_STATES } from './contact-profile';
import { onlyDigits, clampCents, parseMoneyToCents } from './utils';
import { serviceProfessionalMode } from './booking';
import { isValidRole, isValidPermission } from './permissions';
import { pushAudit } from './audit';
import { followsBusinessHours } from './schedule';
import type { DB } from './types';

function normPhone(v: any): string {
  return String(v || '').replace(/\D/g, '').slice(0, 13);
}
function normCpf(v: any): string {
  return String(v || '').replace(/\D/g, '').slice(0, 11);
}
function normEmail(v: any): string {
  return String(v || '').trim().toLowerCase().slice(0, 160);
}
function normName(v: any): string {
  return String(v || '').trim().slice(0, 80);
}

function validatePhone(phoneDigits: string) {
  if (phoneDigits && phoneDigits.length < 10) throw Object.assign(new Error('Telefone inválido.'), { status: 400 });
}
function validateCpf(cpfDigits: string) {
  if (cpfDigits) {
    if (cpfDigits.length !== 11 || !isValidCpf(cpfDigits)) throw Object.assign(new Error('CPF inválido.'), { status: 400 });
  }
}
function validateCrmv(conselho: string, uf: string, numero: string) {
  const has = uf || numero || conselho !== 'CRMV';
  if (!has) return { conselho: '', uf: '', numero: '' };
  const c = String(conselho || 'CRMV').trim() || 'CRMV';
  const u = String(uf || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  const n = String(numero || '').replace(/\D/g, '').slice(0, 6);
  if (c !== 'CRMV' && (u || n)) throw Object.assign(new Error('Conselho deve ser CRMV.'), { status: 400 });
  if (!u && !n) return { conselho: '', uf: '', numero: '' };
  if (u && !BRAZILIAN_STATES.includes(u as any)) throw Object.assign(new Error('UF inválida.'), { status: 400 });
  if (u && !n) throw Object.assign(new Error('Informe o número do CRMV.'), { status: 400 });
  if (n && !u) throw Object.assign(new Error('Informe a UF do CRMV.'), { status: 400 });
  if (n && !/^\d{1,6}$/.test(n)) throw Object.assign(new Error('Número do CRMV inválido.'), { status: 400 });
  return { conselho: 'CRMV', uf: u, numero: n };
}

function normalizeCategoryName(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

// Garante categoria service, retorna id (cria se necessário). Deve ser chamado DENTRO de updateDB.
// Só cria por NOME (suggestedGroupName). groupId deve ser validado antes.
function ensureCategoryByNameTx(db: DB, businessId: string, name: string): string {
  if (!name) return '';
  const raw = String(name).trim();
  if (!raw) return '';
  const norm = normalizeCategoryName(raw);
  const existing = db.categories.find((c) => c.businessId === businessId && c.kind === 'service' && normalizeCategoryName(c.name) === norm);
  if (existing) return existing.id;
  const newId = randomUUID();
  db.categories.push({ id: newId, businessId, kind: 'service', name: raw, order: db.categories.filter((c) => c.businessId === businessId).length, active: true });
  return newId;
}

export interface PersonSaveInput {
  businessId: string;
  // edição vs criação (mode refere-se à operação geral, não ao Member isolado)
  mode: 'create' | 'update';
  existingMemberId?: string;
  existingProfessionalId?: string;
  existingUserId?: string;
  // isOwner não é confiável do cliente — derivado server-side; mantido opcional para compat mas ignorado
  isOwner?: boolean;
  // identificação
  name: string;
  email?: string;
  phone?: string;
  cpf?: string;
  photo?: string;
  // acesso
  hasAccess: boolean;
  role?: string;
  permissionOverrides?: Record<string, boolean>;
  password?: string;
  // clínica
  hasClinical: boolean;
  funcao?: string;
  conselho?: string;
  crmvUf?: string;
  crmvNumero?: string;
  serviceIds?: string[];
  serviceSelectionExplicit?: boolean;
  dispMode?: 'follow' | 'own';
  pendingServices?: Array<{
    tempId?: string;
    name: string;
    groupId?: string;
    suggestedGroupName?: string;
    durationMin?: number;
    price?: string | number;
  }>;
}

function getMembers(db: any) { return (db.businessMembers || db.members || db.businessMembers === undefined && db.members === undefined ? [] : (db.businessMembers || db.members)) as any[]; }
// helper robusto: retorna array real que existe no DB (para push)
function getMembersArray(db: any) {
  if (Array.isArray((db as any).businessMembers)) return (db as any).businessMembers;
  if (Array.isArray((db as any).members)) return (db as any).members;
  // fallback: cria businessMembers se nenhum existir (para testes)
  (db as any).businessMembers = [];
  return (db as any).businessMembers;
}
function getServices(db: any) { return (db.services || []) as any[]; }

// Deriva se o ALVO é Owner a partir do DB, nunca do cliente
function deriveIsTargetOwner(db: DB, input: PersonSaveInput): boolean {
  const business = (db as any).businesses?.find((b: any) => b.id === input.businessId) || (db as any).business;
  const ownerId = business?.ownerId || '';
  if (!ownerId) return false;
  // verifica por existingUserId
  if (input.existingUserId && input.existingUserId === ownerId) return true;
  // por Member
  if (input.existingMemberId) {
    const m = getMembers(db).find((x: any) => x.id === input.existingMemberId);
    if (m && m.userId === ownerId) return true;
    if (m && m.role === 'OWNER') return true;
  }
  // por Professional
  if (input.existingProfessionalId) {
    const p = (db.professionals || []).find((x: any) => x.id === input.existingProfessionalId);
    if (p && (p as any).userId === ownerId) return true;
  }
  // se input traz email que é do owner, também considera? Para update com email do owner
  if (input.email) {
    const em = normEmail(input.email);
    const ownerUser = (db.users || []).find((u: any) => u.id === ownerId);
    if (ownerUser && ownerUser.email.toLowerCase() === em) return true;
  }
  return false;
}

export function validatePersonInput(input: PersonSaveInput, db: DB) {
  // nome obrigatório sempre
  if (!normName(input.name)) throw Object.assign(new Error('Informe o NOME.'), { status: 400 });
  const phoneDigits = normPhone(input.phone);
  const cpfDigits = normCpf(input.cpf);
  validatePhone(phoneDigits);
  validateCpf(cpfDigits);
  const emailNorm = input.email ? normEmail(input.email) : '';
  const isTargetOwner = deriveIsTargetOwner(db, input);
  if (input.hasAccess) {
    if (!emailNorm || !emailNorm.includes('@')) throw Object.assign(new Error('Informe um E-MAIL válido para o acesso.'), { status: 400 });
    if (input.mode === 'create') {
      const existingUser = db.users.find((u) => u.email.toLowerCase() === emailNorm.toLowerCase());
      if (!existingUser && String(input.password || '').length < 6) {
        throw Object.assign(new Error('Defina uma senha inicial com ao menos 6 caracteres para criar a conta.'), { status: 400 });
      }
    } else {
      if (emailNorm && input.existingUserId) {
        const clash = db.users.find((u) => u.email.toLowerCase() === emailNorm.toLowerCase() && u.id !== input.existingUserId);
        if (clash) {
          const clashMember = getMembers(db).find((m) => m.businessId === input.businessId && m.userId === clash.id);
          if (clashMember || db.users.some((u) => u.id !== input.existingUserId && u.email.toLowerCase() === emailNorm.toLowerCase())) {
            throw Object.assign(new Error('E-mail já em uso.'), { status: 400 });
          }
        }
        const otherMemberWithEmail = getMembers(db).find((m) => m.businessId === input.businessId && m.userId !== input.existingUserId && db.users.find((u) => u.id === m.userId)?.email.toLowerCase() === emailNorm.toLowerCase());
        if (otherMemberWithEmail) throw Object.assign(new Error('E-mail já em uso nesta unidade.'), { status: 400 });
      }
      if (input.password && String(input.password).length > 0 && String(input.password).length < 6) {
        throw Object.assign(new Error('A senha precisa ter ao menos 6 caracteres.'), { status: 400 });
      }
    }
    // role validation — usar fonte canônica
    if (input.role !== undefined && input.role !== null && String(input.role).trim() !== '') {
      const roleStr = String(input.role).trim().toUpperCase();
      // MASTER nunca é MemberRole
      if (roleStr === 'MASTER' || String(input.role).toLowerCase() === 'master') {
        throw Object.assign(new Error('Não é possível atribuir o papel Master por esta rota.'), { status: 403 });
      }
      // isValidRole canonical — OWNER só permitido quando alvo é Owner
      if (!isValidRole(roleStr)) {
        throw Object.assign(new Error(`Papel inválido: ${String(input.role)}`), { status: 400 });
      }
      if (roleStr === 'OWNER' && !isTargetOwner) {
        throw Object.assign(new Error('O proprietário é único. Use Administrador.'), { status: 400 });
      }
    }
  }
  // permissionOverrides sanitização — se fornecido, cada chave deve ser válida e valor boolean
  if (input.permissionOverrides !== undefined && input.permissionOverrides !== null) {
    if (typeof input.permissionOverrides !== 'object' || Array.isArray(input.permissionOverrides)) {
      throw Object.assign(new Error('Overrides inválidos.'), { status: 400 });
    }
    for (const [k, v] of Object.entries(input.permissionOverrides as Record<string, any>)) {
      if (!isValidPermission(k)) {
        throw Object.assign(new Error(`Permissão inválida: ${k}`), { status: 400 });
      }
      if (typeof v !== 'boolean') {
        throw Object.assign(new Error(`Valor inválido para ${k}`), { status: 400 });
      }
    }
    // OWNER não pode ter overrides que retirem acesso — será ignorado no personSaveTx, mas não precisa bloquear aqui
  }
  // clínica
  if (input.hasClinical) {
    validateCrmv(input.conselho || 'CRMV', input.crmvUf || '', input.crmvNumero || '');
    if (Array.isArray(input.serviceIds)) {
      for (const sid of input.serviceIds) {
        if (!getServices(db).some((s) => s.id === sid && s.businessId === input.businessId)) {
          throw Object.assign(new Error('Serviço inválido para esta clínica.'), { status: 400 });
        }
      }
    }
    if (Array.isArray(input.pendingServices)) {
      for (const ps of input.pendingServices) {
        if (!String(ps.name || '').trim()) throw Object.assign(new Error('Nome do serviço pendente inválido.'), { status: 400 });
        // groupId deve ser Category real do tenant, se informado
        if (ps.groupId) {
          const cat = db.categories.find((c) => c.id === ps.groupId && c.businessId === input.businessId && c.kind === 'service');
          if (!cat) throw Object.assign(new Error('Grupo inválido para esta clínica.'), { status: 400 });
        }
      }
    }
  } else {
    // mesmo quando hasClinical false, se pendingServices vier, deve ser vazio — mas validamos groupId anyway
    if (Array.isArray(input.pendingServices) && input.pendingServices.length > 0) {
      throw Object.assign(new Error('Não é possível criar serviços sem atuação clínica.'), { status: 400 });
    }
  }
  // e-mail duplicado global para create com hasAccess
  if (input.hasAccess && input.mode === 'create') {
    const emailNorm2 = normEmail(input.email);
    const existingMemberWithEmail = getMembers(db).some((m) => m.businessId === input.businessId && db.users.find((u) => u.id === m.userId)?.email.toLowerCase() === emailNorm2.toLowerCase());
    if (existingMemberWithEmail) throw Object.assign(new Error('Esta pessoa já faz parte da equipe.'), { status: 400 });
  }
}

export function personSaveTx(db: DB, input: PersonSaveInput, ctx?: { user: any; role: string; isOwner: boolean; support?: any; permissions?: any; business?: any }): { professionalId?: string; memberId?: string; userId?: string } {
  // Validação já feita antes, mas reforça dentro da transação com DB fresco
  validatePersonInput(input, db);

  const now = new Date().toISOString();
  const businessId = input.businessId;
  const phoneDigits = normPhone(input.phone);
  const cpfDigits = normCpf(input.cpf);
  const emailNorm = input.email ? normEmail(input.email) : '';
  const nameNorm = normName(input.name);
  const hasAccess = !!input.hasAccess;
  const hasClinical = !!input.hasClinical;
  const isTargetOwner = deriveIsTargetOwner(db, input);

  // --- 1. Pending Services → categorias e serviços ---
  let targetProfessionalId = input.existingProfessionalId || '';
  const isNewProfessional = !targetProfessionalId && hasClinical;
  if (isNewProfessional) {
    targetProfessionalId = randomUUID();
  }

  // Criar categorias/serviços pendentes — groupId já validado, só suggestedGroupName cria
  const createdServiceIds: string[] = [];
  if (hasClinical && Array.isArray(input.pendingServices) && input.pendingServices.length > 0) {
    for (const ps of input.pendingServices) {
      const svcName = String(ps.name || '').trim();
      if (!svcName) continue;
      let catId = '';
      if (ps.groupId) {
        // já validado: deve existir
        catId = ps.groupId;
      } else if (ps.suggestedGroupName) {
        catId = ensureCategoryByNameTx(db, businessId, ps.suggestedGroupName);
      }
      const priceCents = ps.price !== undefined ? clampCents(Number(parseMoneyToCents(String(ps.price))) || 0) : 0;
      const dur = Math.max(5, Number(ps.durationMin) || 30);
      const svcId = randomUUID();
      db.services.push({
        id: svcId,
        businessId,
        name: svcName,
        description: '',
        image: '',
        price: priceCents,
        showPrice: true,
        durationMin: dur,
        professionalIds: [targetProfessionalId],
        professionalMode: 'selected' as any,
        categoryId: catId || '',
        active: true,
        featured: false,
        bookable: true,
        questions: [],
        createdAt: now,
        updatedAt: now,
      } as any);
      createdServiceIds.push(svcId);
      // audit category/service creation via equipe
      if (catId && ps.suggestedGroupName) {
        // categoria já auditada implicitamente via ensure
      }
    }
  }

  // --- 2. Professional ---
  let professional: any = null;
  if (hasClinical) {
    const crmv = validateCrmv(input.conselho || 'CRMV', input.crmvUf || '', input.crmvNumero || '');
    let desiredServiceIds: string[] | null = null;
    if (Array.isArray(input.serviceIds)) {
      desiredServiceIds = [...input.serviceIds, ...createdServiceIds];
    } else if (createdServiceIds.length > 0) {
      desiredServiceIds = [...createdServiceIds];
    }

    if (isNewProfessional) {
      const proData: any = {
        id: targetProfessionalId,
        businessId,
        name: nameNorm,
        role: String(input.funcao || '').trim(),
        photo: String(input.photo || ''),
        active: true,
        followBusinessHours: true,
        phone: phoneDigits,
        cpf: cpfDigits,
        email: emailNorm,
        conselho: crmv.conselho,
        crmvUf: crmv.uf,
        crmvNumero: crmv.numero,
        createdAt: now,
        updatedAt: now,
      };
      (db.professionals as any).push(proData);
      professional = proData;
      // audit
      if (ctx?.user) pushAudit(db, { action: 'professional.created' as any, actor: { ...ctx.user, role: ctx.role }, businessId, supportSessionId: ctx.support?.id, meta: { professionalId: targetProfessionalId } });
    } else {
      professional = db.professionals.find((p) => p.id === targetProfessionalId && p.businessId === businessId);
      if (!professional) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404 });
      const prevRole = professional.role;
      const prevActive = professional.active;
      if (!isTargetOwner) {
        professional.name = nameNorm;
        professional.photo = String(input.photo || '');
        professional.phone = phoneDigits;
        professional.cpf = cpfDigits;
        professional.email = emailNorm;
      }
      professional.role = String(input.funcao || '').trim();
      (professional as any).conselho = crmv.conselho;
      (professional as any).crmvUf = crmv.uf;
      (professional as any).crmvNumero = crmv.numero;
      if (input.dispMode) {
        professional.followBusinessHours = input.dispMode === 'follow';
      }
      (professional as any).updatedAt = now;
      if (ctx?.user && (prevRole !== professional.role || prevActive !== professional.active)) {
        pushAudit(db, { action: 'professional.updated' as any, actor: { ...ctx.user, role: ctx.role }, businessId, supportSessionId: ctx.support?.id, meta: { professionalId: targetProfessionalId, role: professional.role } });
      }
    }

    if (desiredServiceIds !== null) {
      const pid = targetProfessionalId;
      const isExplicit = input.serviceSelectionExplicit === true;
      const allActiveIds = db.professionals.filter((pr) => pr.businessId === businessId && pr.active !== false).map((pr) => pr.id);
      for (const svc of db.services) {
        if (svc.businessId !== businessId) continue;
        const shouldContain = desiredServiceIds.includes(svc.id);
        const mode = serviceProfessionalMode(svc as any);
        const has = (svc.professionalIds || []).includes(pid);
        if (mode === 'all') {
          if (shouldContain) {
          } else {
            if (!isNewProfessional || isExplicit) {
              (svc as any).professionalMode = 'selected';
              (svc as any).professionalIds = allActiveIds.filter((x) => x !== pid);
            }
          }
        } else {
          if (shouldContain && !has) {
            svc.professionalIds = [...(svc.professionalIds || []), pid];
          } else if (!shouldContain && has) {
            svc.professionalIds = (svc.professionalIds || []).filter((x: string) => x !== pid);
          }
          if (!(svc as any).professionalMode) (svc as any).professionalMode = 'selected';
        }
      }
    }

    if (!isNewProfessional && input.dispMode) {
      const wantFollow = input.dispMode === 'follow';
      const currentlyFollow = followsBusinessHours(professional, (db as any).availability || (db as any).availabilityRules || []);
      if (wantFollow !== currentlyFollow) {
        if (wantFollow) {
          (db as any).availability = ((db as any).availability || (db as any).availabilityRules || []).filter((a: any) => !(a.businessId === businessId && a.professionalId === targetProfessionalId));
          if ((db as any).availabilityRules) (db as any).availabilityRules = (db as any).availability;
        }
      }
    }
  } else {
    if (input.existingProfessionalId) {
      const pro = db.professionals.find((p) => p.id === input.existingProfessionalId && p.businessId === businessId);
      if (pro) {
        const wasActive = pro.active !== false;
        pro.active = false;
        (pro as any).updatedAt = now;
        if (wasActive && ctx?.user) pushAudit(db, { action: 'professional.deactivated' as any, actor: { ...ctx.user, role: ctx.role }, businessId, supportSessionId: ctx.support?.id, meta: { professionalId: pro.id } });
      }
    }
  }

  // --- 3. User / Member (acesso) — tratamento separado para grant a solo professional ---
  let memberId = input.existingMemberId || '';
  let userId = input.existingUserId || '';

  if (hasAccess) {
    if (isTargetOwner) {
      // owner: não cria/edita member via esta rota, apenas garante professional já feito
      // mas ainda pode atualizar User do owner se necessário? Mantém read-only de role/permissions
      if (professional && (professional as any).userId) {
        // já vinculado
      }
    } else if (memberId) {
      // update existente member
      const member = getMembers(db).find((m) => m.id === memberId && m.businessId === businessId);
      if (!member) throw Object.assign(new Error('Membro não encontrado.'), { status: 404 });
      if (member.role === 'OWNER') throw Object.assign(new Error('O proprietário não pode ser editado.'), { status: 403 });
      if (member.role === 'ADMIN' && !ctx?.isOwner && ctx?.role !== 'ADMIN') {
        throw Object.assign(new Error('Sem permissão para editar administradores.'), { status: 403 });
      }
      if (input.role && String(input.role).toUpperCase() === 'ADMIN' && !ctx?.isOwner && ctx?.role !== 'ADMIN') {
        throw Object.assign(new Error('Sem permissão para promover a administrador.'), { status: 403 });
      }
      const user = db.users.find((u) => u.id === member.userId);
      if (user) {
        if (nameNorm) user.name = nameNorm;
        if (emailNorm) user.email = emailNorm;
        if (phoneDigits !== undefined) (user as any).phone = phoneDigits;
        if (cpfDigits !== undefined) (user as any).cpf = cpfDigits;
        (user as any).updatedAt = now;
      }
      (member as any).phone = phoneDigits;
      (member as any).cpf = cpfDigits;
      const prevRole = member.role;
      const prevPerms = JSON.stringify(member.permissions);
      if (input.role) {
        const roleUp = String(input.role).toUpperCase() as any;
        if (isValidRole(roleUp) && roleUp !== 'OWNER') member.role = roleUp;
      }
      if (input.permissionOverrides !== undefined) {
        // já validado em validatePersonInput — sanitizado
        const next: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(input.permissionOverrides as Record<string, any>)) {
          if (isValidPermission(k) && typeof v === 'boolean') next[k] = v;
        }
        member.permissions = next;
      }
      member.updatedAt = now;
      if (targetProfessionalId) {
        for (const p of db.professionals) {
          if (p.businessId === businessId && (p as any).userId === member.userId) (p as any).userId = '';
        }
        const pro = db.professionals.find((p) => p.id === targetProfessionalId && p.businessId === businessId);
        if (pro) {
          if ((pro as any).userId && (pro as any).userId !== member.userId) throw Object.assign(new Error('Este profissional já está vinculado a outro login.'), { status: 400 });
          const prevLinked = (pro as any).userId;
          (pro as any).userId = member.userId;
          if (ctx?.user && prevLinked !== member.userId) pushAudit(db, { action: 'member.professional_linked' as any, actor: { ...ctx.user, role: ctx.role }, businessId, supportSessionId: ctx.support?.id, meta: { memberId: member.id, professionalId: targetProfessionalId, userId: member.userId } });
        }
      }
      if (ctx?.user) {
        if (prevRole !== member.role) pushAudit(db, { action: 'member.role_changed' as any, actor: { ...ctx.user, role: ctx.role }, businessId, supportSessionId: ctx.support?.id, meta: { memberId: member.id, from: prevRole, to: member.role } });
        if (prevPerms !== JSON.stringify(member.permissions)) pushAudit(db, { action: 'member.permissions_changed' as any, actor: { ...ctx.user, role: ctx.role }, businessId, supportSessionId: ctx.support?.id, meta: { memberId: member.id } });
        pushAudit(db, { action: 'member.updated' as any, actor: { ...ctx.user, role: ctx.role }, businessId, supportSessionId: ctx.support?.id, meta: { memberId: member.id } });
      }
      memberId = member.id;
      userId = member.userId;
    } else {
      // create — inclui caso "Professional solo → conceder acesso" (mode update sem member, hasAccess true)
      const existingUser = emailNorm ? db.users.find((u) => u.email.toLowerCase() === emailNorm.toLowerCase()) : null;
      let isLinkedExisting = false;
      if (existingUser) {
        userId = existingUser.id;
        isLinkedExisting = true;
        // preserva passwordHash — não exige senha
        // atualiza dados pessoais do User existente se fornecidos? Sim, mas sem sobrescrever senha
        if (nameNorm) existingUser.name = nameNorm;
        if (phoneDigits) (existingUser as any).phone = phoneDigits;
        if (cpfDigits) (existingUser as any).cpf = cpfDigits;
        (existingUser as any).updatedAt = now;
      } else {
        if (!emailNorm) throw Object.assign(new Error('Informe um E-MAIL válido para o acesso.'), { status: 400 });
        if (String(input.password || '').length < 6) throw Object.assign(new Error('Defina uma senha inicial com ao menos 6 caracteres para criar a conta.'), { status: 400 });
        userId = randomUUID();
        const extra: any = {};
        if (phoneDigits) extra.phone = phoneDigits;
        if (cpfDigits) extra.cpf = cpfDigits;
        db.users.push({
          id: userId,
          name: nameNorm,
          email: emailNorm,
          passwordHash: hashPassword(String(input.password || '')),
          createdAt: now,
          role: 'owner',
          lastLoginAt: '',
          ...extra,
        } as any);
      }
      if (targetProfessionalId) {
        const targetPro = db.professionals.find((p) => p.id === targetProfessionalId && p.businessId === businessId);
        if (targetPro && (targetPro as any).userId && (targetPro as any).userId !== userId) {
          throw Object.assign(new Error('Este profissional já está vinculado a outro login.'), { status: 400 });
        }
      }
      const member: any = {
        id: randomUUID(),
        businessId,
        userId,
        role: input.role ? String(input.role).toUpperCase() as any : 'ATENDENTE',
        permissions: (() => {
          const next: Record<string, boolean> = {};
          if (input.permissionOverrides) {
            for (const [k, v] of Object.entries(input.permissionOverrides as Record<string, any>)) {
              if (isValidPermission(k) && typeof v === 'boolean') next[k] = v;
            }
          }
          return next;
        })(),
        active: true,
        note: '',
        invitedBy: ctx?.user?.id || 'system',
        createdAt: now,
        updatedAt: now,
        phone: phoneDigits,
        cpf: cpfDigits,
      };
      if (!isValidRole(member.role)) throw Object.assign(new Error(`Papel inválido: ${member.role}`), { status: 400 });
      if (member.role === 'OWNER') throw Object.assign(new Error('O proprietário é único. Use Administrador.'), { status: 400 });
      if (member.role === 'ADMIN' && !ctx?.isOwner && ctx?.role !== 'ADMIN') {
        throw Object.assign(new Error('Só o proprietário/administrador pode criar administradores.'), { status: 403 });
      }
      getMembersArray(db).push(member);
      memberId = member.id;
      if (targetProfessionalId) {
        const pro = db.professionals.find((p) => p.id === targetProfessionalId && p.businessId === businessId);
        if (pro) (pro as any).userId = userId;
        if (ctx?.user) pushAudit(db, { action: 'member.professional_linked' as any, actor: { ...ctx.user, role: ctx.role }, businessId, supportSessionId: ctx.support?.id, meta: { memberId, professionalId: targetProfessionalId, userId } });
      }
      if (ctx?.user) {
        pushAudit(db, { action: 'member.created' as any, actor: { ...ctx.user, role: ctx.role }, businessId, supportSessionId: ctx.support?.id, meta: { memberId, role: member.role, linkedExistingUser: isLinkedExisting, email: emailNorm } });
        if (existingUser) pushAudit(db, { action: 'member.user_reused' as any, actor: { ...ctx.user, role: ctx.role }, businessId, supportSessionId: ctx.support?.id, meta: { memberId, userId } });
      }
    }
  } else {
    // hasAccess false: não cria nem remove automaticamente
  }

  return { professionalId: targetProfessionalId || undefined, memberId: memberId || undefined, userId: userId || undefined };
}
