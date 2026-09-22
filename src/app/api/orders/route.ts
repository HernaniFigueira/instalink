import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite, runRelationalRead } from '@/lib/relational/slice';
import { customerFromRequest } from '@/lib/customer-auth';
import { onlyDigits, money } from '@/lib/utils';
import { ingestLead, getBusinessPipeline, normalizeLeadStageId, stageForLegacyStatus, moveLeadStage } from '@/lib/pipeline';
import { ORDER_FLOW, canTransition } from '@/lib/status';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import type { DB, OrderItem, OrderStatus } from '@/lib/types';
import { isFeatureEnabled } from '@/lib/features';

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

// POST público: cria pedido. Preços SEMPRE recalculados no servidor.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`order:${ipFrom(req)}`, 30, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde um instante.' }, { status: 429 });
  try {
    const body = await req.json();
    const { businessId } = body;
    const customer = await customerFromRequest(req);
    if (!customer) return NextResponse.json({ error: 'Entre para fazer seu pedido.', code: 'login_required' }, { status: 401 });

    const name = (body.customerName || customer.name || '').trim();
    const phone = (body.customerPhone || customer.phone || '').trim();
    const items = Array.isArray(body.items) ? body.items : [];

    /**
     * Mutação PURA (DOIS MOTORES): criação de pedido com preços SEMPRE
     * recalculados no servidor, opções validadas, código anti-duplicado e
     * entrada na esteira pela porta oficial (ingestLead). No relacional TODAS
     * as checagens re-rodam dentro da transação (lock da unidade).
     */
    const orderCreateTx = (db: any) => {
      const business = (db.businesses || [])[0];
      if (!business) throw err('Negócio não encontrado.', 404);
      // Módulo desativado não aceita pedido novo (nem por rota direta).
      // A vitrine de produtos NÃO gera pedido: apenas o módulo legado de
      // pedidos (empresas antigas que já recebiam) continua aceitando.
      if (!isFeatureEnabled(business, 'orders')) {
        throw err('Este negócio não está recebendo pedidos no momento.', 403);
      }
      if (!name) throw err('Informe seu nome.', 400);
      if (onlyDigits(phone).length < 10) throw err('Informe um WhatsApp válido.', 400);
      if (items.length === 0) throw err('Seu carrinho está vazio.', 400);

      const orderItems: OrderItem[] = [];
      for (const it of items) {
      const product = (db.products || []).find((p: any) => p.id === it.productId && p.businessId === businessId && p.active);
      if (!product) throw err('Um item do carrinho não está mais disponível.', 400);
      const qty = Math.max(1, Math.min(50, Number(it.qty) || 1));
      const base = product.promoPrice > 0 ? product.promoPrice : product.price;
      let unit = base;
      const labels: string[] = [];
      const opts = Array.isArray(it.options) ? it.options : [];
      const selMap = new Map<string, string[]>(
        opts.map((sel: any) => [String(sel.optionId), Array.isArray(sel.valueIds) ? sel.valueIds.map(String) : []]),
      );
      // Valida TODAS as opções do produto (nunca confia no que o cliente enviou)
      const productOptions = (db.options || []).filter((o: any) => o.productId === product.id);
      for (const opt of productOptions) {
        const valueIds: string[] = selMap.get(opt.id) || [];
        if (opt.required && valueIds.length === 0) {
          throw err(`Escolha: ${opt.name} (${product.name}).`, 400);
        }
        if (valueIds.length < opt.min) {
          throw err(`Escolha ao menos ${opt.min} em "${opt.name}".`, 400);
        }
        if (opt.max > 0 && valueIds.length > opt.max) {
          throw err(`Máximo de ${opt.max} em "${opt.name}".`, 400);
        }
        const picked = valueIds
          .map((vid: string) => (db.optionValues || []).find((v: any) => v.id === vid && v.optionId === opt.id && v.active))
          .filter(Boolean) as any[];
        if (!opt.multiple && picked.length > 1) throw err(`Opção inválida em ${product.name}.`, 400);
        for (const v of picked) { unit += v.priceDelta; labels.push(v.name); }
      }
      orderItems.push({
        productId: product.id, name: product.name, qty, unitPrice: unit,
        total: unit * qty, optionsLabel: labels.join(', '), note: String(it.note || '').slice(0, 200),
      });
    }

    const subtotal = orderItems.reduce((s: number, i: any) => s + i.total, 0);
    const type = body.type === 'delivery' ? 'delivery' : 'pickup';
    if (type === 'delivery' && !(body.customerAddress || '').trim()) {
      throw err('Informe o endereço de entrega.', 400);
    }
    if (business.minOrder > 0 && subtotal < business.minOrder) {
      throw err(`Pedido mínimo de ${money(business.minOrder)}.`, 400);
    }
    const fee = type === 'delivery' ? business.deliveryFee || 0 : 0;
    const total = subtotal + fee;

    // Código único gerado DENTRO da escrita (anti-duplicado em concorrência).
    const d = db;
      const existing = new Set((d.orders || []).filter((o: any) => o.businessId === businessId).map((o: any) => o.code));
      let n = existing.size + 1;
      let code = '#' + String(n).padStart(4, '0');
      while (existing.has(code)) { n++; code = '#' + String(n).padStart(4, '0'); }
      const now = new Date().toISOString();
      const orderId = randomUUID();
      d.orders.push({
        id: orderId, businessId, customerId: customer.id, code,
        customerName: name, customerPhone: phone, customerAddress: String(body.customerAddress || ''),
        type, payment: String(body.payment || 'pix'), items: orderItems,
        subtotal, total, status: 'new', note: String(body.note || '').slice(0, 500),
        createdAt: now, updatedAt: now, history: [{ at: now, from: '', to: 'new', by: 'customer' }],
      });
      d.events.push({ id: randomUUID(), businessId, type: 'order_created', path: '', meta: { total }, createdAt: now });
      d.events.push({ id: randomUUID(), businessId, type: 'conversion', path: '', meta: { kind: 'order' }, createdAt: now });
      const digits = onlyDigits(phone);
      // A3: entrada de lead via ingestLead (única porta) — preserva pipeline/stageHistory/eventos
      try {
        // pipeline imported statically
        const res = ingestLead(d, {
          businessId,
          customerId: customer.id,
          name,
          phone: digits,
          interest: orderItems.map((i) => i.name).join(', ').slice(0, 200),
          source: 'pedido',
          actor: { id: customer.id, name, type: 'customer' },
          now,
        });
        res.lead.action = 'pedido';
        // Pedido converte comercialmente: move para converted via máquina oficial
        const pipeline = getBusinessPipeline(d, businessId);
        const cur = normalizeLeadStageId(pipeline, res.lead);
        if (cur !== 'converted') {
          const target = stageForLegacyStatus(pipeline, 'converted');
          if (target && cur !== target) {
            try { moveLeadStage(d, { businessId, leadId: res.lead.id, toStageId: target, actor: { id: customer.id, name }, now }); } catch {}
          }
        }
      } catch (e) {
        // CRM secundário: pedido já criado, falha no lead não desfaz pedido.
        // Não cria lead paralelo fora da porta oficial; apenas loga.
        void e;
      }
      return { orderId, code, total };
    };
    let result: { orderId: string; code: string; total: number };
    if (relationalActive()) {
      // Fatia: unidade (flag/mínimo/taxa), catálogo (produtos/opções/valores),
      // pedidos (código único) e esteira (ingestLead + conversão).
      result = await runRelationalWrite(businessId, orderCreateTx, {
        load: {
          products: {}, options: {}, orders: {}, pipelines: {},
          optionValues: (partial) => ((partial.options || []).length ? {} : null),
        },
      });
    } else {
      const db0 = await readDB();
      // Pré-checagens legadas fora da escrita (comportamento histórico);
      // a própria tx re-valida tudo — a fn é compartilhada.
      const business0 = db0.businesses.find((b) => b.id === businessId);
      if (!business0) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
      if (!isFeatureEnabled(business0, 'orders')) {
        return NextResponse.json({ error: 'Este negócio não está recebendo pedidos no momento.' }, { status: 403 });
      }
      result = await updateDB(orderCreateTx as any);
    }
    return NextResponse.json({ ok: true, orderId: result.orderId, code: result.code, total: result.total });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[orders] POST falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível enviar seu pedido. Tente novamente.' : e.message }, { status });
  }
}

// GET autenticado (equipe): lista paginada
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'pedidos');
  if (!guard.ok) return guard.res;
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));
  if (relationalActive()) {
    // Lista paginada do SQL: mais recente primeiro, total correto, janela
    // pela página — sem cortes fixos e sem reconstruir documento.
    const db = await runRelationalRead(businessId, { orders: { order: 'created_at DESC' } });
    const all = db.orders || [];
    return NextResponse.json({ orders: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit });
  }
  const { db } = guard;
  const all = db.orders.filter((o) => o.businessId === businessId).reverse();
  return NextResponse.json({ orders: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit });
}

export async function PATCH(req: NextRequest) {
  try {
    const { businessId, id, status } = await req.json();
    const guard = await requireBusiness(req, businessId, 'pedidos');
    if (!guard.ok) return guard.res;
    /** Mutação PURA (DOIS motores): transição de status pela máquina oficial. */
    const statusTx = (d: any) => {
      const o: any = (d.orders || []).find((x: any) => x.id === id && x.businessId === businessId);
      if (!o) throw err('Pedido não encontrado.', 404);
      const to = status as OrderStatus;
      const from = o.status as OrderStatus;
      if (!ORDER_FLOW[from] || !canTransition(ORDER_FLOW, from, to)) {
        throw err(`Não é possível mudar de "${o.status}" para "${status}".`, 422);
      }
      const now = new Date().toISOString();
      o.history.push({ at: now, from, to, by: 'owner' });
      o.status = to;
      o.updatedAt = now;
      return true;
    };
    if (relationalActive()) {
      await runRelationalWrite(businessId, statusTx, { load: { orders: { where: 'id = $2', args: [id] } } });
    } else {
      const { db } = guard;
      const current = db.orders.find((x) => x.id === id && x.businessId === businessId);
      if (!current) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
      const to = status as OrderStatus;
      if (!ORDER_FLOW[current.status] || !canTransition(ORDER_FLOW, current.status, to)) {
        return NextResponse.json({ error: `Não é possível mudar de "${current.status}" para "${status}".` }, { status: 422 });
      }
      await updateDB(statusTx);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = e?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar.' : e.message }, { status });
  }
}
