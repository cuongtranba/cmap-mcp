import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type FakeCmap, startFakeCmap } from "./fake-cmap.ts";

const ROOT = join(import.meta.dir, "..");
const AM_VANG_DONG_QUE = "1c1939af"; // Hà Nội event, name "Âm vang đồng quê"

let fake: FakeCmap;
let cacheDir: string;

beforeAll(async () => {
  fake = await startFakeCmap();
  cacheDir = await mkdtemp(join(tmpdir(), "cmap-cli-test-"));
});

afterAll(async () => {
  await fake.stop();
  await rm(cacheDir, { recursive: true, force: true });
});

async function cmap(...args: string[]) {
  const proc = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: ROOT,
    env: { ...process.env, CMAP_BASE_URL: fake.url, CMAP_CACHE_DIR: cacheDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("cmap CLI", () => {
  test("events search prints JSON that contains an accented event found with an unaccented query", async () => {
    const { code, stdout } = await cmap("events", "search", "am vang dong que", "--limit", "5");

    const page = z
      .object({ items: z.array(z.object({ id: z.string(), name: z.string(), url: z.string() })) })
      .parse(JSON.parse(stdout));
    expect(code).toBe(0);
    expect(page.items.map((e) => e.id.slice(0, 8))).toContain(AM_VANG_DONG_QUE);
    expect(page.items.find((e) => e.id.startsWith(AM_VANG_DONG_QUE))?.name).toBe(
      "Âm vang đồng quê",
    );
  });

  test("event get with an unknown id exits 1 and prints a NOT_FOUND JSON error on stderr", async () => {
    const { code, stdout, stderr } = await cmap("event", "get", "no-such-event");

    const failure = z
      .object({ error: z.object({ code: z.string(), message: z.string() }) })
      .parse(JSON.parse(stderr));
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(failure.error.code).toBe("NOT_FOUND");
  });

  test("a usage mistake exits 2 and prints help instead of JSON", async () => {
    const { code, stdout, stderr } = await cmap("events", "search", "--free", "--paid");

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("--free and --paid cannot be combined");
    expect(stderr).toContain("cmap events search");
  });
});
