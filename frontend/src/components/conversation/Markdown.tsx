import { createElement, memo, type HTMLAttributes } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CitedText } from "@/components/conversation/CitedText";
import { CodeBlock } from "@/components/conversation/CodeBlock";
import { cn } from "@/lib/utils";

// Elements whose text can hold [n] Citation markers. Their children pass
// through CitedText, which links the markers inside an answer and leaves text
// alone everywhere else. Code, links and image labels are never touched.
const TEXT_ELEMENTS = ["p", "li", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "del"] as const;

function citedElement(tag: (typeof TEXT_ELEMENTS)[number]) {
  return function CitedElement({ node: _node, children, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) {
    return createElement(tag, props, <CitedText>{children}</CitedText>);
  };
}

// react-markdown renders no raw HTML (there is no rehype-raw here) and strips
// javascript: URLs. Images are shown as links instead of being fetched, so an
// answer cannot make the browser call out to an arbitrary URL.
const components: Components = {
  ...(Object.fromEntries(TEXT_ELEMENTS.map((tag) => [tag, citedElement(tag)])) as Components),
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
