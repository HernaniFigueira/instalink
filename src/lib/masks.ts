// GoDoutor — Máscaras brasileiras reutilizáveis (testáveis, sem coleta indevida)
 // Reutiliza field-quality para telefone/CPF/CEP; adiciona CNPJ/CRMV/UF
 // Todas as máscaras são progressivas e toleram digitação parcial.
 // Normalização: only-digits para persistência; formatação só para exibição.
 // CPF ≠ CRMV: CPF é documento pessoal; CRMV é registro profissional UF+numero. Não deduzir um do outro.
 // Referência CFMV Res 1475/2022: exibição CRMV-UF nº 00001 (Art 30).
 import { onlyDigits as od } from '@/lib/utils';
 import { maskCpf as mqCpf, maskCep as mqCep, maskPhoneBR as mqPhone, isValidPhoneBR } from '@/lib/field-quality';
 import { isValidCpf } from '@/lib/contact-profile';
 import { BRAZILIAN_STATES } from '@/lib/contact-profile';
 
 export { mqCpf as maskCpf, mqCep as maskCep, mqPhone as maskPhoneBR, isValidPhoneBR, isValidCpf };
 export const onlyDigits = od;
 
 // ── CNPJ ──────────────────────────────────────────────────────────
 // 00.000.000/0000-00 (14 dígitos)
 export function maskCnpj(v: string): string {
   const d = od(v).slice(0, 14);
   if (d.length <= 2) return d;
   if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
   if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
   if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
   return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
 }
 
 // CPF (11) ou CNPJ (14) dinâmico — usa CPF enquanto ≤11, CNPJ quando 12-14
 export function maskCpfCnpj(v: string): string {
   const d = od(v);
   if (d.length <= 11) return mqCpf(v);
   return maskCnpj(v);
 }
 
 export function isValidCnpj(raw: string): boolean {
   const d = od(raw);
   if (!/^\d{14}$/.test(d)) return false;
   if (/^(\d)\1{13}$/.test(d)) return false;
   const calc = (base: string, pos: number[]) => {
     let sum = 0;
     for (let i = 0; i < pos.length; i++) sum += Number(base[i]) * pos[i];
     const r = sum % 11;
     return r < 2 ? 0 : 11 - r;
   };
   const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
   const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
   const d1 = calc(d, p1);
   if (d1 !== Number(d[12])) return false;
   const d2 = calc(d, p2);
   return d2 === Number(d[13]);
 }
 
 // ── CEP já via field-quality (00000-000) — re-exportar helper de validade simples
 export function isValidCep(raw: string): boolean {
   return /^\d{8}$/.test(od(raw));
 }
 
 // ── UF ────────────────────────────────────────────────────────────
 // Lista oficial 27 UFs vinda de contact-profile (BRAZILIAN_STATES)
 export const UF_LIST = BRAZILIAN_STATES as readonly string[];
 
 export function maskUf(v: string): string {
   return v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
 }
 export function isValidUf(uf: string): boolean {
   return UF_LIST.includes(uf.toUpperCase() as any);
 }
 export function normalizeUf(v: string): string {
   const u = maskUf(v);
   return isValidUf(u) ? u : '';
 }
 
 // ── CRMV ──────────────────────────────────────────────────────────
 // Clínico: UF (select) + número (digits 1-6). Exibição: CRMV-RJ nº 12345
 //  — não confundir com CPF; não exigir para não-veterinários.
 export function maskCrmvNumero(v: string): string {
   return od(v).slice(0, 6).replace(/^0+(?=\d)/, '');
 }
 export function formatCrmvDisplay(uf: string, numero: string): string {
   const u = maskUf(uf);
   const n = od(numero);
   if (!u || !n) return '';
   return `CRMV-${u} nº ${n}`;
 }
 // Parseia "CRMV-RJ nº 12345" ou "RJ 12345" -> { uf, numero }
 export function parseCrmvDisplay(raw: string): { uf: string; numero: string } | null {
   if (!raw) return null;
   const upper = raw.toUpperCase();
   // tenta extrair UF (2 letras) + numero
   const m = upper.match(/([A-Z]{2})[^0-9]*(\d{1,6})/);
   if (!m) return null;
   const uf = m[1];
   const num = m[2];
   if (!isValidUf(uf)) return null;
   return { uf, numero: num };
 }
 export function isValidCrmv(uf: string, numero: string): boolean {
   return isValidUf(uf) && /^\d{1,6}$/.test(od(numero));
 }
 
 // ── Normalização genérica para persistência (digits-only onde aplicável)
 export function normalizeCep(v: string): string { return od(v).slice(0, 8); }
 export function normalizeCpf(v: string): string { return od(v).slice(0, 11); }
 export function normalizeCnpj(v: string): string { return od(v).slice(0, 14); }
 export function normalizeCpfCnpj(v: string): string { return od(v).slice(0, 14); }
