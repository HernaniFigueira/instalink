import { apiGet, type ApiResult } from './api-client';
import type { Booking } from './types';
export type AgendaPageData = {bookings:Booking[];total:number;page:number;limit:number};
/** Consume the existing authorized pagination; never present a partial list as a full day. */
export async function readAgendaBookings(url:string,isCurrent=()=>true):Promise<ApiResult<AgendaPageData>> {
  const first=await apiGet<AgendaPageData>(url,{scope:'area',area:'Agenda'});
  if(!first.ok)return first;
  const incomplete=():ApiResult<AgendaPageData>=>({...first,ok:false,status:503,data:null,message:'A agenda não pôde ser carregada por completo ou mudou durante a leitura. Tente novamente.'});
  const d=first.data;
  if(!d||!Array.isArray(d.bookings)||!Number.isInteger(d.total)||d.total<0||!Number.isInteger(d.limit)||d.limit<=0)return incomplete();
  const rows=[...d.bookings];
  for(let page=2;page<=Math.ceil(d.total/d.limit);page++) {
    if(!isCurrent())return incomplete();
    const next=await apiGet<AgendaPageData>(`${url}&page=${page}`,{scope:'area',area:'Agenda'});
    if(!next.ok)return next;
    if(!next.data||next.data.total!==d.total||!Array.isArray(next.data.bookings))return incomplete();
    rows.push(...next.data.bookings);
  }
  const bookings=[...new Map(rows.map(b=>[b.id,b])).values()];
  if(bookings.length!==d.total)return incomplete();
  return {...first,data:{...d,bookings}};
}
