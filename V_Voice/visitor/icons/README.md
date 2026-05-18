# Visitor PWA Icons

> manifest.webmanifest 가 참조하는 192×192·512×512 PNG.

## 자산 생성

배포 전에 HD Trust Blue 배경 + Heritage Green 마크의 PNG 두 장을 여기에 배치:

- `icon-192.png` (192×192, maskable)
- `icon-512.png` (512×512, maskable)

마크 배경 색: `#002554` (HD Trust Blue) · 마크 글자 색: `#00AD1D` (Heritage Green) — `_preview/index.html` 의 미니 아이콘과 동일.

`manifest.webmanifest` 의 `purpose: "any maskable"` 에 맞추려면 안전 영역(safe area) 안에 마크를 배치할 것.
