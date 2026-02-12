"use client";

import { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import "highlight.js/styles/github-dark.css";

// Register JSON language
hljs.registerLanguage("json", json);

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AgentCardNormalized, AgentAuthConfig } from "@/lib/a2a/schema";
import { buildAuthHeaders } from "@/lib/a2a/schema";
import { AgentChat } from "@/app/components/agent-chat";
import { AgentDebug } from "@/app/components/agent-debug";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Bot,
  Link2,
  FileJson,
  Plus,
  Zap,
  Radio,
  History,
  MessageSquare,
  Bug,
  Server,
  Loader2,
  Users,
  Trash2,
  RotateCcw,
  Download,
  Lightbulb,
  Tag,
  ChevronRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Code,
  ExternalLink,
  Key,
  Shield,
  ListTodo,
  RefreshCw,
  GripVertical,
} from "lucide-react";
import { exportToJson, exportToMarkdown, downloadFile, generateExportFilename } from "@/lib/export";

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

type TrackedTask = {
  taskId: string;
  contextId?: string;
  state: string;
  lastUpdated: string;
  createdAt: string;
  message?: string;
};

const STORAGE_KEY = "agenticat-agents";
const PANEL_LAYOUT_STORAGE_KEY = "agenticat-panel-layout";
const SUPPORTED_METHODS = [
  {
    value: "message/send",
    label: "message/send",
    description: "Send a message to the agent",
  },
  {
    value: "message/stream",
    label: "message/stream",
    description: "Send a message with streaming response",
  },
  {
    value: "tasks/get",
    label: "tasks/get",
    description: "Get task status by ID",
  },
] as const;
const DEFAULT_METHOD = SUPPORTED_METHODS[0].value;

const formatJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const buildCurl = (endpointUrl: string, payload: unknown, headers?: Record<string, string>) => {
  const json = formatJson(payload).replace(/'/g, "'\\''");
  const h = headers ?? { "Content-Type": "application/json" };
  const headerFlags = Object.entries(h)
    .map(([k, v]) => `-H '${k}: ${String(v).replace(/'/g, "'\\''")}'`)
    .join(" ");
  return `curl -X POST '${endpointUrl}' ${headerFlags} -d '${json}'`;
};

const extractErrorSummary = (data: unknown) => {
  if (!data || typeof data !== "object") {
    return null;
  }
  const record = data as Record<string, unknown>;
  const error = (record.error ?? (record.data as Record<string, unknown>)?.error) as
    | Record<string, unknown>
    | undefined;
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = typeof error.code === "number" ? error.code : undefined;
  const message = typeof error.message === "string" ? error.message : undefined;
  if (code !== undefined && message) {
    return `Agent error ${code}: ${message}`;
  }
  if (message) {
    return `Agent error: ${message}`;
  }
  if (code !== undefined) {
    return `Agent error ${code}`;
  }
  return "Agent returned an error.";
};

const extractTextFromParts = (parts: unknown[]): string | null => {
  for (const part of parts) {
    if (part && typeof part === "object") {
      const partRecord = part as Record<string, unknown>;
      if (partRecord.kind === "text" && typeof partRecord.text === "string") {
        return partRecord.text;
      }
    }
  }
  return null;
};

const extractArtifactsInfo = (artifacts: unknown[]): string | null => {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return null;
  }

  const artifactParts: string[] = [];
  for (const artifact of artifacts) {
    const artifactRecord = artifact as Record<string, unknown> | undefined;
    if (!artifactRecord) continue;

    const name = typeof artifactRecord.name === "string" ? artifactRecord.name : "artifact";

    if (Array.isArray(artifactRecord.parts)) {
      const text = extractTextFromParts(artifactRecord.parts as unknown[]);
      if (text) {
        // Format artifact with clear visual distinction
        artifactParts.push(
          `> 📎 **${name}**\n>\n> \`\`\`json\n> ${text.split("\n").join("\n> ")}\n> \`\`\``
        );
      }
    }
  }

  if (artifactParts.length === 0) return null;

  // Add a section header for artifacts
  const header = artifactParts.length === 1 ? "**Artifact:**" : "**Artifacts:**";
  return `\n\n${header}\n\n${artifactParts.join("\n\n")}`;
};

const extractResponseText = (data: unknown) => {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.error === "string") {
      return record.error;
    }
  }
  const errorSummary = extractErrorSummary(data);
  if (errorSummary) {
    return errorSummary;
  }
  if (typeof data === "string") {
    return data;
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;

    // Handle Task response (kind: "task")
    if (record.kind === "task") {
      const status = record.status as Record<string, unknown> | undefined;
      const state = status?.state as string | undefined;
      const history = record.history as unknown[] | undefined;
      const artifacts = record.artifacts as unknown[] | undefined;

      const responseParts: string[] = [];

      // 1. First, check status.message (primary conversational content)
      if (status?.message) {
        if (typeof status.message === "string") {
          responseParts.push(status.message);
        } else {
          // Handle message object with parts
          const statusMessage = status.message as Record<string, unknown>;
          if (statusMessage.kind === "message" && Array.isArray(statusMessage.parts)) {
            const text = extractTextFromParts(statusMessage.parts as unknown[]);
            if (text) {
              responseParts.push(text);
            }
          }
        }
      }

      // 2. Look for agent messages in history (if no status.message)
      if (responseParts.length === 0 && Array.isArray(history) && history.length > 0) {
        for (let i = history.length - 1; i >= 0; i--) {
          const msg = history[i] as Record<string, unknown> | undefined;
          if (msg?.role === "agent" && Array.isArray(msg.parts)) {
            const text = extractTextFromParts(msg.parts as unknown[]);
            if (text) {
              responseParts.push(text);
              break;
            }
          }
        }
      }

      // 3. Add artifacts info (formatted distinctly)
      if (Array.isArray(artifacts) && artifacts.length > 0) {
        const artifactsInfo = extractArtifactsInfo(artifacts);
        if (artifactsInfo) {
          responseParts.push(artifactsInfo);
        }
      }

      // 4. If we have content, return it
      if (responseParts.length > 0) {
        // Artifacts already have their own formatting/spacing, so just join directly
        return responseParts.join("");
      }

      // 5. Return state-based message as fallback
      switch (state) {
        case "submitted":
          return "Task submitted, waiting for agent...";
        case "working":
          return "Agent is working on your request...";
        case "input-required":
          return "Agent requires additional input.";
        case "completed":
          return "Task completed.";
        case "failed":
          return "Task failed.";
        case "canceled":
          return "Task was canceled.";
        default:
          return `Task status: ${state || "unknown"}`;
      }
    }

    // Handle Message response (kind: "message")
    if (record.kind === "message" && Array.isArray(record.parts)) {
      const text = extractTextFromParts(record.parts as unknown[]);
      if (text) {
        return text;
      }
    }

    // Fallback to result field
    const result = record.result;
    if (typeof result === "string") {
      return result;
    }
    if (result && typeof result === "object") {
      const maybeText =
        (result as Record<string, unknown>).message ??
        (result as Record<string, unknown>).content ??
        (result as Record<string, unknown>).text;
      if (typeof maybeText === "string") {
        return maybeText;
      }
    }
  }
  return formatJson(data);
};

const extractRpcMethod = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  return typeof record.method === "string" ? record.method : null;
};

const formatDuration = (durationMs: number | undefined) => {
  if (durationMs === undefined) {
    return "pending";
  }
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(2)} s`;
  }
  return `${Math.max(1, Math.round(durationMs))} ms`;
};

const normalizeCardUrl = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    if (!url.pathname.endsWith("/.well-known/agent-card.json")) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/.well-known/agent-card.json`;
    }
    return url.toString();
  } catch {
    return trimmed;
  }
};

function SortableAgentCard({
  agent,
  isSelected,
  onSelect,
}: {
  agent: AgentCardNormalized;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: agent.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex flex-col gap-1.5">
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className={`flex flex-col gap-1.5 rounded-md border p-3 text-left transition-all cursor-pointer ${
          isSelected
            ? "border-primary/50 bg-primary/5 shadow-sm"
            : "border-transparent hover:border-border hover:bg-accent/50"
        } ${isDragging ? "shadow-md ring-2 ring-primary/30" : ""}`}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="touch-none cursor-grab active:cursor-grabbing rounded p-0.5 -m-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/80"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
              isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            <Bot className="h-3 w-3" />
          </div>
          <span className="flex-1 truncate text-sm font-medium">{agent.name}</span>
          <div className="flex items-center gap-1 shrink-0">
            {agent.capabilities.streaming && <Zap className="h-3 w-3 text-amber-500" />}
          </div>
        </div>
        <p className="line-clamp-2 pl-8 text-[11px] text-muted-foreground">
          {agent.description || "No description provided."}
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [registerMode, setRegisterMode] = useState<"url" | "json">("url");
  const [cardUrl, setCardUrl] = useState("");
  const [cardJson, setCardJson] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentCardNormalized[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, ChatMessage[]>>({});
  const [rpcLogsByAgent, setRpcLogsByAgent] = useState<Record<string, RpcLogEntry[]>>({});
  const [endpointByAgent, setEndpointByAgent] = useState<Record<string, string>>({});
  const [endpointOverrideByAgent, setEndpointOverrideByAgent] = useState<Record<string, string>>(
    {}
  );
  const [methodByAgent, setMethodByAgent] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [contextIdByAgent, setContextIdByAgent] = useState<Record<string, string>>({});
  const [taskIdByAgent, setTaskIdByAgent] = useState<Record<string, string>>({});
  const [showRawJson, setShowRawJson] = useState(false);
  const [authByAgent, setAuthByAgent] = useState<Record<string, AgentAuthConfig>>({});
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [customHeaderRows, setCustomHeaderRows] = useState<{ key: string; value: string }[]>([]);
  const [trackedTasksByAgent, setTrackedTasksByAgent] = useState<Record<string, TrackedTask[]>>({});
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [fetchingTask, setFetchingTask] = useState(false);
  const [taskIdInput, setTaskIdInput] = useState("");
  const [panelOrientation, setPanelOrientation] = useState<"horizontal" | "vertical">("vertical");
  const [savedPanelLayout, setSavedPanelLayout] = useState<Record<
    string,
    Record<string, number>
  > | null>(null);
  const panelGroupRef = useRef<import("react-resizable-panels").GroupImperativeHandle | null>(null);
  const allowPersistLayoutRef = useRef(false);

  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const update = () => setPanelOrientation(m.matches ? "horizontal" : "vertical");
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);

  // Sync custom header rows when auth dialog opens with custom type
  const selectedAuthType = authByAgent[selectedAgentId ?? ""]?.type;
  useEffect(() => {
    if (!authDialogOpen || !selectedAgentId) return;
    const auth = authByAgent[selectedAgentId];
    if (auth?.type !== "custom") return;
    const headers = auth.customHeaders ?? {};
    const entries = Object.entries(headers).map(([key, value]) => ({ key, value }));
    setCustomHeaderRows(entries.length ? entries : [{ key: "", value: "" }]);
  }, [authDialogOpen, selectedAgentId, selectedAuthType, authByAgent]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, Record<string, number>>;
        if (parsed && typeof parsed === "object") setSavedPanelLayout(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  useLayoutEffect(() => {
    const layout = savedPanelLayout?.[panelOrientation];
    if (!layout || Object.keys(layout).length === 0) return;
    allowPersistLayoutRef.current = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const frameId = requestAnimationFrame(() => {
      if (panelGroupRef.current) {
        panelGroupRef.current.setLayout(layout);
      }
      timeoutId = setTimeout(() => {
        allowPersistLayoutRef.current = true;
      }, 150);
    });
    return () => {
      cancelAnimationFrame(frameId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [savedPanelLayout, panelOrientation]);

  useEffect(() => {
    const id = setTimeout(() => {
      allowPersistLayoutRef.current = true;
    }, 250);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as AgentCardNormalized[];
      if (Array.isArray(parsed)) {
        setAgents(parsed);
        if (parsed.length) {
          setSelectedAgentId(parsed[0].id);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  }, [agents]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleAgentDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = agents.findIndex((a) => a.id === active.id);
    const newIndex = agents.findIndex((a) => a.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setAgents((prev) => arrayMove(prev, oldIndex, newIndex));
  };

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  // Enrich skills with data from raw card (backwards compatibility for already-registered agents)
  const enrichedSkills = useMemo(() => {
    if (!selectedAgent) return [];

    const rawCard = selectedAgent.raw as Record<string, unknown> | null;
    const rawSkills = Array.isArray(rawCard?.skills) ? rawCard.skills : [];

    return selectedAgent.skills.map((skill) => {
      // Find matching raw skill by name
      const rawSkill = rawSkills.find((rs) => {
        const rsRecord = rs as Record<string, unknown> | null;
        return rsRecord?.name === skill.name;
      }) as Record<string, unknown> | undefined;

      if (!rawSkill) return skill;

      // Enrich with raw data if not already present
      const examples =
        skill.examples ??
        (Array.isArray(rawSkill.examples)
          ? rawSkill.examples.filter((e): e is string => typeof e === "string")
          : undefined);
      const tags =
        skill.tags ??
        (Array.isArray(rawSkill.tags)
          ? rawSkill.tags.filter((t): t is string => typeof t === "string")
          : undefined);
      const description =
        skill.description ??
        (typeof rawSkill.description === "string" ? rawSkill.description : undefined);

      return {
        ...skill,
        description,
        examples,
        tags,
      };
    });
  }, [selectedAgent]);

  // Enrich provider from raw card (backwards compatibility)
  const enrichedProvider = useMemo(() => {
    if (!selectedAgent) return null;
    if (selectedAgent.provider?.organization) return selectedAgent.provider;

    const rawCard = selectedAgent.raw as Record<string, unknown> | null;
    const rawProvider = rawCard?.provider as Record<string, unknown> | null;

    if (!rawProvider) return null;

    const organization =
      typeof rawProvider.organization === "string" ? rawProvider.organization : undefined;
    const url = typeof rawProvider.url === "string" ? rawProvider.url : undefined;

    if (!organization && !url) return null;

    return { organization, url };
  }, [selectedAgent]);

  // Enrich input/output modes from raw card (backwards compatibility)
  const enrichedModes = useMemo(() => {
    if (!selectedAgent) return { inputModes: [], outputModes: [] };

    const rawCard = selectedAgent.raw as Record<string, unknown> | null;

    const inputModes =
      selectedAgent.defaultInputModes ??
      (Array.isArray(rawCard?.defaultInputModes)
        ? (rawCard.defaultInputModes as unknown[]).filter((m): m is string => typeof m === "string")
        : []);

    const outputModes =
      selectedAgent.defaultOutputModes ??
      (Array.isArray(rawCard?.defaultOutputModes)
        ? (rawCard.defaultOutputModes as unknown[]).filter(
            (m): m is string => typeof m === "string"
          )
        : []);

    return { inputModes, outputModes };
  }, [selectedAgent]);

  const selectedMessages = selectedAgent ? (messagesByAgent[selectedAgent.id] ?? []) : [];
  const selectedLogs = selectedAgent ? (rpcLogsByAgent[selectedAgent.id] ?? []) : [];

  const handleRegister = async () => {
    setRegisterError(null);
    setRegistering(true);
    try {
      const payload =
        registerMode === "json"
          ? { cardJson: JSON.parse(cardJson) }
          : { cardUrl: normalizeCardUrl(cardUrl) };
      const response = await fetch("/api/agents/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!data.ok) {
        setRegisterError(Array.isArray(data.errors) ? data.errors.join(" ") : "Invalid card.");
        return;
      }
      const card = data.card as AgentCardNormalized;
      setAgents((prev) => {
        const filtered = prev.filter((agent) => agent.id !== card.id);
        return [card, ...filtered];
      });
      setSelectedAgentId(card.id);
      setEndpointByAgent((prev) => ({
        ...prev,
        [card.id]: prev[card.id] ?? card.endpoints[0]?.url ?? "",
      }));
      setMethodByAgent((prev) => ({
        ...prev,
        [card.id]: prev[card.id] ?? DEFAULT_METHOD,
      }));
      setCardUrl("");
      setCardJson("");
      setRegisterError(null);
      setRegisterDialogOpen(false);
    } catch (error) {
      setRegisterError(error instanceof Error ? error.message : "Unable to register agent.");
    } finally {
      setRegistering(false);
    }
  };

  const handleSendMessage = async (messageText: string) => {
    if (!selectedAgent) {
      return;
    }
    if (!messageText.trim()) {
      return;
    }
    setChatError(null);
    const baseEndpoint = endpointByAgent[selectedAgent.id] ?? selectedAgent.endpoints[0]?.url;
    const endpointUrl =
      endpointOverrideByAgent[selectedAgent.id]?.trim() || baseEndpoint || undefined;
    if (!endpointUrl) {
      setChatError("Select an endpoint or enter a full endpoint URL before chatting.");
      return;
    }
    // We need either a card URL or an endpoint URL to communicate
    if (!selectedAgent.url && !endpointUrl) {
      setChatError("Missing agent card URL and endpoint. Re-register the agent.");
      return;
    }
    const method = methodByAgent[selectedAgent.id] || DEFAULT_METHOD;

    // tasks/get is handled separately via the task panel
    if (method === "tasks/get") {
      setChatError("Use the Tasks panel to fetch task status.");
      return;
    }

    if (!SUPPORTED_METHODS.some((entry) => entry.value === method)) {
      setChatError("Unsupported JSON-RPC method selected.");
      return;
    }

    // Check if streaming is explicitly requested via method selection
    const forceStreaming = method === "message/stream";
    // Get existing IDs for continuing a conversation
    const existingContextId = contextIdByAgent[selectedAgent.id];
    const existingTaskId = taskIdByAgent[selectedAgent.id];

    const messagePayload: Record<string, unknown> = {
      messageId: crypto.randomUUID(),
      role: "user",
      kind: "message",
      parts: [
        {
          kind: "text",
          text: messageText,
        },
      ],
    };

    // Include contextId if we have one from a previous response (for continuing conversations)
    if (existingContextId) {
      messagePayload.contextId = existingContextId;
    }

    // Build request params - include taskId if continuing an existing task
    const requestParams: Record<string, unknown> = {
      message: messagePayload,
    };

    // Include taskId for continuing tasks (especially for input-required state)
    if (existingTaskId) {
      requestParams.id = existingTaskId;
    }
    const payload = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params: requestParams,
    };

    const timestamp = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: messageText,
      timestamp,
      status: "complete",
    };

    setMessagesByAgent((prev) => ({
      ...prev,
      [selectedAgent.id]: [...(prev[selectedAgent.id] ?? []), userMessage],
    }));

    const rpcLogId = crypto.randomUUID();
    const startedAt = timestamp;
    const startedAtMs = Date.now();
    const supportsStreaming = selectedAgent.capabilities.streaming;
    const useStreaming = forceStreaming || supportsStreaming;
    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: useStreaming && supportsStreaming ? "text/event-stream" : "application/json",
      ...buildAuthHeaders(authByAgent[selectedAgent.id]),
    };
    const requestLog: RpcLogEntry = {
      id: rpcLogId,
      endpointUrl,
      requestPayload: payload,
      requestHeaders,
      startedAt,
    };

    setRpcLogsByAgent((prev) => ({
      ...prev,
      [selectedAgent.id]: [...(prev[selectedAgent.id] ?? []), requestLog],
    }));

    setSending(true);
    const assistantMessageId = crypto.randomUUID();

    if (useStreaming && supportsStreaming) {
      // Create a streaming placeholder message
      const streamingMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        status: "streaming",
      };

      setMessagesByAgent((prev) => ({
        ...prev,
        [selectedAgent.id]: [...(prev[selectedAgent.id] ?? []), streamingMessage],
      }));

      try {
        const response = await fetch("/api/agents/stream", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            cardUrl: selectedAgent.url || undefined,
            endpointUrl: endpointUrl || undefined,
            method,
            params: requestParams,
            auth: authByAgent[selectedAgent.id],
          }),
        });

        if (!response.ok) {
          let bodyMessage = "Streaming failed";
          try {
            const errorData = await response.json();
            bodyMessage = (errorData as { error?: string }).error || bodyMessage;
          } catch {
            bodyMessage = response.statusText || "Unknown error";
          }
          throw new Error(`${response.status} ${bodyMessage}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulatedContent = "";
        let lastEventData: Record<string, unknown> | null = null;
        let streamErrorMsg: string | null = null;

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") {
                  continue;
                }
                try {
                  const parsed = JSON.parse(data) as Record<string, unknown>;
                  lastEventData = parsed;

                  if (parsed.error != null) {
                    streamErrorMsg =
                      typeof parsed.error === "string"
                        ? parsed.error
                        : typeof (parsed.error as Record<string, unknown>)?.message === "string"
                          ? ((parsed.error as Record<string, unknown>).message as string)
                          : JSON.stringify(parsed.error);
                  }

                  // Extract contextId from any event
                  const eventContextId = parsed.contextId as string | undefined;
                  if (eventContextId) {
                    setContextIdByAgent((prev) => ({
                      ...prev,
                      [selectedAgent.id]: eventContextId,
                    }));
                  }

                  // Extract taskId for continuing conversations
                  const eventTaskId = parsed.id as string | undefined;
                  const eventStatus = parsed.status as Record<string, unknown> | undefined;
                  const eventState = eventStatus?.state as string | undefined;

                  // Track task in the task panel
                  if (eventTaskId && eventState) {
                    setTrackedTasksByAgent((prev) => {
                      const existingTasks = prev[selectedAgent.id] ?? [];
                      const existingTaskIndex = existingTasks.findIndex(
                        (t) => t.taskId === eventTaskId
                      );
                      const now = new Date().toISOString();
                      const taskData: TrackedTask = {
                        taskId: eventTaskId,
                        contextId: eventContextId,
                        state: eventState,
                        lastUpdated: now,
                        createdAt:
                          existingTaskIndex >= 0 ? existingTasks[existingTaskIndex].createdAt : now,
                        message:
                          typeof eventStatus?.message === "string"
                            ? eventStatus.message
                            : undefined,
                      };

                      if (existingTaskIndex >= 0) {
                        // Update existing task
                        const updated = [...existingTasks];
                        updated[existingTaskIndex] = taskData;
                        return { ...prev, [selectedAgent.id]: updated };
                      } else {
                        // Add new task at the beginning
                        return { ...prev, [selectedAgent.id]: [taskData, ...existingTasks] };
                      }
                    });
                  }

                  if (eventTaskId && eventState === "input-required") {
                    setTaskIdByAgent((prev) => ({
                      ...prev,
                      [selectedAgent.id]: eventTaskId,
                    }));
                  } else if (
                    eventState === "completed" ||
                    eventState === "failed" ||
                    eventState === "canceled"
                  ) {
                    setTaskIdByAgent((prev) => {
                      const newState = { ...prev };
                      delete newState[selectedAgent.id];
                      return newState;
                    });
                  }

                  // Extract text content from different event types
                  if (parsed.kind === "message" && Array.isArray(parsed.parts)) {
                    const text = extractTextFromParts(parsed.parts);
                    if (text) {
                      accumulatedContent = text;
                    }
                  } else if (parsed.kind === "task") {
                    const status = parsed.status as Record<string, unknown> | undefined;
                    const history = parsed.history as unknown[] | undefined;
                    const artifacts = parsed.artifacts as unknown[] | undefined;
                    const taskState = status?.state as string | undefined;

                    const contentParts: string[] = [];

                    // 1. First, check status.message (primary conversational content)
                    if (status?.message) {
                      if (typeof status.message === "string") {
                        contentParts.push(status.message);
                      } else {
                        const statusMessage = status.message as Record<string, unknown>;
                        if (
                          statusMessage.kind === "message" &&
                          Array.isArray(statusMessage.parts)
                        ) {
                          const text = extractTextFromParts(statusMessage.parts as unknown[]);
                          if (text) {
                            contentParts.push(text);
                          }
                        }
                      }
                    }

                    // 2. Look for agent messages in history (if no status.message)
                    if (contentParts.length === 0 && Array.isArray(history) && history.length > 0) {
                      for (let i = history.length - 1; i >= 0; i--) {
                        const msg = history[i] as Record<string, unknown>;
                        if (msg?.role === "agent" && Array.isArray(msg.parts)) {
                          const text = extractTextFromParts(msg.parts as unknown[]);
                          if (text) {
                            contentParts.push(text);
                            break;
                          }
                        }
                      }
                    }

                    // 3. Add artifacts info (formatted distinctly)
                    if (Array.isArray(artifacts) && artifacts.length > 0) {
                      const artifactsInfo = extractArtifactsInfo(artifacts);
                      if (artifactsInfo) {
                        contentParts.push(artifactsInfo);
                      }
                    }

                    // Combine content (artifacts already have their own formatting)
                    if (contentParts.length > 0) {
                      accumulatedContent = contentParts.join("");
                    }

                    // Update task state
                    setMessagesByAgent((prev) => {
                      const messages = prev[selectedAgent.id] ?? [];
                      return {
                        ...prev,
                        [selectedAgent.id]: messages.map((msg) =>
                          msg.id === assistantMessageId
                            ? { ...msg, taskId: parsed.id as string, taskState }
                            : msg
                        ),
                      };
                    });
                  }

                  // Update the streaming message content
                  if (accumulatedContent) {
                    setMessagesByAgent((prev) => {
                      const messages = prev[selectedAgent.id] ?? [];
                      return {
                        ...prev,
                        [selectedAgent.id]: messages.map((msg) =>
                          msg.id === assistantMessageId
                            ? { ...msg, content: accumulatedContent }
                            : msg
                        ),
                      };
                    });
                  }
                } catch {
                  // Ignore parse errors for malformed chunks
                }
              }
            }
          }
        }

        // Finalize the message
        const finalContent = accumulatedContent || extractResponseText(lastEventData);
        const isError =
          streamErrorMsg != null ||
          (lastEventData && (lastEventData as Record<string, unknown>).error != null) ||
          !!extractErrorSummary(lastEventData);
        const displayContent = streamErrorMsg ?? finalContent;
        if (isError && displayContent) {
          setChatError(displayContent);
        }
        setMessagesByAgent((prev) => {
          const messages = prev[selectedAgent.id] ?? [];
          return {
            ...prev,
            [selectedAgent.id]: messages.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: displayContent,
                    status: isError ? "error" : "complete",
                    error: isError ? displayContent : undefined,
                  }
                : msg
            ),
          };
        });

        // Update RPC log
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - startedAtMs;
        setRpcLogsByAgent((prev) => {
          const existing = prev[selectedAgent.id] ?? [];
          return {
            ...prev,
            [selectedAgent.id]: existing.map((log) =>
              log.id === rpcLogId
                ? { ...log, responsePayload: lastEventData, completedAt, durationMs }
                : log
            ),
          };
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Streaming failed";
        setChatError(errorMessage);
        setMessagesByAgent((prev) => {
          const messages = prev[selectedAgent.id] ?? [];
          return {
            ...prev,
            [selectedAgent.id]: messages.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: `Error: ${errorMessage}`,
                    status: "error",
                    error: errorMessage,
                  }
                : msg
            ),
          };
        });
      } finally {
        setSending(false);
      }
    } else {
      // Non-streaming fallback
      try {
        const response = await fetch("/api/agents/rpc", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            cardUrl: selectedAgent.url || undefined,
            endpointUrl: endpointUrl || undefined,
            method,
            params: requestParams,
            auth: authByAgent[selectedAgent.id],
          }),
        });

        const data = await response.json();
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - startedAtMs;
        setRpcLogsByAgent((prev) => {
          const existing = prev[selectedAgent.id] ?? [];
          const updated = existing.map((log) =>
            log.id === rpcLogId
              ? {
                  ...log,
                  responsePayload: data,
                  status: data.status,
                  completedAt,
                  durationMs,
                }
              : log
          );
          if (!updated.some((log) => log.id === rpcLogId)) {
            const rpcHeaders: Record<string, string> = {
              "Content-Type": "application/json",
              Accept: "application/json",
              ...buildAuthHeaders(authByAgent[selectedAgent.id]),
            };
            updated.push({
              id: rpcLogId,
              endpointUrl,
              requestPayload: payload,
              requestHeaders: rpcHeaders,
              responsePayload: data,
              status: data.status,
              startedAt,
              completedAt,
              durationMs,
            });
          }
          return {
            ...prev,
            [selectedAgent.id]: updated,
          };
        });

        const responsePayload = data.data ?? data;
        const responseRecord = responsePayload as Record<string, unknown>;

        // Extract contextId from response
        const responseContextId = responseRecord?.contextId as string | undefined;
        if (responseContextId) {
          setContextIdByAgent((prev) => ({
            ...prev,
            [selectedAgent.id]: responseContextId,
          }));
        }

        // Extract taskId from response (for continuing tasks with input-required state)
        const responseTaskId = responseRecord?.id as string | undefined;
        const responseStatus = responseRecord?.status as Record<string, unknown> | undefined;
        const responseState = responseStatus?.state as string | undefined;

        // Track task in the task panel
        if (responseTaskId && responseState) {
          setTrackedTasksByAgent((prev) => {
            const existingTasks = prev[selectedAgent.id] ?? [];
            const existingTaskIndex = existingTasks.findIndex((t) => t.taskId === responseTaskId);
            const now = new Date().toISOString();
            const taskData: TrackedTask = {
              taskId: responseTaskId,
              contextId: responseContextId,
              state: responseState,
              lastUpdated: now,
              createdAt: existingTaskIndex >= 0 ? existingTasks[existingTaskIndex].createdAt : now,
              message:
                typeof responseStatus?.message === "string" ? responseStatus.message : undefined,
            };

            if (existingTaskIndex >= 0) {
              // Update existing task
              const updated = [...existingTasks];
              updated[existingTaskIndex] = taskData;
              return { ...prev, [selectedAgent.id]: updated };
            } else {
              // Add new task at the beginning
              return { ...prev, [selectedAgent.id]: [taskData, ...existingTasks] };
            }
          });
        }

        if (responseTaskId && responseState === "input-required") {
          setTaskIdByAgent((prev) => ({
            ...prev,
            [selectedAgent.id]: responseTaskId,
          }));
        } else if (
          responseState === "completed" ||
          responseState === "failed" ||
          responseState === "canceled"
        ) {
          // Clear taskId when task is finished
          setTaskIdByAgent((prev) => {
            const newState = { ...prev };
            delete newState[selectedAgent.id];
            return newState;
          });
        }

        const errorSummary = extractErrorSummary(responsePayload);
        if (errorSummary) {
          setChatError(errorSummary);
        }
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: extractResponseText(responsePayload),
          timestamp: new Date().toISOString(),
          status: errorSummary ? "error" : "complete",
          error: errorSummary || undefined,
        };

        setMessagesByAgent((prev) => ({
          ...prev,
          [selectedAgent.id]: [...(prev[selectedAgent.id] ?? []), assistantMessage],
        }));
      } catch (error) {
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - startedAtMs;
        const responsePayload = {
          error: error instanceof Error ? error.message : "Request failed.",
        };
        setRpcLogsByAgent((prev) => {
          const existing = prev[selectedAgent.id] ?? [];
          const updated = existing.map((log) =>
            log.id === rpcLogId
              ? {
                  ...log,
                  responsePayload,
                  completedAt,
                  durationMs,
                }
              : log
          );
          if (!updated.some((log) => log.id === rpcLogId)) {
            const rpcHeaders: Record<string, string> = {
              "Content-Type": "application/json",
              Accept: "application/json",
              ...buildAuthHeaders(authByAgent[selectedAgent.id]),
            };
            updated.push({
              id: rpcLogId,
              endpointUrl,
              requestPayload: payload,
              requestHeaders: rpcHeaders,
              responsePayload,
              startedAt,
              completedAt,
              durationMs,
            });
          }
          return {
            ...prev,
            [selectedAgent.id]: updated,
          };
        });
        const errorMessage = error instanceof Error ? error.message : "Request failed.";
        setChatError(errorMessage);
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Request failed: ${errorMessage}`,
          timestamp: new Date().toISOString(),
          status: "error",
          error: errorMessage,
        };
        setMessagesByAgent((prev) => ({
          ...prev,
          [selectedAgent.id]: [...(prev[selectedAgent.id] ?? []), assistantMessage],
        }));
      } finally {
        setSending(false);
      }
    }
  };

  const handleNewConversation = () => {
    if (!selectedAgent) return;

    // Clear messages, context, and task for this agent
    setMessagesByAgent((prev) => ({
      ...prev,
      [selectedAgent.id]: [],
    }));
    setContextIdByAgent((prev) => {
      const newState = { ...prev };
      delete newState[selectedAgent.id];
      return newState;
    });
    setTaskIdByAgent((prev) => {
      const newState = { ...prev };
      delete newState[selectedAgent.id];
      return newState;
    });
    setChatError(null);
  };

  const handleDeleteAgent = (agentId: string) => {
    // Remove agent from list
    setAgents((prev) => prev.filter((agent) => agent.id !== agentId));

    // Clean up all related state
    setMessagesByAgent((prev) => {
      const newState = { ...prev };
      delete newState[agentId];
      return newState;
    });
    setRpcLogsByAgent((prev) => {
      const newState = { ...prev };
      delete newState[agentId];
      return newState;
    });
    setEndpointByAgent((prev) => {
      const newState = { ...prev };
      delete newState[agentId];
      return newState;
    });
    setMethodByAgent((prev) => {
      const newState = { ...prev };
      delete newState[agentId];
      return newState;
    });
    setContextIdByAgent((prev) => {
      const newState = { ...prev };
      delete newState[agentId];
      return newState;
    });
    setTaskIdByAgent((prev) => {
      const newState = { ...prev };
      delete newState[agentId];
      return newState;
    });
    setAuthByAgent((prev) => {
      const newState = { ...prev };
      delete newState[agentId];
      return newState;
    });
    setTrackedTasksByAgent((prev) => {
      const newState = { ...prev };
      delete newState[agentId];
      return newState;
    });

    // If the deleted agent was selected, clear selection
    if (selectedAgentId === agentId) {
      setSelectedAgentId(null);
    }
  };

  const handleFetchTask = async (taskId: string) => {
    if (!selectedAgent || !taskId.trim()) return;

    if (!selectedAgent.url) {
      setChatError("Missing agent card URL. Re-register the agent.");
      return;
    }

    setFetchingTask(true);
    setChatError(null);

    try {
      const response = await fetch("/api/agents/task", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          cardUrl: selectedAgent.url,
          taskId: taskId.trim(),
          historyLength: 10,
          auth: authByAgent[selectedAgent.id],
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        setChatError(data.error || "Failed to fetch task");
        return;
      }

      const task = data.data as Record<string, unknown>;
      const taskStatus = task?.status as Record<string, unknown> | undefined;
      const taskState = taskStatus?.state as string | undefined;
      const taskContextId = task?.contextId as string | undefined;

      if (taskState) {
        setTrackedTasksByAgent((prev) => {
          const existingTasks = prev[selectedAgent.id] ?? [];
          const existingTaskIndex = existingTasks.findIndex((t) => t.taskId === taskId);
          const now = new Date().toISOString();
          const taskData: TrackedTask = {
            taskId,
            contextId: taskContextId,
            state: taskState,
            lastUpdated: now,
            createdAt: existingTaskIndex >= 0 ? existingTasks[existingTaskIndex].createdAt : now,
            message: typeof taskStatus?.message === "string" ? taskStatus.message : undefined,
          };

          if (existingTaskIndex >= 0) {
            const updated = [...existingTasks];
            updated[existingTaskIndex] = taskData;
            return { ...prev, [selectedAgent.id]: updated };
          } else {
            return { ...prev, [selectedAgent.id]: [taskData, ...existingTasks] };
          }
        });
      }

      setTaskIdInput("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Failed to fetch task");
    } finally {
      setFetchingTask(false);
    }
  };

  const handleExport = (format: "json" | "md") => {
    if (!selectedAgent) return;

    const messages = messagesByAgent[selectedAgent.id] ?? [];
    if (messages.length === 0) return;

    const metadata = {
      agentName: selectedAgent.name,
      agentId: selectedAgent.id,
      contextId: contextIdByAgent[selectedAgent.id],
    };

    const content =
      format === "json" ? exportToJson(messages, metadata) : exportToMarkdown(messages, metadata);

    const filename = generateExportFilename(selectedAgent.name, format);
    const mimeType = format === "json" ? "application/json" : "text/markdown";

    downloadFile(content, filename, mimeType);
  };

  const handleRetry = (errorMessageId: string) => {
    if (!selectedAgent) return;

    const messages = messagesByAgent[selectedAgent.id] ?? [];
    const errorIndex = messages.findIndex((m) => m.id === errorMessageId);

    if (errorIndex === -1) return;

    // Find the previous user message to retry
    let userMessageContent = "";
    for (let i = errorIndex - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        userMessageContent = messages[i].content;
        break;
      }
    }

    if (!userMessageContent) return;

    // Remove the error message
    setMessagesByAgent((prev) => ({
      ...prev,
      [selectedAgent.id]: messages.filter((m) => m.id !== errorMessageId),
    }));

    // Resend the message (the user message is already in the history)
    // We need to send without adding another user message
    handleSendMessage(userMessageContent);
  };

  return (
    <div className="flex h-dvh w-full flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bot className="h-3.5 w-3.5" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">AgentiCat</h1>
            <p className="text-[11px] text-muted-foreground">A2A Protocol Dashboard</p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex-1 min-h-0 p-3">
        <ResizablePanelGroup
          groupRef={panelGroupRef}
          id="main-panels"
          orientation={panelOrientation}
          className="h-full w-full"
          resizeTargetMinimumSize={{ fine: 8, coarse: 24 }}
          onLayoutChanged={(layout) => {
            if (!allowPersistLayoutRef.current) return;
            setSavedPanelLayout((prev) => {
              const next = { ...prev, [panelOrientation]: layout };
              try {
                window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(next));
              } catch {
                // ignore
              }
              return next;
            });
          }}
        >
          <ResizablePanel
            id="agents"
            defaultSize={panelOrientation === "horizontal" ? "280px" : "35%"}
            minSize={panelOrientation === "horizontal" ? "200px" : "25%"}
            maxSize={panelOrientation === "horizontal" ? "50%" : "60%"}
            className="min-w-0"
          >
            <Card className="flex min-h-0 h-full flex-col border-border/60 pt-0">
              <div className="flex items-center gap-2.5 border-b border-border/60 px-3 py-2">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <div className="flex-1">
                  <h3 className="text-xs font-semibold">Agents</h3>
                  <p className="text-[10px] text-muted-foreground">{agents.length} registered</p>
                </div>
                <Dialog open={registerDialogOpen} onOpenChange={setRegisterDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="h-7 gap-1.5 text-[11px]">
                      <Plus className="h-3 w-3" />
                      Add
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-2xl w-[90vw] max-h-[85vh] flex flex-col">
                    <DialogHeader>
                      <DialogTitle>Register Agent</DialogTitle>
                      <DialogDescription>
                        Connect to an A2A-compatible agent by URL or paste its card JSON.
                      </DialogDescription>
                    </DialogHeader>
                    <Tabs
                      value={registerMode}
                      onValueChange={(value) => setRegisterMode(value as "url" | "json")}
                      className="w-full flex-1 flex flex-col min-h-0"
                    >
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="url" className="gap-1.5 text-xs">
                          <Link2 className="h-3 w-3" />
                          Card URL
                        </TabsTrigger>
                        <TabsTrigger value="json" className="gap-1.5 text-xs">
                          <FileJson className="h-3 w-3" />
                          Paste JSON
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="url" className="mt-4 space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="card-url" className="text-sm font-medium">
                            Agent Card URL
                          </Label>
                          <Input
                            id="card-url"
                            placeholder="https://agent.example.com"
                            value={cardUrl}
                            onChange={(event) => setCardUrl(event.target.value)}
                            className="text-sm"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Enter the base URL or full path to the agent card JSON.
                          </p>
                        </div>
                        <Button
                          onClick={handleRegister}
                          disabled={registering}
                          className="w-full gap-2"
                        >
                          {registering ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Validating...
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4" />
                              Register Agent
                            </>
                          )}
                        </Button>
                      </TabsContent>
                      <TabsContent
                        value="json"
                        className="mt-4 space-y-4 flex-1 flex flex-col min-h-0"
                      >
                        <div className="space-y-2 flex-1 flex flex-col min-h-0">
                          <Label htmlFor="card-json" className="text-sm font-medium">
                            Agent Card JSON
                          </Label>
                          <Textarea
                            id="card-json"
                            placeholder='{"name": "My Agent", "url": "https://...", ...}'
                            value={cardJson}
                            onChange={(event) => setCardJson(event.target.value)}
                            className="font-mono text-xs flex-1 min-h-[300px] max-h-[50vh] resize-none overflow-auto"
                          />
                        </div>
                        <Button
                          onClick={handleRegister}
                          disabled={registering}
                          className="w-full gap-2"
                        >
                          {registering ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Validating...
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4" />
                              Register Agent
                            </>
                          )}
                        </Button>
                      </TabsContent>
                    </Tabs>
                    {registerError && <p className="text-sm text-destructive">{registerError}</p>}
                  </DialogContent>
                </Dialog>
              </div>
              <ScrollArea className="flex-1">
                <div className="flex flex-col gap-1.5 p-2">
                  {agents.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Bot className="h-8 w-8 text-muted-foreground/50" />
                      <p className="mt-2 text-xs text-muted-foreground">No agents registered</p>
                      <p className="text-[10px] text-muted-foreground/70">
                        Click &quot;Add&quot; to get started
                      </p>
                    </div>
                  )}
                  <DndContext sensors={sensors} onDragEnd={handleAgentDragEnd}>
                    <SortableContext
                      items={agents.map((a) => a.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {agents.map((agent) => (
                        <SortableAgentCard
                          key={agent.id}
                          agent={agent}
                          isSelected={selectedAgentId === agent.id}
                          onSelect={() => setSelectedAgentId(agent.id)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              </ScrollArea>
            </Card>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="content" minSize="40%">
            <Card className="flex min-h-0 h-full flex-col overflow-hidden border-border/60 pt-0">
              {!selectedAgent ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Bot className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">No agent selected</p>
                    <p className="text-xs text-muted-foreground">
                      Select an agent from the list to start chatting
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="border-b border-border/60 bg-muted/30 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      {/* Left side - Agent metadata */}
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                            <Bot className="h-3.5 w-3.5" />
                          </div>
                          <h2 className="text-base font-semibold tracking-tight">
                            {selectedAgent.name}
                          </h2>
                          {selectedAgent.version && (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              v{selectedAgent.version}
                            </Badge>
                          )}
                          {selectedAgent.protocolVersion && (
                            <Badge variant="secondary" className="text-[10px]">
                              A2A {selectedAgent.protocolVersion}
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] gap-1 px-2 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowRawJson(true)}
                          >
                            <Code className="h-3 w-3" />
                            JSON
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-6 text-[10px] gap-1 px-2 ${
                              authByAgent[selectedAgent.id]?.type &&
                              authByAgent[selectedAgent.id]?.type !== "none"
                                ? "text-green-600 dark:text-green-400"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={() => setAuthDialogOpen(true)}
                          >
                            <Key className="h-3 w-3" />
                            Auth
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-6 text-[10px] gap-1 px-2 ${
                              (trackedTasksByAgent[selectedAgent.id]?.length ?? 0) > 0
                                ? "text-blue-600 dark:text-blue-400"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={() => setTaskPanelOpen(true)}
                          >
                            <ListTodo className="h-3 w-3" />
                            Tasks
                            {(trackedTasksByAgent[selectedAgent.id]?.length ?? 0) > 0 && (
                              <span className="ml-0.5 rounded-full bg-blue-500/20 px-1.5 text-[9px]">
                                {trackedTasksByAgent[selectedAgent.id].length}
                              </span>
                            )}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground max-w-lg">
                          {selectedAgent.description || "No description provided."}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {selectedAgent.capabilities.streaming && (
                            <Badge
                              variant="outline"
                              className="gap-1 text-[10px] border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            >
                              <Zap className="h-2.5 w-2.5" />
                              Streaming
                            </Badge>
                          )}
                          {selectedAgent.capabilities.pushNotifications && (
                            <Badge
                              variant="outline"
                              className="gap-1 text-[10px] border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                            >
                              <Radio className="h-2.5 w-2.5" />
                              Push
                            </Badge>
                          )}
                          {selectedAgent.capabilities.stateTransitionHistory && (
                            <Badge
                              variant="outline"
                              className="gap-1 text-[10px] border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
                            >
                              <History className="h-2.5 w-2.5" />
                              History
                            </Badge>
                          )}
                        </div>
                        {enrichedProvider?.organization && (
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1">
                            <span className="font-medium">Provider:</span>
                            {enrichedProvider.url && enrichedProvider.url !== "null" ? (
                              <a
                                href={enrichedProvider.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                {enrichedProvider.organization}
                              </a>
                            ) : (
                              <span>{enrichedProvider.organization}</span>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Right side - Technical info */}
                      <div className="flex flex-col gap-2 items-end">
                        <div className="flex gap-3">
                          <div className="min-w-[180px] space-y-1.5">
                            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Endpoint
                            </Label>
                            <Select
                              value={
                                endpointByAgent[selectedAgent.id] ??
                                selectedAgent.endpoints[0]?.url ??
                                ""
                              }
                              onValueChange={(value) =>
                                setEndpointByAgent((prev) => ({
                                  ...prev,
                                  [selectedAgent.id]: value,
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <Server className="mr-2 h-3 w-3 text-muted-foreground" />
                                <SelectValue placeholder="Choose endpoint" />
                              </SelectTrigger>
                              <SelectContent>
                                {selectedAgent.endpoints.map((endpoint) => (
                                  <SelectItem
                                    key={endpoint.id}
                                    value={endpoint.url}
                                    className="text-xs"
                                  >
                                    {endpoint.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              placeholder="Or paste full URL (e.g. …/supply-chain-query)"
                              className="h-8 text-xs font-mono mt-1.5"
                              value={endpointOverrideByAgent[selectedAgent.id] ?? ""}
                              onChange={(e) =>
                                setEndpointOverrideByAgent((prev) => ({
                                  ...prev,
                                  [selectedAgent.id]: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="min-w-[140px] space-y-1.5">
                            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Method
                            </Label>
                            <Select
                              value={methodByAgent[selectedAgent.id] ?? DEFAULT_METHOD}
                              onValueChange={(value) =>
                                setMethodByAgent((prev) => ({
                                  ...prev,
                                  [selectedAgent.id]: value,
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 text-xs font-mono">
                                <SelectValue placeholder="Select method" />
                              </SelectTrigger>
                              <SelectContent>
                                {SUPPORTED_METHODS.map((method) => (
                                  <SelectItem
                                    key={method.value}
                                    value={method.value}
                                    className="text-xs font-mono"
                                  >
                                    {method.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {(enrichedModes.inputModes.length > 0 ||
                          enrichedModes.outputModes.length > 0) && (
                          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground justify-end">
                            {enrichedModes.inputModes.length > 0 && (
                              <div className="flex items-center gap-1.5">
                                <ArrowDownToLine className="h-3 w-3" />
                                <span className="font-medium">Input:</span>
                                <span>{enrichedModes.inputModes.join(", ")}</span>
                              </div>
                            )}
                            {enrichedModes.outputModes.length > 0 && (
                              <div className="flex items-center gap-1.5">
                                <ArrowUpFromLine className="h-3 w-3" />
                                <span className="font-medium">Output:</span>
                                <span>{enrichedModes.outputModes.join(", ")}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between gap-2">
                      {enrichedSkills.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mr-1">
                            Skills:
                          </span>
                          {enrichedSkills.map((skill) => (
                            <Popover key={skill.name}>
                              <PopoverTrigger asChild>
                                <button type="button">
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] font-normal cursor-pointer hover:bg-secondary/80 transition-colors gap-1"
                                  >
                                    {skill.name}
                                    {skill.examples && skill.examples.length > 0 && (
                                      <Lightbulb className="h-2.5 w-2.5 text-amber-500" />
                                    )}
                                  </Badge>
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-80 p-0" align="start">
                                <div className="p-3 space-y-3">
                                  <div>
                                    <h4 className="font-medium text-sm">{skill.name}</h4>
                                    {skill.description && (
                                      <p className="text-xs text-muted-foreground mt-1">
                                        {skill.description}
                                      </p>
                                    )}
                                  </div>

                                  {skill.tags && skill.tags.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1">
                                      <Tag className="h-3 w-3 text-muted-foreground" />
                                      {skill.tags.map((tag) => (
                                        <Badge
                                          key={tag}
                                          variant="outline"
                                          className="text-[10px] px-1.5 py-0"
                                        >
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}

                                  {skill.examples && skill.examples.length > 0 && (
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                                        <Lightbulb className="h-3 w-3" />
                                        Example{skill.examples.length > 1 ? "s" : ""}
                                      </div>
                                      <div className="space-y-2">
                                        {skill.examples.map((example, idx) => (
                                          <div
                                            key={idx}
                                            className="text-xs bg-muted/50 rounded-md p-2 border border-border/50"
                                          >
                                            <p className="text-muted-foreground italic">
                                              &ldquo;{example}&rdquo;
                                            </p>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 mt-1.5 text-[10px] gap-1 px-2"
                                              onClick={() => {
                                                handleSendMessage(example);
                                              }}
                                            >
                                              <ChevronRight className="h-3 w-3" />
                                              Try this
                                            </Button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </PopoverContent>
                            </Popover>
                          ))}
                        </div>
                      ) : (
                        <div />
                      )}
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={handleNewConversation}
                          disabled={!messagesByAgent[selectedAgent.id]?.length}
                        >
                          <RotateCcw className="h-3 w-3" />
                          New Chat
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => handleExport("md")}
                          disabled={!messagesByAgent[selectedAgent.id]?.length}
                        >
                          <Download className="h-3 w-3" />
                          Export
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteAgent(selectedAgent.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>

                  <Tabs defaultValue="chat" className="flex h-full min-h-0 flex-col">
                    <TabsList className="mx-4 mt-2 h-8 w-fit bg-muted/50">
                      <TabsTrigger value="chat" className="gap-1.5 text-xs px-3">
                        <MessageSquare className="h-3 w-3" />
                        Chat
                      </TabsTrigger>
                      <TabsTrigger value="debug" className="gap-1.5 text-xs px-3">
                        <Bug className="h-3 w-3" />
                        Debug
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="chat" className="flex flex-1 min-h-0 flex-col">
                      <AgentChat
                        messages={selectedMessages}
                        endpointLabel={
                          endpointByAgent[selectedAgent.id] ??
                          selectedAgent.endpoints[0]?.url ??
                          "Select an endpoint"
                        }
                        sending={sending}
                        chatError={chatError}
                        onSend={handleSendMessage}
                        onRetry={handleRetry}
                      />
                    </TabsContent>

                    <TabsContent value="debug" className="flex flex-1 min-h-0 flex-col">
                      <AgentDebug
                        logs={selectedLogs}
                        buildCurl={buildCurl}
                        formatJson={formatJson}
                        formatDuration={formatDuration}
                        extractRpcMethod={extractRpcMethod}
                      />
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </Card>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>

      {/* Raw JSON Dialog */}
      <Dialog open={showRawJson} onOpenChange={setShowRawJson}>
        <DialogContent className="max-w-5xl w-[90vw] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code className="h-4 w-4" />
              Agent Card JSON
            </DialogTitle>
            <DialogDescription>Raw agent card data for {selectedAgent?.name}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto rounded-md border">
            <pre className="p-4 text-xs font-mono leading-relaxed hljs min-w-max">
              <code
                className="language-json"
                dangerouslySetInnerHTML={{
                  __html: hljs.highlight(
                    selectedAgent?.raw ? JSON.stringify(selectedAgent.raw, null, 2) : "{}",
                    { language: "json" }
                  ).value,
                }}
              />
            </pre>
          </div>
          <div className="flex justify-between items-center pt-2">
            <div className="text-xs text-muted-foreground">
              {selectedAgent?.url && (
                <a
                  href={selectedAgent.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open Agent Card URL
                </a>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (selectedAgent?.raw) {
                  navigator.clipboard.writeText(JSON.stringify(selectedAgent.raw, null, 2));
                }
              }}
            >
              Copy to Clipboard
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Auth Configuration Dialog */}
      <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Authentication
            </DialogTitle>
            <DialogDescription>
              Configure authentication for {selectedAgent?.name}
            </DialogDescription>
          </DialogHeader>
          {selectedAgent && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Auth Type</Label>
                <Select
                  value={authByAgent[selectedAgent.id]?.type ?? "none"}
                  onValueChange={(value: "none" | "bearer" | "apiKey" | "custom") => {
                    setAuthByAgent((prev) => ({
                      ...prev,
                      [selectedAgent.id]: {
                        ...prev[selectedAgent.id],
                        type: value,
                      },
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select auth type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="bearer">Bearer Token</SelectItem>
                    <SelectItem value="apiKey">API Key</SelectItem>
                    <SelectItem value="custom">Custom Headers</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {authByAgent[selectedAgent.id]?.type === "bearer" && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Bearer Token</Label>
                  <Input
                    type="password"
                    autoComplete="off"
                    data-1p-ignore
                    placeholder="Enter your bearer token"
                    value={authByAgent[selectedAgent.id]?.token ?? ""}
                    onChange={(e) => {
                      setAuthByAgent((prev) => ({
                        ...prev,
                        [selectedAgent.id]: {
                          ...prev[selectedAgent.id],
                          type: "bearer",
                          token: e.target.value,
                        },
                      }));
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Will be sent as: Authorization: Bearer [token]
                  </p>
                </div>
              )}

              {authByAgent[selectedAgent.id]?.type === "apiKey" && (
                <>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Header Name</Label>
                    <Input
                      placeholder="e.g., X-API-Key"
                      autoComplete="off"
                      data-1p-ignore
                      value={authByAgent[selectedAgent.id]?.apiKeyHeader ?? ""}
                      onChange={(e) => {
                        setAuthByAgent((prev) => ({
                          ...prev,
                          [selectedAgent.id]: {
                            ...prev[selectedAgent.id],
                            type: "apiKey",
                            apiKeyHeader: e.target.value,
                          },
                        }));
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">API Key Value</Label>
                    <Input
                      type="password"
                      autoComplete="off"
                      data-1p-ignore
                      placeholder="Enter your API key"
                      value={authByAgent[selectedAgent.id]?.apiKeyValue ?? ""}
                      onChange={(e) => {
                        setAuthByAgent((prev) => ({
                          ...prev,
                          [selectedAgent.id]: {
                            ...prev[selectedAgent.id],
                            type: "apiKey",
                            apiKeyValue: e.target.value,
                          },
                        }));
                      }}
                    />
                  </div>
                </>
              )}

              {authByAgent[selectedAgent.id]?.type === "custom" && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Custom Headers</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Use the exact header names the agent expects (e.g. client_id, client_secret).
                  </p>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {customHeaderRows.map((row, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input
                          placeholder="Header name (e.g. X-API-Key)"
                          className="font-mono text-xs flex-1 min-w-0"
                          value={row.key}
                          onChange={(e) => {
                            const next = customHeaderRows.map((r, j) =>
                              j === i ? { ...r, key: e.target.value } : r
                            );
                            setCustomHeaderRows(next);
                            setAuthByAgent((prev) => ({
                              ...prev,
                              [selectedAgent.id]: {
                                ...prev[selectedAgent.id],
                                type: "custom",
                                customHeaders: next
                                  .filter((r) => r.key.trim() !== "")
                                  .reduce((acc, r) => ({ ...acc, [r.key.trim()]: r.value }), {}),
                              },
                            }));
                          }}
                        />
                        <Input
                          type="password"
                          autoComplete="off"
                          data-1p-ignore
                          placeholder="Value"
                          className="font-mono text-xs flex-1 min-w-0"
                          value={row.value}
                          onChange={(e) => {
                            const next = customHeaderRows.map((r, j) =>
                              j === i ? { ...r, value: e.target.value } : r
                            );
                            setCustomHeaderRows(next);
                            setAuthByAgent((prev) => ({
                              ...prev,
                              [selectedAgent.id]: {
                                ...prev[selectedAgent.id],
                                type: "custom",
                                customHeaders: next
                                  .filter((r) => r.key.trim() !== "")
                                  .reduce((acc, r) => ({ ...acc, [r.key.trim()]: r.value }), {}),
                              },
                            }));
                          }}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            const next = customHeaderRows.filter((_, j) => j !== i);
                            setCustomHeaderRows(next.length ? next : [{ key: "", value: "" }]);
                            setAuthByAgent((prev) => ({
                              ...prev,
                              [selectedAgent.id]: {
                                ...prev[selectedAgent.id],
                                type: "custom",
                                customHeaders: next
                                  .filter((r) => r.key.trim() !== "")
                                  .reduce((acc, r) => ({ ...acc, [r.key.trim()]: r.value }), {}),
                              },
                            }));
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setCustomHeaderRows((prev) => [...prev, { key: "", value: "" }])}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add header
                  </Button>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAuthByAgent((prev) => {
                      const newState = { ...prev };
                      delete newState[selectedAgent.id];
                      return newState;
                    });
                  }}
                >
                  Clear
                </Button>
                <Button size="sm" onClick={() => setAuthDialogOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Task Panel Dialog */}
      <Dialog open={taskPanelOpen} onOpenChange={setTaskPanelOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListTodo className="h-4 w-4" />
              Tasks
            </DialogTitle>
            <DialogDescription>
              Track and fetch task status for {selectedAgent?.name}
            </DialogDescription>
          </DialogHeader>
          {selectedAgent && (
            <div className="flex flex-col gap-4 flex-1 min-h-0">
              {/* Fetch Task Section */}
              <div className="space-y-2 p-3 bg-muted/30 rounded-lg border">
                <Label className="text-sm font-medium">Fetch Task by ID</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter task ID..."
                    value={taskIdInput}
                    onChange={(e) => setTaskIdInput(e.target.value)}
                    className="text-sm font-mono"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && taskIdInput.trim()) {
                        handleFetchTask(taskIdInput);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={fetchingTask || !taskIdInput.trim()}
                    onClick={() => handleFetchTask(taskIdInput)}
                  >
                    {fetchingTask ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Use the tasks/get method to fetch status for any task ID
                </p>
              </div>

              {/* Active Task */}
              {taskIdByAgent[selectedAgent.id] && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Active Task (Input Required)
                  </Label>
                  <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                    <div className="flex items-center justify-between">
                      <code className="text-xs font-mono text-amber-600 dark:text-amber-400">
                        {taskIdByAgent[selectedAgent.id]}
                      </code>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-amber-500/30 bg-amber-500/10 text-amber-600"
                      >
                        input-required
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Continue this conversation in the chat
                    </p>
                  </div>
                </div>
              )}

              {/* Tracked Tasks */}
              <div className="flex-1 min-h-0 space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Task History ({trackedTasksByAgent[selectedAgent.id]?.length ?? 0})
                </Label>
                <ScrollArea className="h-[250px] rounded-lg border">
                  {(trackedTasksByAgent[selectedAgent.id]?.length ?? 0) === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                      <ListTodo className="h-8 w-8 text-muted-foreground/50 mb-2" />
                      <p className="text-xs text-muted-foreground">No tasks tracked yet</p>
                      <p className="text-[10px] text-muted-foreground/70">
                        Tasks will appear here as you interact with the agent
                      </p>
                    </div>
                  ) : (
                    <div className="p-2 space-y-2">
                      {trackedTasksByAgent[selectedAgent.id]?.map((task) => {
                        const stateColors: Record<string, string> = {
                          submitted: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
                          working: "border-blue-500/30 bg-blue-500/10 text-blue-600",
                          completed: "border-green-500/30 bg-green-500/10 text-green-600",
                          failed: "border-red-500/30 bg-red-500/10 text-red-600",
                          canceled: "border-gray-500/30 bg-gray-500/10 text-gray-600",
                          "input-required": "border-amber-500/30 bg-amber-500/10 text-amber-600",
                        };
                        const colorClass = stateColors[task.state] || "border-border bg-muted/30";

                        return (
                          <div
                            key={task.taskId}
                            className={`p-2.5 rounded-lg border ${colorClass.split(" ").slice(0, 2).join(" ")}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <code className="text-[11px] font-mono truncate flex-1">
                                {task.taskId}
                              </code>
                              <Badge
                                variant="outline"
                                className={`text-[9px] shrink-0 ${colorClass}`}
                              >
                                {task.state}
                              </Badge>
                            </div>
                            {task.message && (
                              <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                                {task.message}
                              </p>
                            )}
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-[9px] text-muted-foreground">
                                Updated: {new Date(task.lastUpdated).toLocaleTimeString()}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 text-[10px] px-1.5"
                                onClick={() => handleFetchTask(task.taskId)}
                                disabled={fetchingTask}
                              >
                                <RefreshCw
                                  className={`h-3 w-3 ${fetchingTask ? "animate-spin" : ""}`}
                                />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </div>

              <div className="flex justify-between items-center pt-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => {
                    setTrackedTasksByAgent((prev) => ({
                      ...prev,
                      [selectedAgent.id]: [],
                    }));
                  }}
                >
                  Clear History
                </Button>
                <Button size="sm" onClick={() => setTaskPanelOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
