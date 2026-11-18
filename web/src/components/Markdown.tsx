import type { ReactNode } from "react";

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  const nodes: ReactNode[] = [];
  let key = 0;
  for (const part of parts) {
    if (!part) continue;
    const keyName = `${keyPrefix}-${key}`;
    if (part.length > 1 && part.startsWith("`") && part.endsWith("`")) {
      nodes.push(
        <code key={keyName} className="md-inline-code">
          {part.slice(1, -1)}
        </code>,
      );
    } else if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      nodes.push(<strong key={keyName}>{part.slice(2, -2)}</strong>);
    } else {
      nodes.push(<span key={keyName}>{part}</span>);
    }
    key += 1;
  }
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.trim().match(/^```/);
    if (fence) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre key={key++} className="md-pre">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = heading[2];
      const Tag = `h${level}` as "h1" | "h2" | "h3";
      blocks.push(
        <Tag key={key++}>
          {renderInline(content, `h${key}`)}
        </Tag>,
      );
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (
        i < lines.length &&
        (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))
      ) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+[.)])\s+/, ""));
        i += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag key={key++} className={ordered ? "md-oli" : "md-ul"}>
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `li${key}-${idx}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }
    const buf: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim().length > 0 &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={key++} className="md-p">
        {renderInline(buf.join(" "), `p${key}`)}
      </p>,
    );
  }

  return <div className="md">{blocks}</div>;
}
