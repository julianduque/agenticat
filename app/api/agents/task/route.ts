import { ClientFactory } from "@a2a-js/sdk/client";
import { NextResponse } from "next/server";
import type { AgentAuthConfig } from "@/lib/a2a/schema";
import { getAuthTokenForSdk } from "@/lib/a2a/schema";

type TaskRequest = {
  cardUrl?: string;
  taskId?: string;
  historyLength?: number;
  auth?: AgentAuthConfig;
};

export async function POST(request: Request) {
  let body: TaskRequest;

  try {
    body = (await request.json()) as TaskRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const cardUrl = typeof body.cardUrl === "string" ? body.cardUrl : "";
  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  const historyLength = typeof body.historyLength === "number" ? body.historyLength : 10;
  const auth = body.auth;

  // Get bearer token for SDK calls
  const authToken = getAuthTokenForSdk(auth);

  if (!cardUrl) {
    return NextResponse.json(
      { ok: false, error: "Missing cardUrl." },
      { status: 400 }
    );
  }

  if (!taskId) {
    return NextResponse.json(
      { ok: false, error: "Missing taskId." },
      { status: 400 }
    );
  }

  try {
    const factory = new ClientFactory();
    const client = await factory.createFromUrl(cardUrl, authToken);
    
    const task = await client.getTask({
      id: taskId,
      historyLength,
    });

    return NextResponse.json({
      ok: true,
      status: 200,
      data: task,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Request failed.",
      },
      { status: 500 }
    );
  }
}
