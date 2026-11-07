import { hash, verify } from '@node-rs/argon2';

// Argon2id (library default algorithm) with OWASP-recommended minimums: m=19 MiB, t=2, p=1.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
export const hashPassword = (password: string) => hash(password, OPTIONS);
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}
/** Used when the username does not exist, so response time does not reveal valid usernames. */
let dummy: Promise<string> | null = null;
export async function burnTime(password: string) {
  dummy ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummy, password);
}
