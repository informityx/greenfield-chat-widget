import { NextResponse } from "next/server";
import {
  adminSessionCookieHeader,
  issueAdminSessionToken,
  requireAdminSecret,
} from "@/lib/admin-session";

export const runtime = "nodejs";

type Body = {
  username?: string;
  password?: string;
};

export async function POST(req: Request) {
  const secret = requireAdminSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Server misconfiguration: ADMIN_SECRET is not set" },
      { status: 503 },
    );
  }

  const user = process.env.ADMIN_DASHBOARD_USER?.trim();
  const pass = process.env.ADMIN_DASHBOARD_PASSWORD?.trim();
  if (!user || !pass) {
    return NextResponse.json(
      {
        error:
          "Server misconfiguration: ADMIN_DASHBOARD_USER and ADMIN_DASHBOARD_PASSWORD must be set",
      },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.username !== user || body.password !== pass) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = issueAdminSessionToken(secret);
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", adminSessionCookieHeader(token));
  return res;
}
