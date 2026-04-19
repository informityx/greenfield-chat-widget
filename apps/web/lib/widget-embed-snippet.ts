/**
 * HTML snippet for embedding the chat widget (matches README / layout attributes).
 */
export function buildWidgetEmbedSnippet(input: {
  scriptOrigin: string;
  siteId: string;
  publishableKey: string;
  locale?: string;
}): string {
  const origin = input.scriptOrigin.replace(/\/$/, "");
  const locale = input.locale ?? "en";
  const siteId = escapeHtmlAttribute(input.siteId);
  const publishableKey = escapeHtmlAttribute(input.publishableKey);
  return `<script
  src="${escapeHtmlAttribute(`${origin}/widget.js`)}"
  defer
  data-site-id="${siteId}"
  data-publishable-key="${publishableKey}"
  data-locale="${escapeHtmlAttribute(locale)}"
></script>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
