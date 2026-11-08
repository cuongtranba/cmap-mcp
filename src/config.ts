import { homedir } from "node:os";
import { join } from "node:path";
import { CmapError } from "./errors.ts";

export interface CmapConfig {
  /** Origin of the upstream API (`CMAP_BASE_URL`). */
  baseUrl: string;
  /** Directory holding `snapshot.json` (`CMAP_CACHE_DIR`). */
  cacheDir: string;
  /** A snapshot older than this many minutes is re-synced by the CLI (`CMAP_MAX_AGE_MIN`). */
  maxAgeMin: number;
  /** Maximum simultaneous upstream requests (`CMAP_CONCURRENCY`). */
  concurrency: number;
  /** Background refresh interval of the MCP server in minutes (`CMAP_REFRESH_MIN`). */
  refreshMin: number;
}

export const DEFAULT_BASE_URL = "https://cmap.vn";

function positiveNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CmapError("VALIDATION", `${name} must be a positive number, got "${raw}"`);
  }
  return value;
}

export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CmapConfig {
  return {
    baseUrl: env.CMAP_BASE_URL?.trim() || DEFAULT_BASE_URL,
    cacheDir: env.CMAP_CACHE_DIR?.trim() || join(homedir(), ".cache", "cmap-mcp"),
    maxAgeMin: positiveNumber("CMAP_MAX_AGE_MIN", env.CMAP_MAX_AGE_MIN, 60),
    concurrency: Math.floor(positiveNumber("CMAP_CONCURRENCY", env.CMAP_CONCURRENCY, 4)),
    refreshMin: positiveNumber("CMAP_REFRESH_MIN", env.CMAP_REFRESH_MIN, 10),
  };
}

export function snapshotPath(config: Pick<CmapConfig, "cacheDir">): string {
  return join(config.cacheDir, "snapshot.json");
}
