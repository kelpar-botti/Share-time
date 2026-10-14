import type { Firestore } from 'firebase-admin/firestore';

export function createShiftSyncHandler(options: {
  getDb: () => Firestore;
  env?: () => NodeJS.ProcessEnv;
  fetchMonth?: (month: string, configuration: {
    clientId: string;
    email: string;
    password: string;
    expectedStaffCode: string;
  }) => Promise<unknown>;
  clock?: () => Date | string;
}): (request: Request) => Promise<Response>;
