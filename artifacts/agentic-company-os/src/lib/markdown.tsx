import { Fragment, type ReactNode } from "react";

/**
 * Minimal, dependency-free markdown renderer tuned for agent chat output.
 * Supports: fenced code blocks, inline code, bold/italic, headings, bullet
 * & numbered lists, links, blockquotes and paragraphs. Everything else
 * renders as plain text -- intentionally conservative.
 */

interface Block {
  type:
    | "code"
    | "heading"
    | "bullet"
    | "ordered"
    | "quote"
    | "paragraph"
    | "divider";
  lines: string[];
  lang?: string;
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence (may be missing)
      blocks.push({ type: "code", lang, lines: buf });
      continue;
    }

    // horizontal rule
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ type: "divider", lines: [] });
      i++;
      continue;
    }

    // heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", lines: [heading[2]] });
      i++;
      continue;
    }

    // quote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: buf });
      continue;
    }

    // bullets (- * •)
    if (/^\s*[-*•]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      blocks.push({ type: "bullet", lines: buf });
      continue;
    }

    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ordered", lines: buf });
      continue;
    }

    // blank
    if (!line.trim()) {
      i++;
      continue;
    }

    // paragraph: collect until blank line / next block starter
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !lines[i].trimStart().startsWith("```") &&
      !/^\s*>/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", lines: buf });
  }

  return blocks;
}

/** Inline formatting: `code`, **bold**, *italic*, [text](url) */
function renderInline(text: string, unsafeLinkLabel: string): ReactNode {
  const nodes: ReactNode[] = [];
  // order matters: code first to protect its contents
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-foreground/[0.07] px-1.5 py-0.5 font-mono text-[12.5px] text-primary"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-bold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("[")) {
      const m = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(token);
      const href = safeMarkdownHref(m?.[2]);
      nodes.push(
        href ? (
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
          >
            {m?.[1] ?? token}
          </a>
        ) : (
          <span key={key++} title={unsafeLinkLabel}>
            {m?.[1] ?? token}
          </span>
        ),
      );
    } else {
      nodes.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}

function safeMarkdownHref(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw, "https://local.invalid/");
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.origin === "https://local.invalid") {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function Markdown({
  content,
  unsafeLinkLabel = "Güvenli olmayan bağlantı engellendi",
}: {
  content: string;
  unsafeLinkLabel?: string;
}) {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-2.5 text-base leading-relaxed">
      {blocks.map((block, bi) => {
        switch (block.type) {
          case "code":
            return (
              <pre
                key={bi}
                dir="ltr"
                className="scrollbar-slim overflow-x-auto rounded-lg border border-border bg-secondary p-3.5 font-mono text-sm leading-relaxed text-foreground"
              >
                {block.lang && (
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    {block.lang}
                  </span>
                )}
                <code>{block.lines.join("\n")}</code>
              </pre>
            );
          case "heading": {
            const text = block.lines.join(" ");
            return (
              <p
                key={bi}
                className="pt-1 text-[15px] font-extrabold tracking-tight first:pt-0"
              >
                {renderInline(text, unsafeLinkLabel)}
              </p>
            );
          }
          case "bullet":
            return (
              <ul key={bi} className="space-y-1 ps-1">
                {block.lines.map((li, liIdx) => (
                  <li key={liIdx} className="flex gap-2">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary/50" />
                    <span className="min-w-0">
                      {renderInline(li, unsafeLinkLabel)}
                    </span>
                  </li>
                ))}
              </ul>
            );
          case "ordered":
            return (
              <ol key={bi} className="space-y-1 ps-1">
                {block.lines.map((li, liIdx) => (
                  <li key={liIdx} className="flex gap-2.5">
                    <span className="w-5 shrink-0 text-end font-mono text-xs font-bold text-primary/70">
                      {liIdx + 1}.
                    </span>
                    <span className="min-w-0">
                      {renderInline(li, unsafeLinkLabel)}
                    </span>
                  </li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote
                key={bi}
                className="rounded-e-md border-s-[3px] border-primary/40 bg-secondary/40 px-3.5 py-2 italic text-muted-foreground"
              >
                {renderInline(block.lines.join(" "), unsafeLinkLabel)}
              </blockquote>
            );
          case "divider":
            return <hr key={bi} className="border-border/70" />;
          default:
            return (
              <p key={bi} className="whitespace-pre-wrap break-words">
                {block.lines.map((l, idx) => (
                  <Fragment key={idx}>
                    {idx > 0 && <br />}
                    {renderInline(l, unsafeLinkLabel)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
