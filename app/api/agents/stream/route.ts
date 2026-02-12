import type { MessageSendParams } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import type { AgentAuthConfig } from "@/lib/a2a/schema";
import { buildAuthHeaders, getAuthTokenForSdk } from "@/lib/a2a/schema";

type StreamRequest = {
  cardUrl?: string;
  endpointUrl?: string;
  method?: string;
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
  return typeof message.messageId === "string" && Array.isArray(message.parts);
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

  const response = await fetch(targetUrl.trim(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": "Agenticat/1.0 (A2A JSON-RPC client)",
      ...authHeaders,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const text = await response.text();
      if (text) {
        const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
        const msg = parsed?.error?.message ?? parsed?.message ?? text.slice(0, 200);
        detail = msg;
      }
    } catch {
      // use default detail
    }
    if (response.status === 404) {
      detail =
        "Endpoint returned 404 Not Found. Use the full endpoint URL including path (e.g. …/supply-chain-query). Check the agent docs for the exact JSON-RPC URL.";
    }
    if (response.status === 401) {
      detail =
        "401 Unauthorized. Check that your auth headers are correct and that header names match exactly (e.g. client_id, client_secret). Some agents are case-sensitive.";
    }
    const err = new Error(detail) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  return response;
}

export async function POST(request: Request) {
  let body: StreamRequest;

  try {
    body = (await request.json()) as StreamRequest;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON payload." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cardUrl = typeof body.cardUrl === "string" ? body.cardUrl : "";
  const endpointUrl = typeof body.endpointUrl === "string" ? body.endpointUrl : "";
  const method = typeof body.method === "string" && body.method ? body.method : "message/stream";
  const params = body.params as Record<string, unknown> | undefined;
  const auth = body.auth;

  // Build auth headers for direct calls
  const authHeaders = buildAuthHeaders(auth);
  // Get bearer token for SDK calls
  const authToken = getAuthTokenForSdk(auth);

  const hasAuth = auth && auth.type !== "none";
  if (hasAuth && Object.keys(authHeaders).length === 0) {
    return new Response(
      JSON.stringify({
        ok: false,
        error:
          "Auth is configured but no headers were built. For custom headers, add at least one header with a name and value. For API key, set both header name and value. For bearer, set the token.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!cardUrl && !endpointUrl) {
    return new Response(JSON.stringify({ ok: false, error: "Missing cardUrl or endpointUrl." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isMessageSendParams(params)) {
    return new Response(JSON.stringify({ ok: false, error: "Missing params.message." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Use direct streaming when we have an endpoint and either no card URL or any auth.
    // The SDK only reliably supports bearer on card fetch; we control headers on direct calls.
    const useDirect = (!cardUrl && endpointUrl) || (endpointUrl && hasAuth);
    if (useDirect) {
      const upstreamResponse = await directStreamingCall(endpointUrl, method, params, authHeaders);

      // Check if the response is actually SSE
      const contentType = upstreamResponse.headers.get("Content-Type") || "";
      if (contentType.includes("text/event-stream") && upstreamResponse.body) {
        // Pass through the SSE stream
        return new Response(upstreamResponse.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      } else {
        // Not SSE, return the JSON response as a single event
        let data: unknown;
        try {
          const text = await upstreamResponse.text();
          data = text ? JSON.parse(text) : {};
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : "Invalid JSON response";
          return new Response(JSON.stringify({ ok: false, error: `Upstream response: ${msg}` }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }
        const encoder = new TextEncoder();
        const dataRecord = data as Record<string, unknown>;
        const stream = new ReadableStream({
          start(controller) {
            const result = dataRecord.result ?? data;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(result)}\n\n`));
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
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

    if (!supportsStreaming && endpointUrl) {
      // Card says no streaming but we have an endpoint: try direct streaming to endpoint
      const upstreamResponse = await directStreamingCall(endpointUrl, method, params, authHeaders);
      const contentType = upstreamResponse.headers.get("Content-Type") || "";
      if (contentType.includes("text/event-stream") && upstreamResponse.body) {
        return new Response(upstreamResponse.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }
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
          Connection: "keep-alive",
        },
      });
    }

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
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    const isAgentCard404 =
      cardUrl && err.message.includes("Failed to fetch Agent Card") && err.message.includes("404");
    if (isAgentCard404) {
      try {
        const upstreamResponse = await directStreamingCall(cardUrl, method, params, authHeaders);
        const contentType = upstreamResponse.headers.get("Content-Type") || "";
        if (contentType.includes("text/event-stream") && upstreamResponse.body) {
          return new Response(upstreamResponse.body, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }
        let data: Record<string, unknown>;
        try {
          const text = await upstreamResponse.text();
          data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "Upstream response was not valid JSON.",
            }),
            { status: 502, headers: { "Content-Type": "application/json" } }
          );
        }
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
            Connection: "keep-alive",
          },
        });
      } catch (fallbackError) {
        const msg = fallbackError instanceof Error ? fallbackError.message : "Request failed.";
        return new Response(JSON.stringify({ ok: false, error: msg }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const msg = err.message || "Request failed.";
    const status = (err as Error & { status?: number }).status;
    const isUpstream = typeof status === "number" && status >= 400 && status < 600;
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: isUpstream ? 502 : 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
