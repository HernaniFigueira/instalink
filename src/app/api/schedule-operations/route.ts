import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireBusiness } from '@/lib/access';
import { updateDB } from '@/lib/db';
import { blockConflict, bookingOccupiedRange, overlaps } from '@/lib/schedule-capacity';

/** Operational blocks and generic capacity, not patients or availability exceptions. */
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'agenda');
  if (!guard.ok) return guard.res;
  const scope = guard.ctx.professionalScope;
  return NextResponse.json({
    blocks: guard.db.scheduleBlocks.filter(b => b.businessId === businessId && (!scope || b.professionalId === scope)),
    resources: guard.db.scheduleResources.filter(r => r.businessId === businessId),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const businessId = String(body?.businessId || '');
  const guard = await requireBusiness(req, businessId, 'agenda');
  if (!guard.ok) return guard.res;
  const scope = guard.ctx.professionalScope;
  const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
  if (body.action === 'resource.save' || body.action === 'resource.delete') {
    // Equipment/room configuration is administrative; a professional cannot administer colleagues' capacity.
    if (scope || !guard.ctx.permissions.catalogo) return error('Sem permissão para configurar recursos.', 403);
    if (body.action === 'resource.save' && (!['room', 'equipment'].includes(body.kind) || !String(body.name || '').trim())) return error('Informe tipo e nome do recurso.');
    try {
      return NextResponse.json(await updateDB(d => {
        const existing = d.scheduleResources.find(r => r.businessId === businessId && r.id === body.id);
        if (body.id && !existing) throw Object.assign(new Error('Recurso não encontrado nesta clínica.'), { status: 404 });
        if (body.action === 'resource.delete') {
          if (!existing) throw Object.assign(new Error('Recurso não encontrado.'), { status: 404 });
          if (d.bookings.some(b => b.businessId === businessId && b.resourceIds?.includes(existing.id)) || d.services.some(s => s.businessId === businessId && s.resourceRequirements?.some(g => g.includes(existing.id))) || d.scheduleBlocks.some(b => b.businessId === businessId && b.resourceId === existing.id)) throw Object.assign(new Error('Recurso com histórico ou uso atual: desative-o.'), { status: 409 });
          d.scheduleResources = d.scheduleResources.filter(r => r !== existing);
        } else if (existing) Object.assign(existing, { name: String(body.name).trim().slice(0, 100), kind: body.kind, active: body.active !== false });
        else d.scheduleResources.push({ id: randomUUID(), businessId, name: String(body.name).trim().slice(0, 100), kind: body.kind, active: true });
        return { ok: true };
      }));
    } catch (e: any) { return error(e.message, e.status || 400); }
  }
  if (!['block.save', 'block.delete'].includes(body.action)) return error('Ação inválida.');
  const professionalId = String(body.professionalId || '');
  const resourceId = String(body.resourceId || '');
  if (body.action === 'block.save') {
    const start = Date.parse(body.startAt), end = Date.parse(body.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 24 * 3600000) return error('Intervalo inválido (até 24 horas).');
    if (scope && (professionalId !== scope || !!resourceId)) return error('Você só pode bloquear seu próprio horário.', 403);
    if (resourceId && professionalId) return error('Escolha profissional ou recurso, não ambos.');
  }
  try {
    return NextResponse.json(await updateDB(d => {
      const existing = d.scheduleBlocks.find(b => b.businessId === businessId && b.id === body.id);
      if (body.id && !existing) throw Object.assign(new Error('Bloqueio não encontrado nesta clínica.'), { status: 404 });
      if (existing && scope && (existing.professionalId !== scope || !!existing.resourceId)) throw Object.assign(new Error('Bloqueio fora do seu escopo.'), { status: 403 });
      if (body.action === 'block.delete') {
        d.scheduleBlocks = d.scheduleBlocks.filter(b => b !== existing);
        return { ok: true, deletedId: existing?.id };
      }
      if (professionalId && !d.professionals.some(p => p.id === professionalId && p.businessId === businessId)) throw Object.assign(new Error('Profissional inválido.'), { status: 400 });
      if (resourceId && !d.scheduleResources.some(r => r.id === resourceId && r.businessId === businessId && r.active)) throw Object.assign(new Error('Recurso inválido.'), { status: 400 });
      const start = Date.parse(body.startAt), end = Date.parse(body.endAt);
      const bookingConfig = d.businesses.find(b => b.id === businessId)?.booking || { bufferMin: 0 };
      if (d.bookings.some(b => {
        if (b.businessId !== businessId || b.status === 'cancelled') return false;
        if (resourceId ? !b.resourceIds?.includes(resourceId) : professionalId && b.professionalId !== professionalId) return false;
        const range = bookingOccupiedRange(b, d.services.find(s => s.id === b.serviceId && s.businessId === businessId), bookingConfig);
        return !!range && overlaps(start, end, range.start, range.end);
      })) throw Object.assign(new Error('Há atendimento neste intervalo.'), { status: 409 });
      if (blockConflict(d.scheduleBlocks.filter(b => b !== existing), businessId, professionalId, resourceId ? [resourceId] : [], start, end)) throw Object.assign(new Error('Já existe bloqueio neste intervalo.'), { status: 409 });
      const data = { businessId, professionalId, resourceId, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), reason: String(body.reason || body.note || 'Bloqueio operacional').trim().slice(0, 100), note: String(body.note || '').slice(0, 200) };
      if (existing) Object.assign(existing, data);
      else d.scheduleBlocks.push({ id: randomUUID(), ...data });
      return { ok: true, block: existing || d.scheduleBlocks[d.scheduleBlocks.length - 1] };
    }));
  } catch (e: any) { return error(e.message, e.status || 400); }
}
