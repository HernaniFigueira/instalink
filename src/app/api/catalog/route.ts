import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';

// API unificada de catálogo (produtos, opções, serviços, equipe, agenda).
// Toda mutação exige sessão + posse do business (multi-tenant).
async function auth(req: NextRequest, businessId: string) {
  const user = await userFromRequest(req);
  if (!user) return null;
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId && b.ownerId === user.id);
  if (!business) return null;
  return { user, business };
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
          const existing = db.categories.find((c) => c.id === body.id && c.businessId === businessId);
          if (existing) { existing.name = body.name.trim(); existing.active = body.active !== false; }
          else db.categories.push({ id, businessId, kind: body.kind === 'service' ? 'service' : 'product', name: body.name.trim(), order: db.categories.filter((c) => c.businessId === businessId).length, active: true });
          return { ok: true };
        }
        case 'category.delete': {
          db.categories = db.categories.filter((c) => !(c.id === body.id && c.businessId === businessId));
          return { ok: true };
        }
        // ── Produtos ──
        case 'product.save': {
          if (!body.name?.trim()) throw new Error('Dê um nome ao produto.');
          const price = Math.max(0, Math.round(Number(body.price) || 0));
          const promo = Math.max(0, Math.round(Number(body.promoPrice) || 0));
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
          const values: Array<{ name: string; priceDelta: number }> = Array.isArray(body.values) ? body.values : [];
          const optId = body.id || randomUUID();
          const existing = db.options.find((o) => o.id === body.id && o.businessId === businessId);
          const data = { name: body.name.trim(), required: !!body.required, multiple: !!body.multiple, min: Number(body.min) || 0, max: Number(body.max) || 0 };
          if (existing) {
            Object.assign(existing, data);
            db.optionValues = db.optionValues.filter((v) => v.optionId !== existing.id);
          } else {
            db.options.push({ id: optId, businessId, productId: body.productId, order: 0, ...data });
          }
          const targetId = existing?.id || optId;
          for (const v of values) {
            if (!v.name?.trim()) continue;
            db.optionValues.push({ id: randomUUID(), optionId: targetId, name: v.name.trim(), priceDelta: Math.max(0, Math.round(Number(v.priceDelta) || 0)), active: true });
          }
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
          const data = { name: body.name.trim(), description: body.description || '', image: body.image || '', price: Math.max(0, Math.round(Number(body.price) || 0)), durationMin: Math.max(5, Number(body.durationMin) || 30), categoryId: body.categoryId || '', active: body.active !== false, featured: !!body.featured, bookable: body.bookable !== false };
          if (existing) Object.assign(existing, data);
          else db.services.push({ id, businessId, ...data });
          return { ok: true };
        }
        case 'service.delete': {
          db.services = db.services.filter((s) => !(s.id === body.id && s.businessId === businessId));
          return { ok: true };
        }
        // ── Profissionais ──
        case 'professional.save': {
          if (!body.name?.trim()) throw new Error('Dê um nome ao profissional.');
          const existing = db.professionals.find((p) => p.id === body.id && p.businessId === businessId);
          const data = { name: body.name.trim(), role: body.role || '', photo: body.photo || '', active: body.active !== false };
          if (existing) Object.assign(existing, data);
          else db.professionals.push({ id, businessId, ...data });
          return { ok: true };
        }
        case 'professional.delete': {
          db.professionals = db.professionals.filter((p) => !(p.id === body.id && p.businessId === businessId));
          return { ok: true };
        }
        // ── Disponibilidade (substitui regras do negócio) ──
        case 'availability.save': {
          const rules = Array.isArray(body.rules) ? body.rules : [];
          db.availability = db.availability.filter((a) => a.businessId !== businessId);
          for (const r of rules) {
            if (r.weekday === undefined || !r.start || !r.end) continue;
            db.availability.push({ id: randomUUID(), businessId, professionalId: r.professionalId || '', weekday: Number(r.weekday), start: r.start, end: r.end, slotMin: Number(r.slotMin) || 30 });
          }
          return { ok: true };
        }
        default:
          throw new Error('Ação inválida.');
      }
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Não foi possível salvar.' }, { status: 400 });
  }
}
