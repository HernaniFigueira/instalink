import type { DB, User } from './types';
import { organizationsFor, unitsForOrganization, canManageOrganization } from './organization';
import { resolveAccess, scopeBookings, isMasterUser } from './access-core';
import { effectiveTimezone, todayISO } from './tz';
import type { PeriodSpec } from './periods';

/** Server projection: no forbidden money or patient records enter the response. */
export function organizationOverview(db: DB, user: User, period: PeriodSpec) {
  const within = (date: string) => !!date && (!period.from || date >= period.from) && date <= period.to;
  return organizationsFor(db,user).map(org => {
    const units = unitsForOrganization(db,user,org.id).map(b => {
      const ctx = resolveAccess(db,user,b.id,null)!;
      const canAgenda = !!ctx?.permissions.agenda;
      // The existing CRM has no reusable professional contact projection (D0).
      // Do not introduce an unrestricted tenant count in this new surface.
      const canClients = !!ctx?.permissions.clientes && !ctx.professionalScope;
      const canFinancial = !!ctx?.permissions.financeiro;
      const timezone = effectiveTimezone(b.businessTimezone);
      const bookings = canAgenda || canFinancial ? scopeBookings(db.bookings.filter(x=>x.businessId===b.id && within(x.date)),ctx.professionalScope) : [];
      const clients = canClients ? db.contacts.filter(x=>x.businessId===b.id && x.createdAt && within(todayISO(new Date(x.createdAt),timezone))).length : null;
      const revenue = canFinancial ? bookings.filter(x=>!['cancelled','no_show'].includes(x.status)).reduce((sum,x)=>sum+(db.services.find(s=>s.id===x.serviceId && s.businessId===b.id)?.price||0),0) : undefined;
      return {id:b.id,name:b.name,slug:b.slug,address:b.address,published:b.published,timezone,canAgenda,
        canDelete:!isMasterUser(user) && b.ownerId===user.id && org.ownerId===user.id,
        summary:{bookings:canAgenda||canFinancial?bookings.length:null,completed:canAgenda||canFinancial?bookings.filter(x=>x.status==='completed').length:null,clients,...(canFinancial?{predictedRevenue:revenue}:{})}};
    });
    const sum = (key:'bookings'|'completed'|'clients') => units.every(u=>u.summary[key]!==null) ? units.reduce((n,u)=>n+(u.summary[key]||0),0) : null;
    return {id:org.id,name:org.name,canManage:canManageOrganization(db,user,org.id),canDelete:!isMasterUser(user)&&org.ownerId===user.id,units,
      totals:{units:units.length,bookings:sum('bookings'),completed:sum('completed'),clients:sum('clients'),
        ...(units.length && units.every(u=>u.summary.predictedRevenue!==undefined)?{predictedRevenue:units.reduce((n,u)=>n+(u.summary.predictedRevenue||0),0)}:{})}};
  });
}
export type OrganizationOverview = ReturnType<typeof organizationOverview>[number];
