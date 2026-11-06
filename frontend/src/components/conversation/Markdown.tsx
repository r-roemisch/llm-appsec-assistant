import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBlock } from "@/components/conversation/CodeBlock";
import { cn } from "@/lib/utils";

// react-markdown renders no raw HTML (there is no rehype-raw here) and strips
// javascript: URLs. Images are shown as links instead of being fetched, so an
// answer cannot make the browser call out to an arbitrary URL.
const components: Components = {
  pre: CodeBlock,
  a: ({ node: _node, children, href, ...props }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...props}>
      {children}
    </a>
  ),
  img: ({ node: _node, src, alt }) => (
    <a
      className="image-link"
      href={typeof src === "string" ? src : undefined}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      [image{alt ? `: ${alt}` : ""}]
    </a>
  ),
};

const remarkPlugins = [remarkGfm];

export const Markdown = memo(function Markdown({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className={cn("prose-rampart", streaming && "is-streaming")}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
