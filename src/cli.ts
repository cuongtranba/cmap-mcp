import { VERSION } from "./version.ts";

// Placeholder entry: the full CLI lands in phase 4e.
if (process.argv.includes("--version")) {
  console.log(VERSION);
}
