"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Check,
  Copy,
  X,
  ChevronRight,
  Activity,
  Clock,
  FileCode,
  Server,
  Loader2,
} from "lucide-react";

// JSON Syntax Highlighter Component
function JsonHighlight({ json }: { json: string }) {
  const highlighted = useMemo(() => {
    // Escape HTML first
    const escaped = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Apply syntax highlighting
    return (
      escaped
        // Strings (including property names in quotes)
        .replace(
          /("(?:[^"\\]|\\.)*")\s*:/g,
          '<span class="text-violet-600 dark:text-violet-400">$1</span>:'
        )
        // String values
        .replace(
          /:\s*("(?:[^"\\]|\\.)*")/g,
          ': <span class="text-emerald-600 dark:text-emerald-400">$1</span>'
        )
        // Standalone strings (in arrays)
        .replace(
          /(\[|,)\s*("(?:[^"\\]|\\.)*")/g,
          '$1 <span class="text-emerald-600 dark:text-emerald-400">$2</span>'
        )
        // Numbers
        .replace(
          /:\s*(-?\d+\.?\d*(?:e[+-]?\d+)?)\b/gi,
          ': <span class="text-amber-600 dark:text-amber-400">$1</span>'
        )
        // Booleans
        .replace(
          /:\s*(true|false)\b/g,
          ': <span class="text-blue-600 dark:text-blue-400">$1</span>'
        )
        // Null
        .replace(/:\s*(null)\b/g, ': <span class="text-rose-600 dark:text-rose-400">$1</span>')
        // Braces and brackets
        .replace(/([{}\[\]])/g, '<span class="text-muted-foreground">$1</span>')
    );
  }, [json]);

  return <code className="block" dangerouslySetInnerHTML={{ __html: highlighted }} />;
}

type RpcLogEntry = {
  id: string;
  endpointUrl: string;
  requestPayload: unknown;
  requestHeaders?: Record<string, string>;
  responsePayload?: unknown;
  status?: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
};

type AgentDebugProps = {
  logs: RpcLogEntry[];
  buildCurl: (endpointUrl: string, payload: unknown, headers?: Record<string, string>) => string;
  formatJson: (value: unknown) => string;
  formatDuration: (durationMs: number | undefined) => string;
  extractRpcMethod: (payload: unknown) => string | null;
};

type DetailTab = "headers" | "payload" | "response" | "timing";

export function AgentDebug({
  logs,
  buildCurl,
  formatJson,
  formatDuration,
  extractRpcMethod,
}: AgentDebugProps) {
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("payload");
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);

  const selectedLog = logs.find((log) => log.id === selectedLogId);

  const handleCopyCurl = async (log: RpcLogEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(
      buildCurl(log.endpointUrl, log.requestPayload, log.requestHeaders)
    );
    setCopiedLogId(log.id);
    setTimeout(() => setCopiedLogId(null), 2000);
  };

  const getStatusColor = (status?: number) => {
    if (!status) return "text-muted-foreground";
    if (status >= 200 && status < 300) return "text-green-500";
    if (status >= 400 && status < 500) return "text-yellow-500";
    if (status >= 500) return "text-red-500";
    return "text-muted-foreground";
  };

  const getStatusBadgeVariant = (status?: number, hasResponse?: boolean) => {
    if (!hasResponse) return "outline" as const;
    if (!status) return "secondary" as const;
    if (status >= 200 && status < 300) return "default" as const;
    if (status >= 400) return "destructive" as const;
    return "secondary" as const;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center border-b border-border/60 bg-muted/20 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium text-muted-foreground">
            {logs.length} request{logs.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Request list */}
        <div
          className={cn(
            "flex flex-col border-r border-border/60",
            selectedLog ? "w-1/2" : "w-full"
          )}
        >
          {/* Table header */}
          <div className="grid grid-cols-[1fr_60px_70px_70px_32px] gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <div>Method</div>
            <div>Status</div>
            <div>Time</div>
            <div>Duration</div>
            <div></div>
          </div>

          {/* Table body */}
          <ScrollArea className="flex-1">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Activity className="h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-xs text-muted-foreground">No requests yet</p>
                <p className="text-[10px] text-muted-foreground/70">
                  Send a message to see traffic
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {logs.map((log) => {
                  const method = extractRpcMethod(log.requestPayload);
                  const hasResponse = log.responsePayload !== undefined;
                  const isSelected = selectedLogId === log.id;

                  return (
                    <div
                      key={log.id}
                      className={cn(
                        "grid w-full grid-cols-[1fr_60px_70px_70px_32px] gap-2 px-3 py-2 text-left text-[11px] transition-all",
                        isSelected
                          ? "bg-primary/10 border-l-2 border-l-primary"
                          : "hover:bg-muted/40 border-l-2 border-l-transparent"
                      )}
                    >
                      <button
                        onClick={() => setSelectedLogId(isSelected ? null : log.id)}
                        className="flex items-center gap-2 truncate text-left"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                            isSelected && "rotate-90 text-primary"
                          )}
                        />
                        <span className="font-mono font-medium truncate">
                          {method ?? "unknown"}
                        </span>
                      </button>
                      <div className="flex items-center">
                        {hasResponse ? (
                          <Badge
                            variant={getStatusBadgeVariant(log.status, hasResponse)}
                            className="text-[9px] px-1.5 py-0 font-mono"
                          >
                            {log.status ?? "OK"}
                          </Badge>
                        ) : (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex items-center text-muted-foreground font-mono">
                        {new Date(log.startedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </div>
                      <div
                        className={cn(
                          "flex items-center font-mono font-medium",
                          hasResponse ? getStatusColor(log.status) : "text-muted-foreground"
                        )}
                      >
                        {formatDuration(log.durationMs)}
                      </div>
                      <div className="flex items-center justify-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={(e) => handleCopyCurl(log, e)}
                              className={cn(
                                "p-1 rounded transition-colors",
                                copiedLogId === log.id
                                  ? "text-green-500"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
                              )}
                            >
                              {copiedLogId === log.id ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {copiedLogId === log.id ? "Copied!" : "Copy cURL"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Detail panel */}
        {selectedLog && (
          <div className="flex w-1/2 flex-col">
            {/* Detail header */}
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3 py-1.5">
              <div className="flex gap-0.5">
                {(["headers", "payload", "response", "timing"] as DetailTab[]).map((tab) => {
                  const TabIcon =
                    tab === "headers"
                      ? Server
                      : tab === "payload"
                        ? FileCode
                        : tab === "response"
                          ? FileCode
                          : Clock;
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded transition-colors",
                        activeTab === tab
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <TabIcon className="h-3 w-3" />
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setSelectedLogId(null)}
                className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Detail content */}
            <div className="flex-1 min-h-0 overflow-auto p-3">
              {activeTab === "headers" && (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      General
                    </h4>
                    <div className="rounded-md border border-border/60 overflow-hidden">
                      <table className="w-full text-[11px]">
                        <tbody className="divide-y divide-border/40">
                          <tr className="hover:bg-muted/30">
                            <td className="py-2 px-3 text-muted-foreground w-28">Request URL</td>
                            <td className="py-2 px-3 font-mono break-all">
                              {selectedLog.endpointUrl}
                            </td>
                          </tr>
                          <tr className="hover:bg-muted/30">
                            <td className="py-2 px-3 text-muted-foreground">Method</td>
                            <td className="py-2 px-3 font-mono">POST</td>
                          </tr>
                          <tr className="hover:bg-muted/30">
                            <td className="py-2 px-3 text-muted-foreground">Status Code</td>
                            <td
                              className={cn(
                                "py-2 px-3 font-mono font-medium",
                                getStatusColor(selectedLog.status)
                              )}
                            >
                              {selectedLog.status ?? "Pending"}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Request Headers
                    </h4>
                    <div className="rounded-md border border-border/60 overflow-hidden">
                      <table className="w-full text-[11px]">
                        <tbody className="divide-y divide-border/40">
                          {selectedLog.requestHeaders &&
                            Object.entries(selectedLog.requestHeaders).map(([name, value]) => (
                              <tr key={name} className="hover:bg-muted/30">
                                <td className="py-2 px-3 text-muted-foreground w-28 align-top">
                                  {name}
                                </td>
                                <td className="py-2 px-3 font-mono break-all">{value}</td>
                              </tr>
                            ))}
                          {(!selectedLog.requestHeaders ||
                            Object.keys(selectedLog.requestHeaders).length === 0) && (
                            <tr className="hover:bg-muted/30">
                              <td className="py-2 px-3 text-muted-foreground w-28">Content-Type</td>
                              <td className="py-2 px-3 font-mono">application/json</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "payload" && (
                <div className="flex flex-col h-full">
                  <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 shrink-0">
                    Request Payload
                  </h4>
                  <div className="flex-1 min-h-0 rounded-md bg-muted/30 border border-border/60 overflow-hidden">
                    <ScrollArea className="h-full max-h-[calc(100vh-400px)]">
                      <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap wrap-break-word leading-relaxed">
                        <JsonHighlight json={formatJson(selectedLog.requestPayload)} />
                      </pre>
                    </ScrollArea>
                  </div>
                </div>
              )}

              {activeTab === "response" && (
                <div className="flex flex-col h-full">
                  <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 shrink-0">
                    Response
                  </h4>
                  {selectedLog.responsePayload ? (
                    <div className="flex-1 min-h-0 rounded-md bg-muted/30 border border-border/60 overflow-hidden">
                      <ScrollArea className="h-full max-h-[calc(100vh-400px)]">
                        <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap wrap-break-word leading-relaxed">
                          <JsonHighlight json={formatJson(selectedLog.responsePayload)} />
                        </pre>
                      </ScrollArea>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Awaiting response...
                    </div>
                  )}
                </div>
              )}

              {activeTab === "timing" && (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Request Timing
                    </h4>
                    <div className="rounded-md border border-border/60 overflow-hidden">
                      <table className="w-full text-[11px]">
                        <tbody className="divide-y divide-border/40">
                          <tr className="hover:bg-muted/30">
                            <td className="py-2 px-3 text-muted-foreground w-28">Started At</td>
                            <td className="py-2 px-3 font-mono">
                              {new Date(selectedLog.startedAt).toLocaleString()}
                            </td>
                          </tr>
                          {selectedLog.completedAt && (
                            <tr className="hover:bg-muted/30">
                              <td className="py-2 px-3 text-muted-foreground">Completed At</td>
                              <td className="py-2 px-3 font-mono">
                                {new Date(selectedLog.completedAt).toLocaleString()}
                              </td>
                            </tr>
                          )}
                          <tr className="hover:bg-muted/30">
                            <td className="py-2 px-3 text-muted-foreground">Duration</td>
                            <td
                              className={cn(
                                "py-2 px-3 font-mono font-semibold",
                                getStatusColor(selectedLog.status)
                              )}
                            >
                              {formatDuration(selectedLog.durationMs)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Visual timing bar */}
                  {selectedLog.durationMs && (
                    <div>
                      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Waterfall
                      </h4>
                      <div className="relative h-7 rounded-md bg-muted/30 border border-border/60 overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-linear-to-r from-primary/80 to-primary/60"
                          style={{
                            width: `${Math.min(100, (selectedLog.durationMs / 1000) * 100)}%`,
                            minWidth: "4px",
                          }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-medium">
                          {selectedLog.durationMs}ms
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
