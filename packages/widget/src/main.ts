/**
 * Embeddable chat widget (Phase B: SSE text + citations event).
 *
 * Expected script tag attributes (see docs/PROJECT_BOOTSTRAP_SPEC.md §7):
 * - data-site-id
 * - data-publishable-key
 * - data-locale (optional)
 */

const ATTR = {
  siteId: "data-site-id",
  publishableKey: "data-publishable-key",
  locale: "data-locale",
} as const;

function getCurrentScript(): HTMLScriptElement | null {
  const scripts = document.querySelectorAll("script[data-site-id][data-publishable-key]");
  return scripts[scripts.length - 1] as HTMLScriptElement | null;
}

function apiBaseFromScript(script: HTMLScriptElement): string {
  try {
    const u = new URL(script.src);
    return `${u.origin}`;
  } catch {
    return "";
  }
}

const MAX_TRANSCRIPT_MESSAGES = 24;

type TranscriptMessage = { role: "user" | "assistant"; content: string };

function transcriptStorageKey(siteId: string): string {
  return `greenfield-chat-transcript:${siteId}`;
}

function sessionStorageKey(siteId: string): string {
  return `greenfield-chat-session:${siteId}`;
}

function loadTranscript(siteId: string): TranscriptMessage[] {
  try {
    const raw = sessionStorage.getItem(transcriptStorageKey(siteId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: TranscriptMessage[] = [];
    for (const m of parsed) {
      if (
        m &&
        typeof m === "object" &&
        (m as { role?: string }).role === "user" &&
        typeof (m as { content?: string }).content === "string"
      ) {
        out.push({ role: "user", content: (m as { content: string }).content });
      } else if (
        m &&
        typeof m === "object" &&
        (m as { role?: string }).role === "assistant" &&
        typeof (m as { content?: string }).content === "string"
      ) {
        out.push({
          role: "assistant",
          content: (m as { content: string }).content,
        });
      }
    }
    return out.slice(-MAX_TRANSCRIPT_MESSAGES);
  } catch {
    return [];
  }
}

function saveTranscript(siteId: string, messages: TranscriptMessage[]): void {
  try {
    sessionStorage.setItem(
      transcriptStorageKey(siteId),
      JSON.stringify(messages.slice(-MAX_TRANSCRIPT_MESSAGES)),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

function getOrCreateSessionId(siteId: string): string {
  try {
    const key = sessionStorageKey(siteId);
    let id = localStorage.getItem(key)?.trim();
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

/** Clears transcript + server session id for this site in the browser (used on intentional disconnect). */
function clearStoredChatSession(siteId: string): void {
  try {
    sessionStorage.removeItem(transcriptStorageKey(siteId));
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(sessionStorageKey(siteId));
  } catch {
    /* ignore */
  }
}

const LAUNCHER_ARIA = "Need help? Chat with our agent now!";

function mount(): void {
  const script = getCurrentScript();
  if (!script) return;

  const siteId = script.getAttribute(ATTR.siteId)?.trim();
  const publishableKey = script.getAttribute(ATTR.publishableKey)?.trim();
  const locale = script.getAttribute(ATTR.locale)?.trim() || "en";
  if (!siteId || !publishableKey) return;

  const base = apiBaseFromScript(script);
  if (!base) return;

  let sessionId = getOrCreateSessionId(siteId);
  let transcript = loadTranscript(siteId);

  const root = document.createElement("div");
  root.id = "greenfield-chat-widget-root";
  root.setAttribute("data-locale", locale);
  Object.assign(root.style, {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    zIndex: "2147483646",
    fontFamily: "system-ui, sans-serif",
  } as CSSStyleDeclaration);

  const panel = document.createElement("div");
  /** Closed by default. Do not use `[hidden]` alone: inline `display:flex` would override it in the cascade. */
  Object.assign(panel.style, {
    position: "absolute",
    bottom: "76px",
    right: "0",
    width: "min(460px, calc(100vw - 24px))",
    maxHeight: "min(620px, 72vh)",
    display: "none",
    flexDirection: "column",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
    background: "#fff",
    border: "1px solid #e5e7eb",
    overflow: "hidden",
  } as CSSStyleDeclaration);

  const panelHero = document.createElement("div");
  Object.assign(panelHero.style, {
    flexShrink: "0",
    background: "linear-gradient(180deg, #fb923c 0%, #ea580c 100%)",
    padding: "14px 12px 16px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.22)",
  } as CSSStyleDeclaration);

  const heroTopRow = document.createElement("div");
  Object.assign(heroTopRow.style, {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  } as CSSStyleDeclaration);

  const heroLeft = document.createElement("div");
  Object.assign(heroLeft.style, {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "12px",
    minWidth: "0",
    flex: "1",
  } as CSSStyleDeclaration);

  const heroIcon = document.createElement("img");
  heroIcon.src = `${base}/help-operator.svg`;
  heroIcon.alt = "";
  heroIcon.setAttribute("aria-hidden", "true");
  Object.assign(heroIcon.style, {
    width: "44px",
    height: "44px",
    flexShrink: "0",
    objectFit: "contain",
    filter: "brightness(0) invert(1)",
  } as CSSStyleDeclaration);

  const helloEl = document.createElement("div");
  helloEl.textContent = "Hello,";
  Object.assign(helloEl.style, {
    fontSize: "26px",
    fontWeight: "700",
    color: "#fff",
    lineHeight: "1.15",
  } as CSSStyleDeclaration);

  heroLeft.append(heroIcon, helloEl);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close chat");
  closeBtn.textContent = "×";
  Object.assign(closeBtn.style, {
    border: "none",
    background: "transparent",
    color: "#fff",
    fontSize: "24px",
    lineHeight: "1",
    cursor: "pointer",
    padding: "4px 6px",
    flexShrink: "0",
    alignSelf: "flex-start",
    opacity: "0.95",
  } as CSSStyleDeclaration);

  heroTopRow.append(heroLeft, closeBtn);

  const welcomeEl = document.createElement("div");
  welcomeEl.textContent =
    "Welcome to our website, book a call, or inquire about our services!";
  Object.assign(welcomeEl.style, {
    marginTop: "10px",
    fontSize: "14px",
    fontWeight: "500",
    color: "rgba(255,255,255,0.96)",
    lineHeight: "1.45",
    paddingRight: "8px",
  } as CSSStyleDeclaration);

  panelHero.append(heroTopRow, welcomeEl);

  const log = document.createElement("div");
  Object.assign(log.style, {
    flex: "1",
    overflow: "auto",
    padding: "12px",
    fontSize: "14px",
    lineHeight: "1.45",
    color: "#111827",
  } as CSSStyleDeclaration);

  const form = document.createElement("form");
  Object.assign(form.style, {
    display: "flex",
    gap: "8px",
    padding: "8px",
    borderTop: "1px solid #e5e7eb",
  } as CSSStyleDeclaration);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Message…";
  input.autocomplete = "off";
  Object.assign(input.style, {
    flex: "1",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    fontSize: "14px",
    color: "#111827",
    background: "#ffffff",
  } as CSSStyleDeclaration);

  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = "Send";
  Object.assign(send.style, {
    padding: "8px 12px",
    borderRadius: "8px",
    border: "none",
    background: "#059669",
    color: "#fff",
    fontWeight: "600",
    cursor: "pointer",
  } as CSSStyleDeclaration);

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.setAttribute("aria-label", LAUNCHER_ARIA);

  const launcherIcon = document.createElement("img");
  launcherIcon.src = `${base}/help-operator.svg`;
  launcherIcon.alt = "";
  launcherIcon.setAttribute("aria-hidden", "true");
  Object.assign(launcherIcon.style, {
    width: "38px",
    height: "38px",
    flexShrink: "0",
    objectFit: "contain",
    filter: "brightness(0) invert(1)",
  } as CSSStyleDeclaration);

  const launcherTexts = document.createElement("span");
  Object.assign(launcherTexts.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    textAlign: "left",
    minWidth: "0",
  } as CSSStyleDeclaration);

  const launcherLine1 = document.createElement("span");
  launcherLine1.textContent = "Need help?";
  Object.assign(launcherLine1.style, {
    display: "block",
    fontWeight: "700",
  } as CSSStyleDeclaration);

  const launcherLine2 = document.createElement("span");
  launcherLine2.textContent = "Chat with our agent now!";
  Object.assign(launcherLine2.style, {
    display: "block",
    fontWeight: "600",
    marginTop: "2px",
  } as CSSStyleDeclaration);

  launcherTexts.append(launcherLine1, launcherLine2);
  launcher.append(launcherIcon, launcherTexts);

  Object.assign(launcher.style, {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: "10px",
    padding: "14px 45px",
    borderRadius: "999px",
    border: "none",
    background: "#059669",
    color: "#fff",
    fontWeight: "600",
    fontSize: "16.8px",
    lineHeight: "1.2",
    whiteSpace: "normal",
    maxWidth: "min(340px, calc(100vw - 40px))",
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(5,150,105,0.35)",
  } as CSSStyleDeclaration);

  function setPanelOpen(open: boolean): void {
    panel.style.display = open ? "flex" : "none";
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    launcher.setAttribute("aria-expanded", String(open));
  }

  setPanelOpen(false);

  function appendBubble(text: string, from: "user" | "assistant"): void {
    const b = document.createElement("div");
    b.textContent = text;
    Object.assign(b.style, {
      marginBottom: "8px",
      padding: "8px 10px",
      borderRadius: "10px",
      maxWidth: "90%",
      marginLeft: from === "user" ? "auto" : "0",
      background: from === "user" ? "#d1fae5" : "#f3f4f6",
      color: "#111827",
    } as CSSStyleDeclaration);
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
  }

  for (const m of transcript) {
    if (m.role === "user") {
      appendBubble(m.content, "user");
    } else {
      appendBubble(m.content, "assistant");
    }
  }

  function appendInlineFormatted(target: HTMLElement, text: string): void {
    const re = /\*\*(.+?)\*\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        target.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      const strong = document.createElement("strong");
      strong.textContent = m[1] ?? "";
      target.appendChild(strong);
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      target.appendChild(document.createTextNode(text.slice(last)));
    }
  }

  function renderAssistantFormatted(target: HTMLElement, raw: string): void {
    target.textContent = "";
    const lines = raw.split("\n").map((l) => l.trimEnd());
    const bulletLines = lines.filter((l) => l.trim().startsWith("- "));

    // If there are bullet-style lines, render them as an actual list.
    if (bulletLines.length > 0) {
      const firstBulletIdx = lines.findIndex((l) => l.trim().startsWith("- "));
      let lastBulletIdx = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]?.trim().startsWith("- ")) {
          lastBulletIdx = i;
          break;
        }
      }

      const before = lines
        .slice(0, Math.max(0, firstBulletIdx))
        .filter((l) => l.trim().length > 0);
      const after = lines
        .slice(lastBulletIdx + 1)
        .filter((l) => l.trim().length > 0);

      if (before.length > 0) {
        const intro = document.createElement("div");
        intro.style.marginBottom = "8px";
        appendInlineFormatted(intro, before.join(" "));
        target.appendChild(intro);
      }

      const ul = document.createElement("ul");
      Object.assign(ul.style, {
        margin: "0 0 8px",
        paddingLeft: "20px",
      } as CSSStyleDeclaration);

      for (const line of bulletLines) {
        const li = document.createElement("li");
        li.style.marginBottom = "4px";
        appendInlineFormatted(li, line.trim().slice(2));
        ul.appendChild(li);
      }
      target.appendChild(ul);

      if (after.length > 0) {
        const outro = document.createElement("div");
        appendInlineFormatted(outro, after.join(" "));
        target.appendChild(outro);
      }
      return;
    }

    appendInlineFormatted(target, raw);
  }

  async function streamChat(messages: TranscriptMessage[]): Promise<void> {
    const turn = document.createElement("div");
    Object.assign(turn.style, { marginBottom: "10px", maxWidth: "100%" });

    const assistantEl = document.createElement("div");
    assistantEl.textContent = "";
    Object.assign(assistantEl.style, {
      padding: "8px 10px",
      borderRadius: "10px",
      maxWidth: "90%",
      background: "#f3f4f6",
      color: "#111827",
      whiteSpace: "pre-wrap",
    } as CSSStyleDeclaration);

    turn.append(assistantEl);
    log.appendChild(turn);
    log.scrollTop = log.scrollHeight;

    const typingEl = document.createElement("div");
    typingEl.textContent = "Typing";
    Object.assign(typingEl.style, {
      marginTop: "6px",
      marginLeft: "4px",
      fontSize: "12px",
      color: "#6b7280",
    } as CSSStyleDeclaration);
    turn.appendChild(typingEl);

    let typingTick = 0;
    const typingTimer = setInterval(() => {
      typingTick = (typingTick + 1) % 4;
      typingEl.textContent = `Typing${".".repeat(typingTick)}`;
    }, 350);

    function stopTypingIndicator(): void {
      clearInterval(typingTimer);
      if (typingEl.parentElement) typingEl.remove();
    }

    const chatUrl = new URL(`${base}/api/chat`);
    chatUrl.searchParams.set("site_id", siteId);
    chatUrl.searchParams.set("publishable_key", publishableKey);

    const res = await fetch(chatUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        session_id: sessionId,
      }),
    });

    if (!res.ok || !res.body) {
      stopTypingIndicator();
      assistantEl.textContent = "Could not reach assistant.";
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let sseEvent = "";

    let assistantRaw = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          sseEvent = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data: ")) {
          try {
            const payload = JSON.parse(line.slice(6)) as {
              text?: string;
              citations?: unknown;
            };
            if (sseEvent === "citations") {
              // Intentionally hidden from UI for now.
            } else if (payload.text) {
              stopTypingIndicator();
              assistantRaw += payload.text;
              renderAssistantFormatted(assistantEl, assistantRaw);
            }
          } catch {
            /* ignore */
          }
          sseEvent = "";
        }
      }
      log.scrollTop = log.scrollHeight;
    }

    stopTypingIndicator();

    const trimmed = assistantRaw.trim();
    if (trimmed.length > 0) {
      transcript.push({ role: "assistant", content: trimmed });
      saveTranscript(siteId, transcript);
    }
  }

  launcher.addEventListener("click", () => {
    setPanelOpen(panel.style.display === "none");
  });

  closeBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const ok = window.confirm(
      "Are you sure you want to disconnect from chat? Your conversation in this browser will be cleared.",
    );
    if (!ok) return;
    clearStoredChatSession(siteId);
    transcript = [];
    sessionId = getOrCreateSessionId(siteId);
    log.replaceChildren();
    setPanelOpen(false);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    transcript.push({ role: "user", content: text });
    saveTranscript(siteId, transcript);
    appendBubble(text, "user");
    void streamChat(transcript);
  });

  form.append(input, send);
  panel.append(panelHero, log, form);
  root.append(panel, launcher);
  document.body.appendChild(root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
