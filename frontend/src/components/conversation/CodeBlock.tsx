import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import type { ExtraProps } from "react-markdown";

import { CopyButton } from "@/components/common/CopyButton";

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function languageOf(node: ReactNode): string | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ className?: string }>(child)) continue;
    const match = /language-([\w+.-]+)/.exec(child.props.className ?? "");
    if (match) return match[1];
  }
  return null;
}

/** A fenced code block with a language label and a copy button. */
export function CodeBlock({ node: _node, children, ...props }: ComponentProps<"pre"> & ExtraProps) {
  const text = textOf(children);
  const language = languageOf(children);

  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span>{language ?? "code"}</span>
        <CopyButton
          text={text}
          className="text-code-foreground/70 hover:bg-white/10 hover:text-code-foreground dark:hover:bg-white/10"
        />
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}
