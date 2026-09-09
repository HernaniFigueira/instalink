import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';

// GET ?text= — PNG do QR Code (ex: link da página pública)
export async function GET(req: NextRequest) {
  const text = req.nextUrl.searchParams.get('text') || '';
  if (!text) return new NextResponse('missing text', { status: 400 });
  const buf = await QRCode.toBuffer(text.slice(0, 500), { width: 480, margin: 2 });
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
}
