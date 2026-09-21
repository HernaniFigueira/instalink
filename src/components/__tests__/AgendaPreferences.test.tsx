// @vitest-environment jsdom
import { act,cleanup,renderHook } from '@testing-library/react';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { useAgendaPreferences } from '../dashboard/useAgendaPreferences';
beforeEach(()=>localStorage.clear());afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('Agenda preferences are per user/browser, and queue per unit',()=>{
 it('starts compact/closed, persists explicit choices, isolates another user and unit',()=>{
  const {result,rerender}=renderHook(({user,unit})=>useAgendaPreferences(user,unit),{initialProps:{user:'a',unit:'one'}});
  expect(result.current.density).toBe('compact');expect(result.current.showQueue).toBe(false);
  act(()=>{result.current.setDensity('comfortable');result.current.setShowQueue(true);});
  rerender({user:'b',unit:'one'});expect(result.current.density).toBe('compact');expect(result.current.showQueue).toBe(false);
  rerender({user:'a',unit:'one'});expect(result.current.density).toBe('comfortable');expect(result.current.showQueue).toBe(true);
  rerender({user:'a',unit:'two'});expect(result.current.density).toBe('comfortable');expect(result.current.showQueue).toBe(false);
 });
 it('works in memory when browser persistence is blocked',()=>{
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('blocked');});vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked');});
  const {result}=renderHook(()=>useAgendaPreferences('a','one'));act(()=>{result.current.setDensity('comfortable');result.current.setShowQueue(true);});expect(result.current.density).toBe('comfortable');expect(result.current.showQueue).toBe(true);
 });
});
