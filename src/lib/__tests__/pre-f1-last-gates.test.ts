import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { leadOriginLabel, LEAD_ORIGIN_LABELS } from '../leads';
const read=(path:string)=>readFileSync(path,'utf8');
describe('Last pre-F1 gates — navigation, geometry and clinical copy',()=>{
 it('retains legacy source identifiers and labels when explicitly enabled; Clinical OS presents historical metadata without selling the legacy product',()=>{
  expect(LEAD_ORIGIN_LABELS.public_page).toBe('Página pública');
  expect(leadOriginLabel('public_page',true)).toBe('Página pública');
  expect(leadOriginLabel('public_page',false)).toBe('Cadastro online (legado)');
  expect(leadOriginLabel('pedido',false)).toBe('Registro comercial (legado)');
  expect(leadOriginLabel('WhatsApp',false)).toBe('WhatsApp');
  expect(leadOriginLabel('Origem livre',false)).toBe('Origem livre');
 });
 it('uses navigation guard on the team editor and keeps navigation reachable without changing modal defaults elsewhere',()=>{
  const team=read('src/app/(dashboard)/equipe/page.tsx');
  expect(team).toContain('useUnsavedChangesGuard');expect(team).toContain('modal={false}');expect(team).toContain('{navigationGuard.dialog}');
  expect(read('src/components/ui.tsx')).toContain('modal = true');
 });
 it('does not shadow shell measured left inset, and reserves visible space for the selected column',()=>{
  const css=read('src/app/globals.css');expect(css).toContain('--sheet-left: inherit;');
  expect(css).toContain('.ag-mode-panel[data-range-focus]');expect(css).toContain('margin-right: calc(min(46vw, 560px) + 14px)');
  expect(read('src/app/(dashboard)/agenda/page.tsx')).toContain('columns.filter(c => c.key === selectedRange?.columnKey)');
 });
 it('active empty-state/campaign copy and image actions follow the clinical contract',()=>{
  expect(read('src/app/(dashboard)/clientes/page.tsx')).not.toMatch(/cadastros na página|na sua página/);
  expect(read('src/app/(dashboard)/campanhas/page.tsx')).not.toMatch(/Promoção|promoções/);
  expect(read('src/components/dashboard/ImageUpload.tsx')).toContain("buttonCls('secondary', 'sm')");
 });
});
