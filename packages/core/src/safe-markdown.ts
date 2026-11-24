// T24、S-08：AI 與網頁內容的 Markdown 解析。
// 不解析 HTML：所有標籤都是文字，由 React 轉義後呈現。只支援標題、段落、清單、粗體、斜體、行內程式碼與連結；
// 連結只允許 https（不含帳號密碼），其他連結只留文字；圖片語法只留替代文字（S-16）。

export type MdInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "link"; href: string; children: MdInline[] };

export type MdBlock =
  | { type: "heading"; level: number; children: MdInline[] }
  | { type: "paragraph"; children: MdInline[] }
  | { type: "list"; ordered: boolean; items: MdInline[][] };

const MAX_SOURCE_CHARS = 20_000;
const MAX_DEPTH = 6;
const MAX_URL_LENGTH = 2048;
// 前一個字元是引號或等號時不自動轉為連結
const QUOTE_OR_EQUALS = /["'=]/;
const BARE_HTTPS = /^https:\/\/[^\s<>"'）)\]]+/i;

export function safeHttpsUrl(raw: string): string | null {
  if (raw.length > MAX_URL_LENGTH || !/^https:\/\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "") return null;
  return url.href;
}

function pushText(out: MdInline[], text: string) {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last?.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

// 「[文字](網址)」：網址可含成對括號，不可含空白
function readBracketLink(s: string, start: number): { label: string; url: string; end: number } | null {
  const close = s.indexOf("]", start + 1);
  if (close === -1 || s[close + 1] !== "(") return null;
  let depth = 1;
  let i = close + 2;
  for (; i < s.length && depth > 0; i++) {
    const ch = s[i];
    if (ch === " " || ch === "\n" || ch === "\t") return null;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
  }
  if (depth !== 0) return null;
  return { label: s.slice(start + 1, close), url: s.slice(close + 2, i - 1), end: i };
}

function parseInline(s: string, depth: number): MdInline[] {
  const out: MdInline[] = [];
  if (depth > MAX_DEPTH) {
    pushText(out, s);
    return out;
  }
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ type: "code", text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (ch === "!" && s[i + 1] === "[") {
      const link = readBracketLink(s, i + 1);
      if (link) {
        pushText(out, link.label);
        i = link.end;
        continue;
      }
    } else if (ch === "[") {
      const link = readBracketLink(s, i);
      if (link) {
        const href = safeHttpsUrl(link.url);
        if (href) out.push({ type: "link", href, children: [{ type: "text", text: link.label }] });
        else pushText(out, link.label);
        i = link.end;
        continue;
      }
    } else if (ch === "*" && s[i + 1] === "*") {
      const end = s.indexOf("**", i + 2);
      if (end > i + 2) {
        out.push({ type: "strong", children: parseInline(s.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    } else if (ch === "*") {
      const end = s.indexOf("*", i + 1);
      if (end > i + 1) {
        out.push({ type: "em", children: parseInline(s.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    } else if ((ch === "h" || ch === "H") && !QUOTE_OR_EQUALS.test(s[i - 1] ?? "") && BARE_HTTPS.test(s.slice(i, i + 9))) {
      // 屬性值裡的網址（例如 src="https://…"）維持文字
      const match = BARE_HTTPS.exec(s.slice(i, i + MAX_URL_LENGTH));
      const href = match ? safeHttpsUrl(match[0]) : null;
      if (match && href) {
        out.push({ type: "link", href, children: [{ type: "text", text: match[0] }] });
        i += match[0].length;
        continue;
      }
    }
    pushText(out, ch ?? "");
    i++;
  }
  return out;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d{1,9}[.)]\s+(.*)$/;

export function parseSafeMarkdown(source: string): MdBlock[] {
  const lines = [...source.replace(/\r\n?/g, "\n")].slice(0, MAX_SOURCE_CHARS).join("").split("\n");
  const blocks: MdBlock[] = [];
  // 以物件保存狀態：flush 在閉包內修改
  const state: { paragraph: string[]; list: { ordered: boolean; items: string[] } | null } = { paragraph: [], list: null };

  const flush = () => {
    if (state.paragraph.length > 0) blocks.push({ type: "paragraph", children: parseInline(state.paragraph.join("\n"), 0) });
    if (state.list) blocks.push({ type: "list", ordered: state.list.ordered, items: state.list.items.map((item) => parseInline(item, 0)) });
    state.paragraph = [];
    state.list = null;
  };

  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1]?.length ?? 1, children: parseInline(heading[2] ?? "", 0) });
      continue;
    }
    const unordered = UNORDERED.exec(line);
    const ordered = unordered ? null : ORDERED.exec(line);
    const item = unordered ?? ordered;
    if (item) {
      const isOrdered = ordered !== null;
      if (state.paragraph.length > 0 || (state.list && state.list.ordered !== isOrdered)) flush();
      state.list ??= { ordered: isOrdered, items: [] };
      state.list.items.push(item[1] ?? "");
      continue;
    }
    if (state.list) flush();
    state.paragraph.push(line);
  }
  flush();
  return blocks;
}
