import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Regressão: em 390 px a linha Profissional + Data em duas colunas truncava o valor
// ("Automático · 2 profissionais" → "Automático · 2 pr…"). Abaixo de sm a linha empilha;
// a partir de sm (640 px) volta a ficar lado a lado. Não altera a regra de distribuição.
const src = fs.readFileSync(
  path.join(process.cwd(), 'src/components/dashboard/NewBookingSheet.tsx'),
  'utf8',
);

describe('NewBookingSheet · linha Profissional + Data no mobile', () => {
  it('empilha em telas estreitas e lado a lado a partir de sm', () => {
    expect(src).toContain("'grid grid-cols-1 items-start gap-3 sm:grid-cols-2'");
  });

  it('não volta à coluna fixa de duas colunas (truncamento em 390 px)', () => {
    expect(src).not.toContain("'grid grid-cols-2 items-start gap-3'");
  });
});
