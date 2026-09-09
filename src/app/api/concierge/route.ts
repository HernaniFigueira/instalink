import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { conciergeAnswer } from '@/lib/concierge';
import { rateLimit, ipFrom } from '@/lib/rate-limit';

// POST público: pergunta ao concierge do negócio
export async function POST(req: NextRequest) {
  const rl = rateLimit(`cz:${ipFrom(req)}`, 30, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas mensagens. Aguarde um instante.' }, { status: 429 });
  try {
    const { businessId, message } = await req.json();
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    const answer = conciergeAnswer(db, business, String(message || '').slice(0, 500));
    await updateDB((d) => {
      d.events.push({ id: randomUUID(), businessId, type: 'ai_started', path: '', meta: { intent: answer.intent }, createdAt: new Date().toISOString() });
    });
    return NextResponse.json(answer);
  } catch {
    return NextResponse.json({ reply: 'Tive um probleminha aqui. Fale com a gente no WhatsApp!', actions: [{ label: 'Falar no WhatsApp', target: 'whatsapp' }], intent: 'error' });
  }
}
