import { getDb } from "@/lib/firebase-admin";
import { createShiftSyncHandler } from "@/lib/shift-sync/handler.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handle = createShiftSyncHandler({ getDb });

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
