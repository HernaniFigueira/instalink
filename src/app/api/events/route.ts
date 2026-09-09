import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import type { EventType } from '@/lib/types';

const VALID: EventType[] = ['page_view', 'button_click', 'product_view', 'product_add', 'cart_created', 'checkout_started', 'order_created', 'booking_started', 'booking_created', 'whatsapp_click', 'lead_created', 'ai_started', 'ai_recommendation', 'conversion'];

// POST público: registra evento de analytics do negócio
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!VALID.includes(body.type)) return NextResponse.json({ ok: true });
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
