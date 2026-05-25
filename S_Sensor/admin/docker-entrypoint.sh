#!/bin/sh
# docker-entrypoint.sh — 런타임 시점에 dealer/visitor HTML의 window.HD_API_BASE를 inject.
#
# 빌드 시 NEXT_PUBLIC_API_BASE build-arg를 명시하지 않아도, Fly secrets/env로
# 컨테이너 환경변수에 NEXT_PUBLIC_API_BASE 있으면 매 컨테이너 시작 시 sed inject.
#
# 멱등 — 이미 inject된 HTML은 다시 inject 안 함.
# 실패 무시 — sed 실패해도 server는 무조건 시작 (502 방지). 클라이언트는 URL ?api_base= fallback.

FILES="
  S_Sensor/admin/public/dealer/index.html
  S_Sensor/admin/public/dealer/v2/index.html
  S_Sensor/admin/public/dealer/v1rev/index.html
  S_Sensor/admin/public/visitor/index.html
"

if [ -n "$NEXT_PUBLIC_API_BASE" ]; then
  echo "[entrypoint] injecting HD_API_BASE=$NEXT_PUBLIC_API_BASE"
  for f in $FILES; do
    [ -f "$f" ] || continue
    # 이미 비어있지 않은 HD_API_BASE inject 됐으면 skip (멱등)
    if grep -q "window.HD_API_BASE='[^']" "$f" 2>/dev/null; then
      echo "[entrypoint] $f already has HD_API_BASE — skip"
      continue
    fi
    # 권한 또는 sed 실패해도 server 시작 차단 안 됨 (|| true)
    sed -i "s|<script>window\.HD_API_BASE='';</script>||g" "$f" 2>/dev/null || true
    sed -i "s|</head>|<script>window.HD_API_BASE='$NEXT_PUBLIC_API_BASE';</script></head>|" "$f" 2>/dev/null \
      && echo "[entrypoint] injected into $f" \
      || echo "[entrypoint] WARN sed failed on $f (permission?) — relying on URL ?api_base= fallback"
  done
else
  echo "[entrypoint] NEXT_PUBLIC_API_BASE not set — skip HTML inject (fallback: URL ?api_base=...)"
fi

exec node S_Sensor/admin/server.js
