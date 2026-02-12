export type AgentSkill = {
  id?: string;
  name: string;
  description?: string;
  examples?: string[];
  tags?: string[];
  inputModes?: string[];
  outputModes?: string[];
};

export type AgentEndpoint = {
  id: string;
  name: string;
  url: string;
  protocol: string;
};

export type AgentCapabilities = {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
};

export type AgentProvider = {
  organization?: string;
  url?: string;
};

export type AgentAuthConfig = {
  type: "none" | "bearer" | "apiKey" | "custom";
  token?: string; // For bearer auth
  apiKeyHeader?: string; // Header name for API key (e.g., "X-API-Key")
  apiKeyValue?: string; // API key value
  customHeaders?: Record<string, string>; // For custom headers
};

export type AgentCardNormalized = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  protocolVersion?: string;
  url?: string;
  provider?: AgentProvider;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills: AgentSkill[];
  endpoints: AgentEndpoint[];
  capabilities: AgentCapabilities;
  raw: unknown;
  auth?: AgentAuthConfig;
};

const DEFAULT_PROTOCOL = "jsonrpc";

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const asString = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const collectEndpointCandidates = (card: Record<string, unknown>) => {
  const candidates: { entry: Record<string, unknown>; protocolHint: string }[] = [];
  const endpoints = card.endpoints;
  const preferredTransport = asString(card.preferredTransport).toLowerCase();
  const protocolHint = preferredTransport || DEFAULT_PROTOCOL;

  if (Array.isArray(endpoints)) {
    endpoints.forEach((entry) => {
      const record = asRecord(entry);
      if (record) {
        candidates.push({ entry: record, protocolHint });
      }
    });
  } else if (endpoints && typeof endpoints === "object") {
    const endpointsRecord = endpoints as Record<string, unknown>;
    ["jsonrpc", "rpc", "http"].forEach((key) => {
      const value = endpointsRecord[key];
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          const record = asRecord(entry);
          if (record) {
            candidates.push({ entry: record, protocolHint: key });
          }
        });
      }
    });
  }

  const endpoint = asRecord(card.endpoint);
  if (endpoint) {
    candidates.push({ entry: endpoint, protocolHint });
  }

  const rootUrl = asString(card.url);
  if (rootUrl) {
    candidates.push({
      entry: {
        url: rootUrl,
        name: asString(card.name) || "Agent URL",
        protocol: protocolHint,
      },
      protocolHint,
    });
  }

  return candidates;
};

const validateUrl = (value: string) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

export const normalizeAgentCard = (
  input: unknown,
  sourceUrl?: string
): { card?: AgentCardNormalized; errors: string[] } => {
  const errors: string[] = [];
  const card = asRecord(input);

  if (!card) {
    return { errors: ["Agent card payload must be an object."] };
  }

  const name = asString(card.name);
  const description = asString(card.description);
  const version = asString(card.version);

  if (!name) {
    errors.push("Missing required field: name.");
  }

  const skillEntries = Array.isArray(card.skills) ? card.skills : [];
  const skills: AgentSkill[] = [];
  skillEntries.forEach((entry) => {
    if (typeof entry === "string") {
      const skillName = entry.trim();
      if (skillName) {
        skills.push({ name: skillName });
      }
      return;
    }

    const record = asRecord(entry);
    if (!record) {
      return;
    }
    const skillName = asString(record.name || record.title);
    if (!skillName) {
      return;
    }
    const skillDescription = asString(record.description);
    const skillId = asString(record.id);
    const examples = Array.isArray(record.examples)
      ? record.examples.filter((e): e is string => typeof e === "string")
      : undefined;
    const tags = Array.isArray(record.tags)
      ? record.tags.filter((t): t is string => typeof t === "string")
      : undefined;
    const inputModes = Array.isArray(record.inputModes)
      ? record.inputModes.filter((m): m is string => typeof m === "string")
      : undefined;
    const outputModes = Array.isArray(record.outputModes)
      ? record.outputModes.filter((m): m is string => typeof m === "string")
      : undefined;

    skills.push({
      name: skillName,
      ...(skillId ? { id: skillId } : {}),
      ...(skillDescription ? { description: skillDescription } : {}),
      ...(examples?.length ? { examples } : {}),
      ...(tags?.length ? { tags } : {}),
      ...(inputModes?.length ? { inputModes } : {}),
      ...(outputModes?.length ? { outputModes } : {}),
    });
  });

  const endpointCandidates = collectEndpointCandidates(card);
  const endpoints: AgentEndpoint[] = [];

  endpointCandidates.forEach(({ entry, protocolHint }, index) => {
    const url = asString(entry.url || entry.href || entry.endpoint);
    if (!url) {
      errors.push(`Endpoint ${index + 1} is missing a url.`);
      return;
    }
    if (!validateUrl(url)) {
      errors.push(`Endpoint ${index + 1} has an invalid url.`);
      return;
    }
    const protocol = asString(entry.protocol || entry.type || entry.transport);
    const nameValue = asString(entry.name || entry.id);
    endpoints.push({
      id: `${protocol || protocolHint}-${index + 1}`,
      name: nameValue || `Endpoint ${index + 1}`,
      url,
      protocol: protocol || protocolHint || DEFAULT_PROTOCOL,
    });
  });

  if (!endpoints.length) {
    errors.push("No endpoints found in card.");
  }

  if (errors.length) {
    return { errors };
  }

  const idValue = asString(card.id || card.agentId || sourceUrl || name);
  const protocolVersion = asString(card.protocolVersion);

  // Extract capabilities
  const capabilitiesRecord = asRecord(card.capabilities);
  const capabilities: AgentCapabilities = {
    streaming: capabilitiesRecord?.streaming === true,
    pushNotifications: capabilitiesRecord?.pushNotifications === true,
    stateTransitionHistory: capabilitiesRecord?.stateTransitionHistory === true,
  };

  // Extract provider info
  const providerRecord = asRecord(card.provider);
  const provider: AgentProvider | undefined = providerRecord
    ? {
        organization: asString(providerRecord.organization) || undefined,
        url: asString(providerRecord.url) || undefined,
      }
    : undefined;

  // Extract default input/output modes
  const defaultInputModes = Array.isArray(card.defaultInputModes)
    ? card.defaultInputModes.filter((m): m is string => typeof m === "string")
    : undefined;
  const defaultOutputModes = Array.isArray(card.defaultOutputModes)
    ? card.defaultOutputModes.filter((m): m is string => typeof m === "string")
    : undefined;

  return {
    card: {
      id: idValue || name,
      name,
      description: description || undefined,
      version: version || undefined,
      protocolVersion: protocolVersion || undefined,
      url: sourceUrl,
      provider: provider?.organization || provider?.url ? provider : undefined,
      defaultInputModes: defaultInputModes?.length ? defaultInputModes : undefined,
      defaultOutputModes: defaultOutputModes?.length ? defaultOutputModes : undefined,
      skills,
      endpoints,
      capabilities,
      raw: input,
    },
    errors: [],
  };
};

/**
 * True when auth requires custom headers (API key or custom). The SDK only supports
 * bearer tokens, so these auth types must use direct fetch with authHeaders.
 */
export const authNeedsCustomHeaders = (auth?: AgentAuthConfig): boolean =>
  !!auth && (auth.type === "apiKey" || auth.type === "custom");

/**
 * Build authentication headers from AgentAuthConfig
 * Returns a Record of header name -> header value
 */
export const buildAuthHeaders = (auth?: AgentAuthConfig): Record<string, string> => {
  if (!auth || auth.type === "none") {
    return {};
  }

  const headers: Record<string, string> = {};

  switch (auth.type) {
    case "bearer":
      if (auth.token) {
        headers["Authorization"] = `Bearer ${auth.token}`;
      }
      break;
    case "apiKey":
      if (auth.apiKeyHeader && auth.apiKeyValue) {
        headers[auth.apiKeyHeader] = auth.apiKeyValue;
      }
      break;
    case "custom":
      if (auth.customHeaders) {
        Object.assign(headers, auth.customHeaders);
      }
      break;
  }

  return headers;
};

/**
 * Get the Authorization header value for SDK client (bearer token only)
 * The SDK's createFromUrl second parameter expects a bearer token string
 */
export const getAuthTokenForSdk = (auth?: AgentAuthConfig): string => {
  if (!auth || auth.type === "none") {
    return "";
  }

  if (auth.type === "bearer" && auth.token) {
    return auth.token;
  }

  // For other auth types, SDK doesn't support them directly
  // They need to be handled at the fetch level
  return "";
};
