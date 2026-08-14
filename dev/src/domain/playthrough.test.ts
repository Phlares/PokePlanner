import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  createStandardPlaythrough,
  migratePlaythrough,
  parsePlaythrough,
  type PlaythroughPackIndex,
} from './playthrough';
import { createEmptyTeam, type TeamMember } from './team';

const LEGAL_ABILITIES: Record<number, number[]> = { 1: [65], 56: [72] };
const VERSION_VALID_MOVES = new Set<number>([10, 43, 89]);
const MILESTONES = new Set<string>(['brock-gym', 'misty-gym', 'giovanni-gym', 'starter-selection']);
const ACQUISITIONS = new Set<string>(['tm26-earthquake', 'hm04-strength']);

const pack: PlaythroughPackIndex = {
  hasSpecies: (id) => id in LEGAL_ABILITIES,
  legalAbilityIds: (id) => LEGAL_ABILITIES[id] ?? [],
  isVersionValidMove: (_species, moveId) => VERSION_VALID_MOVES.has(moveId),
  hasMilestone: (id) => MILESTONES.has(id),
  hasAcquisition: (id) => ACQUISITIONS.has(id),
};

const mankey: TeamMember = {
  id: 'm1',
  speciesId: 56,
  level: 20,
  abilityId: 72,
  moves: [
    { moveId: 10, status: 'available-now', level: null, milestoneId: null },
    { moveId: 89, status: 'future-milestone', level: null, milestoneId: 'giovanni-gym' },
  ],
};

function baseInput() {
  return {
    id: 'p1',
    name: 'My FireRed Run',
    starterSpeciesId: 1,
    createdAt: 1_000,
    updatedAt: 2_000,
    packVersion: 'firered-test',
    currentMilestoneId: 'brock-gym' as string | null,
    previewMilestoneId: 'misty-gym' as string | null,
    acquisitionOverrides: ['tm26-earthquake'],
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('createStandardPlaythrough — fixed FireRed + Standard, versioned, timestamped', () => {
  it('creates a versioned, timestamped Standard FireRed playthrough with empty checkoffs', () => {
    const p = createStandardPlaythrough(baseInput(), pack);
    expect(p.game).toBe('firered');
    expect(p.type).toBe('standard');
    expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(p.packVersion).toBe('firered-test');
    expect(p.createdAt).toBe(1_000); // caller-supplied, never Date.now()
    expect(p.updatedAt).toBe(2_000);
    // Reserved-but-empty checkoff maps for Plan 3 forward-compat.
    expect(p.checkoffs).toEqual({ routesCompleted: {}, encountered: {}, captured: {} });
  });

  it('exposes a non-persisted legacy team view for the existing manifest until timeline UI replaces it', () => {
    const p = createStandardPlaythrough(baseInput(), pack);
    expect((p as unknown as { team: { primary: unknown[]; reserve: unknown[] } }).team.primary).toHaveLength(6);
    expect(JSON.stringify(p)).not.toContain('"team"');
  });

  it('keeps current and preview milestone as distinct fields that may differ', () => {
    const p = createStandardPlaythrough(baseInput(), pack);
    expect(p.currentMilestoneId).toBe('brock-gym');
    expect(p.previewMilestoneId).toBe('misty-gym');
    expect(p.currentMilestoneId).not.toBe(p.previewMilestoneId);
  });

  it('rejects an unknown starter species id', () => {
    expect(() => createStandardPlaythrough({ ...baseInput(), starterSpeciesId: 999 }, pack)).toThrow(/starter|species/i);
  });

  it('rejects an unknown milestone id', () => {
    expect(() => createStandardPlaythrough({ ...baseInput(), currentMilestoneId: 'nope-gym' }, pack)).toThrow(/milestone/i);
  });

  it('rejects an unknown acquisition override id', () => {
    expect(() => createStandardPlaythrough({ ...baseInput(), acquisitionOverrides: ['tm99-fake'] }, pack)).toThrow(/acquisition/i);
  });
});

describe('parsePlaythrough — validates game/type, refs, and rejects embedded canonical data', () => {
  function validDoc() {
    const p = createStandardPlaythrough(baseInput(), pack);
    return JSON.parse(JSON.stringify({
      ...p,
      timeline: {
        members: {
          m1: {
            id: 'm1', originalSpeciesId: 56, speciesSequence: 1, nickname: null, natureId: null,
            origin: { type: 'inferred', acquisitionId: null, note: null }, acquiredAtNodeId: 'brock-gym', notes: '', lifecycle: [],
          },
        },
        keyframes: {
          'brock-gym': {
            nodeId: 'brock-gym', kind: 'major', party: ['m1', null, null, null, null, null], reserve: [], released: [],
            snapshots: {
              m1: {
                speciesId: mankey.speciesId, level: mankey.level, abilityId: mankey.abilityId, moves: mankey.moves,
                heldItemId: null, placement: 'party', partySlot: 0, review: { moves: false, heldItem: false },
              },
            },
          },
        },
        overrides: {}, preferences: { levelMode: 'manual', autoEvolveLevel: false },
      },
    }));
  }

  it('accepts a valid serialized playthrough', () => {
    expect(() => parsePlaythrough(validDoc(), pack)).not.toThrow();
  });

  it('rejects a non-FireRed game', () => {
    expect(() => parsePlaythrough({ ...validDoc(), game: 'emerald' }, pack)).toThrow();
  });

  it('rejects a non-Standard playthrough type', () => {
    expect(() => parsePlaythrough({ ...validDoc(), type: 'nuzlocke' }, pack)).toThrow();
  });

  it('rejects embedded canonical/pack data (unknown top-level key)', () => {
    expect(() => parsePlaythrough({ ...validDoc(), pokemon: [{ id: 1, name: 'Bulbasaur', baseStats: {} }] }, pack)).toThrow();
  });

  it('rejects embedded canonical data on a team member (unknown key)', () => {
    const doc = validDoc();
    doc.timeline.keyframes['brock-gym'].snapshots.m1 = { ...doc.timeline.keyframes['brock-gym'].snapshots.m1, baseStats: { hp: 45 } };
    expect(() => parsePlaythrough(doc, pack)).toThrow();
  });

  it('rejects an unknown referenced move on a team member', () => {
    const doc = validDoc();
    doc.timeline.keyframes['brock-gym'].snapshots.m1.moves = [{ moveId: 999, status: 'available-now', level: null, milestoneId: null }];
    expect(() => parsePlaythrough(doc, pack)).toThrow(/move/i);
  });

  it('rejects an illegal ability on a team member', () => {
    const doc = validDoc();
    doc.timeline.keyframes['brock-gym'].snapshots.m1.abilityId = 65; // not legal for Mankey (56)
    expect(() => parsePlaythrough(doc, pack)).toThrow(/ability/i);
  });

  it('rejects a missing timestamp', () => {
    const doc = validDoc();
    delete doc.createdAt;
    expect(() => parsePlaythrough(doc, pack)).toThrow();
  });
});

describe('migratePlaythrough — deterministic, preserves prior value until migrated result validates', () => {
  it('migrates v1 primary and reserve members into one explicit keyframe', () => {
    const legacy = {
      schemaVersion: 1,
      ...baseInput(),
      game: 'firered' as const,
      type: 'standard' as const,
      currentMilestoneId: null,
      team: {
        primary: [{ ...mankey, id: 'legacy-primary-1' }, null, null, null, null, null],
        reserve: [{ ...mankey, id: 'legacy-reserve-1' }, null, null, null, null, null],
      },
      notes: '',
      branchChoices: {},
      checkoffs: { routesCompleted: {}, encountered: {}, captured: {} },
    };

    const result = migratePlaythrough(legacy, pack);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playthrough.schemaVersion).toBe(2);
    expect(result.playthrough.timeline.keyframes['misty-gym'].party[0]).toBe('legacy-primary-1');
    expect(result.playthrough.timeline.keyframes['misty-gym'].reserve).toContain('legacy-reserve-1');
  });

  function legacyV0() {
    // A schema-0 document lacking checkoffs / previewMilestoneId / acquisitionOverrides.
    return {
      schemaVersion: 0,
      id: 'p-old',
      name: 'Legacy Run',
      packVersion: 'firered-test',
      starterSpeciesId: 1,
      createdAt: 5,
      updatedAt: 6,
      currentMilestoneId: 'brock-gym',
      team: createEmptyTeam(),
    };
  }

  it('migrates a v0 document to the current schema and fills reserved empty checkoffs', () => {
    const result = migratePlaythrough(legacyV0(), pack);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated).toBe(true);
      expect(result.playthrough.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.playthrough.previewMilestoneId).toBeNull();
      expect(result.playthrough.checkoffs).toEqual({ routesCompleted: {}, encountered: {}, captured: {} });
    }
  });

  it('passes an already-current document through as unmigrated', () => {
    const current = JSON.parse(JSON.stringify(createStandardPlaythrough(baseInput(), pack)));
    const result = migratePlaythrough(current, pack);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.migrated).toBe(false);
  });

  it('preserves the prior value on a failed migration and does not mutate the input', () => {
    const bad = deepFreeze({ ...legacyV0(), starterSpeciesId: 999 });
    const result = migratePlaythrough(bad, pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.previous).toBe(bad); // exact prior value returned, nothing lost
      expect((result.previous as { starterSpeciesId: number }).starterSpeciesId).toBe(999);
    }
  });
});
