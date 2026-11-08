import { mkdir } from "node:fs/promises";

const withBinary = process.argv.includes("--bin");

if (withBinary) {
  await mkdir("dist", { recursive: true });
  const proc = Bun.spawn(["bun", "build", "--compile", "src/cli.ts", "--outfile", "dist/cmap"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
} else {
  const result = await Bun.build({
    entrypoints: ["src/cli.ts"],
    outdir: "dist",
    target: "node",
    format: "esm",
    minify: false,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  await Bun.$`chmod +x dist/cli.js`;
  console.log(`built dist/cli.js (${result.outputs.length} output)`);
}
