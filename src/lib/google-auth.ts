// HTML simples do popup de login com Google.
export function popupHtml(title: string, text: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head><body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#fafafa;margin:0">
<div style="text-align:center;padding:24px"><h1 style="font-size:18px">${title}</h1><p style="color:#666;font-size:14px">${text}</p>
<button onclick="window.close()" style="margin-top:8px;padding:10px 24px;border-radius:12px;border:0;background:#111827;color:#fff;font-weight:700">Fechar</button>
</div></body></html>`;
}
