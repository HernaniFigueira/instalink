// ═══════════════════════════════════════════════════════════════
// §5.3 DO AUDIT 360 — VAZAMENTO INTRA-TENANT NA LEITURA DE DADOS
// ═══════════════════════════════════════════════════════════════
// §5.3.1 — GET /api/pages devolvia business+page COMPLETOS para qualquer
// membro da unidade (a leitura só validava acesso, não a permissão
// 'pagina'/'config'); o PUT já recusava. Perfil de operação (secretaria)
// recebia 200 com o payload inteiro.
// §5.3.2 — /api/organizations agregava predictedRevenue sem 'financeiro'
// (coberto comportamentalmente em organization-direction.test.ts; aqui
// trava-se o contrato de fonte).
//
// Padrão do repositório (panel.test.ts/a12): teste de contrato de fonte.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('§5.3.1 — GET /api/pages exige administração da presença', () => {
  const src = read('src/app/api/pages/route.ts');

  it('a LEITURA usa requireBusiness com [pagina, config] (nada de 200 para operação)', () => {
    expect(src).toMatch(/export async function GET[\s\S]*?requireBusiness\(req, businessId, \['pagina', 'config'\]\)/);
  });

  it('a ESCRITA continua exigindo pagina (PUT inalterado)', () => {
    expect(src).toMatch(/export async function PUT[\s\S]*?requireBusiness\(req, businessId, 'pagina'\)/);
  });
});

describe('§5.3.2 — /api/organizations não serializa dinheiro sem financeiro', () => {
  const src = read('src/lib/organization-overview.ts');

  it('predictedRevenue só existe com canFinancial (projecão do servidor)', () => {
    expect(src).toMatch(/canFinancial = !!ctx\?\.permissions\.financeiro/);
    expect(src).toMatch(/\.\.\.\(canFinancial\?\{predictedRevenue:revenue\}:\{\}\)/);
  });
});

describe('P1.13 — nenhuma ação visível que o servidor recusaria', () => {
  const sheet = read('src/components/dashboard/EncounterSheet.tsx');

  it('Registrar pagamento (POST /api/finance) só existe para quem tem financeiro', () => {
    expect(sheet).toMatch(/canRegisterPayment = !permsReady \|\| panelPerms\.financeiro === true/);
    expect(sheet).toMatch(/\{canRegisterPayment && \(/);
  });

  it('a semente de recebimento pós-finalização também é condicional', () => {
    expect(sheet).toMatch(/if \(canRegisterPayment\) \{\s*\n\s*setPaymentSeed\(/);
  });
});
