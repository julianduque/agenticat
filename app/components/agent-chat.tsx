"use client";

import { useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "./markdown-renderer";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  Server,
  AlertCircle,
  Loader2,
  XCircle,
  Copy,
  Check,
  RotateCcw,
} from "lucide-react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  status?: "pending" | "streaming" | "complete" | "error";
  error?: string;
  taskId?: string;
  taskState?: string;
};

type AgentChatProps = {
  messages: ChatMessage[];
  endpointLabel: string;
  sending: boolean;
  chatError: string | null;
  onSend: (text: string) => void;
  onRetry?: (messageId: string) => void;
};

function MessageStatusIndicator({ status, taskState }: { status?: string; taskState?: string }) {
  if (status === "streaming") {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-blue-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{taskState ? `Task: ${taskState}` : "Streaming..."}</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-1 text-[10px] text-destructive">
        <XCircle className="h-3 w-3" />
        <span>Error</span>
      </div>
    );
  }
  return null;
}

function TaskStateBadge({ taskState }: { taskState?: string }) {
  if (!taskState) return null;

  const badgeVariants: Record<string, string> = {
    submitted: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
    working: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    completed: "bg-green-500/10 text-green-600 border-green-500/30",
    failed: "bg-red-500/10 text-red-600 border-red-500/30",
    canceled: "bg-gray-500/10 text-gray-600 border-gray-500/30",
  };

  return (
    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${badgeVariants[taskState] || ""}`}>
      {taskState}
    </Badge>
  );
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity ${className}`}
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </Button>
  );
}

export function AgentChat({
  messages,
  endpointLabel,
  sending,
  chatError,
  onSend,
  onRetry,
}: AgentChatProps) {
  return (
    <>
      <Conversation className="flex-1 min-h-0">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<MessageSquare className="h-8 w-8 text-muted-foreground/50" />}
              title="Start a conversation"
              description="Send a message to interact with the agent via A2A protocol."
            />
          ) : (
            <>
              {messages.map((message) => (
                <Message
                  key={message.id}
                  from={message.role}
                  className={cn("group relative", message.role === "user" && "w-fit max-w-[95%]")}
                >
                  <div className="flex flex-col gap-2">
                    <MessageContent>
                      {message.role === "assistant" ? (
                        <div className="space-y-2">
                          <div className="relative">
                            <MarkdownRenderer>
                              {message.content ||
                                (message.status === "streaming" ? "Thinking..." : "")}
                            </MarkdownRenderer>
                            {message.status === "streaming" && (
                              <span className="inline-block w-1.5 h-4 ml-0.5 bg-primary/70 animate-pulse rounded-sm" />
                            )}
                          </div>
                          {message.taskState && message.status === "complete" && (
                            <TaskStateBadge taskState={message.taskState} />
                          )}
                        </div>
                      ) : (
                        <p>{message.content}</p>
                      )}
                    </MessageContent>
                    <div
                      className={cn(
                        "flex items-center gap-2",
                        message.role === "user" && "justify-end"
                      )}
                    >
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(message.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <MessageStatusIndicator
                        status={message.status}
                        taskState={message.taskState}
                      />
                      {message.content && message.status !== "streaming" && (
                        <CopyButton text={message.content} />
                      )}
                      {message.status === "error" && onRetry && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 text-[10px] text-destructive hover:text-destructive"
                          onClick={() => onRetry(message.id)}
                        >
                          <RotateCcw className="h-3 w-3" />
                          Retry
                        </Button>
                      )}
                    </div>
                  </div>
                </Message>
              ))}
              {sending && !messages.some((m) => m.status === "streaming") && (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground">Agent is thinking</span>
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" />
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="border-t border-border/60 bg-muted/20 px-4 py-2.5">
        <PromptInput onSubmit={({ text }) => onSend(text)}>
          <PromptInputTextarea placeholder="Type your message..." className="text-sm" />
          <PromptInputFooter>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Server className="h-3 w-3" />
              <span className="break-all">{endpointLabel}</span>
            </div>
            <PromptInputSubmit disabled={sending} status={sending ? "submitted" : undefined} />
          </PromptInputFooter>
        </PromptInput>
        {chatError && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            {chatError}
          </div>
        )}
      </div>
    </>
  );
}
