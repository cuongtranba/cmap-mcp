import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { errorMessage } from "../errors.ts";
import { type Snapshot, snapshotSchema } from "./snapshot.ts";

export interface StoreError {
  message: string;
  at: string;
}

/**
 * Owns the current snapshot: in memory for queries, on disk (`snapshot.json`) for warm starts.
 * The swap is atomic (temp file then rename) and a failed sync never touches the last good copy.
 */
export class SnapshotStore {
  private snapshot: Snapshot | undefined;
  private error: StoreError | undefined;

  constructor(
    readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get current(): Snapshot | undefined {
    return this.snapshot;
  }

  get lastError(): StoreError | undefined {
    return this.error;
  }

  /** Load the disk copy into memory; returns false when it is missing, corrupt or outdated. */
  async loadFromDisk(): Promise<boolean> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch {
      return false;
    }
    try {
      const parsed = snapshotSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return false;
      this.snapshot = parsed.data;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Replace the in-memory snapshot, clear the last error, then persist it. A persistence failure
   * (read-only cache dir, full disk) does not fail the sync: the message is returned instead.
   */
  async swap(snapshot: Snapshot): Promise<string | undefined> {
    this.snapshot = snapshot;
    this.error = undefined;
    const temp = `${this.path}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(temp, JSON.stringify(snapshot));
      await rename(temp, this.path);
      return undefined;
    } catch (error) {
      await rm(temp, { force: true });
      return `Could not write ${this.path}: ${errorMessage(error)}`;
    }
  }

  recordError(error: unknown): void {
    this.error = { message: errorMessage(error), at: this.now().toISOString() };
  }

  ageMinutes(): number | undefined {
    if (!this.snapshot) return undefined;
    return (this.now().getTime() - Date.parse(this.snapshot.syncedAt)) / 60_000;
  }

  isFresh(maxAgeMin: number): boolean {
    const age = this.ageMinutes();
    return age !== undefined && age <= maxAgeMin;
  }

  /**
   * Make sure a snapshot no older than `maxAgeMin` is loaded, calling `refresh` when it is not.
   * If the refresh fails but an older snapshot exists, that one is kept and the error recorded.
   */
  async ensureFresh(options: {
    maxAgeMin: number;
    refresh: () => Promise<unknown>;
    force?: boolean;
  }): Promise<void> {
    if (!options.force && this.isFresh(options.maxAgeMin)) return;
    try {
      await options.refresh();
    } catch (error) {
      if (this.snapshot === undefined) throw error;
      this.recordError(error);
    }
  }
}
