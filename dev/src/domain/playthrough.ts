import { z } from 'zod';
import { createEmptyTimeline, parseTimelineState, type TimelinePackView, type TimelineState } from './timeline/model';
import { createEmptyTeam, validateTeamState, type MemberPackView, type PlannedMove, type TeamMember, type TeamState } from './team';

/** The current on-disk schema version for a serialized playthrough. */
export const CURRENT_SCHEMA_VERSION = 2 as const;
const LEGACY_SCHEMA_VERSION = 1 as const;

/** The injected id-resolution surface for a playthrough. */
export interface PlaythroughPackIndex extends TimelinePackView {
  starterNodeId(): string;
}

export interface CheckoffMaps {
  routesCompleted: Record<string, boolean>;
  encountered: Record<string, boolean>;
  captured: Record<string, boolean>;
}

/** A schema-v2 playthrough persists only user choices, ids and explicit timeline state. */
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
  timeline: TimelineState;
  /** Temporary non-enumerable projection for the pre-timeline TeamManifest. Never persisted. */
  readonly team: TeamState;
  notes: string;
  acquisitionOverrides: string[];
  checkoffs: CheckoffMaps;
}

interface LegacyPlaythroughV1 extends Omit<Playthrough, 'schemaVersion' | 'timeline'> {
  schemaVersion: typeof LEGACY_SCHEMA_VERSION;
  team: TeamState;
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

const commonPlaythroughSchema = {
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
  notes: z.string(),
  acquisitionOverrides: z.array(z.string().min(1)),
  checkoffs: checkoffMapsSchema,
};
const playthroughSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  ...commonPlaythroughSchema,
  timeline: z.unknown(),
}).strict();
const legacyPlaythroughV1Schema = z.object({
  schemaVersion: z.literal(LEGACY_SCHEMA_VERSION),
  ...commonPlaythroughSchema,
  team: teamStateSchema,
}).strict();

function emptyCheckoffs(): CheckoffMaps {
  return { routesCompleted: {}, encountered: {}, captured: {} };
}

function validateCommonReferences(playthrough: Pick<Playthrough, 'starterSpeciesId' | 'currentMilestoneId' | 'previewMilestoneId' | 'acquisitionOverrides'>, pack: PlaythroughPackIndex): void {
  if (!pack.hasSpecies(playthrough.starterSpeciesId)) throw new Error(`Unknown starter species id ${playthrough.starterSpeciesId}`);
  if (playthrough.currentMilestoneId !== null && !pack.hasMilestone(playthrough.currentMilestoneId)) {
    throw new Error(`Unknown current milestone id "${playthrough.currentMilestoneId}"`);
  }
  if (playthrough.previewMilestoneId !== null && !pack.hasMilestone(playthrough.previewMilestoneId)) {
    throw new Error(`Unknown preview milestone id "${playthrough.previewMilestoneId}"`);
  }
  for (const acquisitionId of playthrough.acquisitionOverrides) {
    if (!pack.hasAcquisition(acquisitionId)) throw new Error(`Unknown acquisition override id "${acquisitionId}"`);
  }
}

function validateReferences(playthrough: Omit<Playthrough, 'team'>, pack: PlaythroughPackIndex): void {
  validateCommonReferences(playthrough, pack);
  parseTimelineState(playthrough.timeline, pack);
}

function legacyTeamView(playthrough: Pick<Playthrough, 'timeline' | 'currentMilestoneId' | 'previewMilestoneId'>): TeamState {
  const { timeline } = playthrough;
  const keyframe = (playthrough.currentMilestoneId === null ? undefined : timeline.keyframes[playthrough.currentMilestoneId])
    ?? (playthrough.previewMilestoneId === null ? undefined : timeline.keyframes[playthrough.previewMilestoneId])
    ?? Object.keys(timeline.keyframes).sort().map((nodeId) => timeline.keyframes[nodeId])[0];
  if (!keyframe) return createEmptyTeam();
  const memberAt = (memberId: string | null): TeamMember | null => {
    if (memberId === null) return null;
    const member = timeline.members[memberId];
    const snapshot = keyframe.snapshots[memberId];
    if (!member || !snapshot) return null;
    return {
      id: member.id,
      speciesId: snapshot.speciesId,
      level: snapshot.level,
      abilityId: snapshot.abilityId,
      moves: snapshot.moves,
      nickname: member.nickname,
      notes: member.notes,
    };
  };
  const primary = keyframe.party.map(memberAt) as unknown as TeamState['primary'];
  const reserve = Array.from({ length: 6 }, (_value, index) => memberAt(keyframe.reserve[index] ?? null)) as unknown as TeamState['reserve'];
  return { primary, reserve };
}

function withLegacyTeamView(playthrough: Omit<Playthrough, 'team'>): Playthrough {
  Object.defineProperty(playthrough, 'team', {
    value: legacyTeamView(playthrough), enumerable: false, writable: false, configurable: false,
  });
  return playthrough as Playthrough;
}

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
  timeline?: TimelineState;
  notes?: string;
  acquisitionOverrides?: readonly string[];
}

/** Build a new validated schema-v2 FireRed run; no legacy team shape is persisted. */
export function createStandardPlaythrough(input: CreateStandardPlaythroughInput, pack: PlaythroughPackIndex): Playthrough {
  const playthrough: Omit<Playthrough, 'team'> = {
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
    timeline: input.timeline ?? createEmptyTimeline(),
    notes: input.notes ?? '',
    acquisitionOverrides: [...(input.acquisitionOverrides ?? [])],
    checkoffs: emptyCheckoffs(),
  };
  validateReferences(playthrough, pack);
  return withLegacyTeamView(playthrough);
}

/** Parse and fully validate a strict, current-schema playthrough. */
export function parsePlaythrough(input: unknown, pack: PlaythroughPackIndex): Playthrough {
  const parsed = playthroughSchema.parse(input) as unknown as Omit<Playthrough, 'team'>;
  validateReferences(parsed, pack);
  return withLegacyTeamView(parsed);
}

function parseLegacyV1(input: unknown, pack: PlaythroughPackIndex): LegacyPlaythroughV1 {
  const legacy = legacyPlaythroughV1Schema.parse(input) as unknown as LegacyPlaythroughV1;
  validateCommonReferences(legacy, pack);
  validateTeamState(legacy.team, pack);
  return legacy;
}

function migrationNodeId(playthrough: LegacyPlaythroughV1, pack: PlaythroughPackIndex): string {
  return playthrough.currentMilestoneId ?? playthrough.previewMilestoneId ?? pack.starterNodeId();
}

function copyMoves(moves: readonly PlannedMove[]): PlannedMove[] {
  return moves.map((move) => ({ ...move }));
}

/** Convert an already-validated v1 team to persistent members and one major keyframe. */
export function migratePlaythroughV1(input: unknown, pack: PlaythroughPackIndex): Playthrough {
  // Validation happens before the replacement candidate is built, preserving corrupt v1 data.
  const legacy = parseLegacyV1(input, pack);
  const nodeId = migrationNodeId(legacy, pack);
  const members: TimelineState['members'] = {};
  const snapshots: Record<string, TimelineState['keyframes'][string]['snapshots'][string]> = {};
  const party: [string | null, string | null, string | null, string | null, string | null, string | null] = [null, null, null, null, null, null];
  const reserve: string[] = [];
  const speciesSequences = new Map<number, number>();

  const migrateMember = (legacyMember: TeamMember, placement: 'party' | 'reserve', partySlot: 0 | 1 | 2 | 3 | 4 | 5 | null) => {
    const speciesSequence = (speciesSequences.get(legacyMember.speciesId) ?? 0) + 1;
    speciesSequences.set(legacyMember.speciesId, speciesSequence);
    members[legacyMember.id] = {
      id: legacyMember.id,
      originalSpeciesId: legacyMember.speciesId,
      speciesSequence,
      nickname: legacyMember.nickname ?? null,
      natureId: null,
      origin: { type: 'inferred', acquisitionId: null, note: null },
      acquiredAtNodeId: nodeId,
      notes: legacyMember.notes ?? '',
      lifecycle: [],
    };
    snapshots[legacyMember.id] = {
      speciesId: legacyMember.speciesId,
      level: legacyMember.level,
      abilityId: legacyMember.abilityId,
      moves: copyMoves(legacyMember.moves),
      heldItemId: null,
      placement,
      partySlot,
      review: { moves: false, heldItem: false },
    };
  };

  legacy.team.primary.forEach((legacyMember, slot) => {
    if (legacyMember === null) return;
    const partySlot = slot as 0 | 1 | 2 | 3 | 4 | 5;
    migrateMember(legacyMember, 'party', partySlot);
    party[partySlot] = legacyMember.id;
  });
  legacy.team.reserve.forEach((legacyMember) => {
    if (legacyMember === null) return;
    migrateMember(legacyMember, 'reserve', null);
    reserve.push(legacyMember.id);
  });

  const { team: _legacyTeam, ...playthroughFields } = legacy;
  return parsePlaythrough({
    ...playthroughFields,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timeline: {
      members,
      keyframes: {
        [nodeId]: { nodeId, kind: 'major', party, reserve, released: [], snapshots },
      },
      overrides: {},
      preferences: { levelMode: 'manual', autoEvolveLevel: false },
    },
  }, pack);
}

/** The outcome of a migration. On failure the exact prior value is returned, never lost. */
export type MigratePlaythroughResult =
  | { ok: true; playthrough: Playthrough; migrated: boolean }
  | { ok: false; error: string; previous: unknown };

function toLegacyV1Candidate(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Playthrough to migrate must be an object');
  const source = input as Record<string, unknown>;
  return {
    ...source,
    schemaVersion: LEGACY_SCHEMA_VERSION,
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
 * Deterministically migrate v0/v1 values. v0 first becomes and validates as v1, then v1 is
 * converted to v2; neither path replaces a durable record before every validation succeeds.
 */
export function migratePlaythrough(input: unknown, pack: PlaythroughPackIndex): MigratePlaythroughResult {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Playthrough to migrate must be an object');
    const source = input as Record<string, unknown>;
    const version = typeof source.schemaVersion === 'number' ? source.schemaVersion : 0;
    if (version > CURRENT_SCHEMA_VERSION) throw new Error(`Cannot migrate playthrough from newer schema version ${version}`);
    if (version === CURRENT_SCHEMA_VERSION) return { ok: true, playthrough: parsePlaythrough(input, pack), migrated: false };
    if (version === LEGACY_SCHEMA_VERSION) return { ok: true, playthrough: migratePlaythroughV1(input, pack), migrated: true };
    if (version === 0) {
      const v1Candidate = toLegacyV1Candidate(input);
      return { ok: true, playthrough: migratePlaythroughV1(v1Candidate, pack), migrated: true };
    }
    throw new Error(`Cannot migrate playthrough from unsupported schema version ${version}`);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), previous: input };
  }
}
