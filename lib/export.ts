type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  status?: string;
  taskId?: string;
  taskState?: string;
};

type ExportMetadata = {
  agentName: string;
  agentId: string;
  contextId?: string;
  exportedAt: string;
};

type ConversationExport = {
  metadata: ExportMetadata;
  messages: ChatMessage[];
};

export function exportToJson(
  messages: ChatMessage[],
  metadata: Omit<ExportMetadata, "exportedAt">
): string {
  const exportData: ConversationExport = {
    metadata: {
      ...metadata,
      exportedAt: new Date().toISOString(),
    },
    messages,
  };
  return JSON.stringify(exportData, null, 2);
}

export function exportToMarkdown(
  messages: ChatMessage[],
  metadata: Omit<ExportMetadata, "exportedAt">
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Conversation with ${metadata.agentName}`);
  lines.push("");
  lines.push(`**Agent ID:** ${metadata.agentId}`);
  if (metadata.contextId) {
    lines.push(`**Context ID:** ${metadata.contextId}`);
  }
  lines.push(`**Exported:** ${new Date().toLocaleString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Messages
  for (const message of messages) {
    const timestamp = new Date(message.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const roleLabel = message.role === "user" ? "**You**" : "**Agent**";

    lines.push(`### ${roleLabel} (${timestamp})`);
    lines.push("");
    lines.push(message.content);
    lines.push("");

    if (message.taskId) {
      lines.push(`> Task: ${message.taskId}`);
      if (message.taskState) {
        lines.push(`> State: ${message.taskState}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function generateExportFilename(agentName: string, format: "json" | "md"): string {
  const sanitizedName = agentName.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `conversation-${sanitizedName}-${timestamp}.${format}`;
}
