import { blockOnAgendaColumn } from "../agenda-blocks";
import { describe, expect, it } from 'vitest';
import { computeSlots, type SlotQuery } from '../slots';
import { permissionsFor, PERMISSIONS } from '../permissions';
import { splitRolesForEditor } from '../equipe-access';
import { roleLabel } from '../role-labels';
import { ROLES } from '../permissions';
import { readFileSync } from 'node:fs';
const read=(p:string)=>readFileSync(p,'utf8');
const query:SlotQuery={rules:[{id:'r',businessId:'qa',professionalId:'',serviceId:'',weekday:1,start:'09:00',end:'18:00',slotMin:30}],exceptions:[],bookings:[],services:[],professionals:[{id:'p',active:true,followBusinessHours:true} as any],dateISO:'2026-10-05',weekday:1,serviceId:'s',durationMin:30,professionalId:'p',nowHM:'',leadMin:0,bufferMin:0};
describe('Pré-F1 — regressions reported in PR53',()=>{
 it('engine actually uses administrative 15; public cadence remains 30',()=>{
  expect(computeSlots({...query,startStepMin:15}).slots.slice(0,4)).toEqual(['09:00','09:15','09:30','09:45']);
  expect(computeSlots(query).slots.slice(0,3)).toEqual(['09:00','09:30','10:00']);
  expect(computeSlots({...query,startStepMin:5}).slots.slice(0,3)).toEqual(['09:00','09:05','09:10']);
 });
 it('210-minute range has a 09:15 start when available',()=>expect(computeSlots({...query,startStepMin:15,durationMin:210}).slots).toContain('09:15'));
 it('Recepção defaults exclude opportunities; explicit override remains supported',()=>{
  expect(permissionsFor('SECRETARIA').leads).toBe(false);
  expect(permissionsFor('SECRETARIA',{leads:true}).leads).toBe(true);
  expect(splitRolesForEditor(ROLES,'SECRETARIA').other.map(r=>r.id)).not.toContain('ATENDENTE');
  expect(roleLabel('ATENDENTE')).toBe('Recepção');
  expect(PERMISSIONS.find(p=>p.id==='leads')?.hint).not.toContain('página');
 });
 it('team drawer uses canonical dismiss guard',()=>expect(read('src/app/(dashboard)/equipe/page.tsx')).toContain('dismissGuard='));
 it('service suggestions no longer close on a blur timer',()=>expect(read('src/components/dashboard/catalog-panels.tsx')).not.toContain('onBlur={()=>setTimeout(()=>setShowSug(false),150)}'));
});

describe('Day/Week operational blocks',()=>{
 const block={id:'b',professionalId:'hernani',resourceId:'',startAt:'2026-10-06T16:00:00Z',endAt:'2026-10-06T20:30:00Z'} as any;
 it('Week has no pro column but still shows 13–17:30; Day matches only Hernani',()=>{
  expect(blockOnAgendaColumn(block,'2026-10-06','','week','America/Sao_Paulo')).toEqual({from:780,to:1050,timeLabel:'13:00–17:30'});
  expect(blockOnAgendaColumn(block,'2026-10-06','hernani','day','America/Sao_Paulo')?.timeLabel).toBe('13:00–17:30');
  expect(blockOnAgendaColumn(block,'2026-10-06','michelle','day','America/Sao_Paulo')).toBeNull();
 });
 it('resource block and clinic block are visible, across days clipped without negative duration',()=>{
  expect(blockOnAgendaColumn({...block,professionalId:'',resourceId:'room'},'2026-10-06','','week','America/Sao_Paulo')).not.toBeNull();
  expect(blockOnAgendaColumn({...block,professionalId:''},'2026-10-06','hernani','day','America/Sao_Paulo')).not.toBeNull();
  expect(blockOnAgendaColumn(block,'2026-10-07','','week','America/Sao_Paulo')).toBeNull();
 });
});
