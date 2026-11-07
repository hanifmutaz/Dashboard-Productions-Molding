export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}
export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = () => new HttpError(401, 'UNAUTHENTICATED', 'Silakan masuk terlebih dahulu.');
export const forbidden = () => new HttpError(403, 'FORBIDDEN', 'Anda tidak memiliki akses untuk tindakan ini.');
export const notFound = (what = 'Data') => new HttpError(404, 'NOT_FOUND', `${what} tidak ditemukan.`);
export const conflict = () => new HttpError(409, 'CONFLICT', 'Data sudah diubah oleh pengguna lain. Muat ulang lalu ulangi perubahan Anda.');
export const tooMany = () => new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
