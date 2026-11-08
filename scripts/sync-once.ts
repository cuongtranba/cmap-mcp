/** Runs one full sync against the configured upstream and prints counts and timing. */
import { createCmap } from "../src/index.ts";

const cmap = createCmap();
const started = performance.now();
const report = await cmap.sync();
const seconds = ((performance.now() - started) / 1000).toFixed(1);

console.log(`synced in ${seconds}s`);
console.log(JSON.stringify(report.counts));
console.log(`rejected=${report.rejected} duplicates=${report.duplicates}`);
for (const warning of report.warnings) console.warn(`warning: ${warning}`);
console.log((await cmap.status()).snapshotPath);
