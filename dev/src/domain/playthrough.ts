import { z } from 'zod';
import { validateTeamState, type MemberPackView, type TeamState } from './team';

/**
 * The current on-disk schema version for a serialized playthrough. Bump this and add a
 * migration step whenever the persisted shape changes.
 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/**
 * The injected id-resolution surface for a playthrough. It extends the team's member-legality
 * view with milestone and acquisition existence checks, so every id a playthrough references
 * can be validated against the pack without embedding any canonical data.
 */
export interface PlaythroughPackIndex extends MemberPackView {
  hasMilestone(milestoneId: string): boolean;
  hasAcquisition(acquisitionId: string): boolean;
}

/**
 * Reserved Plan-3 live-run checkoff maps. Present for forward-compatibility but carry no
 * behavior in this plan; created empty and left empty.
 */
export interface CheckoffMaps {
  routesCompleted: Record<string, boolean>;
  encountered: Record<string, boolean>;
  captured: Record<string, boolean>;
}

/**
 * A versioned, self-contained playthrough record. It stores only user choices and id/refs —
 * never canonical pack data. Game is fixed FireRed and type fixed Standard. The current and
 * preview milestone are deliberately distinct fields so a look-ahead never disturbs saved
 * progress.
 */
export interface Playthrough {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  packVersion: string;
  id: string;
  name: string;
  game: 'firered';
  type: 'standard';
  createdAt: number;
  updatedAt: number;
  starterSpeciesId: number;
  branchChoices: Record<string, string>;
  currentMilestoneId: string | null;
  previewMilestoneId: string | null;
  team: TeamState;
  notes: string;
  acquisitionOverrides: string[];
  checkoffs: CheckoffMaps;
}

const plannedMoveSchema = z.object({
  moveId: z.number().int().positive(),
  status: z.enum(['available-now', 'future-level', 'future-milestone']),
  level: z.number().int().positive().nullable(),
  milestoneId: z.string().min(1).nullable(),
}).strict();

const teamMemberSchema = z.object({
  id: z.string().min(1),
  speciesId: z.number().int().positive(),
  level: z.number().int().min(1).max(100),
  abilityId: z.number().int().positive(),
  moves: z.array(plannedMoveSchema).max(4),
  nickname: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).strict();

const slotSchema = teamMemberSchema.nullable();
const sixSlotsSchema = z.tuple([slotSchema, slotSchema, slotSchema, slotSchema, slotSchema, slotSchema]);
const teamStateSchema = z.object({ primary: sixSlotsSchema, reserve: sixSlotsSchema }).strict();

const checkoffMapsSchema = z.object({
  routesCompleted: z.record(z.string(), z.boolean()),
  encountered: z.record(z.string(), z.boolean()),
  captured: z.record(z.string(), z.boolean()),
}).strict();

const playthroughSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  packVersion: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  game: z.literal('firered'),
  type: z.literal('standard'),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  starterSpeciesId: z.number().int().positive(),
  branchChoices: z.record(z.string(), z.string()),
  currentMilestoneId: z.string().min(1).nullable(),
  previewMilestoneId: z.string().min(1).nullable(),
  team: teamStateSchema,
  notes: z.string(),
  acquisitionOverrides: z.array(z.string().min(1)),
  checkoffs: checkoffMapsSchema,
}).strict();

function emptyCheckoffs(): CheckoffMaps {
  return { routesCompleted: {}, encountered: {}, captured: {} };
}

/**
 * Resolve every id a playthrough references against the injected pack index: the starter
 * species, the current/preview milestones (when present), each acquisition override, and every
 * team member (species, ability, and version-valid moves via {@link validateTeamState}).
 * Throws on the first unknown id.
 */
function validateReferences(playthrough: Playthrough, pack: PlaythroughPackIndex): void {
  if (!pack.hasSpecies(playthrough.starterSpeciesId)) {
    throw new Error(`Unknown starter species id ${playthrough.starterSpeciesId}`);
  }
  if (playthrough.currentMilestoneId !== null && !pack.hasMilestone(playthrough.currentMilestoneId)) {
    throw new Error(`Unknown current milestone id "${playthrough.currentMilestoneId}"`);
  }
  if (playthrough.previewMilestoneId !== null && !pack.hasMilestone(playthrough.previewMilestoneId)) {
    throw new Error(`Unknown preview milestone id "${playthrough.previewMilestoneId}"`);
  }
  for (const acquisitionId of playthrough.acquisitionOverrides) {
    if (!pack.hasAcquisition(acquisitionId)) {
      throw new Error(`Unknown acquisition override id "${acquisitionId}"`);
    }
  }
  validateTeamState(playthrough.team, pack);
}

/** Inputs for a brand-new Standard FireRed playthrough. Timestamps are caller-supplied. */
export interface CreateStandardPlaythroughInput {
  id: string;
  name: string;
  starterSpeciesId: number;
  createdAt: number;
  updatedAt: number;
  packVersion: string;
  currentMilestoneId?: string | null;
  previewMilestoneId?: string | null;
  branchChoices?: Record<string, string>;
  team?: TeamState;
  notes?: string;
  acquisitionOverrides?: readonly string[];
}

/**
 * Build a new, validated Standard FireRed playthrough. Game and type are fixed. Timestamps are
 * taken from the caller (never `Date.now()`), so callers control determinism. Checkoff maps are
 * created empty for Plan-3 forward-compat. Every referenced id is validated; throws on any
 * unknown id or illegal team member.
 */
export function createStandardPlaythrough(input: CreateStandardPlaythroughInput, pack: PlaythroughPackIndex): Playthrough {
  const playthrough: Playthrough = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    packVersion: input.packVersion,
    id: input.id,
    name: input.name,
    game: 'firered',
    type: 'standard',
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    starterSpeciesId: input.starterSpeciesId,
    branchChoices: { ...(input.branchChoices ?? {}) },
    currentMilestoneId: input.currentMilestoneId ?? null,
    previewMilestoneId: input.previewMilestoneId ?? null,
    team: input.team ?? { primary: [null, null, null, null, null, null], reserve: [null, null, null, null, null, null] },
    notes: input.notes ?? '',
    acquisitionOverrides: [...(input.acquisitionOverrides ?? [])],
    checkoffs: emptyCheckoffs(),
  };
  validateReferences(playthrough, pack);
  return playthrough;
}

/**
 * Parse and fully validate an unknown value as a current-schema playthrough. Structural
 * validation is strict — unknown keys (embedded canonical/pack data) are rejected — and every
 * referenced id must resolve against the injected pack index. Throws on any violation.
 */
export function parsePlaythrough(input: unknown, pack: PlaythroughPackIndex): Playthrough {
  const parsed = playthroughSchema.parse(input) as unknown as Playthrough;
  validateReferences(parsed, pack);
  return parsed;
}

/** The outcome of a migration. On failure the exact prior value is returned, never lost. */
export type MigratePlaythroughResult =
  | { ok: true; playthrough: Playthrough; migrated: boolean }
  | { ok: false; error: string; previous: unknown };

/**
 * Transform a possibly-legacy value into a candidate current-schema object WITHOUT mutating the
 * input. Deterministic: every default is fixed, no clock is read. Throws on a non-object or a
 * newer-than-current schema version (which cannot be migrated backward).
 */
function toCurrentSchemaCandidate(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Playthrough to migrate must be an object');
  }
  const source = input as Record<string, unknown>;
  const version = typeof source.schemaVersion === 'number' ? source.schemaVersion : 0;
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Cannot migrate playthrough from newer schema version ${version}`);
  }
  if (version === CURRENT_SCHEMA_VERSION) return { ...source };
  // v0 → v1: fill the fields introduced in v1 without disturbing existing user data.
  return {
    ...source,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    game: source.game ?? 'firered',
    type: source.type ?? 'standard',
    branchChoices: source.branchChoices ?? {},
    previewMilestoneId: source.previewMilestoneId ?? null,
    currentMilestoneId: source.currentMilestoneId ?? null,
    notes: source.notes ?? '',
    acquisitionOverrides: source.acquisitionOverrides ?? [],
    checkoffs: source.checkoffs ?? emptyCheckoffs(),
  };
}

/**
 * Migrate a persisted value to the current schema. Deterministic and non-destructive: it builds
 * a candidate, validates it against the schema AND the injected pack index, and only then
 * returns it. If anything fails the exact prior value is returned untouched (`ok: false`,
 * `previous: input`), so a failed migration never corrupts or loses the input.
 */
export function migratePlaythrough(input: unknown, pack: PlaythroughPackIndex): MigratePlaythroughResult {
  const wasCurrent = input !== null
    && typeof input === 'object'
    && (input as Record<string, unknown>).schemaVersion === CURRENT_SCHEMA_VERSION;
  try {
    const candidate = toCurrentSchemaCandidate(input);
    const playthrough = parsePlaythrough(candidate, pack);
    return { ok: true, playthrough, migrated: !wasCurrent };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), previous: input };
  }
}
