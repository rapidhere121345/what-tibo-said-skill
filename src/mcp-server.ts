import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { QuotaResetService } from "./service.js";
import type { QuotaSignal } from "./types.js";

const signalShape = {
  message: z.string().nullable().optional().describe("Quota error text, if available."),
  model: z.string().nullable().optional().describe("Model that encountered the quota error."),
  reset_at: z
    .string()
    .nullable()
    .optional()
    .describe("Optional quota reset timestamp for a manual preview or request."),
  source: z.string().nullable().optional().describe("Signal source, such as stop or subagent_stop."),
  session_id: z.string().nullable().optional().describe("Session identifier used only for tracing."),
};

const requiredGptModel = z
  .string()
  .describe("Required gpt-* model slug for the affected Codex plan.");

function toSignal(input: {
  message?: string | null | undefined;
  model?: string | null | undefined;
  reset_at?: string | null | undefined;
  source?: string | null | undefined;
  session_id?: string | null | undefined;
}): QuotaSignal {
  const signal: QuotaSignal = {};
  if (input.message !== undefined) {
    signal.message = input.message;
  }
  if (input.model !== undefined) {
    signal.model = input.model;
  }
  if (input.reset_at !== undefined) {
    signal.resetAt = input.reset_at;
  }
  if (input.source !== undefined) {
    signal.source = input.source;
  }
  if (input.session_id !== undefined) {
    signal.sessionId = input.session_id;
  }
  return signal;
}

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

export function createMcpServer(service = new QuotaResetService({ config: loadConfig() })) {
  const server = new McpServer({
    name: "what-tibo-said",
    version: "0.1.0",
  });

  server.registerTool(
    "preview_quota_reset",
    {
      title: "Preview Tibo quota-reset post",
      description:
        "Preview the playful @thsottiaux post without publishing it. Supplied non-GPT models and non-quota errors are ignored.",
      inputSchema: { ...signalShape, model: requiredGptModel },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => toolResult(service.previewQuotaReset(toSignal(input))),
  );

  server.registerTool(
    "handle_quota_signal",
    {
      title: "Handle a Codex quota signal",
      description:
        "Detect an explicit gpt-* account usage-limit error and publish one cooldown-protected @thsottiaux post when live mode is enabled.",
      inputSchema: { ...signalShape, model: requiredGptModel },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => toolResult(await service.handleQuotaSignal(toSignal(input))),
  );

  server.registerTool(
    "request_quota_reset",
    {
      title: "Request a Codex quota reset from Tibo",
      description:
        "Manually request a cooldown-protected @thsottiaux GPT quota-reset post. Publishing still requires live mode.",
      inputSchema: {
        model: requiredGptModel,
        reset_at: signalShape.reset_at,
        source: signalShape.source,
        session_id: signalShape.session_id,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const signal = toSignal(input);
      return toolResult(await service.requestQuotaReset(signal));
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : "Unknown startup error";
    process.stderr.write("what-tibo-said MCP failed: " + detail.slice(0, 500) + "\n");
    process.exitCode = 1;
  });
}
