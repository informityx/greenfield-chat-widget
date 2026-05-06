import OpenAI from "openai";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveSiteWithKey } from "@/lib/site";
import {
  buildRagSystemMessages,
  type RetrievedForPrompt,
} from "@/lib/rag/prompt";
import { embedTexts } from "@/lib/rag/embeddings";
import {
  retrieveSimilarChunks,
  type RetrievedChunk,
} from "@/lib/rag/retrieve";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MESSAGES = 24;

const SMALL_TALK_REDIRECT =
  "Hi there! I am here and ready to help. Ask me anything about services, AI capabilities, team extension, or getting in touch.";

const RAG_DISTANCE_GATE_FALLBACK =
  "I can’t find that in our indexed site content. I can help with our services, how we work, AI capabilities, team extension, or getting you connected with the team—what would you like to know?";

function parseRagMaxCosineDistance(): number | undefined {
  const raw = process.env.RAG_MAX_COSINE_DISTANCE?.trim();
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function applyRagDistanceGate(
  rows: RetrievedChunk[],
  maxDistance: number | undefined,
): RetrievedChunk[] {
  if (maxDistance === undefined) return rows;
  return rows.filter((r) => Number(r.distance) <= maxDistance);
}

function chunksForPrompt(rows: RetrievedChunk[]): RetrievedForPrompt[] {
  return rows.map(({ id, content, title, sourceUrl }) => ({
    id,
    content,
    title,
    sourceUrl,
  }));
}

type ChatMessage = { role: string; content: string };

type ChatBody = {
  site_id?: string;
  publishable_key?: string;
  messages?: ChatMessage[];
  session_id?: string;
};

type LeadFields = {
  fullName?: string;
  email?: string;
  phone?: string;
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

  return tail;
}

/** Snapshot of the client transcript for storage on `Ticket.chatHistory` (user + assistant only). */
function conversationToChatHistory(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Prisma.InputJsonValue {
  const rows: Array<{ role: string; content: string }> = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content.trim()) continue;
    rows.push({ role: m.role, content });
  }
  return rows;
}

/** Client messages plus this turn’s assistant reply (structured flows are not in the request body yet). */
function chatSnapshot(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  assistantReply?: string,
): Prisma.InputJsonValue {
  const base = conversationToChatHistory(messages);
  const tail = assistantReply?.trim();
  if (!tail) return base;
  const rows = Array.isArray(base) ? [...base] : [];
  rows.push({ role: "assistant", content: tail });
  return rows;
}

function getLatestUserText(messages: OpenAI.Chat.ChatCompletionMessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") {
      return m.content;
    }
  }
  return "";
}

function isSmallTalk(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 48) return false;
  const lower = t.toLowerCase();

  if (/\?/.test(t) && !/^how are you\??$/i.test(lower)) return false;

  if (
    /\b(service|services|pricing|price|quote|hire|hiring|ticket|demo|contact|email|phone|project|mvp|contract)\b/i.test(
      t,
    )
  ) {
    return false;
  }

  if (
    /^(hi|hello|hey|yo|hola|howdy|sup|'?sup|what'?s up|wassup)\b/.test(lower)
  ) {
    return true;
  }
  if (/^(thanks|thank you|thx|ty|tysm)\b/.test(lower)) return true;
  if (/^(good morning|good afternoon|good evening)\b/.test(lower)) return true;
  if (/^(cool|nice|great|awesome|sweet|lol|lmao|haha|hehe)\b/.test(lower)) {
    return true;
  }
  if (/^(nm|not much|nothing much|same old)\b/.test(lower)) return true;
  if (/^not much\b/.test(lower)) return true;
  if (/^(ok|okay|k)\s*[!.]?\s*$/i.test(lower)) return true;
  if (/^(sure)\s*[!.]?\s*$/i.test(lower)) return true;
  if (/^(aw+|aww+)\.?(\s+sweet|\s+cute)?\.?\s*$/i.test(lower)) return true;
  if (/^(love you|luv u|luv you|ily)\s*[!.]?\s*$/i.test(lower)) return true;

  return false;
}

function isContactOrMeetingIntent(text: string): boolean {
  if (
    /(contact|call|email|phone|meeting|book|schedule|consultation|demo|speak to|talk to|connect)/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(create|open|raise)\s+(a\s+)?ticket\b|\bsupport request\b|file\s+a\s+complaint/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(refund|reimburse|dispute)\b/i.test(text) &&
    /\b(help|urgent|now|contact|call|ticket|speak|talk|escalat|issue|problem)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

function wantsTicketCreation(text: string): boolean {
  return /(create|raise|open)\s+(a\s+)?ticket|ticket|support request/i.test(text);
}

function wantsDirectContactDetails(text: string): boolean {
  return /(contact number|phone number|phone|email|share contact|share details|give me details)/i.test(
    text,
  );
}

/** After we asked "ticket vs contact yourself", short affirmatives mean "create a ticket". */
function isAffirmativeTicketChoice(text: string): boolean {
  const t = text.trim();
  if (t.length > 48) return false;
  if (/^(no|nope|nah|don't|do not|cancel|stop)\b/i.test(t)) return false;
  return /^(yes|yeah|yep|sure|please|ok|okay)\b/i.test(t);
}

function wantsSelfContactChoice(text: string): boolean {
  return /(myself|on my own|I'll\s+(call|email)|I will\s+(call|email)|reach out myself|I'll\s+reach|contact (you|them) myself|just (the )?(email|phone|number))/i.test(
    text,
  );
}

const BARE_NAME_STOPWORDS = new Set([
  "yes",
  "no",
  "ok",
  "okay",
  "sure",
  "maybe",
  "thanks",
  "thank",
  "you",
  "hello",
  "hi",
  "hey",
  "help",
  "call",
  "email",
  "phone",
  "urgent",
  "refund",
  "ceo",
  "ticket",
  "sales",
  "support",
  "demo",
  "please",
]);

const BARE_NAME_SENTENCE_MARKERS =
  /\b(the|a|an|need|want|have|can|will|your|my|with|from|for|this|that|guys|team)\b/i;

function extractPhoneFromLine(line: string): string | undefined {
  const trimmed = line.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 20) return undefined;
  if (!/^[\d\s().+\-/]+$/.test(trimmed)) return undefined;
  return trimmed;
}

function extractBareNameFromLine(line: string): string | undefined {
  const t = line.trim();
  if (t.length < 2 || t.length > 60) return undefined;
  if (/@/.test(t)) return undefined;
  if (extractPhoneFromLine(t)) return undefined;
  if (BARE_NAME_SENTENCE_MARKERS.test(t)) return undefined;
  if (!/^[A-Za-z][A-Za-z\s.'-]*$/.test(t)) return undefined;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return undefined;
  if (words.length === 1 && BARE_NAME_STOPWORDS.has(t.toLowerCase())) {
    return undefined;
  }
  return t;
}

function extractLeadFieldsFromConversation(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): LeadFields {
  const userLines: string[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    const c = m.content;
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (t.length > 0) userLines.push(t);
  }

  const userTexts = userLines.join("\n");

  const emailMatch = userTexts.match(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  );

  let phone: string | undefined;
  for (let i = userLines.length - 1; i >= 0; i--) {
    const p = extractPhoneFromLine(userLines[i]!);
    if (p) {
      phone = p;
      break;
    }
  }
  if (!phone) {
    const phoneMatch = userTexts.match(
      /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}\b/,
    );
    phone = phoneMatch?.[0]?.trim();
  }

  const nameMatch = userTexts.match(
    /\b(?:my name is|i am|this is)\s+([A-Za-z][A-Za-z\s'-]{1,60})/i,
  );
  let fullName = nameMatch?.[1]?.trim();

  if (!fullName) {
    for (let i = userLines.length - 1; i >= 0; i--) {
      const n = extractBareNameFromLine(userLines[i]!);
      if (n) {
        fullName = n;
        break;
      }
    }
  }

  return {
    fullName,
    email: emailMatch?.[0]?.trim(),
    phone,
  };
}

function readTicketMeta(ticket: { metadata: unknown }): Record<string, unknown> {
  if (
    ticket.metadata &&
    typeof ticket.metadata === "object" &&
    !Array.isArray(ticket.metadata)
  ) {
    return { ...(ticket.metadata as Record<string, unknown>) };
  }
  return {};
}

function getFirstContactUserQuery(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): string | undefined {
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") {
      const t = m.content.trim();
      if (t && isContactOrMeetingIntent(t)) return t;
    }
  }
  return undefined;
}

async function findAwaitingPreferenceTicket(siteId: string, sessionId: string) {
  return prisma.ticket.findFirst({
    where: {
      siteId,
      sessionId,
      metadata: {
        path: ["awaitingPreference"],
        equals: true,
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

function leadFieldsFromTicket(ticket: {
  fullName: string | null;
  email: string | null;
  phone: string | null;
}): LeadFields {
  return {
    fullName: ticket.fullName ?? undefined,
    email: ticket.email ?? undefined,
    phone: ticket.phone ?? undefined,
  };
}

async function findContactWizardTicket(siteId: string, sessionId: string) {
  return prisma.ticket.findFirst({
    where: {
      siteId,
      sessionId,
      metadata: {
        path: ["contactWizard"],
        equals: true,
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

async function ensureContactWizardTicket(params: {
  siteId: string;
  sessionId: string;
  fields: LeadFields;
  userQuery: string;
  priority: "critical" | "high" | "medium" | "low";
  requestId: string;
  chatHistory: Prisma.InputJsonValue;
}) {
  const existing = await findContactWizardTicket(
    params.siteId,
    params.sessionId,
  );
  const metaBase: Record<string, unknown> = {
    requestId: params.requestId,
    contactWizard: true,
    initialUserQuery: params.userQuery.slice(0, 2000),
    initialPriority: params.priority,
  };

  if (existing) {
    const prev = readTicketMeta(existing);
    await prisma.ticket.update({
      where: { id: existing.id },
      data: {
        fullName: params.fields.fullName ?? existing.fullName,
        email: params.fields.email ?? existing.email,
        phone: params.fields.phone ?? existing.phone,
        chatHistory: params.chatHistory,
        metadata: {
          ...prev,
          ...metaBase,
          initialUserQuery:
            (typeof prev.initialUserQuery === "string" &&
              prev.initialUserQuery.trim()) ||
            metaBase.initialUserQuery,
          initialPriority: prev.initialPriority ?? metaBase.initialPriority,
        } as Prisma.InputJsonValue,
      },
    });
    return;
  }

  await prisma.ticket.create({
    data: {
      siteId: params.siteId,
      sessionId: params.sessionId,
      fullName: params.fields.fullName ?? null,
      email: params.fields.email ?? null,
      phone: params.fields.phone ?? null,
      type: "sales_lead",
      priority: params.priority,
      status: "in_progress",
      summary: params.userQuery.slice(0, 500),
      chatHistory: params.chatHistory,
      metadata: metaBase as Prisma.InputJsonValue,
    },
  });
}

function missingLeadFields(fields: LeadFields): string[] {
  const missing: string[] = [];
  if (!fields.fullName) missing.push("full name");
  if (!fields.email) missing.push("email");
  if (!fields.phone) missing.push("phone number");
  return missing;
}

function detectPriority(text: string): "critical" | "high" | "medium" | "low" {
  if (/(urgent|asap|immediately|outage|down|critical|blocker|emergency)/i.test(text)) {
    return "critical";
  }
  if (/(high priority|priority|soon|important)/i.test(text)) {
    return "high";
  }
  if (/(whenever|low priority|not urgent|later)/i.test(text)) {
    return "low";
  }
  return "medium";
}

async function upsertTicket(params: {
  siteId: string;
  sessionId?: string;
  fields: LeadFields;
  requestId: string;
  latestUserQuery: string;
  type: "support" | "sales_lead" | "general";
  priority: "critical" | "high" | "medium" | "low";
  status?: "open" | "in_progress" | "resolved" | "closed";
  preference?: "ticket" | "direct_contact";
  /** When set, written into ticket metadata (e.g. false to exit contact wizard). */
  contactWizard?: boolean;
  metadataExtras?: Record<string, unknown>;
  /** Full transcript snapshot; replaces prior `chatHistory` when set. */
  chatHistory?: Prisma.InputJsonValue;
}) {
  const {
    siteId,
    sessionId,
    fields,
    requestId,
    latestUserQuery,
    type,
    priority,
    status = "open",
    preference,
    contactWizard,
    metadataExtras,
    chatHistory,
  } = params;
  const fullName = fields.fullName ?? null;
  const email = fields.email ?? null;
  const phone = fields.phone ?? null;

  const existing =
    (sessionId
      ? await prisma.ticket.findFirst({
          where: { siteId, sessionId },
          orderBy: { createdAt: "desc" },
        })
      : null) ??
    (email
      ? await prisma.ticket.findFirst({
          where: { siteId, email },
          orderBy: { createdAt: "desc" },
        })
      : null);

  if (existing) {
    await prisma.ticket.update({
      where: { id: existing.id },
      data: {
        fullName: fullName ?? existing.fullName,
        email: email ?? existing.email,
        phone: phone ?? existing.phone,
        type,
        priority,
        status,
        summary: latestUserQuery.slice(0, 500),
        ...(chatHistory === undefined ? {} : { chatHistory }),
        metadata: {
          ...(typeof existing.metadata === "object" && existing.metadata
            ? (existing.metadata as object)
            : {}),
          requestId,
          latestUserQuery,
          ...(preference ? { preference } : {}),
          ...(contactWizard === undefined ? {} : { contactWizard }),
          ...(metadataExtras ?? {}),
        },
      },
    });
    return existing.id;
  }

  const created = await prisma.ticket.create({
    data: {
      siteId,
      sessionId: sessionId ?? null,
      fullName,
      email,
      phone,
      type,
      priority,
      status,
      summary: latestUserQuery.slice(0, 500),
      ...(chatHistory === undefined ? {} : { chatHistory }),
      metadata: {
        requestId,
        latestUserQuery,
        ...(preference ? { preference } : {}),
        ...(contactWizard === undefined ? {} : { contactWizard }),
        ...(metadataExtras ?? {}),
      },
    },
  });
  return created.id;
}

async function respondAfterContactCapture(params: {
  siteId: string;
  sessionId?: string;
  fields: LeadFields;
  userQuery: string;
  requestId: string;
  priority: "critical" | "high" | "medium" | "low";
  cors: HeadersInit;
  conversation: OpenAI.Chat.ChatCompletionMessageParam[];
}): Promise<Response> {
  const { siteId, sessionId, fields, userQuery, requestId, priority, cors, conversation } =
    params;

  const wantsTicket = wantsTicketCreation(userQuery);
  const wantsDirect = wantsDirectContactDetails(userQuery);

  await upsertTicket({
    siteId,
    sessionId,
    fields,
    requestId,
    latestUserQuery: userQuery,
    type: "sales_lead",
    priority,
    status: "open",
    contactWizard: false,
    chatHistory:
      wantsTicket || wantsDirect
        ? conversationToChatHistory(conversation)
        : chatSnapshot(
            conversation,
            "Thanks, I have your details. Would you like to contact the team yourself (I can share email/phone), or should I create a ticket for you?",
          ),
    metadataExtras: {
      awaitingPreference: !(wantsTicket || wantsDirect),
    },
  });

  if (wantsTicket) {
    await upsertTicket({
      siteId,
      sessionId,
      fields,
      requestId,
      latestUserQuery: userQuery,
      type: "support",
      priority,
      status: "open",
      preference: "ticket",
      contactWizard: false,
      chatHistory: chatSnapshot(
        conversation,
        "Perfect, I have created your request ticket and our team will reach out shortly using your contact details. If you want, I can also share direct contact details now.",
      ),
      metadataExtras: { awaitingPreference: false },
    });
    return sseTextResponse(
      "Perfect, I have created your request ticket and our team will reach out shortly using your contact details. If you want, I can also share direct contact details now.",
      cors,
    );
  }

  if (wantsDirect) {
    await upsertTicket({
      siteId,
      sessionId,
      fields,
      requestId,
      latestUserQuery: userQuery,
      type: "sales_lead",
      priority,
      status: "open",
      preference: "direct_contact",
      contactWizard: false,
      chatHistory: chatSnapshot(
        conversation,
        "Great, thanks for sharing your details. You can contact the team at info@informityx.ai or +1 800-88220-333. Would you like me to also create a ticket for you?",
      ),
      metadataExtras: { awaitingPreference: false },
    });
    return sseTextResponse(
      "Great, thanks for sharing your details. You can contact the team at info@informityx.ai or +1 800-88220-333. Would you like me to also create a ticket for you?",
      cors,
    );
  }

  return sseTextResponse(
    "Thanks, I have your details. Would you like to contact the team yourself (I can share email/phone), or should I create a ticket for you?",
    cors,
  );
}

function sseTextResponse(
  text: string,
  headers: HeadersInit,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ text })}\n\n`),
      );
      controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...headers,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  const siteId = url.searchParams.get("site_id") ?? undefined;
  const publishableKey = url.searchParams.get("publishable_key") ?? undefined;
  const resolved = await resolveSiteWithKey(siteId, publishableKey);

  if (!resolved.ok) {
    return new NextResponse(null, { status: 204 });
  }

  const headers = getCorsHeaders(origin, resolved.data.allowedOrigins);
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(req: Request) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const origin = req.headers.get("origin");
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = new URL(req.url);
  const siteId = body.site_id ?? url.searchParams.get("site_id") ?? undefined;
  const publishableKey =
    body.publishable_key ?? url.searchParams.get("publishable_key") ?? undefined;

  const resolved = await resolveSiteWithKey(siteId, publishableKey);
  if (!resolved.ok) {
    const status = resolved.status === 404 ? 404 : 401;
    return NextResponse.json(
      { error: "Invalid site_id or publishable_key" },
      { status },
    );
  }

  const { site, allowedOrigins } = resolved.data;

  if (origin && !allowedOrigins.includes(origin)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const chatModel = process.env.CHAT_MODEL?.trim() || "gpt-4o-mini";
  const embeddingModel =
    process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
  const topK = Math.min(
    25,
    Math.max(1, Number.parseInt(process.env.RAG_TOP_K ?? "8", 10) || 8),
  );

  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: OPENAI_API_KEY is not set" },
      { status: 503 },
    );
  }

  const conversation = buildChatMessages(body.messages);
  if (!conversation) {
    return NextResponse.json(
      { error: "messages must include at least one non-empty user turn" },
      { status: 400 },
    );
  }

  const userQuery = getLatestUserText(conversation);
  const sessionId =
    typeof body.session_id === "string" && body.session_id.trim().length > 0
      ? body.session_id.trim()
      : undefined;
  const cors = getCorsHeaders(origin, allowedOrigins);

  if (sessionId) {
    const wizardTicket = await findContactWizardTicket(site.id, sessionId);
    if (wizardTicket) {
      const dbFields: LeadFields = {
        fullName: wizardTicket.fullName ?? undefined,
        email: wizardTicket.email ?? undefined,
        phone: wizardTicket.phone ?? undefined,
      };
      const extracted = extractLeadFieldsFromConversation(conversation);
      const fields: LeadFields = {
        fullName: extracted.fullName ?? dbFields.fullName,
        email: extracted.email ?? dbFields.email,
        phone: extracted.phone ?? dbFields.phone,
      };
      const missing = missingLeadFields(fields);
      const meta = readTicketMeta(wizardTicket);
      const initialQuery =
        (typeof meta.initialUserQuery === "string" &&
          meta.initialUserQuery.trim()) ||
        getFirstContactUserQuery(conversation) ||
        userQuery;

      if (missing.length > 0) {
        await prisma.ticket.update({
          where: { id: wizardTicket.id },
          data: {
            fullName: fields.fullName ?? null,
            email: fields.email ?? null,
            phone: fields.phone ?? null,
            chatHistory: chatSnapshot(
              conversation,
              `Thanks — I still need your ${missing.join(", ")}.`,
            ),
            metadata: {
              ...meta,
              contactWizard: true,
              requestId,
              latestUserQuery: userQuery,
            } as Prisma.InputJsonValue,
          },
        });
        return sseTextResponse(
          `Thanks — I still need your ${missing.join(", ")}.`,
          cors,
        );
      }

      const priorityRaw = meta.initialPriority;
      const priority =
        priorityRaw === "critical" ||
        priorityRaw === "high" ||
        priorityRaw === "medium" ||
        priorityRaw === "low"
          ? priorityRaw
          : detectPriority(initialQuery);

      return respondAfterContactCapture({
        siteId: site.id,
        sessionId,
        fields,
        userQuery,
        requestId,
        priority,
        cors,
        conversation,
      });
    }
  }

  if (sessionId) {
    const prefTicket = await findAwaitingPreferenceTicket(site.id, sessionId);
    if (prefTicket) {
      const fields = leadFieldsFromTicket(prefTicket);
      if (missingLeadFields(fields).length > 0) {
        return sseTextResponse(
          "I still need your full name, email, and phone number before I can open a ticket or share direct contact details.",
          cors,
        );
      }
      const priority = prefTicket.priority;
      const wantsTicket = wantsTicketCreation(userQuery);
      const wantsDirect =
        wantsDirectContactDetails(userQuery) || wantsSelfContactChoice(userQuery);

      if (wantsDirect && !wantsTicket) {
        await upsertTicket({
          siteId: site.id,
          sessionId,
          fields,
          requestId,
          latestUserQuery: userQuery,
          type: "sales_lead",
          priority,
          status: "open",
          preference: "direct_contact",
          contactWizard: false,
          chatHistory: chatSnapshot(
            conversation,
            "Great — you can contact the team at info@informityx.ai or +1 800-88220-333. If you would like a ticket as well, say “create a ticket”.",
          ),
          metadataExtras: { awaitingPreference: false },
        });
        return sseTextResponse(
          "Great — you can contact the team at info@informityx.ai or +1 800-88220-333. If you would like a ticket as well, say “create a ticket”.",
          cors,
        );
      }

      if (wantsTicket || isAffirmativeTicketChoice(userQuery)) {
        await upsertTicket({
          siteId: site.id,
          sessionId,
          fields,
          requestId,
          latestUserQuery: userQuery,
          type: "support",
          priority,
          status: "open",
          preference: "ticket",
          contactWizard: false,
          chatHistory: chatSnapshot(
            conversation,
            "Perfect, I have created your request ticket and our team will reach out shortly using your contact details. If you want, I can also share direct contact details now.",
          ),
          metadataExtras: { awaitingPreference: false },
        });
        return sseTextResponse(
          "Perfect, I have created your request ticket and our team will reach out shortly using your contact details. If you want, I can also share direct contact details now.",
          cors,
        );
      }

      await prisma.ticket.update({
        where: { id: prefTicket.id },
        data: {
          chatHistory: chatSnapshot(
            conversation,
            "Just to confirm: should I create a ticket for our team to follow up, or would you prefer our email and phone so you can reach out yourself?",
          ),
        },
      });
      return sseTextResponse(
        "Just to confirm: should I create a ticket for our team to follow up, or would you prefer our email and phone so you can reach out yourself?",
        cors,
      );
    }
  }

  if (isSmallTalk(userQuery)) {
    return sseTextResponse(SMALL_TALK_REDIRECT, cors);
  }

  if (isContactOrMeetingIntent(userQuery)) {
    const fields = extractLeadFieldsFromConversation(conversation);
    const missing = missingLeadFields(fields);
    const priority = detectPriority(userQuery);

    if (missing.length > 0) {
      if (sessionId) {
        await ensureContactWizardTicket({
          siteId: site.id,
          sessionId,
          fields,
          userQuery,
          priority,
          requestId,
          chatHistory: chatSnapshot(
            conversation,
            `Happy to help you connect. Before we proceed, please share your ${missing.join(", ")}.`,
          ),
        });
      }
      return sseTextResponse(
        `Happy to help you connect. Before we proceed, please share your ${missing.join(", ")}.`,
        cors,
      );
    }

    return respondAfterContactCapture({
      siteId: site.id,
      sessionId,
      fields,
      userQuery,
      requestId,
      priority,
      cors,
      conversation,
    });
  }

  const openai = new OpenAI({ apiKey });
  const encoder = new TextEncoder();
  const ragMaxCosineDistance = parseRagMaxCosineDistance();

  let retrievedRaw: RetrievedChunk[];
  try {
    const [queryEmbedding] = await embedTexts(openai, embeddingModel, [
      userQuery,
    ]);
    retrievedRaw = await retrieveSimilarChunks(
      prisma,
      site.id,
      queryEmbedding,
      topK,
    );
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Embedding or retrieval failed";
    console.log(JSON.stringify({ level: "error", requestId, msg }));
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const filteredByDistance = applyRagDistanceGate(
    retrievedRaw,
    ragMaxCosineDistance,
  );

  console.log(
    JSON.stringify({
      level: "info",
      requestId,
      siteId: site.siteId,
      retrievalCount: retrievedRaw.length,
      retrievalAfterDistanceFilter: filteredByDistance.length,
      ragMaxCosineDistance: ragMaxCosineDistance ?? null,
      bestDistance: retrievedRaw[0]?.distance ?? null,
      bestDistanceAfterFilter: filteredByDistance[0]?.distance ?? null,
      chatModel,
      embeddingModel,
    }),
  );

  if (
    ragMaxCosineDistance !== undefined &&
    retrievedRaw.length > 0 &&
    filteredByDistance.length === 0
  ) {
    return sseTextResponse(RAG_DISTANCE_GATE_FALLBACK, cors);
  }

  const retrievedForPrompt = chunksForPrompt(filteredByDistance);
  const contextLooksWeak = retrievedForPrompt.length === 0;

  const uniqueCitations = new Map<
    string,
    { chunkId: string; title: string | null; sourceUrl: string | null }
  >();
  for (const r of filteredByDistance) {
    const key = `${r.sourceUrl ?? ""}|${r.title ?? ""}`;
    if (!uniqueCitations.has(key)) {
      uniqueCitations.set(key, {
        chunkId: r.id,
        title: r.title,
        sourceUrl: r.sourceUrl,
      });
    }
  }
  const citationsPayload = {
    citations: [...uniqueCitations.values()],
  };

  const { messages: ragMessages } = buildRagSystemMessages({
    conversation,
    retrieved: retrievedForPrompt,
    contextLooksWeak,
  });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const completion = await openai.chat.completions.create({
          model: chatModel,
          messages: ragMessages,
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

        controller.enqueue(
          encoder.encode(
            `event: citations\ndata: ${JSON.stringify(citationsPayload)}\n\n`,
          ),
        );
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
