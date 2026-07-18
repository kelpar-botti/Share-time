import "server-only";
import type { Session } from "next-auth";
import { auth } from "@/auth";

export async function requireAdmin(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.email || session.user.email !== process.env.ADMIN_EMAIL) {
    throw new Error("管理者としてログインしていません。");
  }
  return session;
}
