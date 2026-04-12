import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Phase A/C interim: hardcoded tenant; replace with DB `Site` lookup. */
const DEMO_TENANTS: Record<
  string,
  { publishableKey: string; allowedOrigins: string[] }
> = {
  "demo-site": {
    publishableKey: "pk_test_demo",
    allowedOrigins: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://theexpertways.com",
      "https://www.theexpertways.com",
      "https://informityx.com",
      "https://www.informityx.com",
    ],
  },
};

const MAX_MESSAGES = 24;

type ChatMessage = { role: string; content: string };

type ChatBody = {
  site_id?: string;
  publishable_key?: string;
  messages?: ChatMessage[];
  session_id?: string;
};

function getCorsHeaders(origin: string | null, allowed: string[]): HeadersInit {
  const allow =
    origin && allowed.includes(origin) ? origin : allowed[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function buildChatMessages(
  incoming: ChatMessage[] | undefined,
): OpenAI.Chat.ChatCompletionMessageParam[] | null {
  if (!incoming?.length) return null;

  const roles = new Set(["system", "user", "assistant"]);
  const mapped: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (const m of incoming) {
    if (!roles.has(m.role)) continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content.trim() && m.role !== "assistant") continue;
    mapped.push({
      role: m.role as "system" | "user" | "assistant",
      content,
    });
  }

  const tail = mapped.slice(-MAX_MESSAGES);
  if (!tail.some((m) => m.role === "user")) return null;

  const hasSystem = tail.some((m) => m.role === "system");
  if (hasSystem) return tail;

  return [
    {
      role: "system",
      content:
        "You are a helpful assistant. Be concise and clear. If you do not know something, say so.",
    },
    ...tail,
  ];
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  const tenant = DEMO_TENANTS["demo-site"];
  const headers = getCorsHeaders(origin, tenant.allowedOrigins);
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const siteId = body.site_id;
  const key = body.publishable_key;
  const tenant = siteId ? DEMO_TENANTS[siteId] : undefined;

  if (!tenant || !key || tenant.publishableKey !== key) {
    return NextResponse.json(
      { error: "Invalid site_id or publishable_key" },
      { status: 401 },
    );
  }

  if (origin && !tenant.allowedOrigins.includes(origin)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const chatModel =
    process.env.CHAT_MODEL?.trim() || "gpt-4o-mini";

  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: OPENAI_API_KEY is not set" },
      { status: 503 },
    );
  }

  const messages = buildChatMessages(body.messages);
  if (!messages) {
    return NextResponse.json(
      { error: "messages must include at least one non-empty user turn" },
      { status: 400 },
    );
  }

  const cors = getCorsHeaders(origin, tenant.allowedOrigins);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const client = new OpenAI({ apiKey });
        const completion = await client.chat.completions.create({
          model: chatModel,
          messages,
          stream: true,
        });

        for await (const part of completion) {
          const token = part.choices[0]?.delta?.content ?? "";
          if (token) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ text: token })}\n\n`,
              ),
            );
          }
        }

        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Unexpected error calling OpenAI";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ text: `\n\n[Error] ${msg}` })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...cors,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
