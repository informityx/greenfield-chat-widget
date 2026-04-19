import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ siteId: string }> };

export async function GET(request: Request, ctx: RouteCtx) {
  const denied = requireAdminSession(request);
  if (denied) return denied;

  const { siteId: raw } = await ctx.params;
  const siteId = decodeURIComponent(raw);
  const site = await prisma.site.findUnique({ where: { siteId } });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const tickets = await prisma.ticket.findMany({
    where: { siteId: site.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      sessionId: true,
      email: true,
      fullName: true,
      status: true,
      type: true,
      priority: true,
      summary: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    siteId,
    tickets: tickets.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
    })),
  });
}
