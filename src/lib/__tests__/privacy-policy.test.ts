import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(resolve(process.cwd(), 'src/app/politica-de-privacidade/page.tsx'), 'utf8');
const landing = readFileSync(resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
const authLayout = readFileSync(resolve(process.cwd(), 'src/app/(auth)/layout.tsx'), 'utf8');

describe('Política de Privacidade pública', () => {
  it('é uma página server-rendered com metadata rastreável e conteúdo LGPD essencial', () => {
    expect(route).toContain("title: 'Política de Privacidade | GoDoutor'");
    expect(route).toContain("robots: { index: true, follow: true }");
    const normalizedRoute = route.toLocaleLowerCase('pt-BR');
    for (const term of [
      'WABA ID', 'Phone Number ID', 'AES-256-GCM', 'WhatsApp Cloud API',
      'retenção', 'Direitos previstos na LGPD', 'Cookies, sessão e armazenamento local',
      'Canal de privacidade',
    ]) {
      expect(normalizedRoute).toContain(term.toLocaleLowerCase('pt-BR'));
    }
  });

  it('é linked no site público e no layout de login', () => {
    expect(landing).toContain('href="/politica-de-privacidade"');
    expect(authLayout).toContain('href="/politica-de-privacidade"');
  });
});
