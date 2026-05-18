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

RUN npm ci --omit=dev=false

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

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_BASE
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

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
