import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const terms = read('src/app/termos-de-servico/page.tsx');
const deletion = read('src/app/exclusao-de-dados/page.tsx');
const layout = read('src/components/public/LegalDocument.tsx');

describe('páginas legais públicas do GoDoutor', () => {
  it('define metadata rastreável e cobre os temas essenciais dos Termos', () => {
    expect(terms).toContain("title: 'Termos de Serviço | GoDoutor'");
    for (const term of ['uso do SaaS', 'Contas, acesso e segurança', 'Integrações e canais de terceiros', 'Disponibilidade, manutenção e suporte', 'Suspensão, cancelamento e encerramento', 'Limites de responsabilidade']) {
      expect(terms).toContain(term);
    }
  });

  it('define metadata rastreável e explica o fluxo de exclusão e retenções', () => {
    expect(deletion).toContain("title: 'Exclusão de Dados | GoDoutor'");
    for (const term of ['Como fazer o pedido', 'O que pode ser removido', 'Retenção legal e exceções', 'WhatsApp, Meta e outros provedores', 'Validação, retorno e prazo']) {
      expect(deletion).toContain(term);
    }
  });

  it('compartilha layout público sem guarda de autenticação e cruza os documentos', () => {
    expect(layout).toContain('LegalDocument');
    expect(layout).toContain('/politica-de-privacidade');
    expect(layout).toContain('/termos-de-servico');
    expect(layout).toContain('/exclusao-de-dados');
    expect(layout).not.toContain('requireUser');
    expect(layout).not.toContain('requireAuth');
  });
});
