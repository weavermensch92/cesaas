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
};

module.exports = nextConfig;
