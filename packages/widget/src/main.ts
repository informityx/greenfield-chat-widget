/**
 * Embeddable chat widget (Phase A).
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

function mount(): void {
  const script = getCurrentScript();
  if (!script) return;

  const siteId = script.getAttribute(ATTR.siteId)?.trim();
  const publishableKey = script.getAttribute(ATTR.publishableKey)?.trim();
  const locale = script.getAttribute(ATTR.locale)?.trim() || "en";
  if (!siteId || !publishableKey) return;

  const base = apiBaseFromScript(script);
  if (!base) return;

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
  panel.hidden = true;
  Object.assign(panel.style, {
    position: "absolute",
    bottom: "52px",
    right: "0",
    width: "min(360px, calc(100vw - 32px))",
    maxHeight: "min(420px, 50vh)",
    display: "flex",
    flexDirection: "column",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
    background: "#fff",
    border: "1px solid #e5e7eb",
    overflow: "hidden",
  } as CSSStyleDeclaration);

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
  launcher.setAttribute("aria-label", "Open chat");
  launcher.textContent = "Chat";
  Object.assign(launcher.style, {
    padding: "12px 16px",
    borderRadius: "999px",
    border: "none",
    background: "#059669",
    color: "#fff",
    fontWeight: "600",
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(5,150,105,0.35)",
  } as CSSStyleDeclaration);

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

  async function streamChat(userText: string): Promise<void> {
    const assistantEl = document.createElement("div");
    assistantEl.textContent = "";
    Object.assign(assistantEl.style, {
      marginBottom: "8px",
      padding: "8px 10px",
      borderRadius: "10px",
      maxWidth: "90%",
      background: "#f3f4f6",
      color: "#111827",
      whiteSpace: "pre-wrap",
    } as CSSStyleDeclaration);
    log.appendChild(assistantEl);
    log.scrollTop = log.scrollHeight;

    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_id: siteId,
        publishable_key: publishableKey,
        messages: [{ role: "user", content: userText }],
      }),
    });

    if (!res.ok || !res.body) {
      assistantEl.textContent = "Could not reach assistant.";
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const payload = JSON.parse(line.slice(6)) as { text?: string };
            if (payload.text) assistantEl.textContent += payload.text;
          } catch {
            /* ignore */
          }
        }
      }
      log.scrollTop = log.scrollHeight;
    }
  }

  launcher.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    launcher.setAttribute("aria-expanded", String(!panel.hidden));
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    appendBubble(text, "user");
    void streamChat(text);
  });

  form.append(input, send);
  panel.append(log, form);
  root.append(panel, launcher);
  document.body.appendChild(root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
