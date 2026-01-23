import { NextResponse } from "next/server";

import { normalizeAgentCard } from "@/lib/a2a/schema";

type RegisterRequest = {
  cardUrl?: string;
  cardJson?: unknown;
};

export async function POST(request: Request) {
  let payload: RegisterRequest;

  try {
    payload = (await request.json()) as RegisterRequest;
  } catch {
    return NextResponse.json(
      { ok: false, errors: ["Invalid JSON payload."] },
      { status: 400 }
    );
  }

  const cardUrl = typeof payload.cardUrl === "string" ? payload.cardUrl : "";
  const hasJson = payload.cardJson !== undefined;

  if (!cardUrl && !hasJson) {
    return NextResponse.json(
      { ok: false, errors: ["Provide cardUrl or cardJson."] },
      { status: 400 }
    );
  }

  let cardData: unknown = payload.cardJson;
  let resolvedUrl = cardUrl;

  // If registering by JSON, try to extract URL from the card itself
  if (!resolvedUrl && hasJson && payload.cardJson && typeof payload.cardJson === "object") {
    const jsonCard = payload.cardJson as Record<string, unknown>;
    
    // Try to get URL from common fields in agent cards
    const cardUrlField = jsonCard.url ?? jsonCard.cardUrl ?? jsonCard.agentUrl;
    if (typeof cardUrlField === "string" && cardUrlField.trim()) {
      resolvedUrl = cardUrlField.trim();
    }
    
    // If still no URL, try to derive from endpoints
    if (!resolvedUrl) {
      const endpoints = jsonCard.endpoints;
      let endpointUrl: string | null = null;
      
      if (Array.isArray(endpoints) && endpoints.length > 0) {
        const firstEndpoint = endpoints[0] as Record<string, unknown> | null;
        if (firstEndpoint && typeof firstEndpoint.url === "string") {
          endpointUrl = firstEndpoint.url;
        }
      }
      
      // Try to construct card URL from endpoint (e.g., https://host/rpc -> https://host/.well-known/agent-card.json)
      if (endpointUrl) {
        try {
          const url = new URL(endpointUrl);
          resolvedUrl = `${url.origin}/.well-known/agent-card.json`;
        } catch {
          // If URL parsing fails, use the endpoint URL as-is for identification
          resolvedUrl = endpointUrl;
        }
      }
    }
  }

  if (cardUrl) {
    try {
      const response = await fetch(cardUrl, {
        headers: {
          accept: "application/json",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        return NextResponse.json(
          {
            ok: false,
            errors: [`Failed to fetch card: ${response.statusText}`],
          },
          { status: 400 }
        );
      }

      cardData = await response.json();
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          errors: [
            `Failed to fetch card: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          ],
        },
        { status: 400 }
      );
    }
  }

  const { card, errors } = normalizeAgentCard(cardData, resolvedUrl);

  if (errors.length || !card) {
    return NextResponse.json({ ok: false, errors }, { status: 400 });
  }

  return NextResponse.json({ ok: true, card });
}
