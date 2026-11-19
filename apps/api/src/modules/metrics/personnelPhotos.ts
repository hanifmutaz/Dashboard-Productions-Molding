import { lstat } from 'node:fs/promises';
import path from 'node:path';

const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

/** Keep NIK as text so leading zeroes match the server file name. */
export const isPhotoNik = (nik: string | null | undefined): nik is string =>
  typeof nik === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(nik);

export async function findPersonnelPhoto(directory: string, nik: string): Promise<string | null> {
  if (!isPhotoNik(nik)) return null;
  for (const extension of PHOTO_EXTENSIONS) {
    const file = path.resolve(directory, nik + '.' + extension);
    const info = await lstat(file).catch(() => null);
    if (info?.isFile()) return file;
  }
  return null;
}
