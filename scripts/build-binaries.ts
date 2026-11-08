/**
 * Cross-compiles the standalone `cmap` binaries and writes `SHA256SUMS`.
 *
 *   bun run build:binaries                       all five targets
 *   bun run build:binaries -- --only linux-x64   a single target (what CI smoke-tests)
 *
 * Output: dist/bin/cmap-<os>-<arch>[.exe] and dist/bin/SHA256SUMS.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

interface Target {
  readonly name: string;
  readonly bunTarget: string;
  readonly file: string;
}

const TARGETS: readonly Target[] = [
  { name: "linux-x64", bunTarget: "bun-linux-x64", file: "cmap-linux-x64" },
  { name: "linux-arm64", bunTarget: "bun-linux-arm64", file: "cmap-linux-arm64" },
  { name: "darwin-x64", bunTarget: "bun-darwin-x64", file: "cmap-darwin-x64" },
  { name: "darwin-arm64", bunTarget: "bun-darwin-arm64", file: "cmap-darwin-arm64" },
  { name: "windows-x64", bunTarget: "bun-windows-x64", file: "cmap-windows-x64.exe" },
];

const OUT_DIR = join("dist", "bin");

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { only: { type: "string" } },
});

const selected =
  values.only === undefined ? TARGETS : TARGETS.filter((target) => target.name === values.only);
if (selected.length === 0) {
  const known = TARGETS.map((target) => target.name).join(", ");
  console.error(`unknown target "${values.only}"; expected one of: ${known}`);
  process.exit(2);
}

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

for (const target of selected) {
  const outfile = join(OUT_DIR, target.file);
  const proc = Bun.spawn(
    [
      "bun",
      "build",
      "--compile",
      `--target=${target.bunTarget}`,
      "src/cli.ts",
      "--outfile",
      outfile,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`building ${target.name} failed with exit code ${code}`);
    process.exit(code);
  }
}

const lines: string[] = [];
for (const target of selected) {
  const bytes = await Bun.file(join(OUT_DIR, target.file)).bytes();
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  lines.push(`${hash}  ${target.file}`);
}
await writeFile(join(OUT_DIR, "SHA256SUMS"), `${lines.join("\n")}\n`);
console.log(
  `built ${selected.length} binar${selected.length === 1 ? "y" : "ies"} + SHA256SUMS in ${OUT_DIR}`,
);
