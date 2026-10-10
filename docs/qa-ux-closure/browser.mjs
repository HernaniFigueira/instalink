// ═══════════════════════════════════════════════════════════════
// QA UX CLOSURE — BROWSER PARA A HOMOLOGAÇÃO (auto-recuperável)
// ═══════════════════════════════════════════════════════════════
// As evidências desta missão são medidas em Chromium de VERDADE. O ambiente de
// CI/sandbox pode não trazer navegador (e limpa `/tmp` e `node_modules` entre
// execuções), então este módulo garante o binário antes de cada captura:
//
//   • se já existe um Chromium utilizável em /tmp/qa-ux-browser → usa;
//   • senão baixa `@sparticuz/chromium` (build enxuto, sem instalador),
//     descomprime o payload brotli e extrai as bibliotecas do sistema;
//   • devolve `executablePath` + `LD_LIBRARY_PATH` prontos para o Playwright.
//
// Nada disso é dependência do produto: é ferramenta de homologação, fora do
// bundle (mesma categoria do `capture.mjs`).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const ROOT = process.env.QA_BROWSER_DIR || '/tmp/qa-ux-browser';
const BIN = path.join(ROOT, 'chromium');
const LIB = path.join(ROOT, 'lib');
const PKG = '@sparticuz/chromium@153.0.0';

function usable(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

/** Descomprime (.br) e extrai um tar quando o arquivo ainda não existe. */
async function unpackBrotli(src, dst) {
  const out = zlib.brotliDecompressSync(await fsp.readFile(src));
  await fsp.writeFile(dst, out);
  return out.length;
}

export async function ensureBrowser() {
  // 1. Já existe? (binário + as libs que ele precisa)
  if (usable(BIN) && usable(path.join(LIB, 'libnss3.so'))) {
    return { executablePath: BIN, LD_LIBRARY_PATH: LIB, reused: true };
  }
  await fsp.mkdir(ROOT, { recursive: true });
  const tgz = path.join(ROOT, 'chromium.tgz');
  // 2. Payload do pacote (npm) — sem instalar dependência no projeto.
  execFileSync('npm', ['pack', PKG, '--silent', '--pack-destination', ROOT], { cwd: ROOT, stdio: 'inherit' });
  const packed = (await fsp.readdir(ROOT)).find((f) => f.endsWith('.tgz'));
  if (!packed) throw new Error('npm pack não produziu o pacote do Chromium');
  await fsp.rename(path.join(ROOT, packed), tgz);
  execFileSync('tar', ['xzf', tgz, '-C', ROOT]);
  const binDir = path.join(ROOT, 'package', 'bin');
  // 3. Binário + bibliotecas do sistema (al2023 traz NSS/NSPR/freebl).
  await unpackBrotli(path.join(binDir, 'chromium.br'), BIN);
  await fsp.chmod(BIN, 0o755);
  // `tar` não descomprime brotli: descomprime antes de extrair.
  const al2023 = path.join(ROOT, 'al2023.tar');
  await unpackBrotli(path.join(binDir, 'al2023.tar.br'), al2023);
  execFileSync('tar', ['xf', al2023, '-C', ROOT]);
  if (!usable(BIN) || !usable(path.join(LIB, 'libnss3.so'))) {
    throw new Error('Chromium não ficou utilizável em ' + ROOT);
  }
  // 4. Confere que o binário roda com essas libs (falha cedo, não no meio da captura).
  const version = execFileSync(BIN, ['--version'], {
    env: { ...process.env, LD_LIBRARY_PATH: LIB }, encoding: 'utf8',
  }).trim();
  return { executablePath: BIN, LD_LIBRARY_PATH: LIB, version };
}

/** Argumentos de sandbox mínimos para headless neste ambiente. */
export const CHROMIUM_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--no-zygote'];
