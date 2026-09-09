import { NextRequest, NextResponse } from 'next/server';
import { customerFromRequest, publicCustomer } from '@/lib/customer-auth';

// GET: consumidor logado (cookie OU Bearer).
export async function GET(req: NextRequest) {
  const customer = await customerFromRequest(req);
  if (!customer) return NextResponse.json({ customer: null }, { status: 401 });
  return NextResponse.json({ customer: publicCustomer(customer) });
}
