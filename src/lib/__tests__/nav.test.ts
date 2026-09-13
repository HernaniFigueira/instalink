import { describe, expect, it } from 'vitest';
import { NAV_ORDER, VALID_NAV, aboutVisible, defaultAbout, navLabel } from '../nav';

describe('NAV_ORDER (menu configurável)', () => {
  it('tem ordem canônica única, sem ids duplicados', () => {
    const ids = NAV_ORDER.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('VALID_NAV cobre todos os itens do catálogo', () => {
    expect(VALID_NAV).toEqual(NAV_ORDER.map((n) => n.id));
  });
  it('navLabel devolve o rótulo do catálogo', () => {
    expect(navLabel('about')).toBe('Sobre a empresa');
    expect(navLabel('nao-existe')).toBe('nao-existe');
  });
});

describe('aboutVisible (seção Sobre)', () => {
  it('vazia/desativada → não aparece', () => {
    expect(aboutVisible(defaultAbout())).toBe(false);
    expect(aboutVisible({ ...defaultAbout(), enabled: true })).toBe(false);
    expect(aboutVisible(null)).toBe(false);
    expect(aboutVisible(undefined)).toBe(false);
  });
  it('ativa e com conteúdo → aparece', () => {
    expect(aboutVisible({ ...defaultAbout(), enabled: true, text: 'Somos uma clínica...' })).toBe(true);
    expect(aboutVisible({ title: 'Sobre', text: '', image: '', enabled: true })).toBe(true);
    expect(aboutVisible({ title: '', text: '', image: 'https://x/y.png', enabled: true })).toBe(true);
  });
  it('conteúdo só de espaços → não conta', () => {
    expect(aboutVisible({ title: '   ', text: '', image: '', enabled: true })).toBe(false);
  });
});
