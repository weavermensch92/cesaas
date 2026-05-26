/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  // Fly.io Docker 이미지에 standalone server.js 출력 — Dockerfile이 standalone/ 복사
  output: 'standalone',
  transpilePackages: ['@hd/design'],
  experimental: {
    typedRoutes: false,
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
  async rewrites() {
    return [
      { source: '/dealer',       destination: '/dealer/index.html' },
      { source: '/dealer/',      destination: '/dealer/index.html' },
      { source: '/dealer/v2',    destination: '/dealer/v2/index.html' },
      { source: '/dealer/v2/',   destination: '/dealer/v2/index.html' },
      { source: '/dealer/v2mobile',  destination: '/dealer/v2mobile/index.html' },
      { source: '/dealer/v2mobile/', destination: '/dealer/v2mobile/index.html' },
      { source: '/visitor',      destination: '/visitor/index.html' },
      { source: '/visitor/',     destination: '/visitor/index.html' },
      { source: '/_design/voice-wireframes',  destination: '/_design/voice-wireframes/index.html' },
      { source: '/_design/voice-wireframes/', destination: '/_design/voice-wireframes/index.html' },
      { source: '/_design/popup-screenshot',  destination: '/_design/popup-screenshot/index.html' },
      { source: '/_design/popup-screenshot/', destination: '/_design/popup-screenshot/index.html' },
    ];
  },
};

module.exports = nextConfig;
