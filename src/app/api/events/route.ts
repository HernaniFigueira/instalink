import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { getPool } from '@/lib/relational/pool';
import type { EventType } from '@/lib/types';
import { rateLimit, ipFrom } from '@/lib/rate-limit';

const VALID: EventType[] = ['page_view', 'button_click', 'product_view', 'product_add', 'cart_created', 'checkout_started', 'order_created', 'booking_started', 'booking_created', 'whatsapp_click', 'lead_created', 'ai_started', 'ai_recommendation', 'conversion'];

// POST público: registra evento de analytics do negócio
export async function POST(req: NextRequest) {
  const rl = rateLimit(`ev:${ipFrom(req)}`, 120, 60000);
  if (!rl.ok) return NextResponse.json({ ok: true });
  try {
    const body = await req.json();
    if (!VALID.includes(body.type)) return NextResponse.json({ ok: true });
    if (relationalActive()) {
      // Ingesta PÚBLICA de analytics: INSERT direto (evento é só-append, sem
      // fatia de unidade). A unidade precisa existir — mesma checagem do
      // legado, agora por consulta pontual.
      const pool = getPool();
      const biz = await pool.query('SELECT 1 FROM app.businesses WHERE id = $1', [String(body.businessId || '')]);
      if (biz.rows.length === 0) return NextResponse.json({ ok: true });
      await pool.query(
        `INSERT INTO app.events (id, business_id, type, path, meta, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [randomUUID(), String(body.businessId), String(body.type),
          String(body.path || '').slice(0, 200),
          JSON.stringify((body.meta && typeof body.meta === 'object') ? body.meta : {})],
      );
      return NextResponse.json({ ok: true });
    }
    const db = await readDB();
    if (!db.businesses.some((b) => b.id === body.businessId)) return NextResponse.json({ ok: true });
    await updateDB((d) => {
      d.events.push({
        id: randomUUID(), businessId: body.businessId, type: body.type,
        path: String(body.path || '').slice(0, 200),
        meta: (body.meta && typeof body.meta === 'object') ? body.meta : {},
        createdAt: new Date().toISOString(),
      });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
