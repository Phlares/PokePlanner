import {
  migratePlaythrough,
  parsePlaythrough,
  type Playthrough,
  type PlaythroughPackIndex,
} from '../domain/playthrough';

/**
 * The persistence surface for saved playthroughs. It stores ONLY user-state playthrough records;
 * canonical/pack data is never written (strict schema validation rejects any embedded canonical
 * fields on {@link PlaythroughRepository.put}). Every method is async so the memory and native
 * IndexedDB adapters share one interface — components consult this, never IndexedDB directly.
 */
export interface PlaythroughRepository {
  /** All stored playthroughs, each migrated to the current schema on read. */
  list(): Promise<Playthrough[]>;
  /** One playthrough by id (migrated to current schema), or `undefined` when absent. */
  get(id: string): Promise<Playthrough | undefined>;
  /**
   * Validate and store a playthrough, stamping `updatedAt` from the caller-supplied clock. The
   * record is validated against the pack (schema + id refs + team legality) BEFORE any write, so
   * an invalid or canonical-tainted record never reaches storage. Returns the stored record.
   */
  put(record: Playthrough): Promise<Playthrough>;
  /** Remove a playthrough by id (no-op when absent). */
  delete(id: string): Promise<void>;
}

/**
 * Construction options shared by every repository adapter. `pack` resolves referenced ids on read
 * and write; `now` is the caller-supplied clock used to stamp `updatedAt` on put (never
 * `Date.now()`), so persistence stays deterministic and testable.
 */
export interface RepositoryOptions {
  pack: PlaythroughPackIndex;
  now(): number;
}

/**
 * Validate a record for storage: stamp `updatedAt` from the clock, then parse strictly against the
 * schema and pack index. Strict parsing rejects any unknown key — the mechanism that keeps
 * canonical pack data out of storage — and validates every referenced id and team member. Returns
 * a fresh, validated current-schema record; throws on any violation (surfaced as a rejected
 * promise by the callers).
 */
export function validateForStorage(record: Playthrough, options: RepositoryOptions): Playthrough {
  const stamped = { ...record, updatedAt: options.now() };
  return parsePlaythrough(stamped, options.pack);
}

/**
 * Migrate a raw stored value to the current schema, resolving its ids against the pack. Throws when
 * the value cannot be migrated or validated (a corrupt record), so callers surface it as a rejected
 * promise rather than returning a broken playthrough.
 */
export function migrateStored(raw: unknown, options: RepositoryOptions): Playthrough {
  return prepareStoredMigration(raw, options).playthrough;
}

/** A fully validated read candidate plus whether its durable representation needs replacement. */
export interface StoredMigration {
  playthrough: Playthrough;
  migrated: boolean;
}

/**
 * Prepare a stored value for return and possible write-back. The migrated candidate is parsed a
 * second time at this repository boundary before callers replace the previous raw value.
 */
export function prepareStoredMigration(raw: unknown, options: RepositoryOptions): StoredMigration {
  const result = migratePlaythrough(raw, options.pack);
  if (!result.ok) throw new Error(`Corrupt stored playthrough: ${result.error}`);
  return {
    playthrough: parsePlaythrough(result.playthrough, options.pack),
    migrated: result.migrated,
  };
}

/**
 * An in-memory {@link PlaythroughRepository}. Records are held as deep copies keyed by id, so
 * writing or mutating one never disturbs another. Migration and validation run through the exact
 * same helpers as the native adapter. Handy for tests and for a non-persistent session.
 */
export class MemoryPlaythroughRepository implements PlaythroughRepository {
  private readonly store = new Map<string, unknown>();

  constructor(
    private readonly options: RepositoryOptions,
    seed?: Iterable<readonly [string, unknown]>,
  ) {
    if (seed) {
      for (const [id, value] of seed) this.store.set(id, structuredClone(value));
    }
  }

  async list(): Promise<Playthrough[]> {
    // Prepare every candidate first. If one is corrupt, no earlier candidate is written back.
    const prepared = Array.from(this.store, ([id, raw]) => [id, prepareStoredMigration(raw, this.options)] as const);
    for (const [id, result] of prepared) {
      if (result.migrated) this.store.set(id, structuredClone(result.playthrough));
    }
    return prepared.map(([, result]) => result.playthrough);
  }

  async get(id: string): Promise<Playthrough | undefined> {
    const raw = this.store.get(id);
    if (raw === undefined) return undefined;
    const prepared = prepareStoredMigration(raw, this.options);
    if (prepared.migrated) this.store.set(id, structuredClone(prepared.playthrough));
    return prepared.playthrough;
  }

  async put(record: Playthrough): Promise<Playthrough> {
    const validated = validateForStorage(record, this.options);
    this.store.set(validated.id, structuredClone(validated));
    return validated;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
