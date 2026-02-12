import type { MessageSendParams } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import { NextResponse } from "next/server";
import type { AgentAuthConfig } from "@/lib/a2a/schema";
import { buildAuthHeaders, getAuthTokenForSdk } from "@/lib/a2a/schema";

type RpcRequest = {
  cardUrl?: string;
  endpointUrl?: string;
  method?: string;
  params?: unknown;
  streaming?: boolean;
  auth?: AgentAuthConfig;
};

const isMessageSendParams = (value: unknown): value is MessageSendParams => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const message = record.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") {
    return false;
  }
  return typeof message.messageId === "string" && Array.isArray(message.parts);
};

// Make a direct JSON-RPC call to an endpoint
async function directJsonRpcCall(
  targetUrl: string,
  method: string,
  params: unknown,
  authHeaders: Record<string, string> = {}
): Promise<unknown> {
  const payload = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method,
    params,
  };

  const response = await fetch(targetUrl.trim(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Agenticat/1.0 (A2A JSON-RPC client)",
      ...authHeaders,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const text = await response.text();
      if (text) {
        const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
        detail = parsed?.error?.message ?? parsed?.message ?? text.slice(0, 200);
      }
    } catch {
      // keep detail
    }
    if (response.status === 404) {
      detail =
        "Endpoint returned 404 Not Found. Use the full endpoint URL including path (e.g. …/supply-chain-query). Check the agent docs for the exact JSON-RPC URL.";
    }
    if (response.status === 401) {
      detail =
        "401 Unauthorized. Check that auth header names match exactly (e.g. client_id, client_secret). Some agents are case-sensitive.";
    }
    throw new Error(detail);
  }

  const data = await response.json();

  // Handle JSON-RPC error response
  if (data.error) {
    const errorMsg = data.error.message || data.error.code || "RPC error";
    throw new Error(errorMsg);
  }

  return data.result ?? data;
}

export async function POST(request: Request) {
  let body: RpcRequest;

  try {
    body = (await request.json()) as RpcRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const cardUrl = typeof body.cardUrl === "string" ? body.cardUrl : "";
  const endpointUrl = typeof body.endpointUrl === "string" ? body.endpointUrl : "";
  const method = typeof body.method === "string" ? body.method : "message/send";
  const params = body.params as Record<string, unknown> | undefined;
  const useStreaming = body.streaming ?? true; // Default to streaming
  const auth = body.auth;

  // Build auth headers for direct calls
  const authHeaders = buildAuthHeaders(auth);
  // Get bearer token for SDK calls
  const authToken = getAuthTokenForSdk(auth);

  const hasAuth = auth && auth.type !== "none";
  if (hasAuth && Object.keys(authHeaders).length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Auth is configured but no headers were built. For custom headers, add at least one header with a name and value. For API key, set both header name and value. For bearer, set the token.",
      },
      { status: 400 }
    );
  }

  if (!cardUrl && !endpointUrl) {
    return NextResponse.json(
      { ok: false, error: "Missing cardUrl or endpointUrl." },
      { status: 400 }
    );
  }

  // Validate supported methods
  const supportedMethods = ["message/send", "message/stream"];
  if (!supportedMethods.includes(method)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Method '${method}' not supported. Use one of: ${supportedMethods.join(", ")}`,
      },
      { status: 400 }
    );
  }

  if (!isMessageSendParams(params)) {
    return NextResponse.json({ ok: false, error: "Missing params.message." }, { status: 400 });
  }

  // For message/stream, force streaming mode
  const requestStreaming = method === "message/stream" ? true : useStreaming;

  try {
    // Use direct call when we have an endpoint and either no card URL or any auth.
    // The SDK only reliably supports bearer on card fetch; we control headers on direct calls.
    const hasAuth = auth && auth.type !== "none";
    const useDirect = (!cardUrl && endpointUrl) || (endpointUrl && hasAuth);
    if (useDirect) {
      const data = await directJsonRpcCall(endpointUrl, method, params, authHeaders);
      return NextResponse.json({
        ok: true,
        status: 200,
        data,
        streaming: false,
      });
    }

    // Use SDK when we have a card URL
    const factory = new ClientFactory();
    const client = await factory.createFromUrl(cardUrl, authToken);
    const agentCard = await client.getAgentCard();
    const supportsStreaming = agentCard.capabilities?.streaming ?? false;

    // Use streaming if requested AND supported, otherwise use regular sendMessage
    if (requestStreaming && supportsStreaming) {
      // Streaming mode: collect all events and return the final state
      const events: unknown[] = [];
      let finalResult: unknown = null;

      for await (const event of client.sendMessageStream(params)) {
        events.push(event);
        // Keep track of the latest Task or Message
        const eventRecord = event as unknown as Record<string, unknown>;
        if (eventRecord.kind === "task" || eventRecord.kind === "message") {
          finalResult = event;
        }
        // Also check for status updates that indicate completion
        if (eventRecord.kind === "status-update") {
          const status = eventRecord.status as Record<string, unknown> | undefined;
          if (status?.state === "completed" || status?.state === "failed") {
            break;
          }
        }
      }

      return NextResponse.json({
        ok: true,
        status: 200,
        data: finalResult ?? events[events.length - 1] ?? null,
        events,
        streaming: true,
      });
    } else {
      // Non-streaming mode: regular sendMessage
      const data = await client.sendMessage(params);

      return NextResponse.json({
        ok: true,
        status: 200,
        data,
        streaming: false,
      });
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    const isAgentCard404 =
      cardUrl && err.message.includes("Failed to fetch Agent Card") && err.message.includes("404");
    if (isAgentCard404) {
      try {
        const data = await directJsonRpcCall(cardUrl, method, params, authHeaders);
        return NextResponse.json({
          ok: true,
          status: 200,
          data,
          streaming: false,
        });
      } catch (fallbackError) {
        return NextResponse.json(
          {
            ok: false,
            error: fallbackError instanceof Error ? fallbackError.message : "Request failed.",
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Request failed.",
      },
      { status: 500 }
    );
  }
}
