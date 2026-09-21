import { afterEach,describe,it,expect,vi } from 'vitest';
import { readAgendaBookings } from '../agenda-read';
const rows=(start:number,count:number)=>Array.from({length:count},(_,i)=>({id:String(start+i)}));
afterEach(()=>vi.unstubAllGlobals());
describe('Complete authorized agenda pagination',()=>{
 it('reads beyond the existing 500-row limit without changing the API limit',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(Response.json({bookings:rows(0,500),total:501,page:1,limit:500})).mockResolvedValueOnce(Response.json({bookings:rows(500,1),total:501,page:2,limit:500}));vi.stubGlobal('fetch',fetch);
  const r=await readAgendaBookings('/api/bookings?businessId=synthetic&mode=manage&limit=500');expect(r.ok).toBe(true);expect(r.data?.bookings).toHaveLength(501);expect(fetch.mock.calls[1][0]).toContain('limit=500&page=2');
 });
 it('does not show a partially loaded day as complete when the next page fails',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({bookings:rows(0,500),total:501,page:1,limit:500})).mockResolvedValueOnce(Response.json({error:'Synthetic outage'},{status:503})));
  expect((await readAgendaBookings('/api/bookings?businessId=synthetic')).ok).toBe(false);
 });
 it('reports concurrent list changes instead of silently omitting events',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({bookings:rows(0,500),total:501,page:1,limit:500})).mockResolvedValueOnce(Response.json({bookings:rows(500,2),total:502,page:2,limit:500})));
  const r=await readAgendaBookings('/api/bookings?businessId=synthetic');expect(r.ok).toBe(false);expect(r.data).toBeNull();
 });
});
