import { createMemo } from "solid-js";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

function sanitizeHtml(html) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true }
  });
}

export function IssueMarkdown(props) {
  const html = createMemo(() => {
    const raw = props.markdown || "";
    if (!String(raw).trim()) {
      return "";
    }
    return sanitizeHtml(marked.parse(String(raw)));
  });

  return <div class="issue-md-preview" innerHTML={html()} />;
}
