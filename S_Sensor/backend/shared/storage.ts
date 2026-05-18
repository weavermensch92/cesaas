// Supabase Storage 헬퍼.
import { db } from './db.ts';
import { ApiError } from './errors.ts';

const BUCKET = 'captures';

/**
 * 저장된 WebP를 Uint8Array로 다운로드 (service_role).
 */
export async function downloadCapture(path: string): Promise<Uint8Array> {
  const { data, error } = await db().storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new ApiError('internal_error', 'storage download failed', {
      path, msg: error?.message,
    });
  }
  return new Uint8Array(await data.arrayBuffer());
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + chunkSize, bytes.length))),
    );
  }
  return btoa(binary);
}
