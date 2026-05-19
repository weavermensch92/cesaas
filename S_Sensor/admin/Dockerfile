# Multi-stage build — Next.js 14 standalone on Fly.io Tokyo (nrt).
# 빌드 컨텍스트는 monorepo 루트 (hd-hyundai-poc/) — fly.toml의 build.dockerfile 경로 참조.

# ---------- 1) deps ----------
FROM node:20-alpine AS deps
WORKDIR /repo

# workspaces 설치를 위해 루트 manifest + 관련 workspace package.json 만 먼저 복사
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY C_Common/packages/core/package.json    C_Common/packages/core/
COPY C_Common/packages/design/package.json  C_Common/packages/design/
COPY S_Sensor/admin/package.json            S_Sensor/admin/

RUN npm install --legacy-peer-deps --no-audit --no-fund

# ---------- 2) builder ----------
FROM node:20-alpine AS builder
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/package.json ./
COPY --from=deps /repo/tsconfig.base.json ./

# workspace 패키지 소스
COPY C_Common/packages/core    C_Common/packages/core
COPY C_Common/packages/design  C_Common/packages/design
COPY S_Sensor/admin            S_Sensor/admin

# V_Voice Dealer HTML + Visitor PWA — 같은 도메인 정적 호스팅
COPY V_Voice/dealer            S_Sensor/admin/public/dealer
COPY V_Voice/visitor           S_Sensor/admin/public/visitor

# 디자인 와이어프레임 (스펙 비교용 — meeting_brief_2026_05_14 추출)
COPY _preview                  S_Sensor/admin/public/_design

# Sensor Extension 자산 + 설치 스크립트 (API 라우트가 ZIP 동적 생성 시 읽음)
COPY S_Sensor/extension        S_Sensor/admin/public/_ext-template

# Sensor Extension 자산 + 설치 스크립트 (API 라우트가 ZIP 생성 시 읽음)
COPY S_Sensor/extension        S_Sensor/admin/public/_ext-template

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_BASE
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# Dealer / Visitor 의 window.HD_API_BASE 자동 주입 (v1·v2·visitor 전부)
RUN sed -i "s|</head>|<script>window.HD_API_BASE='${NEXT_PUBLIC_API_BASE}';</script></head>|" \
      S_Sensor/admin/public/dealer/index.html \
      S_Sensor/admin/public/dealer/v2/index.html \
      S_Sensor/admin/public/visitor/index.html

RUN npm run build -w @hd/sensor-admin

# ---------- 3) runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
EXPOSE 3000

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# Next.js standalone output
COPY --from=builder /repo/S_Sensor/admin/.next/standalone ./
COPY --from=builder /repo/S_Sensor/admin/.next/static ./S_Sensor/admin/.next/static
COPY --from=builder /repo/S_Sensor/admin/public          ./S_Sensor/admin/public

USER nextjs
CMD ["node", "S_Sensor/admin/server.js"]
