import { NextResponse } from "next/server";
import { clearAdminSessionCookieHeader } from "@/lib/admin-session";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearAdminSessionCookieHeader());
  return res;
}
