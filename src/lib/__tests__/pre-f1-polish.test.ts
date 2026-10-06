import { describe, it, expect } from 'vitest';
import { durationLabel } from '../duration-label';
import { exceptionUnavailableRanges } from '../agenda-exceptions';
import { computeSlots } from '../slots';
import type { AvailabilityException } from '../types';
const ex: AvailabilityException={id:'qa',businessId:'qa',date:'2026-11-18',closed:false,start:'13:00',end:'18:00',note:'Reunião'};
describe('Polish — display only contracts',()=>{
 it.each([[30,'30 min'],[45,'45 min'],[60,'60 min · 1h'],[90,'90 min · 1h30'],[195,'195 min · 3h15'],[390,'390 min · 6h30']])('duration %i = %s',(min,label)=>expect(durationLabel(Number(min))).toBe(label));
 it('derives the complement, not the open special interval',()=>expect(exceptionUnavailableRanges([ex],ex.date,540,1080)).toEqual([{start:540,end:780,label:'Reunião'}]));
 it('closed marks the entire visible day without a synthetic block',()=>expect(exceptionUnavailableRanges([{...ex,closed:true}],ex.date,480,1200)).toEqual([{start:480,end:1200,label:'Reunião'}]));
 it('no exception on a different date; empty and invalid windows do not invent closure',()=>{
  expect(exceptionUnavailableRanges([ex],'2026-11-19',540,1080)).toEqual([]);
  expect(exceptionUnavailableRanges([{...ex,start:''}],ex.date,540,1080)).toEqual([]);
  expect(exceptionUnavailableRanges([{...ex,start:'19:00'}],ex.date,540,1080)).toEqual([]);
 });
 it('clips both edges and follows first-date-match semantics of the engine',()=>{
  expect(exceptionUnavailableRanges([{...ex,start:'10:00',end:'17:00'},ex],ex.date,540,1080)).toEqual([{start:540,end:600,label:'Reunião'},{start:1020,end:1080,label:'Reunião'}]);
 });
 it('special opening 13–18 still rejects 09 and allows 13 in actual slots',()=>{
  const q:any={rules:[{weekday:3,start:'09:00',end:'18:00',slotMin:30,professionalId:'',serviceId:''}],exceptions:[ex],bookings:[],services:[],professionals:[],dateISO:ex.date,weekday:3,serviceId:'s',durationMin:30,professionalId:'',nowHM:'',leadMin:0,bufferMin:0};
  const result=computeSlots(q);expect(result.slots).not.toContain('09:00');expect(result.slots).toContain('13:00');
 });
});

import { NAV_ACCENTS, navAccentById, contrastRatio } from '../nav-accent';
import { readFileSync } from 'node:fs';
describe('Polish — curated themes, shared visual primitives and bounded dashboard',()=>{
 it.each(['azul-profundo','verde-equilibrado','teal-profundo','vinho','onix'])('curated %s remains AA', id=>{
  const t=navAccentById(id);expect(t.id).toBe(id);
  expect(contrastRatio(t.vars['--il-nav-active-fg'],t.vars['--il-nav-active'])).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(t.vars['--accent-fg'],t.vars['--accent-soft'])).toBeGreaterThanOrEqual(4.5);
 });
 it('retains all legacy presets, while confirmation has no decorative icon',()=>{
  expect(NAV_ACCENTS).toHaveLength(21);expect(navAccentById('amarelo-suave').id).toBe('amarelo-suave');
  expect(readFileSync('src/components/dashboard/OverlayDismissGuard.tsx','utf8')).not.toContain('overlay-confirm__icon');
 });
 it('bounds the render and uses actual permissions, not a nonexistent tarefas overview flag',()=>{
  const source=readFileSync('src/app/(dashboard)/dashboard/page.tsx','utf8');
  expect(source).toContain('(openTasks || []).slice(0, 4).map');expect(source).toContain('Ver todas ({taskSum.open})');
  expect(source).not.toContain('links.tarefas');expect(source).toContain('panelPerms.agenda || panelPerms.clientes || panelPerms.leads || panelPerms.config');
 });
});
it('attributes Reunião only to normally open hours, merging duplicate routine windows',()=>{
 expect(exceptionUnavailableRanges([ex],ex.date,480,1200,[{start:540,end:1080},{start:540,end:1080}])).toEqual([{start:540,end:780,label:'Reunião'}]);
});
import { durationSuggestionLabel } from '../vet-service-catalog';
it('service library duration uses the same human presentation',()=>expect(durationSuggestionLabel(195)).toBe('Duração sugerida · 195 min · 3h15'));
