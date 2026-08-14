import { describe, expect, it } from 'vitest';
import {
  createStandardPlaythrough,
  type Playthrough,
  type PlaythroughPackIndex,
} from '../domain/playthrough';
import { createEmptyTeam, type TeamMember } from '../domain/team';
import { MemoryPlaythroughRepository } from './repository';
import { createPlaythroughDownload, preparePlaythroughImport, serializePlaythroughExport } from './export-import';

const LEGAL_ABILITIES: Record<number, number[]> = { 1: [65], 56: [72] };
const pack: PlaythroughPackIndex = {
  hasSpecies: (id) => id in LEGAL_ABILITIES,
  legalAbilityIds: (id) => LEGAL_ABILITIES[id] ?? [],
  isVersionValidMove: (_species, moveId) => new Set([10, 43, 89]).has(moveId),
  hasMilestone: (id) => new Set(['brock-gym', 'misty-gym', 'giovanni-gym']).has(id),
  hasAcquisition: (id) => new Set(['tm26-earthquake']).has(id),
  hasNode: (id) => id === 'starter-selection' || new Set(['brock-gym', 'misty-gym', 'giovanni-gym']).has(id),
  starterNodeId: () => 'starter-selection',
};

const mankey: TeamMember = {
  id: 'm1',
  speciesId: 56,
  level: 20,
  abilityId: 72,
  moves: [{ moveId: 10, status: 'available-now', level: null, milestoneId: null }],
};

function makePlaythrough(overrides: Partial<Parameters<typeof createStandardPlaythrough>[0]> = {}): Playthrough {
  return createStandardPlaythrough(
    {
      id: 'p1',
      name: 'Run One',
      starterSpeciesId: 1,
      createdAt: 1_000,
      updatedAt: 2_000,
      packVersion: 'firered-test',
      currentMilestoneId: 'brock-gym',
      previewMilestoneId: 'misty-gym',
      branchChoices: { 'oak-parcel': 'accepted' },
      acquisitionOverrides: ['tm26-earthquake'],
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
                speciesId: mankey.speciesId, level: mankey.level, abilityId: mankey.abilityId, moves: mankey.moves.map((move) => ({ ...move })),
                heldItemId: null, placement: 'party', partySlot: 0, review: { moves: false, heldItem: false },
              },
            },
          },
        },
        overrides: {}, preferences: { levelMode: 'manual', autoEvolveLevel: false },
      },
      ...overrides,
    },
    pack,
  );
}

describe('serializePlaythroughExport — stable, pretty, version-carrying JSON', () => {
  it('carries schemaVersion and packVersion', () => {
    const text = serializePlaythroughExport(makePlaythrough());
    const parsed = JSON.parse(text);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.packVersion).toBe('firered-test');
  });

  it('is pretty-printed (indented, multi-line)', () => {
    const text = serializePlaythroughExport(makePlaythrough());
    expect(text).toContain('\n');
    expect(text).toContain('  ');
  });

  it('is deterministic regardless of source key insertion order', () => {
    const p = makePlaythrough();
    const reordered = Object.fromEntries(Object.entries(p).reverse()) as unknown as Playthrough;
    expect(serializePlaythroughExport(p)).toBe(serializePlaythroughExport(reordered));
  });

  it('sorts nested record keys so branchChoices ordering does not change output', () => {
    const a = makePlaythrough({ branchChoices: { alpha: 'x', beta: 'y' } });
    const b = makePlaythrough({ branchChoices: { beta: 'y', alpha: 'x' } });
    expect(serializePlaythroughExport(a)).toBe(serializePlaythroughExport(b));
  });

  it('creates a JSON download with a normalized run-name filename', async () => {
    const playthrough = makePlaythrough({ name: '  Élite / Four: Run?!  ' });
    const download = createPlaythroughDownload(playthrough);

    expect(download.filename).toBe('elite-four-run.json');
    expect(download.blob.type).toBe('application/json;charset=utf-8');
    expect(await download.blob.text()).toBe(serializePlaythroughExport(playthrough));
  });

  it('uses a portable fallback filename when the normalized run name is empty', () => {
    expect(createPlaythroughDownload(makePlaythrough({ name: '🔥' })).filename).toBe('pokeplanner-plan.json');
  });
});

describe('preparePlaythroughImport — parse → migrate → validate, no write', () => {
  it('round-trips a valid export back to an equal record', () => {
    const p = makePlaythrough();
    const imported = preparePlaythroughImport(serializePlaythroughExport(p), pack);
    expect(imported).toEqual(p);
  });

  it('rejects malformed JSON', () => {
    expect(() => preparePlaythroughImport('{ not json', pack)).toThrow(/json/i);
  });

  it('rejects an unknown referenced id', () => {
    const text = serializePlaythroughExport(makePlaythrough({ starterSpeciesId: 1 }));
    const tampered = JSON.parse(text);
    tampered.starterSpeciesId = 999;
    expect(() => preparePlaythroughImport(JSON.stringify(tampered), pack)).toThrow(/starter|species/i);
  });

  it('rejects invalid team slots (too many moves)', () => {
    const text = serializePlaythroughExport(makePlaythrough());
    const tampered = JSON.parse(text);
    tampered.timeline.keyframes['brock-gym'].snapshots.m1.moves = [
      { moveId: 10, status: 'available-now', level: null, milestoneId: null },
      { moveId: 43, status: 'available-now', level: null, milestoneId: null },
      { moveId: 89, status: 'available-now', level: null, milestoneId: null },
      { moveId: 10, status: 'available-now', level: null, milestoneId: null },
      { moveId: 43, status: 'available-now', level: null, milestoneId: null },
    ];
    expect(() => preparePlaythroughImport(JSON.stringify(tampered), pack)).toThrow();
  });

  it('rejects an unsupported future schema version', () => {
    const text = serializePlaythroughExport(makePlaythrough());
    const tampered = JSON.parse(text);
    tampered.schemaVersion = 999;
    expect(() => preparePlaythroughImport(JSON.stringify(tampered), pack)).toThrow(/schema|version/i);
  });

  it('migrates a supported older schema on import', () => {
    const legacyV0 = {
      schemaVersion: 0,
      id: 'p-old',
      name: 'Legacy',
      packVersion: 'firered-test',
      starterSpeciesId: 1,
      createdAt: 5,
      updatedAt: 6,
      currentMilestoneId: 'brock-gym',
      team: createEmptyTeam(),
    };
    const imported = preparePlaythroughImport(JSON.stringify(legacyV0), pack);
    expect(imported.schemaVersion).toBe(2);
    expect(imported.previewMilestoneId).toBeNull();
  });

  it('performs no repository write and preserves the existing record on a failed import', async () => {
    const repo = new MemoryPlaythroughRepository({ pack, now: () => 7_000 });
    const existing = makePlaythrough({ id: 'p1', name: 'Original' });
    await repo.put(existing);

    // Caller pattern: prepare first; only write on success. A malformed import must throw
    // BEFORE any write, leaving the previously-stored record untouched.
    expect(() => preparePlaythroughImport('{ broken', pack)).toThrow();
    expect((await repo.get('p1'))?.name).toBe('Original');

    // A successful prepare returns a record but writes nothing itself; the caller writes once.
    const prepared = preparePlaythroughImport(serializePlaythroughExport(makePlaythrough({ id: 'p1', name: 'Imported' })), pack);
    expect((await repo.get('p1'))?.name).toBe('Original'); // still unchanged — prepare did not write
    await repo.put(prepared);
    expect((await repo.get('p1'))?.name).toBe('Imported');
  });
});
