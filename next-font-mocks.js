// Temporary build aid (NOT for production): mocked Google Fonts responses so
// `next build` can complete in sandboxes without TLS access to fonts.googleapis.com.
// Activated only via the official NEXT_FONT_GOOGLE_MOCKED_RESPONSES env var.
module.exports = {
  'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap':
    ['/* latin */', "@font-face {", "  font-family: 'Inter';", '  font-style: normal;', '  font-weight: 100 900;', '  font-display: swap;', "  src: url(https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2) format('woff2');", '  unicode-range: U+0000-00FF;', '}'].join('\n'),
  'https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&display=swap':
    ['/* latin */', "@font-face {", "  font-family: 'Sora';", '  font-style: normal;', '  font-weight: 600 800;', '  font-display: swap;', "  src: url(https://fonts.gstatic.com/s/sora/v12/xMQOuFFYT72X5wkB_18qmnndmSdSgU-AKQ.woff2) format('woff2');", '  unicode-range: U+0000-00FF;', '}'].join('\n'),
};
