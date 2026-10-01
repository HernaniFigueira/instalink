import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { clampCents, onlyDigits, parseMoneyToCents } from '@/lib/utils';
import { isValidCpf, BRAZILIAN_STATES } from '@/lib/contact-profile';
import type { Professional } from '@/lib/types';
// Herança de horários: a regra vive em lib/schedule (pura e testada) para que
// API e painel decidam exatamente a mesma coisa.
import {
  applyToAllResultMessage, businessRules, followTogglePatch, planApplyBusinessHoursToAll, sanitizeWindows,
} from '@/lib/schedule';
import { validateAvailabilityException } from '@/lib/hours';
import { todayISO, effectiveTimezone } from '@/lib/tz';
import { serviceProfessionalMode } from '@/lib/booking';
import { serviceHasHistory, professionalHasHistory } from '@/lib/history';
import { freezeLegacyWindowsForService } from '@/lib/booking-temporal';

// API unificada de catálogo (produtos, opções, serviços, equipe, agenda).
// Toda mutação passa pela camada central de autorização (identidade →
// empresa → permissão), nunca por posse "na mão".
async function auth(req: NextRequest, businessId: string) {
  const guard = await requireBusiness(req, businessId, 'catalogo');
  if (!guard.ok) return null;
  return { user: guard.ctx.user, business: guard.ctx.business };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { businessId, action } = body;
    if (!businessId || !(await auth(req, businessId))) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });

    const id = body.id || randomUUID();

    const result = await updateDB((db) => {
      switch (action) {
        // ── Categorias ──
        case 'category.save': {
          if (!body.name?.trim()) throw new Error('Dê um nome à categoria.');
          // Normalização para integridade: trim, case insensitive, accent insensitive, espaços normalizados
          const normalizeName = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
          const normNew = normalizeName(body.name);
          const existing = db.categories.find((c) => c.id === body.id && c.businessId === businessId);
          if (existing) {
            // Renomear também precisa respeitar unicidade normalizada
            const targetKind = body.kind === 'service' ? 'service' : body.kind === 'product' ? 'product' : existing.kind;
            const dupRename = db.categories.find((c) => c.id !== existing.id && c.businessId === businessId && c.kind === targetKind && normalizeName(c.name) === normNew);
            if (dupRename) throw new Error('Já existe um grupo com este nome.');
            existing.name = body.name.trim();
            existing.active = body.active !== false;
            return { ok: true, categoryId: existing.id };
          }
          // Evitar duplicata por nome equivalente (mesmo businessId + kind)
          const dup = db.categories.find((c) => c.businessId === businessId && c.kind === (body.kind === 'service' ? 'service' : 'product') && normalizeName(c.name) === normNew);
          if (dup) return { ok: true, categoryId: dup.id };
          const newId = id;
          db.categories.push({ id: newId, businessId, kind: body.kind === 'service' ? 'service' : 'product', name: body.name.trim(), order: db.categories.filter((c) => c.businessId === businessId).length, active: true });
          return { ok: true, categoryId: newId };
        }
        case 'category.delete': {
          const linkedServices = db.services.filter((s) => s.businessId === businessId && s.categoryId === body.id).length;
          if (linkedServices > 0) throw new Error(`Não é possível excluir: ${linkedServices} serviço(s) usam esta categoria. Reatribua ou remova os serviços antes.`);
          db.categories = db.categories.filter((c) => !(c.id === body.id && c.businessId === businessId));
          return { ok: true };
        }
        // ── Produtos ──
        case 'product.save': {
          if (!body.name?.trim()) throw new Error('Dê um nome ao produto.');
          const price = clampCents(Number(body.price) || 0);
          const promo = clampCents(Number(body.promoPrice) || 0);
          const existing = db.products.find((p) => p.id === body.id && p.businessId === businessId);
          const data = { name: body.name.trim(), description: body.description || '', image: body.image || '', price: price, promoPrice: promo > 0 && promo < price ? promo : 0, categoryId: body.categoryId || '', active: body.active !== false, featured: !!body.featured };
          if (existing) Object.assign(existing, data);
          else db.products.push({ id, businessId, order: db.products.filter((p) => p.businessId === businessId).length, ...data });
          return { ok: true, id: existing?.id || id };
        }
        case 'product.delete': {
          const optIds = db.options.filter((o) => o.productId === body.id).map((o) => o.id);
          db.products = db.products.filter((p) => !(p.id === body.id && p.businessId === businessId));
          db.options = db.options.filter((o) => o.productId !== body.id);
          db.optionValues = db.optionValues.filter((v) => !optIds.includes(v.optionId));
          return { ok: true };
        }
        // ── Opções do produto (genéricas: tamanho, sabor, adicional…) ──
        case 'option.save': {
          if (!body.productId) throw new Error('Produto inválido.');
          if (!body.name?.trim()) throw new Error('Dê um nome à opção (ex: Tamanho).');
          const values: Array<{ id?: string; name: string; priceDelta: number }> = Array.isArray(body.values) ? body.values : [];
          const optId = body.id || randomUUID();
          const existing = db.options.find((o) => o.id === body.id && o.businessId === businessId);
          const data = { name: body.name.trim(), required: !!body.required, multiple: !!body.multiple, min: Number(body.min) || 0, max: Number(body.max) || 0 };
          if (existing) {
            Object.assign(existing, data);
          } else {
            db.options.push({ id: optId, businessId, productId: body.productId, order: 0, ...data });
          }
          const targetId = existing?.id || optId;
          const seen = new Set<string>();
          for (const v of values) {
            if (!v.name?.trim()) continue;
            const delta = clampCents(Number(v.priceDelta) || 0);
            const prev = v.id ? db.optionValues.find((x) => x.id === v.id && x.optionId === targetId) : undefined;
            if (prev) {
              prev.name = v.name.trim(); prev.priceDelta = delta; prev.active = true;
              seen.add(prev.id);
            } else {
              const nid = randomUUID();
              db.optionValues.push({ id: nid, optionId: targetId, name: v.name.trim(), priceDelta: delta, active: true });
              seen.add(nid);
            }
          }
          db.optionValues = db.optionValues.filter((x) => x.optionId !== targetId || seen.has(x.id));
          return { ok: true };
        }
        case 'option.delete': {
          db.options = db.options.filter((o) => !(o.id === body.id && o.businessId === businessId));
          db.optionValues = db.optionValues.filter((v) => v.optionId !== body.id);
          return { ok: true };
        }
        // ── Serviços ──
        case 'service.save': {
          if (!body.name?.trim()) throw new Error('Dê um nome ao serviço.');
          const existing = db.services.find((s) => s.id === body.id && s.businessId === businessId);
          // Validar categoryId pertence à clínica e é do kind service
          if (body.categoryId) {
            const cat = db.categories.find((c) => c.id === body.categoryId && c.businessId === businessId && c.kind === 'service');
            if (!cat) throw new Error('Categoria inválida para esta clínica.');
          }
          let proIds: string[];
          // professionalMode: 'all' | 'selected' (aditivo, backcompat: ausente → legacy []→all, [ids]→selected)
          let professionalMode: 'all' | 'selected' | undefined;
          if (typeof body.professionalMode === 'string' && (body.professionalMode === 'all' || body.professionalMode === 'selected')) {
            professionalMode = body.professionalMode;
          } else if (existing?.professionalMode) {
            professionalMode = existing.professionalMode;
          } else if (Array.isArray(body.professionalIds)) {
            // inferência legada apenas para criação sem modo explícito
            if (!existing) {
              const rawInfer = body.professionalIds.map((x: any) => String(x).trim()).filter(Boolean);
              professionalMode = rawInfer.length ? 'selected' : 'all';
            }
          }
          if (Array.isArray(body.professionalIds)) {
            const raw = body.professionalIds.map((x: any) => String(x).trim()).filter(Boolean);
            for (const pid of raw) {
              if (!db.professionals.some((pr) => pr.id === pid && pr.businessId === businessId)) {
                throw new Error('Profissional inválido para esta clínica.');
              }
            }
            // quando mode all, lista deve ser vazia (todos elegíveis)
            if (professionalMode === 'all') proIds = [];
            else proIds = raw;
          } else {
            proIds = existing?.professionalIds || [];
            if (professionalMode === 'all') proIds = [];
          }
          // showPrice (Mostrar preço na página pública): ausente preserva o
          // valor atual (legado = true); explícito grava a decisão do lojista.
          const showPrice = typeof body.showPrice === 'boolean'
            ? body.showPrice
            : (existing ? existing.showPrice !== false : true);
          const data: any = { name: body.name.trim(), description: body.description || '', image: body.image || '', price: clampCents(Number(body.price) || 0), showPrice, durationMin: Math.max(5, Number(body.durationMin) || 30), professionalIds: proIds, categoryId: body.categoryId || '', active: body.active !== false, featured: !!body.featured, bookable: body.bookable !== false, questions: (Array.isArray(body.questions) ? body.questions : (existing?.questions || [])).map((x: any) => String(x || '').trim().slice(0, 120)).filter(Boolean).slice(0, 3) };
          if (professionalMode) data.professionalMode = professionalMode;
          // ═══════════════════════════════════════════════════════════════
          // AGENDA TEMPORAL 2.0 (B1) — CONGELAMENTO ANTES DE MUDAR A DURAÇÃO
          // ═══════════════════════════════════════════════════════════════
          // Agendamentos antigos nunca tiveram a duração armazenada. Antes de
          // alterar `Service.durationMin`, a inferência dos agendamentos
          // legados deste serviço é congelada com a duração VIGENTE — assim
          // nem esta nem edições futuras movem a ocupação histórica. Sem
          // backfill destrutivo: só Bookings sem janela canônica são tocados.
          if (existing && Number(data.durationMin) !== Number(existing.durationMin)) {
            const biz = db.businesses.find((b) => b.id === businessId);
            freezeLegacyWindowsForService(db, {
              businessId,
              serviceId: existing.id,
              durationMin: existing.durationMin,
              timeZone: effectiveTimezone(biz?.businessTimezone),
            });
          }
          let serviceId: string;
          if (existing) { Object.assign(existing, data); serviceId = existing.id; }
          else { db.services.push({ id, businessId, ...data }); serviceId = id; }
          return { ok: true, serviceId };
        }
        case 'service.delete': {
          // Proteção histórica canônica: Booking OU Queue OU Encounter (qualquer estado, inclusive sem Booking)
          if (serviceHasHistory(db as any, businessId, body.id)) throw Object.assign(new Error('Este serviço possui histórico e não pode ser excluído. Desative-o.'), { status: 409 });
          // Cleanup seguro quando nunca referenciado
          db.availability = db.availability.filter((a) => !(a.businessId === businessId && a.serviceId === body.id));
          db.services = db.services.filter((s) => !(s.id === body.id && s.businessId === businessId));
          return { ok: true };
        }
        // ── Profissionais ──
        case 'professional.save': {
          if (!body.name?.trim()) throw new Error('Dê um nome ao profissional.');
          const existing = db.professionals.find((p) => p.id === body.id && p.businessId === businessId);
          const data: Record<string, any> = { name: body.name.trim(), role: body.role || '', photo: body.photo || '', active: body.active !== false };
          // Clinical OS — campos adicionais (sem migração destrutiva): telefone/CPF/CRMV/serviços são opcionais e preservam compatibilidade.
          // Normalização digits-only para telefone/CPF/CRMV; UF em maiúsculo.
          const onlyDigitsLocal = (v: any) => String(v||'').replace(/\D/g,'');
          // Validação server-side canônica (não só máscara client)
          if (body.phone !== undefined) {
            const p = onlyDigitsLocal(body.phone).slice(0,13);
            if (p && p.length < 10) throw new Error('Telefone inválido.');
            data.phone = p;
          }
          if (body.cpf !== undefined) {
            const c = onlyDigitsLocal(body.cpf).slice(0,11);
            if (c) {
              if (c.length !== 11 || !isValidCpf(c)) throw new Error('CPF inválido.');
            }
            data.cpf = c;
          }
          if (body.email !== undefined) {
            const e = String(body.email||'').trim().toLowerCase().slice(0,160);
            if (e && !e.includes('@')) throw new Error('E-mail inválido.');
            data.email = e;
          }
          // CRMV: nesta vertical, conselho fixo CRMV; se qualquer parte preenchida, validar UF e número
          const hasCrmv = body.crmvUf !== undefined || body.crmvNumero !== undefined || body.conselho !== undefined;
          if (hasCrmv) {
            const uf = String(body.crmvUf||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,2);
            const num = onlyDigitsLocal(body.crmvNumero||'').slice(0,6);
            const cons = String(body.conselho||'CRMV').trim() || 'CRMV';
            if (cons !== 'CRMV' && (uf || num)) throw new Error('Conselho deve ser CRMV.');
            if (!uf && !num) {
              // Ambos vazios → limpeza explícita, não criar registro falso
              data.conselho = '';
              data.crmvUf = '';
              data.crmvNumero = '';
            } else {
              if (uf && !BRAZILIAN_STATES.includes(uf as any)) throw new Error('UF inválida.');
              if (uf && !num) throw new Error('Informe o número do CRMV.');
              if (num && !uf) throw new Error('Informe a UF do CRMV.');
              if (num && !/^\d{1,6}$/.test(num)) throw new Error('Número do CRMV inválido.');
              data.conselho = 'CRMV';
              data.crmvUf = uf;
              data.crmvNumero = num;
            }
          }
          // Service.professionalIds é a autoridade canônica (não Professional.serviceIds)
          // Validar serviceIds quando fornecido, mas não persistir como campo do Professional
          let desiredServiceIds: string[] | null = null;
          if (Array.isArray(body.serviceIds)) {
            const rawIds = (body.serviceIds as any[]).map((x:any)=>String(x).trim()).filter(Boolean);
            for (const sid of rawIds) {
              if (!db.services.some((s)=> s.id===sid && s.businessId===businessId)) {
                throw new Error('Serviço inválido para esta clínica.');
              }
            }
            desiredServiceIds = rawIds;
          }
          // Herança do horário da empresa só muda quando vem explícita no corpo
          // (editar nome/foto nunca altera a agenda do profissional).
          if (typeof body.followBusinessHours === 'boolean') data.followBusinessHours = body.followBusinessHours;
          if (existing) Object.assign(existing, data);
          // Profissional novo começa SEGUINDO o horário da empresa.
          else db.professionals.push({ id, businessId, followBusinessHours: true, ...data } as Professional);
          // Sincronização atômica Service.professionalIds com professionalMode (fonte única)
          if (desiredServiceIds !== null) {
            const pid = existing?.id || id;
            const isNewProfessional = !existing;
            const isExplicit = body.serviceSelectionExplicit === true;
            // para conversão all → selected precisamos dos ativos atuais (inclui o próprio pid recém-criado)
            const allActiveIds = db.professionals.filter(pr => pr.businessId === businessId && pr.active !== false).map(pr => pr.id);
            for (const svc of db.services) {
              if (svc.businessId !== businessId) continue;
              const shouldContain = desiredServiceIds.includes(svc.id);
              const mode = serviceProfessionalMode(svc as any);
              const has = (svc.professionalIds || []).includes(pid);
              if (mode === 'all') {
                if (shouldContain) {
                  // já elegível via 'all', não modificar
                } else {
                  // desmarcar um serviço que era 'all' → materializa 'selected' sem o pid
                  // para novo profissional, só converte se seleção foi explícita (UI tocou)
                  if (!isNewProfessional || isExplicit) {
                    (svc as any).professionalMode = 'selected';
                    (svc as any).professionalIds = allActiveIds.filter(x => x !== pid);
                  }
                }
              } else {
                // mode selected
                if (shouldContain && !has) {
                  svc.professionalIds = [...(svc.professionalIds || []), pid];
                } else if (!shouldContain && has) {
                  svc.professionalIds = (svc.professionalIds || []).filter((x:string)=> x !== pid);
                }
                if (!(svc as any).professionalMode) (svc as any).professionalMode = 'selected';
              }
            }
          }
          // A3.4: devolvemos o id do profissional recém-salvo. A tela usa esse
          // id para oferecer "Criar acesso agora" JÁ VINCULADO (o vínculo é
          // Professional.userId, gravado por /api/team) — sem segunda pessoa.
          return { ok: true, professionalId: existing?.id || id };
        }
        // ── Vínculo do profissional com o horário da empresa ──
        // follow=true  → herda por referência. As regras próprias são PRESERVADAS
        //                (persistidas e inativas enquanto ele herda) — nunca apagadas;
        // follow=false → horário próprio: grava as janelas enviadas; sem janelas
        //                enviadas mantém as regras próprias existentes; sem regras
        //                existentes copia o horário da empresa como ponto de partida.
        // professional.services.set removido — fonte única via professional.save + Service.professionalIds (evita duas autoridades).
        case 'professional.hours': {
          const pro = db.professionals.find((p) => p.id === body.id && p.businessId === businessId);
          if (!pro) throw new Error('Profissional não encontrado.');
          if (typeof body.follow !== 'boolean') throw new Error('Informe se o profissional segue o horário da empresa.');
          const all = db.availability.filter((a) => a.businessId === businessId);
          const patch = followTogglePatch({ follow: body.follow, rules: all, professionalId: pro.id });
          pro.followBusinessHours = patch.followBusinessHours;
          if (!patch.followBusinessHours) {
            const raw = Array.isArray(body.rules) ? body.rules : null;
            const sent = sanitizeWindows(raw ?? []);
            // Janela inválida (fim antes do início, hora fora do dia) é RECUSADA —
            // nunca descartada em silêncio, senão o lojista acha que salvou o
            // horário próprio quando o sistema gravou outra coisa.
            if (raw && raw.length > 0 && sent.length !== raw.length) {
              throw new Error('Horário inválido: o fim do atendimento precisa ser depois do início.');
            }
            const hadOwn = all.some((a) => a.professionalId === pro.id);
            if (sent.length > 0) {
              // Substitui SOMENTE quando o usuário enviou janelas explícitas.
              db.availability = db.availability.filter((a) => !(a.businessId === businessId && a.professionalId === pro.id));
              for (const w of sent) {
                db.availability.push({
                  id: randomUUID(), businessId, professionalId: pro.id, serviceId: '',
                  weekday: w.weekday, start: w.start, end: w.end, slotMin: w.slotMin,
                });
              }
            } else if (!hadOwn) {
              const windows = patch.rules;
              if (windows.length === 0) throw new Error('Defina ao menos um dia de atendimento.');
              for (const w of windows) {
                db.availability.push({
                  id: randomUUID(), businessId, professionalId: pro.id, serviceId: '',
                  weekday: w.weekday, start: w.start, end: w.end, slotMin: w.slotMin,
                });
              }
            }
          }
          return { ok: true, followBusinessHours: pro.followBusinessHours };
        }
        case 'professional.delete': {
          if (professionalHasHistory(db as any, businessId, body.id)) throw Object.assign(new Error('Este profissional possui histórico e não pode ser excluído. Desative-o.'), { status: 409 });
          // Cleanup seguro quando nunca referenciado
          for (const svc of db.services) {
            if (svc.businessId === businessId) svc.professionalIds = (svc.professionalIds || []).filter((pid) => pid !== body.id);
          }
          db.availability = db.availability.filter((a) => !(a.businessId === businessId && a.professionalId === body.id));
          db.professionals = db.professionals.filter((p) => !(p.id === body.id && p.businessId === businessId));
          return { ok: true };
        }
        // ── Disponibilidade (substitui SOMENTE o escopo editado) ──
        case 'availability.save': {
          const rules = Array.isArray(body.rules) ? body.rules : [];
          const scope = body.scope && typeof body.scope === 'object' ? body.scope : {};
          const scopePro = typeof scope.professionalId === 'string' ? scope.professionalId : undefined;
          const scopeSvc = typeof scope.serviceId === 'string' ? scope.serviceId : undefined;
          const rx = /^\d{2}:\d{2}$/;
          const toMin = (t: string) => { const parts = t.split(':').map(Number); return parts[0] * 60 + parts[1]; };
          db.availability = db.availability.filter((a) =>
            a.businessId !== businessId ||
            (scopePro !== undefined && a.professionalId !== scopePro) ||
            (scopeSvc !== undefined && a.serviceId !== scopeSvc),
          );
          for (const r of rules) {
            const wd = Number(r.weekday);
            if (!Number.isInteger(wd) || wd < 0 || wd > 6) continue;
            if (!rx.test(r.start || '') || !rx.test(r.end || '')) continue;
            if (toMin(r.end) <= toMin(r.start)) continue;
            db.availability.push({
              id: randomUUID(), businessId,
              professionalId: scopePro !== undefined ? scopePro : (r.professionalId || ''),
              serviceId: scopeSvc !== undefined ? scopeSvc : (r.serviceId || ''),
              weekday: wd, start: r.start, end: r.end, slotMin: Math.max(0, Number(r.slotMin) || 0),
            });
          }
          return { ok: true };
        }
        // ── Aplicar o horário da empresa a todos ──
        // Toca SOMENTE em quem segue a empresa. Quem tem horário personalizado
        // é listado como ignorado (nunca sobrescrito em silêncio).
        case 'availability.applyToAll': {
          const all = db.availability.filter((a) => a.businessId === businessId);
          if (businessRules(all).length === 0) throw new Error('Defina o horário da empresa antes de aplicar a todos.');
          const pros = db.professionals.filter((p) => p.businessId === businessId);
          const plan = planApplyBusinessHoursToAll(pros, all);
          const update = new Set(plan.update);
          // Herança é por referência: nada é copiado nem apagado. Regras próprias
          // residuais de quem já segue a clínica ficam PRESERVADAS (inativas).
          for (const p of pros) if (update.has(p.id)) p.followBusinessHours = true;
          return { ok: true, updated: plan.update.length, skipped: plan.skip.length, message: applyToAllResultMessage(plan) };
        }
        // ── Exceções (dia fechado / horário especial) ──
        // A2-B3 (F7.4/F7.5): só grava exceção com EFEITO REAL — data passada,
        // janela invertida ou horário especial que não intersecta nenhuma
        // regra do dia são RECUSADOS com mensagem clara (nunca salvos em
        // silêncio para depois "não funcionar").
        case 'exception.save': {
          const date = String(body.date || '');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida.');
          const rx = /^\d{2}:\d{2}$/;
          const start = rx.test(body.start || '') ? body.start : '';
          const end = rx.test(body.end || '') ? body.end : '';
          const closed = body.closed !== false && !(start && end);
          const check = validateAvailabilityException(
            { date, closed, start, end },
            {
              // A2-B5 (F9): "hoje" no fuso do negócio da exceção.
              today: todayISO(
                new Date(),
                effectiveTimezone(db.businesses.find((b) => b.id === businessId)?.businessTimezone),
              ),
              rules: db.availability.filter((a) => a.businessId === businessId),
            },
          );
          if (!check.ok) throw new Error(check.error);
          const found = db.exceptions.find((e) => e.businessId === businessId && e.date === date);
          if (found) {
            found.closed = closed; found.start = start; found.end = end;
            found.note = String(body.note || '').slice(0, 80);
          } else {
            db.exceptions.push({ id: randomUUID(), businessId, date, closed, start, end, note: String(body.note || '').slice(0, 80) });
          }
          return { ok: true };
        }
        case 'exception.delete': {
          db.exceptions = db.exceptions.filter((e) => !(e.businessId === businessId && (e.id === body.id || e.date === body.date)));
          return { ok: true };
        }
        default:
          throw new Error('Ação inválida.');
      }
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Não foi possível salvar.' }, { status: err?.status || 400 });
  }
}
