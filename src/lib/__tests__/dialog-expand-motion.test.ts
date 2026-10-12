// Contrato de motion do Novo agendamento (modal central): expandir/recolher o cadastro aninhado
// não pode reiniciar a entrada (fade a partir de opacidade 0) nem trocar a largura em um quadro.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const ds = fs.readFileSync(path.join(root, 'src/styles/godoutor-design-system.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');

describe('dialog central · expandir/recolher cadastro aninhado', () => {
  it('a entrada do strip do dialog NÃO depende de data-expanded (não reinicia ao recolher)', () => {
    expect(ds).not.toMatch(/\.il-drawer--dialog \.il-drawer__strip:not\(\[data-expanded\]\)/);
    expect(ds).toMatch(/\.il-drawer--dialog \.il-drawer__strip \{ animation: gd-dialog-in var\(--gd-motion-dialog\)/);
  });

  it('a largura do dialog anima pelo token de side-modal (0 ms em reduce)', () => {
    const block = app.slice(app.indexOf('dialog.il-drawer--dialog {'));
    const rule = block.slice(0, block.indexOf('}') + 1);
    expect(rule).toMatch(/transition: width var\(--gd-motion-side-modal\) var\(--gd-ease\)/);
  });
});
