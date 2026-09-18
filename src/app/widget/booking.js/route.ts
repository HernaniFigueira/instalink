import { NextResponse } from 'next/server';

// ═══════════════════════════════════════════════════════════════
// WIDGET DE AGENDAMENTO (P3) — A2-B2 (F1)
// ═══════════════════════════════════════════════════════════════
// Injeta um iframe de /agendar no site do lojista. O fluxo completo
// (serviço → dia → horário → nome/telefone → confirmação) roda DENTRO do
// iframe usando as APIs oficiais — o widget NÃO tem implementação própria
// de slots nem de reserva (um único motor de agenda).
// A2-B2: o iframe reporta a altura real via postMessage e o widget ajusta o
// embed (antes: altura fixa de 680px cortava o fluxo com dados de contato).
export async function GET() {
  const script = `/**
 * InstaLink Booking Widget (P3 · A2)
 * Uso simples em qualquer site:
 *   <div id="instalink-booking" data-business="slug-do-negocio"></div>
 *   <script src="https://instalink.app/widget/booking.js" async><\/script>
 */
(function() {
  function init() {
    var el = document.getElementById('instalink-booking') || document.querySelector('[data-instalink-booking]');
    if (!el || el.dataset.instalinkLoaded) return;
    el.dataset.instalinkLoaded = 'true';

    var biz = el.getAttribute('data-business') || el.getAttribute('data-business-id') || '';
    var svc = el.getAttribute('data-service-id') || el.getAttribute('data-service') || '';
    var lead = el.getAttribute('data-lead-id') || '';

    var currentScript = document.currentScript;
    var host = window.location.origin;
    if (currentScript && currentScript.src) {
      try { host = new URL(currentScript.src).origin; } catch (e) {}
    }

    var iframe = document.createElement('iframe');
    var query = '?b=' + encodeURIComponent(biz) + '&embed=1';
    if (svc) query += '&s=' + encodeURIComponent(svc);
    if (lead) query += '&leadId=' + encodeURIComponent(lead);

    iframe.src = host + '/agendar' + query;
    iframe.style.width = '100%';
    iframe.style.height = '720px';
    iframe.style.minHeight = '560px';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '12px';
    iframe.style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)';
    iframe.style.display = 'block';
    iframe.style.background = 'transparent';
    iframe.title = 'Agendamento Online';

    // O fluxo de agendamento informa a altura real do conteúdo; o widget só
    // ajusta o iframe quando a mensagem vem do MESMO host do embed.
    window.addEventListener('message', function(event) {
      if (event.origin !== host) return;
      var data = event.data || {};
      if (data.type !== 'instalink:height' || typeof data.height !== 'number') return;
      var h = Math.max(560, Math.min(4000, Math.ceil(data.height) + 24));
      iframe.style.height = h + 'px';
    });

    el.innerHTML = '';
    el.appendChild(iframe);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

  return new NextResponse(script, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
