import pkg from "../package.json" with { type: "json" };

/** Package version, read from package.json at build time so `bun pm version` is the only place to bump it. */
export const VERSION: string = pkg.version;
