'use client';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Drawer } from '@/components/ui';
export function QueueDock({children,onClose,maxHeight}:{children:ReactNode;onClose:()=>void;maxHeight:number|null}) {
  const [wide,setWide]=useState(false);
  useEffect(()=>{const m=matchMedia('(min-width:1280px)');const sync=()=>setWide(m.matches);sync();m.addEventListener('change',sync);return()=>m.removeEventListener('change',sync);},[]);
  return wide ? <aside data-queue-rail aria-label="Fila de atendimento" style={{'--queue-rail-maxh':maxHeight?`${maxHeight}px`:undefined} as CSSProperties}>{children}</aside>
    : <Drawer open title="Fila de atendimento" onClose={onClose} width="max-w-[380px]">{children}</Drawer>;
}
