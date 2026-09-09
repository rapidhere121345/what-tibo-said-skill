import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
