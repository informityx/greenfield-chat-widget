import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireAdminSession(req);
  if (denied) return denied;
  return NextResponse.json({ ok: true, authenticated: true });
}
