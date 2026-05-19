# fly_edge/Dockerfile — Fly.io Edge fallback container.
# 빌드 context = 리포 루트 (hd-hyundai-poc/). fly.toml의 [build].dockerfile 경로가 리포 루트 기준.
#
# 배포 사이즈를 줄이기 위해 .dockerignore가 node_modules·.git·실행물 제외.

FROM denoland/deno:2.1.4

WORKDIR /app

# 핸들러 + 의존 모듈만 복사 (admin/extension 등은 제외)
COPY fly_edge/                       fly_edge/
COPY V_Voice/backend/                V_Voice/backend/
COPY S_Sensor/backend/shared/        S_Sensor/backend/shared/
COPY R_Runtime/lib/                  R_Runtime/lib/
COPY R_Runtime/deno.json             R_Runtime/deno.json
COPY C_Common/r_10_rules/            C_Common/r_10_rules/

# 의존성 사전 캐시 (deno cache로 npm:* 받음)
RUN deno cache --config fly_edge/deno.json fly_edge/main.ts

EXPOSE 8080

ENV LOG_LEVEL=info

CMD ["deno", "run", \
     "--config", "fly_edge/deno.json", \
     "--allow-net", "--allow-env", "--allow-read", \
     "fly_edge/main.ts"]
