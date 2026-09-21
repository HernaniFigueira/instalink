import { describe,it,expect } from 'vitest';
import { agendaEnvelope,agendaScale } from '../agenda-density';
import { layoutBlocks,minuteFromOffsetY,blockTop } from '../agenda-drag';
const date='2026-09-21';
const rules=[{weekday:1,start:'08:00',end:'18:00'}] as any;
const services=[{id:'short',durationMin:15},{id:'long',durationMin:60}] as any;
describe('Agenda density is geometry, not scheduling rules',()=>{
  it('shows exactly 08–18, not an arbitrary full day',()=>{expect(agendaEnvelope([date],rules,[],[],services)).toEqual({start:480,end:1080,span:600,hours:10});});
  it('uses only the displayed weekdays',()=>{expect(agendaEnvelope([date],[...rules,{weekday:2,start:'00:00',end:'23:59'}],[],[],services).hours).toBe(10);});
  it('never crops early or late existing bookings, including cancelled history',()=>{const events=[{date,time:'06:30',serviceId:'short',status:'cancelled'},{date,time:'20:30',serviceId:'long'}] as any;expect(agendaEnvelope([date],rules,[],events,services)).toMatchObject({start:360,end:1320});});
  it('includes exception windows outside ordinary hours',()=>{expect(agendaEnvelope([date],rules,[{date,start:'05:30',end:'06:30',closed:true}] as any,[],services).start).toBe(300);});
  it('does not use events from another day to widen the day',()=>{expect(agendaEnvelope([date],rules,[],[{date:'2026-09-22',time:'02:00'}] as any,services).start).toBe(480);});
  it('fits the compact day when there is room, but never goes below 40px/hour',()=>{expect(agendaScale('compact',10,600)).toBe(60);expect(agendaScale('compact',20,600)).toBe(40);expect(agendaScale('comfortable',10,600)).toBe(72);});
  it('keeps short events proportional and adjacent events collision-free at each density',()=>{
    for(const scale of [40,60,72]){
      const blocks=layoutBlocks([{id:'a',minute:540,durationMin:10},{id:'b',minute:550,durationMin:15}],{startMinute:480,pxPerHour:scale,minHeight:0});
      expect(blocks[0].height).toBeCloseTo(scale/6);expect(blocks[0].top+blocks[0].height).toBeCloseTo(blocks[1].top);
      expect(minuteFromOffsetY(blockTop(550,480,scale),{startMinute:480,endMinute:1080,pxPerHour:scale},5)).toBe(550);
    }
  });
  it('simultaneous events retain separate lanes without inflated duration',()=>{const blocks=layoutBlocks([{id:'a',minute:540,durationMin:15},{id:'b',minute:540,durationMin:30}],{startMinute:480,pxPerHour:40,minHeight:0});expect(blocks.every(b=>b.widthPct===50)).toBe(true);expect(blocks[0].height).toBe(10);expect(blocks[1].height).toBe(20);});
});
