import pLimit from "p-limit";
import { z } from "zod";
import { CmapError, errorMessage } from "../errors.ts";
import { VERSION } from "../version.ts";
import { type RawPage, rawPageSchema } from "./schemas.ts";

export interface ClientOptions {
  baseUrl: string;
  /** Maximum simultaneous requests (default 4). */
  concurrency?: number;
  /** Per-attempt timeout in milliseconds (default 20 000). */
  timeoutMs?: number;
  /** Retries after the first attempt on 429, 5xx and network errors (default 4). */
  retries?: number;
  /** First backoff delay in milliseconds; doubles on each retry, plus up to 25% jitter (default 1000). */
  retryDelayMs?: number;
}

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with up to 25% jitter so concurrent workers do not retry in lockstep. */
function backoffMs(baseMs: number, attempt: number): number {
  return baseMs * 2 ** attempt * (1 + Math.random() * 0.25);
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 10_000) : undefined;
}

/** Thin, polite HTTP client for cmap.vn's /fe_api: bounded concurrency, retries, schema checks. */
export class UpstreamClient {
  readonly baseUrl: string;
  readonly userAgent = `cmap-mcp/${VERSION}`;
  private readonly limit: ReturnType<typeof pLimit>;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.limit = pLimit(Math.max(1, options.concurrency ?? 4));
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retries = options.retries ?? 4;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
  }

  /** GET `path` and validate the JSON body with `schema`; errors name the endpoint. */
  async get<S extends z.ZodType>(
    path: string,
    params: QueryParams,
    schema: S,
  ): Promise<z.output<S>> {
    const url = this.buildUrl(path, params);
    const label = `${path}${url.search}`;
    const body = await this.limit(() => this.fetchJson(url, label));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new CmapError(
        "UPSTREAM",
        `Unexpected response from ${label}: ${z.prettifyError(parsed.error)}`,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  /** GET a list endpoint; records stay `unknown` so callers validate them one by one. */
  getPage(path: string, params: QueryParams): Promise<RawPage> {
    return this.get(path, params, rawPageSchema);
  }

  private buildUrl(path: string, params: QueryParams): URL {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }

  private async fetchJson(url: URL, label: string): Promise<unknown> {
    let failure: CmapError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const outcome = await this.attempt(url, label);
      if (outcome.kind === "ok") return outcome.body;
      if (outcome.kind === "fatal") throw outcome.error;
      failure = outcome.error;
      if (attempt < this.retries) {
        await sleep(outcome.waitMs ?? backoffMs(this.retryDelayMs, attempt));
      }
    }
    throw failure ?? new CmapError("UPSTREAM", `Request to ${label} failed`);
  }

  private async attempt(url: URL, label: string): Promise<Attempt> {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.ok) return { kind: "ok", body: await response.json() };
      if (response.status === 404) {
        return {
          kind: "fatal",
          error: new CmapError("NOT_FOUND", `Upstream returned 404 for ${label}`),
        };
      }
      const error = new CmapError("UPSTREAM", `Upstream returned ${response.status} for ${label}`);
      if (!RETRYABLE_STATUS.has(response.status)) return { kind: "fatal", error };
      const waitMs = retryAfterMs(response);
      return waitMs === undefined ? { kind: "retry", error } : { kind: "retry", error, waitMs };
    } catch (cause) {
      const error = new CmapError(
        "UPSTREAM",
        `Request to ${label} failed: ${errorMessage(cause)}`,
        {
          cause,
        },
      );
      return { kind: "retry", error };
    }
  }
}

type Attempt =
  | { kind: "ok"; body: unknown }
  | { kind: "fatal"; error: CmapError }
  | { kind: "retry"; error: CmapError; waitMs?: number };
