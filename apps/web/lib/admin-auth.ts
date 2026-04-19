import { NextResponse } from "next/server";
import {
  getAdminSessionTokenFromRequest,
  requireAdminSecret,
  verifyAdminSessionToken,
} from "@/lib/admin-session";

export function requireAdminSession(req: Request): NextResponse | null {
  const secret = requireAdminSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Server misconfiguration: ADMIN_SECRET is not set" },
      { status: 503 },
    );
  }
  const token = getAdminSessionTokenFromRequest(req);
  if (!verifyAdminSessionToken(secret, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
