#!/bin/sh
# docker-entrypoint.sh — 런타임 시점에 dealer/visitor HTML의 window.HD_API_BASE를 inject.
#
# 빌드 시 NEXT_PUBLIC_API_BASE build-arg를 명시하지 않아도, Fly secrets/env로
# 컨테이너 환경변수에 NEXT_PUBLIC_API_BASE 있으면 매 컨테이너 시작 시 sed inject.
#
# 멱등 — 이미 inject된 HTML은 다시 inject 안 함.

set -e

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
    if grep -q "window.HD_API_BASE='[^']" "$f"; then
      echo "[entrypoint] $f already has HD_API_BASE — skip"
      continue
    fi
    # build-arg가 비어있던 inject(window.HD_API_BASE='';)가 있으면 제거 후 재inject
    sed -i "s|<script>window\.HD_API_BASE='';</script>||g" "$f"
    sed -i "s|</head>|<script>window.HD_API_BASE='$NEXT_PUBLIC_API_BASE';</script></head>|" "$f"
    echo "[entrypoint] injected into $f"
  done
else
  echo "[entrypoint] NEXT_PUBLIC_API_BASE not set — skip HTML inject (fallback: URL ?api_base=...)"
fi

exec node S_Sensor/admin/server.js
