const path = require('path');
const fs = require('fs');

const mockFont = path.join(__dirname, 'next-font-mocks.js');
if (!process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES && fs.existsSync(mockFont)) {
  process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES = mockFont;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};
module.exports = nextConfig;
