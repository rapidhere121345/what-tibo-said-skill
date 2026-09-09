import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { QuotaResetService } from "../src/service.js";
import { StateStore } from "../src/state-store.js";
import { XApiError, XPostClient, type FetchLike } from "../src/x-client.js";

const QUOTA_ERROR =
  "Codex GPT plan: 您已达到每周使用上限，您的限额将在 2026-09-13 20:24:17 重置。";

async function withTemporaryDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "what-tibo-said-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function makeConfig(stateDir: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    live: true,
    xUserAccessToken: "test-secret-token",
    targetHandle: "tibo",
    cooldownMs: 24 * 60 * 60 * 1000,
    stateDir,
    xEndpoint: "https://api.x.com/2/tweets",
    requestTimeoutMs: 1_000,
    ...overrides,
  };
}

function successfulResponse(
  id = "123",
  text = "@tibo my Codex quota just hit the wall. Any chance you can wave the reset wand? 🪄",
): Response {
  return new Response(
    JSON.stringify({
      data: {
        id,
        text,
      },
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
}

test("dry-run never calls X and still previews the post", async () => {
  await withTemporaryDirectory(async (directory) => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return successfulResponse();
    };
    const config = makeConfig(directory, {
      live: false,
      xUserAccessToken: undefined,
    });
    const service = new QuotaResetService({
      config,
      xClient: new XPostClient({
        endpoint: config.xEndpoint,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
      }),
      now: () => new Date(2026, 8, 9, 12, 24, 17),
      random: () => 0,
      publicContext: {
        platform: "linux",
        arch: "x64",
      },
    });

    const result = await service.handleQuotaSignal({
      message: QUOTA_ERROR,
      model: "gpt-5.6-sol",
    });
    assert.equal(result.status, "dry_run");
    assert.match(result.text ?? "", /^@tibo\b/);
    assert.match(result.text ?? "", /Reset: 4d 8h left/);
    assert.match(result.text ?? "", /gpt-5\.6-sol · linux\/x64/);
    assert.equal(calls, 0);
  });
});

test("ignores non-GPT, missing, and IP-shaped models before touching X", async () => {
  await withTemporaryDirectory(async (directory) => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return successfulResponse();
    };
    const config = makeConfig(directory);
    const service = new QuotaResetService({
      config,
      xClient: new XPostClient({
        endpoint: config.xEndpoint,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
      }),
    });

    for (const model of [
      "glm-coding/glm-5.3",
      "192.168.1.10",
      "gpt-192.168.1.10",
      "fe80::1",
      undefined,
    ]) {
      const result = await service.handleQuotaSignal({ message: QUOTA_ERROR, model });
      assert.equal(result.status, "ignored_unsupported_model");
      assert.equal(result.text, undefined);
    }
    assert.equal(calls, 0);
  });
});

test("ignores a transient 429 signal before touching X", async () => {
  await withTemporaryDirectory(async (directory) => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return successfulResponse();
    };
    const config = makeConfig(directory);
    const service = new QuotaResetService({
      config,
      xClient: new XPostClient({
        endpoint: config.xEndpoint,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
      }),
    });

    const result = await service.handleQuotaSignal({
      message: "429 rate limit exceeded",
      model: "gpt-5.6-sol",
    });
    assert.equal(result.status, "ignored_not_quota");
    assert.equal(calls, 0);
  });
});

test("live mode publishes once and persists the successful cooldown", async () => {
  await withTemporaryDirectory(async (directory) => {
    let calls = 0;
    const fetchImpl: FetchLike = async (_input, init) => {
      calls += 1;
      assert.equal(init?.method, "POST");
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer test-secret-token",
      );
      const payload = JSON.parse(String(init?.body)) as { text?: string };
      assert.match(payload.text ?? "", /^@tibo\b/);
      assert.match(payload.text ?? "", /Reset: 4d 8h left/);
      assert.match(payload.text ?? "", /gpt-5\.6-sol · linux\/x64/);
      assert.match(payload.text ?? "", /Sent by https:\/\/github\.com\//);
      assert.match(
        payload.text ?? "",
        /what-tibo-said-skill — triggered when Codex quota runs out\.$/,
      );
      return successfulResponse("123", payload.text);
    };
    const config = makeConfig(directory);
    const stateStore = new StateStore(directory);
    const service = new QuotaResetService({
      config,
      stateStore,
      xClient: new XPostClient({
        endpoint: config.xEndpoint,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
      }),
      now: () => new Date(2026, 8, 9, 12, 24, 17),
      random: () => 0,
      publicContext: {
        platform: "linux",
        arch: "x64",
      },
    });

    const first = await service.handleQuotaSignal({
      message: QUOTA_ERROR,
      model: "gpt-5.6-sol",
    });
    const second = await service.handleQuotaSignal({
      message: QUOTA_ERROR,
      model: "gpt-5.6-sol",
    });

    assert.equal(first.status, "posted");
    assert.equal(first.postId, "123");
    assert.equal(second.status, "deduplicated");
    assert.equal(calls, 1);
    assert.equal((await stateStore.read()).postId, "123");
  });
});

test("a failed publish does not consume the success cooldown", async () => {
  await withTemporaryDirectory(async (directory) => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ detail: "temporary failure" }), {
          status: 503,
        });
      }
      return successfulResponse("456");
    };
    const config = makeConfig(directory);
    const service = new QuotaResetService({
      config,
      xClient: new XPostClient({
        endpoint: config.xEndpoint,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
      }),
      random: () => 0,
    });

    const first = await service.handleQuotaSignal({
      message: QUOTA_ERROR,
      model: "gpt-5.6-sol",
    });
    const second = await service.handleQuotaSignal({
      message: QUOTA_ERROR,
      model: "gpt-5.6-sol",
    });
    assert.equal(first.status, "error");
    assert.equal(second.status, "posted");
    assert.equal(calls, 2);
  });
});

test("concurrent matching signals result in only one X request", async () => {
  await withTemporaryDirectory(async (directory) => {
    let calls = 0;
    let releaseRequest: (() => void) | undefined;
    const requestGate = new Promise<void>((resolvePromise) => {
      releaseRequest = resolvePromise;
    });
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      await requestGate;
      return successfulResponse();
    };
    const config = makeConfig(directory);
    const service = new QuotaResetService({
      config,
      stateStore: new StateStore(directory, { retryDelayMs: 5 }),
      xClient: new XPostClient({
        endpoint: config.xEndpoint,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
      }),
      random: () => 0,
    });

    const firstPromise = service.handleQuotaSignal({
      message: QUOTA_ERROR,
      model: "gpt-5.6-sol",
    });
    while (calls === 0) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
    }
    const secondPromise = service.handleQuotaSignal({
      message: QUOTA_ERROR,
      model: "gpt-5.6-sol",
    });
    releaseRequest?.();

    const statuses = (await Promise.all([firstPromise, secondPromise]))
      .map((result) => result.status)
      .sort();
    assert.deepEqual(statuses, ["deduplicated", "posted"]);
    assert.equal(calls, 1);
  });
});

test("live mode requires a user token", async () => {
  await withTemporaryDirectory(async (directory) => {
    const config = makeConfig(directory, { xUserAccessToken: undefined });
    const service = new QuotaResetService({ config });
    const result = await service.handleQuotaSignal({
      message: QUOTA_ERROR,
      model: "gpt-5.6-sol",
    });
    assert.equal(result.status, "config_error");
    assert.match(result.detail ?? "", /X_USER_ACCESS_TOKEN/);
  });
});

test("X client redacts credentials and exposes rate-limit reset", async () => {
  const token = "test-secret-token";
  const fetchImpl: FetchLike = async () =>
    new Response(JSON.stringify({ detail: "bad token " + token }), {
      status: 429,
      headers: { "x-rate-limit-reset": "1780000000" },
    });
  const client = new XPostClient({
    endpoint: "https://api.x.com/2/tweets",
    timeoutMs: 1_000,
    fetchImpl,
  });

  await assert.rejects(
    client.createPost("@tibo hello", token),
    (error: unknown) => {
      assert.ok(error instanceof XApiError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAt, "1780000000");
      assert.doesNotMatch(error.message, new RegExp(token));
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    },
  );
});

test("a create-post 401 refreshes, persists rotation, and retries exactly once", async () => {
  await withTemporaryDirectory(async (directory) => {
    const credentialsPath = join(directory, "x-oauth.json");
    const original = {
      clientId: "confidential-client",
      clientSecret: "confidential-secret",
      accessToken: "expired-access",
      refreshToken: "old-refresh",
    };
    await writeFile(credentialsPath, JSON.stringify(original), { mode: 0o600 });
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      requests.push({ input: String(input), init });
      if (requests.length === 1) {
        return new Response(JSON.stringify({ detail: "expired" }), { status: 401 });
      }
      if (requests.length === 2) {
        assert.equal(String(input), "https://api.x.com/2/oauth2/token");
        const headers = init?.headers as Record<string, string>;
        assert.equal(
          headers.Authorization,
          "Basic " + Buffer.from("confidential-client:confidential-secret").toString("base64"),
        );
        assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
        assert.equal(
          String(init?.body),
          "grant_type=refresh_token&refresh_token=old-refresh",
        );
        return new Response(
          JSON.stringify({
            access_token: "rotated-access",
            refresh_token: "rotated-refresh",
          }),
          { status: 200 },
        );
      }
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer rotated-access",
      );
      return successfulResponse("rotated-post");
    };
    const config = makeConfig(directory, {
      xCredentialsFile: credentialsPath,
      xUserAccessToken: "fallback-token",
    });
    const service = new QuotaResetService({
      config,
      xClient: new XPostClient({
        endpoint: config.xEndpoint,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
      }),
      random: () => 0,
    });

    const result = await service.handleQuotaSignal({ message: QUOTA_ERROR, model: "gpt-5.6-sol" });
    assert.equal(result.status, "posted");
    assert.equal(result.postId, "rotated-post");
    assert.equal(requests.length, 3);
    assert.deepEqual(JSON.parse(await readFile(credentialsPath, "utf8")), {
      ...original,
      accessToken: "rotated-access",
      refreshToken: "rotated-refresh",
    });
    assert.equal((await stat(credentialsPath)).mode & 0o777, 0o600);
  });
});

test("credential refresh errors redact every credential value", async () => {
  const credentials = {
    clientId: "visible-client-id",
    clientSecret: "visible-client-secret",
    accessToken: "visible-access-token",
    refreshToken: "visible-refresh-token",
  };
  const client = new XPostClient({
    endpoint: "https://api.x.com/2/tweets",
    timeoutMs: 1_000,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ detail: Object.values(credentials).join(" ") }),
        { status: 400 },
      ),
  });

  await assert.rejects(client.refreshAccessToken(credentials), (error: unknown) => {
    assert.ok(error instanceof XApiError);
    for (const secret of Object.values(credentials)) {
      assert.doesNotMatch(error.message, new RegExp(secret));
    }
    assert.match(error.message, /\[REDACTED\]/);
    return true;
  });
});

test("refresh keeps the existing refresh token when X does not rotate it", async () => {
  await withTemporaryDirectory(async (directory) => {
    const credentialsPath = join(directory, "x-oauth.json");
    const credentials = {
      clientId: "client-id",
      clientSecret: "client-secret",
      accessToken: "expired-access",
      refreshToken: "existing-refresh",
    };
    await writeFile(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("unauthorized", { status: 401 });
      }
      if (calls === 2) {
        return new Response(JSON.stringify({ access_token: "new-access" }), { status: 200 });
      }
      return successfulResponse("post-with-unrotated-refresh");
    };
    const config = makeConfig(directory, { xCredentialsFile: credentialsPath });
    const service = new QuotaResetService({
      config,
      xClient: new XPostClient({
        endpoint: config.xEndpoint,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
      }),
      random: () => 0,
    });

    const result = await service.handleQuotaSignal({ message: QUOTA_ERROR, model: "gpt-5.6-sol" });
    assert.equal(result.status, "posted");
    assert.deepEqual(JSON.parse(await readFile(credentialsPath, "utf8")), {
      ...credentials,
      accessToken: "new-access",
    });
    assert.equal(calls, 3);
  });
});

test("a second create-post 401 is returned without another refresh or retry", async () => {
  await withTemporaryDirectory(async (directory) => {
    const credentialsPath = join(directory, "x-oauth.json");
    await writeFile(
      credentialsPath,
      JSON.stringify({
        clientId: "client-id",
        clientSecret: "client-secret",
        accessToken: "expired-access",
        refreshToken: "refresh-token",
      }),
      { mode: 0o600 },
    );
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 2) {
        return new Response(
          JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh" }),
          { status: 200 },
        );
      }
      return new Response("unauthorized", { status: 401 });
    };
    const config = makeConfig(directory, { xCredentialsFile: credentialsPath });
    const service = new QuotaResetService({
      config,
      xClient: new XPostClient({
        endpoint: config.xEndpoint,
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
      }),
      random: () => 0,
    });

    const result = await service.handleQuotaSignal({ message: QUOTA_ERROR, model: "gpt-5.6-sol" });
    assert.equal(result.status, "error");
    assert.equal(calls, 3);
  });
});

test("credential mode does not refresh or retry create-post outside HTTP 401", async () => {
  for (const failure of ["network", "503"] as const) {
    await withTemporaryDirectory(async (directory) => {
      const credentialsPath = join(directory, "x-oauth.json");
      await writeFile(
        credentialsPath,
        JSON.stringify({
          clientId: "client-id",
          clientSecret: "client-secret",
          accessToken: "access-token",
          refreshToken: "refresh-token",
        }),
        { mode: 0o600 },
      );
      let calls = 0;
      const fetchImpl: FetchLike = async () => {
        calls += 1;
        if (failure === "network") {
          throw new Error("connection reset");
        }
        return new Response(JSON.stringify({ detail: "unavailable" }), { status: 503 });
      };
      const config = makeConfig(directory, { xCredentialsFile: credentialsPath });
      const service = new QuotaResetService({
        config,
        xClient: new XPostClient({
          endpoint: config.xEndpoint,
          timeoutMs: config.requestTimeoutMs,
          fetchImpl,
        }),
        random: () => 0,
      });

      const result = await service.handleQuotaSignal({
        message: QUOTA_ERROR,
        model: "gpt-5.6-sol",
      });
      assert.equal(result.status, "error");
      assert.equal(calls, 1, failure);
    });
  }
});
