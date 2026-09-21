import { NextRequest, NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalRead } from '@/lib/relational/slice';
import { isFeatureEnabled } from '@/lib/features';
import { rateLimit, ipFrom } from '@/lib/rate-limit';

// GET ?businessId= — dados de pagamento no MOMENTO do checkout.
// A chave PIX sai do payload da página e só aparece aqui, quando o
// consumidor escolhe pagar com PIX.
export async function GET(req: NextRequest) {
  const rl = rateLimit(`cko:${ipFrom(req)}`, 60, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas.' }, { status: 429 });
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  let business: any;
  if (relationalActive()) {
    // Leitura PÚBLICA pontual: só a linha da unidade (chave PIX nunca vem do
    // documento legado).
    const db = await runRelationalRead(businessId, {});
    business = (db.businesses || [])[0];
  } else {
    const db = await readDB();
    business = db.businesses.find((b) => b.id === businessId);
  }
  if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
  // Módulo desligado ⇒ checkout não existe nesta empresa (a chave PIX não
  // vaza para uma página que não vende mais).
  if (!isFeatureEnabled(business, 'products') && !isFeatureEnabled(business, 'orders')) {
    return NextResponse.json({ pixKey: '', moduleOff: true });
  }
  const pix = (business.paymentMethods || []).includes('pix') ? business.pixKey || '' : '';
  return NextResponse.json({ pixKey: pix });
}
