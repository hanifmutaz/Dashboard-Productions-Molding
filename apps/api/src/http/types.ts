import type { Permission } from '@mpd/contracts';

export type Principal =
  | { kind: 'user'; id: string; username: string; displayName: string; roleId: string; roleName: string; systemKey: string | null; permissions: Permission[]; sessionHash: string; csrfToken: string }
  | { kind: 'kiosk'; id: string; name: string; machineNo: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      principal?: Principal;
    }
  }
}
export {};
