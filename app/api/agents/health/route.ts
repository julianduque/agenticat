import { NextResponse } from "next/server";

type HealthRequest = {
  cardUrl?: string;
};

export async function POST(request: Request) {
  let body: HealthRequest;

  try {
    body = (await request.json()) as HealthRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const cardUrl = typeof body.cardUrl === "string" ? body.cardUrl : "";

  if (!cardUrl) {
    return NextResponse.json(
      { ok: false, error: "Missing cardUrl." },
      { status: 400 }
    );
  }

  try {
    const startTime = Date.now();
    
    const response = await fetch(cardUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
      // Set a timeout for the health check
      signal: AbortSignal.timeout(10000),
    });

    const latency = Date.now() - startTime;

    if (!response.ok) {
      return NextResponse.json({
        ok: true,
        healthy: false,
        status: response.status,
        statusText: response.statusText,
        latency,
      });
    }

    // Try to parse the agent card to verify it's valid
    const agentCard = await response.json();
    const isValidCard = 
      typeof agentCard === "object" &&
      agentCard !== null &&
      typeof agentCard.name === "string";

    return NextResponse.json({
      ok: true,
      healthy: isValidCard,
      status: response.status,
      latency,
      agentName: agentCard.name,
      protocolVersion: agentCard.protocolVersion,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Health check failed";
    const isTimeout = errorMessage.includes("timeout") || errorMessage.includes("aborted");
    
    return NextResponse.json({
      ok: true,
      healthy: false,
      error: isTimeout ? "Request timed out" : errorMessage,
    });
  }
}
