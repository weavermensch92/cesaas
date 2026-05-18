/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  // Fly.io Docker 이미지에 standalone server.js 출력 — Dockerfile이 standalone/ 복사
  output: 'standalone',
  // monorepo 루트 outputFileTracingRoot — workspace 패키지 (@hd/core, @hd/design) 포함
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // @hd/design은 workspace package — Next.js가 transpilePackages로 처리해야 src/ TS·CSS 가능
  transpilePackages: ['@hd/design'],
  experimental: {
    typedRoutes: false,
  },
};

module.exports = nextConfig;
