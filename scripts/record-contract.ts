/**
 * Records the key shape of the live cmap.vn API into test/contract/shape.json (see
 * scripts/contract-shape.ts). Re-run (`bun run contract:record`) after an intended upstream change.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createCmap } from "../src/index.ts";
import {
  type ContractShape,
  compareShapes,
  fetchEventDetails,
  sampleIds,
  shapesFrom,
} from "./contract-shape.ts";

const BASE_URL = process.env.CMAP_BASE_URL ?? "https://cmap.vn";
const OUT = join(import.meta.dir, "..", "test", "contract", "shape.json");
const DETAIL_SAMPLE = 3;

const cacheDir = await mkdtemp(join(tmpdir(), "cmap-contract-"));
try {
  const cmap = createCmap({ baseUrl: BASE_URL, cacheDir });
  const report = await cmap.sync();
  console.log(`synced ${report.counts.events} events, rejected ${report.rejected}`);

  const snapshotJson: unknown = JSON.parse(
    await readFile((await cmap.status()).snapshotPath, "utf8"),
  );
  const ids = z
    .object({ events: z.array(z.object({ id: z.string() })) })
    .parse(snapshotJson)
    .events.map((e) => e.id);
  const details = await fetchEventDetails(BASE_URL, sampleIds(ids, DETAIL_SAMPLE));

  const endpoints = shapesFrom(snapshotJson, details);
  const { failures } = compareShapes(endpoints, endpoints);
  if (failures.length > 0) {
    throw new Error(
      `Recorded shape lacks required keys:\n${failures.join("\n")}\nFix REQUIRED in scripts/contract-shape.ts or the schemas.`,
    );
  }

  const shape: ContractShape = { recordedAt: new Date().toISOString(), endpoints };
  await Bun.write(OUT, `${JSON.stringify(shape, null, 2)}\n`);
  console.log(`wrote ${OUT}`);
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}
