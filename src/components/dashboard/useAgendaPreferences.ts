'use client';
import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import type { AgendaDensity } from '@/lib/agenda-density';
export function useAgendaPreferences(userId: string | undefined, businessId: string) {
  const [density,setDensityState]=useState<AgendaDensity>('compact');
  const [showQueue,setQueueState]=useState(false);
  const densityKey=userId?`il-agenda-density:${userId}`:'';
  const queueKey=userId?`il-agenda-queue:${userId}:${businessId}`:'';
  useEffect(()=>{
    try {setDensityState(densityKey&&localStorage.getItem(densityKey)==='comfortable'?'comfortable':'compact');setQueueState(!!queueKey&&localStorage.getItem(queueKey)==='open');}
    catch {setDensityState('compact');setQueueState(false);}
  },[densityKey,queueKey]);
  const setDensity=useCallback((value:AgendaDensity)=>{setDensityState(value);try{if(densityKey)localStorage.setItem(densityKey,value);}catch{/* Storage blocked: keep the in-memory preference. */}},[densityKey]);
  const setShowQueue=useCallback((value:SetStateAction<boolean>)=>setQueueState(previous=>{const next=typeof value==='function'?value(previous):value;try{if(queueKey)localStorage.setItem(queueKey,next?'open':'closed');}catch{}return next;}),[queueKey]);
  return {density,setDensity,showQueue,setShowQueue};
}
