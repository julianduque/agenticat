import type { MessageSendParams } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import type { AgentAuthConfig } from "@/lib/a2a/schema";
import { buildAuthHeaders, getAuthTokenForSdk } from "@/lib/a2a/schema";

type StreamRequest = {
  cardUrl?: string;
  endpointUrl?: string;
  params?: unknown;
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
  return (
    typeof message.messageId === "string" &&
    Array.isArray(message.parts)
  );
};

// Direct streaming to an endpoint URL using SSE
async function directStreamingCall(
  targetUrl: string,
  method: string,
  params: unknown,
  authHeaders: Record<string, string> = {}
): Promise<Response> {
  const payload = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method,
    params,
  };

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...authHeaders,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response;
}

export async function POST(request: Request) {
  let body: StreamRequest;

  try {
    body = (await request.json()) as StreamRequest;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON payload." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const cardUrl = typeof body.cardUrl === "string" ? body.cardUrl : "";
  const endpointUrl = typeof body.endpointUrl === "string" ? body.endpointUrl : "";
  const params = body.params as Record<string, unknown> | undefined;
  const auth = body.auth;

  // Build auth headers for direct calls
  const authHeaders = buildAuthHeaders(auth);
  // Get bearer token for SDK calls
  const authToken = getAuthTokenForSdk(auth);

  if (!cardUrl && !endpointUrl) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing cardUrl or endpointUrl." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!isMessageSendParams(params)) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing params.message." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // If we have an endpoint URL but no card URL, use direct streaming
    if (!cardUrl && endpointUrl) {
      const upstreamResponse = await directStreamingCall(endpointUrl, "message/send", params, authHeaders);
      
      // Check if the response is actually SSE
      const contentType = upstreamResponse.headers.get("Content-Type") || "";
      if (contentType.includes("text/event-stream") && upstreamResponse.body) {
        // Pass through the SSE stream
        return new Response(upstreamResponse.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      } else {
        // Not SSE, return the JSON response as a single event
        const data = await upstreamResponse.json();
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const result = data.result ?? data;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(result)}\n\n`));
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }
    }

    // Use SDK when we have a card URL
    const factory = new ClientFactory();
    const client = await factory.createFromUrl(cardUrl, authToken);
    
    // Check if agent supports streaming
    const agentCard = await client.getAgentCard();
    const supportsStreaming = agentCard.capabilities?.streaming ?? false;
    
    if (!supportsStreaming) {
      return new Response(
        JSON.stringify({ ok: false, error: "Agent does not support streaming." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of client.sendMessageStream(params)) {
            const data = JSON.stringify(event);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
          // Send done event
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Stream failed";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Request failed.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
