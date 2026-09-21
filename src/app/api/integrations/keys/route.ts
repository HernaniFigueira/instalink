import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireBusiness } from '@/lib/access';
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/api-keys';
import { updateDB } from '@/lib/db';
import { pushAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('Integrações · chaves');
  if (blocked) return blocked;

  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'config');
  if (!guard.ok) return guard.res;

  const keys = listApiKeys(guard.db, businessId);
  return NextResponse.json({ ok: true, keys });
}

export async function POST(req: NextRequest) {
  const blocked = blockIfRelational('Integrações · chaves');
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const businessId = String(body.businessId || req.nextUrl.searchParams.get('businessId') || '');
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;

    const name = String(body.name || 'Nova integração').trim().slice(0, 60);

    let result: ReturnType<typeof createApiKey>;

    await updateDB((d) => {
      result = createApiKey(d, businessId, name, guard.ctx.user.id);
      pushAudit(d, {
        action: 'api_key.created',
        actor: guard.ctx.user,
        businessId,
        meta: { keyId: result.apiKey.id, name },
      });
    });

    return NextResponse.json({
      ok: true,
      apiKey: result!.apiKey,
      fullSecret: result!.fullSecret,
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao gerar chave de API.' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const blocked = blockIfRelational('Integrações · chaves');
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const keyId = String(body.keyId || '');
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;

    await updateDB((d) => {
      revokeApiKey(d, businessId, keyId);
      pushAudit(d, {
        action: 'api_key.revoked',
        actor: guard.ctx.user,
        businessId,
        meta: { keyId },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao revogar chave.' }, { status: 400 });
  }
}
