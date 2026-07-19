import { describe, expect, it } from 'vitest';
import {
  createStandardPlaythrough,
  type Playthrough,
  type PlaythroughPackIndex,
} from '../domain/playthrough';
import { createEmptyTeam } from '../domain/team';
import { MemoryPlaythroughRepository, type RepositoryOptions } from './repository';

const LEGAL_ABILITIES: Record<number, number[]> = { 1: [65], 56: [72] };
const VERSION_VALID_MOVES = new Set<number>([10, 43, 89]);
const MILESTONES = new Set<string>(['brock-gym', 'misty-gym', 'giovanni-gym']);
const ACQUISITIONS = new Set<string>(['tm26-earthquake', 'hm04-strength']);

const pack: PlaythroughPackIndex = {
  hasSpecies: (id) => id in LEGAL_ABILITIES,
  legalAbilityIds: (id) => LEGAL_ABILITIES[id] ?? [],
  isVersionValidMove: (_species, moveId) => VERSION_VALID_MOVES.has(moveId),
  hasMilestone: (id) => MILESTONES.has(id),
  hasAcquisition: (id) => ACQUISITIONS.has(id),
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
      acquisitionOverrides: ['tm26-earthquake'],
      ...overrides,
    },
    pack,
  );
}

function options(now = () => 12_345): RepositoryOptions {
  return { pack, now };
}

describe('MemoryPlaythroughRepository — round trips + independence', () => {
  it('saves and loads a playthrough by id', async () => {
    const repo = new MemoryPlaythroughRepository(options());
    const p = makePlaythrough();
    await repo.put(p);
    const loaded = await repo.get('p1');
    expect(loaded?.id).toBe('p1');
    expect(loaded?.name).toBe('Run One');
  });

  it('returns undefined for a missing id', async () => {
    const repo = new MemoryPlaythroughRepository(options());
    expect(await repo.get('missing')).toBeUndefined();
  });

  it('lists all stored playthroughs and deletes by id', async () => {
    const repo = new MemoryPlaythroughRepository(options());
    await repo.put(makePlaythrough({ id: 'p1', name: 'One' }));
    await repo.put(makePlaythrough({ id: 'p2', name: 'Two' }));
    const listed = await repo.list();
    expect(listed.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    await repo.delete('p1');
    expect(await repo.get('p1')).toBeUndefined();
    expect((await repo.list()).map((p) => p.id)).toEqual(['p2']);
  });

  it('keeps records independent — writing one never alters another', async () => {
    const repo = new MemoryPlaythroughRepository(options());
    await repo.put(makePlaythrough({ id: 'p1', name: 'One' }));
    await repo.put(makePlaythrough({ id: 'p2', name: 'Two' }));
    const one = await repo.get('p1');
    expect(one?.name).toBe('One');
    expect(one?.id).toBe('p1');
  });

  it('does not let a mutated returned record leak back into storage', async () => {
    const repo = new MemoryPlaythroughRepository(options());
    await repo.put(makePlaythrough({ id: 'p1', name: 'One' }));
    const loaded = await repo.get('p1');
    (loaded as Playthrough).name = 'Tampered';
    (loaded as Playthrough).checkoffs.captured['pidgey'] = true; // deep field
    const reloaded = await repo.get('p1');
    expect(reloaded?.name).toBe('One');
    expect(reloaded?.checkoffs.captured).toEqual({});
  });

  it('refreshes updatedAt from the caller-supplied clock on put (createdAt untouched)', async () => {
    const repo = new MemoryPlaythroughRepository(options(() => 99_999));
    const stored = await repo.put(makePlaythrough({ createdAt: 1_000, updatedAt: 2_000 }));
    expect(stored.updatedAt).toBe(99_999);
    expect(stored.createdAt).toBe(1_000);
    expect((await repo.get('p1'))?.updatedAt).toBe(99_999);
  });
});

describe('MemoryPlaythroughRepository — never persists canonical pack data', () => {
  it('rejects a put carrying embedded canonical/pack data (unknown top-level key)', async () => {
    const repo = new MemoryPlaythroughRepository(options());
    const tainted = {
      ...makePlaythrough(),
      pokemon: [{ id: 1, name: 'Bulbasaur', baseStats: { hp: 45 } }],
    } as unknown as Playthrough;
    await expect(repo.put(tainted)).rejects.toThrow();
    expect(await repo.get('p1')).toBeUndefined();
  });

  it('rejects a put carrying an unknown referenced id', async () => {
    const repo = new MemoryPlaythroughRepository(options());
    const bad = { ...makePlaythrough(), starterSpeciesId: 999 } as unknown as Playthrough;
    await expect(repo.put(bad)).rejects.toThrow(/starter|species/i);
  });
});

describe('MemoryPlaythroughRepository — migration + error surfacing on read', () => {
  const legacyV0 = {
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

  it('migrates an older-schema record to current on read', async () => {
    const repo = new MemoryPlaythroughRepository(options(), [['p-old', legacyV0]]);
    const loaded = await repo.get('p-old');
    expect(loaded?.schemaVersion).toBe(1);
    expect(loaded?.checkoffs).toEqual({ routesCompleted: {}, encountered: {}, captured: {} });
  });

  it('surfaces a corrupt stored record as a rejected promise', async () => {
    const repo = new MemoryPlaythroughRepository(options(), [['broken', { schemaVersion: 1, junk: true }]]);
    await expect(repo.get('broken')).rejects.toThrow();
  });
});
