export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface XPostResult {
  id: string;
  text: string;
}

export interface XPostClientOptions {
  endpoint: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

export class XApiError extends Error {
  readonly status?: number;
  readonly retryAt?: string;

  constructor(message: string, options: { status?: number; retryAt?: string } = {}) {
    super(message);
    this.name = "XApiError";
    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.retryAt !== undefined) {
      this.retryAt = options.retryAt;
    }
  }
}

function redactSensitive(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }

  redacted = redacted
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(["']?(?:access_)?token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\s+/g, " ")
    .trim();

  return redacted.slice(0, 500);
}

function readApiDetail(rawBody: string, token: string): string {
  const safeRaw = redactSensitive(rawBody, [token]);
  if (!safeRaw) {
    return "X returned an empty error response.";
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const details: string[] = [];
    for (const key of ["title", "detail", "message"] as const) {
      if (typeof payload[key] === "string") {
        details.push(payload[key] as string);
      }
    }

    if (Array.isArray(payload.errors)) {
      for (const item of payload.errors.slice(0, 3)) {
        if (item && typeof item === "object") {
          const errorItem = item as Record<string, unknown>;
          if (typeof errorItem.message === "string") {
            details.push(errorItem.message);
          } else if (typeof errorItem.detail === "string") {
            details.push(errorItem.detail);
          }
        }
      }
    }

    if (details.length > 0) {
      return redactSensitive(details.join("; "), [token]);
    }
  } catch {
    // Fall back to the already-redacted response text.
  }

  return safeRaw;
}

export class XPostClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: XPostClientOptions) {
    this.endpoint = options.endpoint;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createPost(text: string, userAccessToken: string): Promise<XPostResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + userAccessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      const rawBody = await response.text();

      if (response.status === 201) {
        let payload: unknown;
        try {
          payload = JSON.parse(rawBody) as unknown;
        } catch {
          throw new XApiError("X returned invalid JSON for a successful post.", {
            status: response.status,
          });
        }

        const data =
          payload && typeof payload === "object"
            ? (payload as Record<string, unknown>).data
            : undefined;
        if (!data || typeof data !== "object") {
          throw new XApiError("X did not return post data.", { status: response.status });
        }

        const record = data as Record<string, unknown>;
        if (typeof record.id !== "string" || typeof record.text !== "string") {
          throw new XApiError("X returned malformed post data.", { status: response.status });
        }
        return { id: record.id, text: record.text };
      }

      const retryAt = response.headers.get("x-rate-limit-reset") ?? undefined;
      const detail = readApiDetail(rawBody, userAccessToken);
      const options: { status?: number; retryAt?: string } = { status: response.status };
      if (retryAt !== undefined) {
        options.retryAt = retryAt;
      }
      throw new XApiError(
        "X create-post request failed with HTTP " + response.status + ": " + detail,
        options,
      );
    } catch (error) {
      if (error instanceof XApiError) {
        throw error;
      }
      const detail =
        error instanceof Error
          ? redactSensitive(error.message, [userAccessToken])
          : "Unknown network error";
      throw new XApiError("X create-post request failed: " + detail);
    } finally {
      clearTimeout(timeout);
    }
  }
}
