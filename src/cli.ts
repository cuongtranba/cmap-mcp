#!/usr/bin/env node
/** The `cmap` command: a thin adapter that parses arguments and prints library results. */
import { parseArgs } from "node:util";
import { COMMAND_HELP, GROUP_HELP, MAIN_HELP } from "./cli/help.ts";
import {
  eventDetailText,
  eventsListText,
  eventsPageText,
  offerDetailText,
  offersPageText,
  placesText,
  provinceDetailText,
  provincesText,
  statusText,
  syncText,
  taxonomiesText,
} from "./cli/text.ts";
import { type Cmap, createCmap, isCmapError, type Language, VERSION } from "./index.ts";

/** A mistake in how the command line was written: exit code 2 and the relevant help text. */
class UsageError extends Error {
  constructor(
    message: string,
    readonly help: string = MAIN_HELP,
  ) {
    super(message);
    this.name = "UsageError";
  }
}

const OPTIONS = {
  province: { type: "string" },
  type: { type: "string" },
  category: { type: "string" },
  kind: { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  free: { type: "boolean" },
  paid: { type: "boolean" },
  highlight: { type: "boolean" },
  limit: { type: "string" },
  offset: { type: "string" },
  lang: { type: "string" },
  "radius-km": { type: "string" },
  http: { type: "string" },
  "max-age": { type: "string" },
  refresh: { type: "boolean" },
  text: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

type FlagName = keyof typeof OPTIONS;
type Values = {
  [K in FlagName]?: ((typeof OPTIONS)[K]["type"] extends "boolean" ? boolean : string) | undefined;
};

const GLOBAL_FLAGS: readonly FlagName[] = ["help", "version"];
const DATA_FLAGS: readonly FlagName[] = ["lang", "refresh", "max-age", "text"];

/** What a command produced: the JSON value and its `--text` rendering. */
interface Output {
  json: unknown;
  text: () => string;
}

interface Context {
  cmap: Cmap;
  args: readonly string[];
  values: Values;
}

interface Command {
  path: readonly string[];
  flags: readonly FlagName[];
  minArgs: number;
  maxArgs: number;
  /** Sync first when --refresh is given (every data command, not sync/status/mcp). */
  data: boolean;
  run: (context: Context) => Promise<Output>;
}

function number(
  flag: string,
  raw: string | undefined,
  rule: { integer?: boolean; min?: number; max?: number },
  help: string,
): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  const bad =
    raw.trim() === "" ||
    !Number.isFinite(value) ||
    (rule.integer === true && !Number.isInteger(value)) ||
    (rule.min !== undefined && value < rule.min) ||
    (rule.max !== undefined && value > rule.max);
  if (bad) throw new UsageError(`--${flag} must be a valid number, got "${raw}"`, help);
  return value;
}

function language(raw: string | undefined, help: string): Language | undefined {
  if (raw === undefined) return undefined;
  if (raw === "vi" || raw === "en") return raw;
  throw new UsageError(`--lang must be "vi" or "en", got "${raw}"`, help);
}

const query = (args: readonly string[]): string | undefined =>
  args.length === 0 ? undefined : args.join(" ");

function pageParams(values: Values, help: string) {
  return {
    limit: number("limit", values.limit, { integer: true, min: 1 }, help),
    offset: number("offset", values.offset, { integer: true, min: 0 }, help),
    lang: language(values.lang, help),
  };
}

function freeFlag(values: Values, help: string): boolean | undefined {
  if (values.free === true && values.paid === true) {
    throw new UsageError("--free and --paid cannot be combined", help);
  }
  return values.free === true ? true : values.paid === true ? false : undefined;
}

const helpFor = (path: string): string => COMMAND_HELP[path] ?? MAIN_HELP;

const COMMANDS: readonly Command[] = [
  {
    path: ["sync"],
    flags: [],
    minArgs: 0,
    maxArgs: 0,
    data: false,
    async run({ cmap }) {
      const report = await cmap.sync();
      return { json: report, text: () => syncText(report) };
    },
  },
  {
    path: ["status"],
    flags: ["text"],
    minArgs: 0,
    maxArgs: 0,
    data: false,
    async run({ cmap }) {
      const status = await cmap.status();
      return { json: status, text: () => statusText(status) };
    },
  },
  {
    path: ["events", "search"],
    flags: [
      ...DATA_FLAGS,
      "province",
      "type",
      "category",
      "from",
      "to",
      "free",
      "paid",
      "highlight",
      "limit",
      "offset",
    ],
    minArgs: 0,
    maxArgs: Number.POSITIVE_INFINITY,
    data: true,
    async run({ cmap, args, values }) {
      const help = helpFor("events search");
      const { limit, offset, lang } = pageParams(values, help);
      const page = await cmap.searchEvents({
        query: query(args),
        province: values.province,
        type: values.type,
        category: values.category,
        from: values.from,
        to: values.to,
        free: freeFlag(values, help),
        highlight: values.highlight === true ? true : undefined,
        limit,
        offset,
        lang,
      });
      return { json: page, text: () => eventsPageText(page) };
    },
  },
  {
    path: ["events", "near"],
    flags: [...DATA_FLAGS, "radius-km", "limit", "from", "to"],
    minArgs: 2,
    maxArgs: 2,
    data: true,
    async run({ cmap, args, values }) {
      const help = helpFor("events near");
      const [rawLat, rawLng] = args;
      const lat = number("lat", rawLat, { min: -90, max: 90 }, help);
      const lng = number("lng", rawLng, { min: -180, max: 180 }, help);
      if (lat === undefined || lng === undefined)
        throw new UsageError("lat and lng are required", help);
      const events = await cmap.eventsNear({
        lat,
        lng,
        radiusKm: number("radius-km", values["radius-km"], { min: 0 }, help),
        limit: number("limit", values.limit, { integer: true, min: 1 }, help),
        from: values.from,
        to: values.to,
        lang: language(values.lang, help),
      });
      return { json: { items: events }, text: () => eventsListText(events) };
    },
  },
  {
    path: ["event", "get"],
    flags: [...DATA_FLAGS],
    minArgs: 1,
    maxArgs: 1,
    data: true,
    async run({ cmap, args, values }) {
      const [id] = args;
      const event = await cmap.getEvent(id ?? "", {
        lang: language(values.lang, helpFor("event get")),
      });
      return { json: event, text: () => eventDetailText(event) };
    },
  },
  {
    path: ["offers", "search"],
    flags: [...DATA_FLAGS, "province", "kind", "limit", "offset"],
    minArgs: 0,
    maxArgs: Number.POSITIVE_INFINITY,
    data: true,
    async run({ cmap, args, values }) {
      const help = helpFor("offers search");
      const { limit, offset, lang } = pageParams(values, help);
      const kind = values.kind;
      if (kind !== undefined && kind !== "event" && kind !== "position") {
        throw new UsageError(`--kind must be "event" or "position", got "${kind}"`, help);
      }
      const page = await cmap.searchOffers({
        query: query(args),
        province: values.province,
        kind,
        limit,
        offset,
        lang,
      });
      return { json: page, text: () => offersPageText(page) };
    },
  },
  {
    path: ["offer", "get"],
    flags: [...DATA_FLAGS],
    minArgs: 1,
    maxArgs: 1,
    data: true,
    async run({ cmap, args, values }) {
      const [id] = args;
      const offer = await cmap.getOffer(id ?? "", {
        lang: language(values.lang, helpFor("offer get")),
      });
      return { json: offer, text: () => offerDetailText(offer) };
    },
  },
  {
    path: ["provinces"],
    flags: [...DATA_FLAGS],
    minArgs: 0,
    maxArgs: 0,
    data: true,
    async run({ cmap, values }) {
      const provinces = await cmap.listProvinces({
        lang: language(values.lang, helpFor("provinces")),
      });
      return { json: { items: provinces }, text: () => provincesText(provinces) };
    },
  },
  {
    path: ["province", "get"],
    flags: [...DATA_FLAGS],
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    data: true,
    async run({ cmap, args, values }) {
      const province = await cmap.getProvince(args.join(" "), {
        lang: language(values.lang, helpFor("province get")),
      });
      return { json: province, text: () => provinceDetailText(province) };
    },
  },
  {
    path: ["places"],
    flags: [...DATA_FLAGS, "province", "type"],
    minArgs: 0,
    maxArgs: Number.POSITIVE_INFINITY,
    data: true,
    async run({ cmap, args, values }) {
      const places = await cmap.listPlaces({
        query: query(args),
        province: values.province,
        type: values.type,
        lang: language(values.lang, helpFor("places")),
      });
      return { json: { items: places }, text: () => placesText(places) };
    },
  },
  {
    path: ["taxonomies"],
    flags: [...DATA_FLAGS],
    minArgs: 0,
    maxArgs: 0,
    data: true,
    async run({ cmap, values }) {
      const taxonomies = await cmap.listTaxonomies({
        lang: language(values.lang, helpFor("taxonomies")),
      });
      return { json: taxonomies, text: () => taxonomiesText(taxonomies) };
    },
  },
];

/** `host:port`, `:port` (all interfaces) or a bare `port` (loopback). */
function parseListenAddress(raw: string): { host: string; port: number } {
  const help = helpFor("mcp");
  const separator = raw.lastIndexOf(":");
  const hostPart = separator === -1 ? "127.0.0.1" : raw.slice(0, separator) || "0.0.0.0";
  const rawPort = separator === -1 ? raw : raw.slice(separator + 1);
  const port = Number(rawPort);
  if (rawPort === "" || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`--http expects host:port such as 127.0.0.1:8787, got "${raw}"`, help);
  }
  return { host: hostPart.replace(/^\[(.*)\]$/, "$1"), port };
}

function findCommand(
  positionals: readonly string[],
): { command: Command; args: string[] } | undefined {
  for (const length of [2, 1]) {
    const path = positionals.slice(0, length);
    const command = COMMANDS.find(
      (c) => c.path.length === length && c.path.every((word, i) => word === path[i]),
    );
    if (command) return { command, args: positionals.slice(length) };
  }
  return undefined;
}

function print(stream: NodeJS.WriteStream, text: string): void {
  stream.write(text.endsWith("\n") ? text : `${text}\n`);
}

function usageFailure(error: UsageError): number {
  print(process.stderr, `cmap: ${error.message}\n\n${error.help}`);
  return 2;
}

function runtimeFailure(error: unknown): number {
  const failure = isCmapError(error)
    ? { code: error.code, message: error.message }
    : { code: "INTERNAL", message: error instanceof Error ? error.message : String(error) };
  print(process.stderr, JSON.stringify({ error: failure }, null, 2));
  return 1;
}

function parse(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

async function runMcp(values: Values): Promise<void> {
  const { startMcp } = await import("./mcp/server.ts");
  const listen = values.http === undefined ? undefined : parseListenAddress(values.http);
  await startMcp(listen);
}

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parse(argv);
  if (values.version === true) {
    print(process.stdout, VERSION);
    return 0;
  }

  const [first, second] = positionals;
  if (first === undefined) {
    if (values.help === true) {
      print(process.stdout, MAIN_HELP);
      return 0;
    }
    throw new UsageError("missing command");
  }

  if (first === "mcp") {
    if (values.help === true) {
      print(process.stdout, helpFor("mcp"));
      return 0;
    }
    reject(values, ["http", ...GLOBAL_FLAGS], helpFor("mcp"));
    if (positionals.length > 1) throw new UsageError("mcp takes no arguments", helpFor("mcp"));
    await runMcp(values);
    return -1;
  }

  const found = findCommand(positionals);
  if (!found) {
    const group = GROUP_HELP[first];
    if (group !== undefined && values.help === true) {
      print(process.stdout, group.map(helpFor).join("\n"));
      return 0;
    }
    if (group !== undefined) {
      throw new UsageError(
        second === undefined
          ? `"${first}" needs a subcommand`
          : `unknown subcommand "${first} ${second}"`,
        group.map(helpFor).join("\n"),
      );
    }
    throw new UsageError(`unknown command "${first}"`);
  }

  const { command, args } = found;
  const help = helpFor(command.path.join(" "));
  if (values.help === true) {
    print(process.stdout, help);
    return 0;
  }
  reject(values, [...command.flags, ...GLOBAL_FLAGS], help);
  if (args.length < command.minArgs || args.length > command.maxArgs) {
    throw new UsageError(
      args.length < command.minArgs ? "missing argument" : "too many arguments",
      help,
    );
  }

  const maxAgeMin = number("max-age", values["max-age"], { min: 0 }, help);
  const cmap = createCmap(maxAgeMin === undefined ? {} : { maxAgeMin });
  if (command.data && values.refresh === true) await cmap.sync();
  const output = await command.run({ cmap, args, values });
  print(
    process.stdout,
    values.text === true ? output.text() : JSON.stringify(output.json, null, 2),
  );
  return 0;
}

/** Fail with a usage error when a flag that this command does not take was given. */
function reject(values: Values, allowed: readonly FlagName[], help: string): void {
  for (const flag of Object.keys(values)) {
    if (!allowed.some((name) => name === flag)) {
      throw new UsageError(`unknown or unsupported flag --${flag} for this command`, help);
    }
  }
}

// A closed pipe (`cmap ... | head`) is not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EPIPE") throw error;
});

try {
  const code = await main(process.argv.slice(2));
  if (code >= 0) process.exitCode = code;
} catch (error) {
  process.exitCode = error instanceof UsageError ? usageFailure(error) : runtimeFailure(error);
}
