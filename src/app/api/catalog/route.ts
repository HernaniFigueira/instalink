import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite } from '@/lib/relational/slice';
import { requireBusiness } from '@/lib/access';
import { clampCents } from '@/lib/utils';
import type { Professional } from '@/lib/types';
// Herança de horários: a regra vive em lib/schedule (pura e testada) para que
// API e painel decidam exatamente a mesma coisa.
import {
  applyToAllResultMessage, businessRules, followTogglePatch, planApplyBusinessHoursToAll, sanitizeWindows,
} from '@/lib/schedule';
import { validateAvailabilityException } from '@/lib/hours';
import { todayISO, effectiveTimezone } from '@/lib/tz';

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

    // Mutação PURA (DOIS motores): TODAS as ações do catálogo em um lugar —
    // a regra nunca diverge entre documento e SQL.
    const catalogAction = (db: any): any => {
      switch (action) {
        // ── Categorias ──
        case 'category.save': {
          if (!body.name?.trim()) throw new Error('Dê um nome à categoria.');
          const existing = db.categories.find((c: any) => c.id === body.id && c.businessId === businessId);
          if (existing) { existing.name = body.name.trim(); existing.active = body.active !== false; }
          else db.categories.push({ id, businessId, kind: body.kind === 'service' ? 'service' : 'product', name: body.name.trim(), order: db.categories.filter((c: any) => c.businessId === businessId).length, active: true });
          return { ok: true };
        }
        case 'category.delete': {
          db.categories = db.categories.filter((c: any) => !(c.id === body.id && c.businessId === businessId));
          return { ok: true };
        }
        // ── Produtos ──
        case 'product.save': {
          if (!body.name?.trim()) throw new Error('Dê um nome ao produto.');
          const price = clampCents(Number(body.price) || 0);
          const promo = clampCents(Number(body.promoPrice) || 0);
          const existing = db.products.find((p: any) => p.id === body.id && p.businessId === businessId);
          const data = { name: body.name.trim(), description: body.description || '', image: body.image || '', price: price, promoPrice: promo > 0 && promo < price ? promo : 0, categoryId: body.categoryId || '', active: body.active !== false, featured: !!body.featured };
          if (existing) Object.assign(existing, data);
          else db.products.push({ id, businessId, order: db.products.filter((p: any) => p.businessId === businessId).length, ...data });
          return { ok: true, id: existing?.id || id };
        }
        case 'product.delete': {
          const optIds = db.options.filter((o: any) => o.productId === body.id).map((o: any) => o.id);
          db.products = db.products.filter((p: any) => !(p.id === body.id && p.businessId === businessId));
          db.options = db.options.filter((o: any) => o.productId !== body.id);
          db.optionValues = db.optionValues.filter((v: any) => !optIds.includes(v.optionId));
          return { ok: true };
        }
        // ── Opções do produto (genéricas: tamanho, sabor, adicional…) ──
        case 'option.save': {
          if (!body.productId) throw new Error('Produto inválido.');
          if (!body.name?.trim()) throw new Error('Dê um nome à opção (ex: Tamanho).');
          const values: Array<{ id?: string; name: string; priceDelta: number }> = Array.isArray(body.values) ? body.values : [];
          const optId = body.id || randomUUID();
          const existing = db.options.find((o: any) => o.id === body.id && o.businessId === businessId);
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
            const prev = v.id ? db.optionValues.find((x: any) => x.id === v.id && x.optionId === targetId) : undefined;
            if (prev) {
              prev.name = v.name.trim(); prev.priceDelta = delta; prev.active = true;
              seen.add(prev.id);
            } else {
              const nid = randomUUID();
              db.optionValues.push({ id: nid, optionId: targetId, name: v.name.trim(), priceDelta: delta, active: true });
              seen.add(nid);
            }
          }
          db.optionValues = db.optionValues.filter((x: any) => x.optionId !== targetId || seen.has(x.id));
          return { ok: true };
        }
        case 'option.delete': {
          db.options = db.options.filter((o: any) => !(o.id === body.id && o.businessId === businessId));
          db.optionValues = db.optionValues.filter((v: any) => v.optionId !== body.id);
          return { ok: true };
        }
        // ── Serviços ──
        case 'service.save': {
          if (!body.name?.trim()) throw new Error('Dê um nome ao serviço.');
          const existing = db.services.find((sv: any) => sv.id === body.id && sv.businessId === businessId);
          const proIds = Array.isArray(body.professionalIds)
            ? body.professionalIds.map((x: any) => String(x)).filter((x: string) => db.professionals.some((pr: any) => pr.id === x && pr.businessId === businessId))
            : (existing?.professionalIds || []);
          // showPrice (Mostrar preço na página pública): ausente preserva o
          // valor atual (legado = true); explícito grava a decisão do lojista.
          const showPrice = typeof body.showPrice === 'boolean'
            ? body.showPrice
            : (existing ? existing.showPrice !== false : true);
          const data = { name: body.name.trim(), description: body.description || '', image: body.image || '', price: clampCents(Number(body.price) || 0), showPrice, durationMin: Math.max(5, Number(body.durationMin) || 30), professionalIds: proIds, categoryId: body.categoryId || '', active: body.active !== false, featured: !!body.featured, bookable: body.bookable !== false, questions: (Array.isArray(body.questions) ? body.questions : (existing?.questions || [])).map((x: any) => String(x || '').trim().slice(0, 120)).filter(Boolean).slice(0, 3) };
          if (existing) Object.assign(existing, data);
          else db.services.push({ id, businessId, ...data });
          return { ok: true };
        }
        case 'service.delete': {
          db.services = db.services.filter((s: any) => !(s.id === body.id && s.businessId === businessId));
          return { ok: true };
        }
        // ── Profissionais ──
        case 'professional.save': {
          if (!body.name?.trim()) throw new Error('Dê um nome ao profissional.');
          const existing = db.professionals.find((pp: any) => pp.id === body.id && pp.businessId === businessId);
          const data: Record<string, any> = { name: body.name.trim(), role: body.role || '', photo: body.photo || '', active: body.active !== false };
          // Herança do horário da empresa só muda quando vem explícita no corpo
          // (editar nome/foto nunca altera a agenda do profissional).
          if (typeof body.followBusinessHours === 'boolean') data.followBusinessHours = body.followBusinessHours;
          if (existing) Object.assign(existing, data);
          // Profissional novo começa SEGUINDO o horário da empresa.
          else db.professionals.push({ id, businessId, followBusinessHours: true, ...data } as Professional);
          // A3.4: devolvemos o id do profissional recém-salvo. A tela usa esse
          // id para oferecer "Criar acesso agora" JÁ VINCULADO (o vínculo é
          // Professional.userId, gravado por /api/team) — sem segunda pessoa.
          return { ok: true, professionalId: existing?.id || id };
        }
        // ── Vínculo do profissional com o horário da empresa ──
        // follow=true  → herda por referência (regras próprias são removidas);
        // follow=false → horário personalizado (copia o horário da empresa como
        //                ponto de partida, ou grava as janelas enviadas).
        case 'professional.hours': {
          const pro = db.professionals.find((p: any) => p.id === body.id && p.businessId === businessId);
          if (!pro) throw new Error('Profissional não encontrado.');
          if (typeof body.follow !== 'boolean') throw new Error('Informe se o profissional segue o horário da empresa.');
          const all = db.availability.filter((a: any) => a.businessId === businessId);
          const patch = followTogglePatch({ follow: body.follow, rules: all, professionalId: pro.id });
          pro.followBusinessHours = patch.followBusinessHours;
          // Remove o horário próprio anterior em qualquer um dos dois casos.
          db.availability = db.availability.filter((a: any) => !(a.businessId === businessId && a.professionalId === pro.id));
          if (!patch.followBusinessHours) {
            const raw = Array.isArray(body.rules) ? body.rules : null;
            const sent = sanitizeWindows(raw ?? []);
            // Janela inválida (fim antes do início, hora fora do dia) é RECUSADA —
            // nunca descartada em silêncio, senão o lojista acha que salvou o
            // horário próprio quando o sistema gravou outra coisa.
            if (raw && raw.length > 0 && sent.length !== raw.length) {
              throw new Error('Horário inválido: o fim do atendimento precisa ser depois do início.');
            }
            const windows = sent.length > 0 ? sent : patch.rules;
            if (windows.length === 0) throw new Error('Defina ao menos um dia de atendimento.');
            for (const w of windows) {
              db.availability.push({
                id: randomUUID(), businessId, professionalId: pro.id, serviceId: '',
                weekday: w.weekday, start: w.start, end: w.end, slotMin: w.slotMin,
              });
            }
          }
          return { ok: true, followBusinessHours: pro.followBusinessHours };
        }
        case 'professional.delete': {
          db.professionals = db.professionals.filter((p: any) => !(p.id === body.id && p.businessId === businessId));
          return { ok: true };
        }
        // ── Disponibilidade (substitui SOMENTE o escopo editado) ──
        case 'availability.save': {
          const rules: any[] = Array.isArray(body.rules) ? body.rules : [];
          const scope = body.scope && typeof body.scope === 'object' ? body.scope : {};
          const scopePro = typeof scope.professionalId === 'string' ? scope.professionalId : undefined;
          const scopeSvc = typeof scope.serviceId === 'string' ? scope.serviceId : undefined;
          const rx = /^\d{2}:\d{2}$/;
          const toMin = (t: string) => { const parts = t.split(':').map(Number); return parts[0] * 60 + parts[1]; };
          db.availability = db.availability.filter((a: any) =>
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
          const all = db.availability.filter((a: any) => a.businessId === businessId);
          if (businessRules(all).length === 0) throw new Error('Defina o horário da empresa antes de aplicar a todos.');
          const pros = db.professionals.filter((p: any) => p.businessId === businessId);
          const plan = planApplyBusinessHoursToAll(pros, all);
          const update = new Set(plan.update);
          // Herança é por referência: basta remover regras próprias residuais.
          db.availability = db.availability.filter((a: any) => !(a.businessId === businessId && a.professionalId && update.has(a.professionalId)));
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
                effectiveTimezone(db.businesses.find((b: any) => b.id === businessId)?.businessTimezone),
              ),
              rules: db.availability.filter((a: any) => a.businessId === businessId),
            },
          );
          if (!check.ok) throw new Error(check.error);
          const found = db.exceptions.find((e: any) => e.businessId === businessId && e.date === date);
          if (found) {
            found.closed = closed; found.start = start; found.end = end;
            found.note = String(body.note || '').slice(0, 80);
          } else {
            db.exceptions.push({ id: randomUUID(), businessId, date, closed, start, end, note: String(body.note || '').slice(0, 80) });
          }
          return { ok: true };
        }
        case 'exception.delete': {
          db.exceptions = db.exceptions.filter((e: any) => !(e.businessId === businessId && (e.id === body.id || e.date === body.date)));
          return { ok: true };
        }
        default:
          throw new Error('Ação inválida.');
      }
    };
    // MODO RELACIONAL: a MESMA mutação sobre a fatia do catálogo
    // (categorias/produtos/opções/serviços/profissionais/horários/exceções).
    if (relationalActive()) {
      const result = await runRelationalWrite(businessId, catalogAction, {
        load: {
          categories: {}, products: {}, options: {}, services: {}, professionals: {},
          availability: {}, exceptions: {}, businesses: {},
          optionValues: (partial) => (partial.options.length ? {} : null),
        },
      });
      return NextResponse.json(result);
    }
    const result = await updateDB(catalogAction);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Não foi possível salvar.' }, { status: 400 });
  }
}
