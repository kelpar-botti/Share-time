import { getDb } from "@/lib/firebase-admin";
import { createConversationHandler } from "@/lib/day-availability/handler.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createConversationHandler({ getDb });
export async function GET(request: Request): Promise<Response> { return handle(request); }
export async function POST(request: Request): Promise<Response> { return handle(request); }
export async function PATCH(request: Request): Promise<Response> { return handle(request); }
