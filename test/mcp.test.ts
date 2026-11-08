import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import { type FakeCmap, startFakeCmap } from "./fake-cmap.ts";

const ROOT = join(import.meta.dir, "..");
const AM_VANG_DONG_QUE = "1c1939af";
const TOOLS = [
  "events_near",
  "get_event",
  "get_offer",
  "get_province",
  "get_sync_status",
  "list_places",
  "list_provinces",
  "list_taxonomies",
  "search_events",
  "search_offers",
];

let fake: FakeCmap;
let cacheDir: string;

beforeAll(async () => {
  fake = await startFakeCmap();
  cacheDir = await mkdtemp(join(tmpdir(), "cmap-mcp-test-"));
});

afterAll(async () => {
  await fake.stop();
  await rm(cacheDir, { recursive: true, force: true });
});

function serverEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  return { ...env, CMAP_BASE_URL: fake.url, CMAP_CACHE_DIR: cacheDir };
}

async function connectStdio(): Promise<Client> {
  const client = new Client({ name: "cmap-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["src/cli.ts", "mcp"],
      cwd: ROOT,
      env: serverEnv(),
      stderr: "ignore",
    }),
  );
  return client;
}

const searchResult = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string() })),
});

describe("cmap MCP server over stdio", () => {
  test("lists exactly the ten tools", async () => {
    const client = await connectStdio();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    } finally {
      await client.close();
    }
  });

  test("search_events returns structuredContent with an accented event found by an unaccented query", async () => {
    const client = await connectStdio();
    try {
      const result = await client.callTool({
        name: "search_events",
        arguments: { query: "am vang dong que", limit: 5 },
      });

      const page = searchResult.parse(result.structuredContent);
      expect(result.isError).not.toBe(true);
      expect(page.items.map((e) => e.id.slice(0, 8))).toContain(AM_VANG_DONG_QUE);
    } finally {
      await client.close();
    }
  });

  test("an unknown event is a tool error the agent can read, not a protocol failure", async () => {
    const client = await connectStdio();
    try {
      const result = await client.callTool({
        name: "get_event",
        arguments: { idOrSlug: "no-such-event" },
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("NOT_FOUND");
    } finally {
      await client.close();
    }
  });
});

describe("cmap MCP server over HTTP", () => {
  test("answers tools/list on POST /mcp and health on GET /healthz", async () => {
    const proc = Bun.spawn(["bun", "src/cli.ts", "mcp", "--http", "127.0.0.1:0"], {
      cwd: ROOT,
      env: serverEnv(),
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      const origin = await listeningOrigin(proc.stderr);
      const health = await fetch(`${origin}/healthz`);
      expect(health.status).toBe(200);

      const client = new Client({ name: "cmap-test", version: "0.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
      } finally {
        await client.close();
      }
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});

/**
 * Read the server's stderr until it announces the address it bound (port 0 picks a free one).
 * The stream is kept open and drained afterwards: closing it would make the server's next log
 * line fail with a broken pipe.
 */
async function listeningOrigin(stderr: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stderr.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`MCP HTTP server exited before listening. stderr:\n${seen}`);
    seen += decoder.decode(value, { stream: true });
    const match = /listening on (http:\/\/\S+?)\/mcp/.exec(seen);
    if (match?.[1] !== undefined) {
      void drain(reader);
      return match[1];
    }
  }
}

async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  while (!(await reader.read()).done) {
    // discard
  }
}
