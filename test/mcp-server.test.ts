import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AppConfig } from "../src/config.js";
import { createMcpServer } from "../src/mcp-server.js";
import { QuotaResetService } from "../src/service.js";

const TEST_CONFIG: AppConfig = {
  live: false,
  targetHandle: "tibo",
  cooldownMs: 24 * 60 * 60 * 1000,
  stateDir: "/unused-in-dry-run",
  xEndpoint: "https://api.x.com/2/tweets",
  requestTimeoutMs: 10_000,
};

test("MCP handshake exposes all tools and preview remains dry-run", async () => {
  const service = new QuotaResetService({
    config: TEST_CONFIG,
    now: () => new Date("2026-09-09T04:24:17Z"),
    random: () => 0,
    publicContext: {
      platform: "linux",
      arch: "x64",
    },
  });
  const server = createMcpServer(service);
  const client = new Client({ name: "what-tibo-said-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      ["handle_quota_signal", "preview_quota_reset", "request_quota_reset"],
    );

    const called = await client.callTool({
      name: "preview_quota_reset",
      arguments: {
        model: "gpt-5.6-sol",
        reset_at: "2026-09-12T12:24:17Z",
      },
    });
    const content = called.content[0];
    assert.equal(content?.type, "text");
    if (!content || content.type !== "text") {
      assert.fail("Expected a text MCP result.");
    }

    const payload = JSON.parse(content.text) as { status?: string; text?: string };
    assert.equal(payload.status, "dry_run");
    assert.match(payload.text ?? "", /^@tibo\b/);
    assert.match(payload.text ?? "", /Reset: 3d 8h left/);
    assert.match(payload.text ?? "", /gpt-5\.6-sol · linux\/x64/);
    assert.match(payload.text ?? "", /Sent by https:\/\/github\.com\//);
    assert.match(
      payload.text ?? "",
      /what-tibo-said-skill — triggered when Codex quota runs out\.$/,
    );
    assert.doesNotMatch(payload.text ?? "", /Asia|Shanghai|GMT|UTC|20:24/i);
  } finally {
    await client.close();
    await server.close();
  }
});
