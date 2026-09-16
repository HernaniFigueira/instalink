import { NextResponse } from 'next/server';

export async function GET() {
  const script = `/**
 * InstaLink Booking Widget (P3)
 * Uso simples em qualquer site:
 *   <div id="instalink-booking" data-business="biz-seu-negocio"></div>
 *   <script src="https://instalink.app/widget/booking.js" async></script>
 */
(function() {
  function init() {
    var el = document.getElementById('instalink-booking') || document.querySelector('[data-instalink-booking]');
    if (!el || el.dataset.instalinkLoaded) return;
    el.dataset.instalinkLoaded = 'true';

    var biz = el.getAttribute('data-business') || el.getAttribute('data-business-id') || '';
    var svc = el.getAttribute('data-service-id') || el.getAttribute('data-service') || '';
    var pro = el.getAttribute('data-professional-id') || el.getAttribute('data-professional') || '';

    var currentScript = document.currentScript;
    var host = window.location.origin;
    if (currentScript && currentScript.src) {
      try { host = new URL(currentScript.src).origin; } catch (e) {}
    }

    var iframe = document.createElement('iframe');
    var query = '?b=' + encodeURIComponent(biz) + '&embed=1';
    if (svc) query += '&s=' + encodeURIComponent(svc);
    if (pro) query += '&p=' + encodeURIComponent(pro);

    iframe.src = host + '/agendar' + query;
    iframe.style.width = '100%';
    iframe.style.height = '680px';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '12px';
    iframe.style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)';
    iframe.style.display = 'block';
    iframe.title = 'Agendamento Online';

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
