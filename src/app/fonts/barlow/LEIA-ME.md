# Barlow (vendorizada)

Arquivos **OFL-1.1** da família Barlow (Jeremy Tribby / The Barlow Project
Authors), subset `latin`, pesos 400/500/600/700 — exatamente os pesos que a
escala tipográfica do DS 1.1 usa.

- **Origem:** pacote npm `@fontsource/barlow@5.3.0` (`files/barlow-latin-<peso>-normal.woff2`).
- **Licença:** `OFL.txt` (SIL Open Font License 1.1) — redistribuição permitida.
- **Uso:** `src/app/layout.tsx` via `next/font/local` (self-host + preload, sem
  requisição a fonts.googleapis.com em runtime **nem no build**).
- **Por que local e não `next/font/google`:** o ambiente de homologação não tem
  rota para fonts.googleapis.com e o `next build` falhava ao baixar a fonte,
  o que tornaria build e evidência visual irreproduzíveis. Ver
  `docs/GODOUTOR-DESIGN-SYSTEM.md` §9 (typography) e o relatório da missão.
- **Não editar os arquivos**: atualizar = trocar os `.woff2` pela mesma origem e
  registrar a versão aqui.
