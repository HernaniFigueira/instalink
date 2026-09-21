import { describe,it,expect } from 'vitest';
import { emptyDB } from '../db';
import { biz } from './helpers/automation-fixtures';
import { organizationOverview } from '../organization-overview';
import { resolvePeriodSpec } from '../periods';
import type { User } from '../types';
const period=resolvePeriodSpec({period:'custom',from:'2026-09-20',to:'2026-09-21',today:'2026-09-21'});
function fixture(){const db=emptyDB();const owner:User={id:'owner',name:'Owner',email:'owner@example.invalid',passwordHash:'',createdAt:'',role:'owner'};
 db.organizations.push({id:'org',name:'Organization',ownerId:owner.id,metadata:{},createdAt:'',updatedAt:''},{id:'foreign',name:'Private',ownerId:'stranger',metadata:{},createdAt:'',updatedAt:''});
 db.businesses.push(biz('a',{organizationId:'org',ownerId:owner.id,businessTimezone:'America/Sao_Paulo'}),biz('b',{organizationId:'org',ownerId:owner.id}),biz('secret',{organizationId:'foreign',ownerId:'stranger'}));
 db.services.push({id:'svc',businessId:'a',price:12345} as any);db.bookings.push({id:'one',businessId:'a',serviceId:'svc',date:'2026-09-21',status:'confirmed',professionalId:'p1'} as any,{id:'old',businessId:'a',date:'2026-08-01',status:'confirmed'} as any);
 return {db,owner};}
describe('Organization direction — server projection',()=>{
 it('filters tenants and uses one explicit period',()=>{const {db,owner}=fixture();const o=organizationOverview(db,owner,period);expect(o).toHaveLength(1);expect(o[0].units.map(u=>u.id)).toEqual(['a','b']);expect(o[0].totals.bookings).toBe(1);expect(o[0].totals.predictedRevenue).toBe(12345);});
 it('never serializes financial fields without financial permission',()=>{const {db}=fixture();const user={id:'staff',role:'owner'} as User;db.members.push({id:'m',businessId:'a',userId:user.id,role:'SECRETARIA',active:true,permissions:{financeiro:false}} as any);const o=organizationOverview(db,user,period);expect(o[0].units).toHaveLength(1);expect(JSON.stringify(o)).not.toContain('predictedRevenue');expect(JSON.stringify(o)).not.toContain('12345');});
 it('scopes professional bookings before aggregating',()=>{const {db}=fixture();const user={id:'pro',role:'owner'} as User;db.members.push({id:'m',businessId:'a',userId:user.id,role:'PROFISSIONAL',active:true,permissions:{}} as any);db.professionals.push({id:'p2',businessId:'a',userId:user.id,active:true} as any);expect(organizationOverview(db,user,period)[0].totals.bookings).toBe(0);expect(organizationOverview(db,user,period)[0].totals.clients).toBeNull();});
 it('counts unit registrations, not invented unique people, in their local timezone',()=>{const {db,owner}=fixture();db.contacts.push({id:'ca',businessId:'a',customerId:'same',createdAt:'2026-09-22T01:00:00Z'} as any,{id:'cb',businessId:'b',customerId:'same',createdAt:'2026-09-22T01:00:00Z'} as any);expect(organizationOverview(db,owner,period)[0].totals.clients).toBe(2);});
 it('withholds totals when any visible unit has a restricted metric',()=>{const {db}=fixture();const user={id:'viewer',role:'owner'} as User;db.members.push({id:'m',businessId:'a',userId:user.id,role:'VIEWER',active:true,permissions:{}} as any);const o=organizationOverview(db,user,period);expect(o[0].totals.bookings).toBeNull();expect(o[0].totals.clients).toBeNull();});
 it('keeps an owned empty organization accessible without fabricating a unit',()=>{const {db,owner}=fixture();db.businesses=[];const o=organizationOverview(db,owner,period);expect(o[0].units).toEqual([]);expect(o[0].canManage).toBe(true);expect(o[0].canDelete).toBe(true);});
});
