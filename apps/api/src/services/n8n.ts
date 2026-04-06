import { env } from "../config/env.js";

export type N8nStatus = {
  configured: boolean;
  reachable: boolean;
  baseUrl: string | null;
  workflows: Record<
    string,
    {
      reachable: boolean;
      status: number;
    }
  >;
};

function buildHeaders() {
  const headers = new Headers();
  if (env.N8N_API_KEY) {
    headers.set("x-n8n-api-key", env.N8N_API_KEY);
    headers.set("authorization", `Bearer ${env.N8N_API_KEY}`);
  }
  return headers;
}

function resolveN8nBaseUrl(options?: { baseUrl?: string | null }): string | null {
  return options?.baseUrl?.trim() || env.N8N_HOST || null;
}

async function checkWorkflowAccessibility(baseUrl: string, workflowId: string) {
  const endpoint = new URL(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, baseUrl).toString();
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: buildHeaders(),
    });
    return {
      reachable: response.ok,
      status: response.status,
    };
  } catch {
    return {
      reachable: false,
      status: 0,
    };
  }
}

export async function getN8nStatus(options?: {
  baseUrl?: string | null;
  workflowIds?: string[];
}): Promise<N8nStatus> {
  const configuredBaseUrl = resolveN8nBaseUrl(options);
  const workflowIds = (options?.workflowIds ?? [])
    .map((value) => value.trim())
    .filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index);

  if (!configuredBaseUrl) {
    return {
      configured: false,
      reachable: false,
      baseUrl: null,
      workflows: {},
    };
  }

  try {
    const endpoint = new URL("/healthz", configuredBaseUrl).toString();
    const response = await fetch(endpoint, {
      method: "GET",
      headers: buildHeaders(),
    });
    const workflows: N8nStatus["workflows"] = {};
    if (response.ok && workflowIds.length > 0) {
      for (const workflowId of workflowIds) {
        workflows[workflowId] = await checkWorkflowAccessibility(configuredBaseUrl, workflowId);
      }
    }
    return {
      configured: true,
      reachable: response.ok,
      baseUrl: configuredBaseUrl,
      workflows,
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      baseUrl: configuredBaseUrl,
      workflows: Object.fromEntries(
        workflowIds.map((workflowId) => [workflowId, { reachable: false, status: 0 }]),
      ),
    };
  }
}

export function resolveToolWebhookEndpoint(toolId: string, options?: { baseUrl?: string | null }) {
  const configuredBaseUrl = resolveN8nBaseUrl(options);
  if (!configuredBaseUrl) {
    throw new Error("N8N_NOT_CONFIGURED");
  }

  const webhookPath = `/webhook/coziyoo/${encodeURIComponent(toolId)}`;
  return new URL(webhookPath, configuredBaseUrl).toString();
}

export async function runN8nToolWebhook(input: {
  toolId: string;
  toolInput?: string;
  roomName?: string;
  username?: string;
  baseUrl?: string | null;
}) {
  const endpoint = resolveToolWebhookEndpoint(input.toolId, { baseUrl: input.baseUrl });

  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      ...Object.fromEntries(buildHeaders().entries()),
    }),
    body: JSON.stringify({
      toolId: input.toolId,
      input: input.toolInput ?? "",
      roomName: input.roomName ?? null,
      username: input.username ?? null,
      source: "agent",
      timestamp: new Date().toISOString(),
    }),
  });

  const raw = await upstream.text();
  let body: unknown = raw;
  try {
    body = raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    body = raw;
  }

  return {
    endpoint,
    ok: upstream.ok,
    status: upstream.status,
    body,
  };
}

const SESSION_END_MAX_ATTEMPTS = 3;
const SESSION_END_RETRY_BASE_MS = 1_000;

export async function sendSessionEndEvent(input: {
  roomName: string;
  jobId?: string | null;
  userIdentity?: string | null;
  agentIdentity?: string | null;
  summary: string;
  startedAt?: string | null;
  endedAt?: string | null;
  outcome?: string | null;
  sentiment?: string | null;
  metadata?: Record<string, unknown> | null;
  baseUrl?: string | null;
}) {
  const endpoint = resolveToolWebhookEndpoint("session-end", { baseUrl: input.baseUrl });
  const bodyPayload = JSON.stringify({
    source: "agent",
    timestamp: new Date().toISOString(),
    roomName: input.roomName,
    jobId: input.jobId ?? null,
    userIdentity: input.userIdentity ?? null,
    agentIdentity: input.agentIdentity ?? null,
    summary: input.summary,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    outcome: input.outcome ?? null,
    sentiment: input.sentiment ?? null,
    metadata: input.metadata ?? {},
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= SESSION_END_MAX_ATTEMPTS; attempt++) {
    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: new Headers({
          "content-type": "application/json",
          ...Object.fromEntries(buildHeaders().entries()),
        }),
        body: bodyPayload,
      });

      const raw = await upstream.text();
      let body: unknown = raw;
      try {
        body = raw ? (JSON.parse(raw) as unknown) : null;
      } catch {
        body = raw;
      }

      if (upstream.ok) {
        return { endpoint, ok: true, status: upstream.status, body, attempts: attempt };
      }

      // Non-retriable client errors (4xx except 429)
      if (upstream.status >= 400 && upstream.status < 500 && upstream.status !== 429) {
        return { endpoint, ok: false, status: upstream.status, body, attempts: attempt };
      }

      lastError = new Error(`HTTP ${upstream.status}`);
    } catch (err) {
      lastError = err;
    }

    if (attempt < SESSION_END_MAX_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, SESSION_END_RETRY_BASE_MS * 2 ** (attempt - 1))
      );
    }
  }

  return {
    endpoint,
    ok: false,
    status: 0,
    body: lastError instanceof Error ? lastError.message : String(lastError),
    attempts: SESSION_END_MAX_ATTEMPTS,
  };
}
