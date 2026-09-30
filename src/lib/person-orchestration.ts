// Person orchestration — operação atômica para "Adicionar pessoa" / "Gerenciar pessoa"
// Reutiliza validações canônicas de team e catalog sem duplicar lógica.
// Uma única updateDB() persiste: User/Member/Professional/Services/Categories + vínculos.
import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth';
import { isValidCpf, BRAZILIAN_STATES } from './contact-profile';
import { onlyDigits, clampCents, parseMoneyToCents } from './utils';
import { serviceProfessionalMode } from './booking';
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
function ensureCategoryTx(db: DB, businessId: string, nameOrId: string): string {
  if (!nameOrId) return '';
  // Se for id existente, retorna ele
  const byId = db.categories.find((c) => c.id === nameOrId && c.businessId === businessId && c.kind === 'service');
  if (byId) return byId.id;
  // Senão, trata como nome (pode ser suggestedGroupName)
  const raw = String(nameOrId).trim();
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
  // edição vs criação
  mode: 'create' | 'update';
  existingMemberId?: string;
  existingProfessionalId?: string;
  existingUserId?: string;
  isOwner?: boolean; // owner: identificação read-only, só clínica pode editar
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

function getMembers(db: any) { return (db.businessMembers || db.members || []) as any[]; }
function getServices(db: any) { return (db.services || []) as any[]; }
export function validatePersonInput(input: PersonSaveInput, db: DB) {
  // nome obrigatório sempre
  if (!normName(input.name)) throw Object.assign(new Error('Informe o NOME.'), { status: 400 });
  const phoneDigits = normPhone(input.phone);
  const cpfDigits = normCpf(input.cpf);
  validatePhone(phoneDigits);
  validateCpf(cpfDigits);
  const emailNorm = input.email ? normEmail(input.email) : '';
  if (input.hasAccess) {
    if (!emailNorm || !emailNorm.includes('@')) throw Object.assign(new Error('Informe um E-MAIL válido para o acesso.'), { status: 400 });
    if (input.mode === 'create') {
      // para create, se user não existe, senha >=6; se user existe, não exige senha (reutiliza)
      const existingUser = db.users.find((u) => u.email.toLowerCase() === emailNorm.toLowerCase());
      if (!existingUser && String(input.password || '').length < 6) {
        throw Object.assign(new Error('Defina uma senha inicial com ao menos 6 caracteres para criar a conta.'), { status: 400 });
      }
    } else {
      // update: se email mudou e já existe outro user com mesmo email, conflita
      if (emailNorm && input.existingUserId) {
        const clash = db.users.find((u) => u.email.toLowerCase() === emailNorm.toLowerCase() && u.id !== input.existingUserId);
        if (clash) {
          // verifica se clash já é membro desta unidade
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
    // role validation
    if (input.role && !['ATENDENTE','SECRETARIA','PROFISSIONAL','ADMIN','VENDEDOR','FINANCEIRO'].includes(String(input.role).toUpperCase())) {
      // permite ATENDENTE etc; OWNER só quando isOwner (edição do proprietário)
      if ((String(input.role).toUpperCase() === 'OWNER' && !input.isOwner) || String(input.role).toLowerCase() === 'master') {
        throw Object.assign(new Error('Não é possível atribuir o papel Master/Owner por esta rota.'), { status: 403 });
      }
    }
    if (input.role === 'OWNER' && !input.isOwner) throw Object.assign(new Error('O proprietário é único. Use Administrador.'), { status: 400 });
  }
  // clínica
  if (input.hasClinical) {
    // crmv
    validateCrmv(input.conselho || 'CRMV', input.crmvUf || '', input.crmvNumero || '');
    // serviceIds devem existir
    if (Array.isArray(input.serviceIds)) {
      for (const sid of input.serviceIds) {
        if (!getServices(db).some((s) => s.id === sid && s.businessId === input.businessId)) {
          throw Object.assign(new Error('Serviço inválido para esta clínica.'), { status: 400 });
        }
      }
    }
    // pendingServices validação básica
    if (Array.isArray(input.pendingServices)) {
      for (const ps of input.pendingServices) {
        if (!String(ps.name || '').trim()) throw Object.assign(new Error('Nome do serviço pendente inválido.'), { status: 400 });
      }
    }
  }
  // e-mail duplicado global para create com hasAccess
  if (input.hasAccess && input.mode === 'create') {
    const emailNorm2 = normEmail(input.email);
    const existingMemberWithEmail = getMembers(db).some((m) => m.businessId === input.businessId && db.users.find((u) => u.id === m.userId)?.email.toLowerCase() === emailNorm2.toLowerCase());
    if (existingMemberWithEmail) throw Object.assign(new Error('Esta pessoa já faz parte da equipe.'), { status: 400 });
  }
}

export function personSaveTx(db: DB, input: PersonSaveInput, ctx?: { user: any; role: string; isOwner: boolean; support?: any }): { professionalId?: string; memberId?: string; userId?: string } {
  // Validação já feita antes, mas reforça dentro da transação com DB fresco
  validatePersonInput(input, db);

  const now = new Date().toISOString();
  const businessId = input.businessId;
  const phoneDigits = normPhone(input.phone);
  const cpfDigits = normCpf(input.cpf);
  const emailNorm = input.email ? normEmail(input.email) : '';
  const nameNorm = normName(input.name);
  const isCreate = input.mode === 'create';
  const hasAccess = !!input.hasAccess;
  const hasClinical = !!input.hasClinical;

  // --- 1. Pending Services → categorias e serviços (precisa de professionalId, então cria professional primeiro se novo) ---
  // Para novo professional, precisamos do id antes de criar serviços pendentes que o referenciam.
  // Vamos determinar professionalId alvo
  let targetProfessionalId = input.existingProfessionalId || '';
  const isNewProfessional = !targetProfessionalId && hasClinical;
  if (isNewProfessional) {
    targetProfessionalId = randomUUID();
  }

  // Criar categorias/serviços pendentes
  const createdServiceIds: string[] = [];
  if (hasClinical && Array.isArray(input.pendingServices) && input.pendingServices.length > 0) {
    for (const ps of input.pendingServices) {
      const svcName = String(ps.name || '').trim();
      if (!svcName) continue;
      // resolver categoria
      let catId = '';
      if (ps.groupId) {
        // tenta usar id direto, senão trata como nome
        const byId = db.categories.find((c) => c.id === ps.groupId && c.businessId === businessId && c.kind === 'service');
        if (byId) catId = byId.id;
        else catId = ensureCategoryTx(db, businessId, ps.groupId);
      }
      if (!catId && ps.suggestedGroupName) {
        catId = ensureCategoryTx(db, businessId, ps.suggestedGroupName);
      }
      // criar serviço
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
    }
  }

  // --- 2. Professional ---
  let professional: any = null;
  if (hasClinical) {
    const crmv = validateCrmv(input.conselho || 'CRMV', input.crmvUf || '', input.crmvNumero || '');
    // serviceIds finais = selecionados existentes + criados pendentes
    let desiredServiceIds: string[] | null = null;
    if (Array.isArray(input.serviceIds)) {
      desiredServiceIds = [...input.serviceIds, ...createdServiceIds];
    } else if (createdServiceIds.length > 0) {
      // se não veio serviceIds mas tem pendentes, considera pendentes como seleção
      desiredServiceIds = [...createdServiceIds];
    }

    if (isNewProfessional) {
      // cria professional
      const proData: any = {
        id: targetProfessionalId,
        businessId,
        name: nameNorm,
        role: String(input.funcao || '').trim(),
        photo: String(input.photo || ''),
        active: true,
        followBusinessHours: true, // padrão
        phone: phoneDigits,
        cpf: cpfDigits,
        email: emailNorm,
        conselho: crmv.conselho,
        crmvUf: crmv.uf,
        crmvNumero: crmv.numero,
        createdAt: now,
        updatedAt: now,
      };
      // dispMode para novo: se own, depois o caller pode configurar, mas aqui respeita se veio own? Por padrão, novo segue clínica.
      // O spec diz que novo com own deve aguardar salvar para configurar disponibilidade, mas aqui mantemos follow true e o UI depois leva para disponibilidade.
      // Se dispMode === 'own' e isNewProfessional, ainda mantém follow true até configurar — mas não persiste regra própria agora.
      db.professionals.push(proData);
      professional = proData;
    } else {
      // update existente
      professional = db.professionals.find((p) => p.id === targetProfessionalId && p.businessId === businessId);
      if (!professional) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404 });
      // se for owner, não altera dados pessoais via esta rota? Mas permite clínica
      if (!input.isOwner) {
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
      // active já true (se desmarcou clínica, este bloco não rodaria; para desativar clínica, o caller deve fazer hasClinical false)
      // followBusinessHours: só muda quando explícito e não é novo
      if (input.dispMode) {
        professional.followBusinessHours = input.dispMode === 'follow';
      }
      (professional as any).updatedAt = now;
    }

    // Sincronização Service.professionalIds (fonte única) — reutiliza lógica de catalog
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
            // já elegível
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

    // Disponibilidade: se dispMode mudou, precisa atualizar rules? Para novo, não cria regra própria agora; para edição, segue a mesma lógica de professional.hours
    // Se hasClinical e dispMode === 'own' para existente, o UI depois leva para /disponibilidade; não precisamos criar regra vazia aqui.
    // Se dispMode === 'follow' para existente com horário próprio, devemos remover regras próprias (como em professional.hours)
    if (!isNewProfessional && input.dispMode) {
      const wantFollow = input.dispMode === 'follow';
      const currentlyFollow = (() => {
        // followsBusinessHours logic: precisa de rules
        const { followsBusinessHours } = require('./schedule');
        return followsBusinessHours(professional, db.availability);
      })();
      if (wantFollow !== currentlyFollow) {
        if (wantFollow) {
          // herda: remover regras próprias
          db.availability = db.availability.filter((a) => !(a.businessId === businessId && a.professionalId === pidForDisp()));
        } else {
          // own: não cria regras agora, mas marca follow false (já feito acima)
          // Para compatibilidade, se não há regras próprias, mantém follow false sem regras (UI vai pedir para configurar)
        }
      }
      function pidForDisp() { return targetProfessionalId; }
    }
  } else {
    // hasClinical false: se existia professional e está editando, desativa
    if (!isCreate && input.existingProfessionalId) {
      const pro = db.professionals.find((p) => p.id === input.existingProfessionalId && p.businessId === businessId);
      if (pro) {
        pro.active = false;
        (pro as any).updatedAt = now;
      }
    }
  }

  // --- 3. User / Member (acesso) ---
  let memberId = input.existingMemberId || '';
  let userId = input.existingUserId || '';

  if (hasAccess) {
    // para owner, não cria/edita member via esta rota
    if (input.isOwner) {
      // owner: apenas atualiza professional já feito, não mexe em member
    } else if (isCreate) {
      // create
      const existingUser = db.users.find((u) => u.email.toLowerCase() === emailNorm.toLowerCase());
      let isLinkedExisting = false;
      if (existingUser) {
        userId = existingUser.id;
        isLinkedExisting = true;
        // não exige senha
      } else {
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
        });
      }
      // verifica se professional já vinculado a outro user
      if (targetProfessionalId) {
        const targetPro = db.professionals.find((p) => p.id === targetProfessionalId && p.businessId === businessId);
        if (targetPro && targetPro.userId && targetPro.userId !== userId) {
          throw Object.assign(new Error('Este profissional já está vinculado a outro login.'), { status: 400 });
        }
      }
      // cria member
      const member: any = {
        id: randomUUID(),
        businessId,
        userId,
        role: String(input.role || 'ATENDENTE').toUpperCase() as any,
        permissions: input.permissionOverrides || {},
        active: true,
        note: '',
        invitedBy: ctx?.user?.id || "system",
        createdAt: now,
        updatedAt: now,
        phone: phoneDigits,
        cpf: cpfDigits,
      };
      // valida role
      if (member.role === 'OWNER') throw Object.assign(new Error('O proprietário é único. Use Administrador.'), { status: 400 });
      if (member.role === 'ADMIN' && !ctx?.isOwner && ctx?.role !== 'ADMIN') {
        throw Object.assign(new Error('Só o proprietário/administrador pode criar administradores.'), { status: 403 });
      }
      ((db as any).businessMembers || (db as any).members).push(member);
      memberId = member.id;
      // vincula professional se houver
      if (targetProfessionalId) {
        const pro = db.professionals.find((p) => p.id === targetProfessionalId && p.businessId === businessId);
        if (pro) pro.userId = userId;
      }
    } else {
      // update existente member
      const member = getMembers(db).find((m) => m.id === input.existingMemberId && m.businessId === businessId);
      if (!member) throw Object.assign(new Error('Membro não encontrado.'), { status: 404 });
      // valida permissão para editar admin
      if (member.role === 'OWNER' && !input.isOwner) throw Object.assign(new Error('O proprietário não pode ser editado.'), { status: 403 });
      if (member.role === 'ADMIN' && !ctx?.isOwner && ctx?.role !== 'ADMIN') {
        throw Object.assign(new Error('Sem permissão para editar administradores.'), { status: 403 });
      }
      if (input.role === 'ADMIN' && !ctx?.isOwner && ctx?.role !== 'ADMIN') {
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
      if (input.role && !input.isOwner) member.role = String(input.role).toUpperCase() as any;
      if (input.permissionOverrides !== undefined && !input.isOwner) {
        member.permissions = input.permissionOverrides || {};
      }
      member.updatedAt = now;
      // vínculo professional
      if (targetProfessionalId) {
        // desvincula outros pros deste user
        for (const p of db.professionals) {
          if (p.businessId === businessId && p.userId === member.userId) p.userId = '';
        }
        const pro = db.professionals.find((p) => p.id === targetProfessionalId && p.businessId === businessId);
        if (pro) {
          if (pro.userId && pro.userId !== member.userId) throw Object.assign(new Error('Este profissional já está vinculado a outro login.'), { status: 400 });
          pro.userId = member.userId;
        }
      }
      memberId = member.id;
      userId = member.userId;
    }
  } else {
    // hasAccess false: para create, não cria user/member; para update, não remove automaticamente (remoção é via DELETE)
    // nada
  }

  return { professionalId: targetProfessionalId || undefined, memberId: memberId || undefined, userId: userId || undefined };
}
