import { parseSafeMarkdown, safeHttpsUrl, type MdBlock, type MdInline } from "@atps/core";
import type { ReactNode } from "react";

// T24、S-08：AI 與網頁內容共用的呈現元件。
// 內容先經 parseSafeMarkdown 解析成有限的結構，再以 React 元素呈現；不使用 dangerouslySetInnerHTML。
// 連結只允許 https，並加上 rel="noopener noreferrer"。

const LINK_PROPS = { rel: "noopener noreferrer", target: "_blank" } as const;

export function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  const safe = safeHttpsUrl(href);
  if (!safe) return <span>{children}</span>;
  return (
    <a href={safe} {...LINK_PROPS}>
      {children}
    </a>
  );
}

function Inline({ nodes }: { nodes: MdInline[] }) {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return <code key={i}>{node.text}</code>;
      case "strong":
        return (
          <strong key={i}>
            <Inline nodes={node.children} />
          </strong>
        );
      case "em":
        return (
          <em key={i}>
            <Inline nodes={node.children} />
          </em>
        );
      case "link":
        return (
          <a key={i} href={node.href} {...LINK_PROPS}>
            <Inline nodes={node.children} />
          </a>
        );
    }
  });
}

// 標題降兩級呈現（## → h4），避免與頁面標題層級衝突
const HEADINGS = ["h3", "h4", "h5", "h6", "h6", "h6"] as const;

function Block({ block }: { block: MdBlock }) {
  switch (block.type) {
    case "heading": {
      const Tag = HEADINGS[Math.min(block.level, 6) - 1] ?? "h6";
      return (
        <Tag>
          <Inline nodes={block.children} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p>
          <Inline nodes={block.children} />
        </p>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <Inline nodes={item} />
        </li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
  }
}

export function SafeMarkdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={className}>
      {parseSafeMarkdown(source).map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}
