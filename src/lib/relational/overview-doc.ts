import type { DB } from '../types';
import { relAccessibleDoc } from './auth-store';
import { getPool } from './pool';

/**
 * Doc MÍNIMO multi-unidade (modo relacional) para agregações de DONO:
 * o documento acessível do usuário (unidades/organizações/membros — mesmas
 * consultas do guard) estendido SOMENTE com o que o overview/resultados
 * agrega: profissionais do login, preços de serviço e agendamentos/contatos
 * DENTRO da janela do período. Nenhuma outra unidade entra; as regras
 * continuam nas fns puras (organizationOverview / collectResults).
 */
export async function relationalOverviewDoc(userId: string, period: { from: string; to: string }): Promise<DB> {
  const pool = getPool();
  const db = (await relAccessibleDoc({ id: userId } as any, null)) as any;
  const unitIds = (db.businesses || []).map((b: any) => b.id);
  const empty = { professionals: [], services: [], bookings: [], contacts: [] };
  if (unitIds.length === 0) return { ...db, ...empty };
  // Profissionais do PRÓPRIO login (escopo de agenda no resolveAccess).
  const proRows = await pool.query(
    'SELECT * FROM app.professionals WHERE user_id = $1 AND active = true',
    [userId],
  );
  db.professionals = proRows.rows.map((p: any) => ({
    id: String(p.id || ''), businessId: String(p.business_id || ''), userId: String(p.user_id || ''),
    name: String(p.name || ''), role: String(p.role || ''), active: p.active !== false,
    followBusinessHours: p.follow_business_hours !== false,
  }));
  // Preços de serviço das unidades acessíveis (receita prevista).
  const svcRows = await pool.query(
    'SELECT id, business_id, price FROM app.services WHERE business_id = ANY($1)',
    [unitIds],
  );
  db.services = svcRows.rows.map((r: any) => ({ id: String(r.id), businessId: String(r.business_id), price: Number(r.price) || 0 }));
  // Agendamentos na janela do período (data é dia de negócio — sem folga).
  const bookingConds = ['business_id = ANY($1)'];
  const bookingArgs: unknown[] = [unitIds];
  if (period.from) { bookingArgs.push(period.from); bookingConds.push(`date >= $${bookingArgs.length}`); }
  if (period.to) { bookingArgs.push(period.to); bookingConds.push(`date <= $${bookingArgs.length}`); }
  const bkRows = await pool.query(
    `SELECT business_id, date, status, professional_id, service_id FROM app.bookings WHERE ${bookingConds.join(' AND ')}`,
    bookingArgs,
  );
  db.bookings = bkRows.rows.map((r: any) => ({
    businessId: String(r.business_id), date: String(r.date || ''), status: String(r.status || ''),
    professionalId: r.professional_id ? String(r.professional_id) : '', serviceId: String(r.service_id || ''),
  }));
  // Contatos na janela: created_at é instantâneo convertido por fuso na fn
  // pura — a consulta abre ±1 dia para não perder borda de fuso.
  const contactConds = ['business_id = ANY($1)'];
  const contactArgs: unknown[] = [unitIds];
  if (period.from) {
    contactArgs.push(`${period.from}T00:00:00Z`);
    contactConds.push(`created_at >= ($${contactArgs.length}::timestamptz - interval '1 day')`);
  }
  if (period.to) {
    contactArgs.push(`${period.to}T00:00:00Z`);
    contactConds.push(`created_at < ($${contactArgs.length}::timestamptz + interval '2 days')`);
  }
  const ctRows = await pool.query(
    `SELECT business_id, created_at FROM app.contacts WHERE ${contactConds.join(' AND ')}`,
    contactArgs,
  );
  db.contacts = ctRows.rows.map((r: any) => ({
    businessId: String(r.business_id),
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
  }));
  return db;
}
