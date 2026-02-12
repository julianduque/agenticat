"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";

// Import highlight.js styles - you can also add this to globals.css
import "highlight.js/styles/github-dark.css";

type MarkdownRendererProps = {
  children: string;
  className?: string;
};

export function MarkdownRenderer({ children, className }: MarkdownRendererProps) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-h1:text-xl prose-h2:text-lg prose-h3:text-base",
        "prose-p:leading-relaxed prose-p:my-2",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono",
        "prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-pre:p-0 prose-pre:my-3",
        "prose-pre:overflow-x-auto",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-4 [&_pre_code]:block",
        "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
        "prose-blockquote:border-l-primary prose-blockquote:bg-muted/50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r",
        "prose-table:text-xs",
        "prose-th:bg-muted prose-th:px-3 prose-th:py-2",
        "prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-border",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Custom code block rendering
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match && !className?.includes("hljs");

            if (isInline) {
              return (
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                  {children}
                </code>
              );
            }

            return (
              <code className={cn(className, "text-xs")} {...props}>
                {children}
              </code>
            );
          },
          // Custom link rendering to open in new tab
          a({ href, children, ...props }) {
            const isExternal = href?.startsWith("http");
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
