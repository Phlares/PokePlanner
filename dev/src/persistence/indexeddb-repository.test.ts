import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  createStandardPlaythrough,
  type Playthrough,
  type PlaythroughPackIndex,
} from '../domain/playthrough';
import { createEmptyTeam } from '../domain/team';
import { openIndexedDbRepository } from './indexeddb-repository';
import type { RepositoryOptions } from './repository';

const LEGAL_ABILITIES: Record<number, number[]> = { 1: [65], 56: [72] };
const pack: PlaythroughPackIndex = {
  hasSpecies: (id) => id in LEGAL_ABILITIES,
  legalAbilityIds: (id) => LEGAL_ABILITIES[id] ?? [],
  isVersionValidMove: (_species, moveId) => new Set([10, 43, 89]).has(moveId),
  hasMilestone: (id) => new Set(['brock-gym', 'misty-gym']).has(id),
  hasAcquisition: (id) => new Set(['tm26-earthquake']).has(id),
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

function options(factory = new IDBFactory(), now = () => 12_345): { factory: IDBFactory; opts: RepositoryOptions } {
  return { factory, opts: { pack, now } };
}

/** Open the raw pokeplanner db (creating the store) so tests can seed records behind the repo. */
function openRawDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('pokeplanner', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('playthroughs')) db.createObjectStore('playthroughs', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putRaw(db: IDBDatabase, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('playthroughs', 'readwrite');
    tx.objectStore('playthroughs').put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('openIndexedDbRepository — native adapter behind the repository interface', () => {
  it('uses one database named pokeplanner with a playthroughs store keyed by id', async () => {
    const { factory, opts } = options();
    const repo = await openIndexedDbRepository(factory, opts);
    await repo.put(makePlaythrough());
    const db = await openRawDb(factory);
    expect(Array.from(db.objectStoreNames)).toContain('playthroughs');
    expect(db.transaction('playthroughs', 'readonly').objectStore('playthroughs').keyPath).toBe('id');
    db.close();
  });

  it('round-trips save / load / list / delete', async () => {
    const { factory, opts } = options();
    const repo = await openIndexedDbRepository(factory, opts);
    await repo.put(makePlaythrough({ id: 'p1', name: 'One' }));
    await repo.put(makePlaythrough({ id: 'p2', name: 'Two' }));
    expect((await repo.get('p1'))?.name).toBe('One');
    expect((await repo.list()).map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    await repo.delete('p1');
    expect(await repo.get('p1')).toBeUndefined();
    expect((await repo.list()).map((p) => p.id)).toEqual(['p2']);
  });

  it('refreshes updatedAt from the caller clock on put', async () => {
    const { factory, opts } = options(new IDBFactory(), () => 88_888);
    const repo = await openIndexedDbRepository(factory, opts);
    const stored = await repo.put(makePlaythrough({ updatedAt: 2_000 }));
    expect(stored.updatedAt).toBe(88_888);
    expect((await repo.get('p1'))?.updatedAt).toBe(88_888);
  });

  it('rejects a put carrying embedded canonical/pack data — nothing persisted', async () => {
    const { factory, opts } = options();
    const repo = await openIndexedDbRepository(factory, opts);
    const tainted = { ...makePlaythrough(), pokemon: [{ id: 1 }] } as unknown as Playthrough;
    await expect(repo.put(tainted)).rejects.toThrow();
    expect(await repo.get('p1')).toBeUndefined();
  });

  it('migrates an older-schema record to current on read', async () => {
    const { factory, opts } = options();
    const db = await openRawDb(factory);
    await putRaw(db, {
      schemaVersion: 0,
      id: 'p-old',
      name: 'Legacy',
      packVersion: 'firered-test',
      starterSpeciesId: 1,
      createdAt: 5,
      updatedAt: 6,
      currentMilestoneId: 'brock-gym',
      team: createEmptyTeam(),
    });
    db.close();
    const repo = await openIndexedDbRepository(factory, opts);
    const loaded = await repo.get('p-old');
    expect(loaded?.schemaVersion).toBe(2);
    expect(loaded?.checkoffs).toEqual({ routesCompleted: {}, encountered: {}, captured: {} });
  });

  it('surfaces a corrupt stored record as a rejected promise', async () => {
    const { factory, opts } = options();
    const db = await openRawDb(factory);
    await putRaw(db, { id: 'broken', schemaVersion: 1, junk: true });
    db.close();
    const repo = await openIndexedDbRepository(factory, opts);
    await expect(repo.get('broken')).rejects.toThrow();
  });

  it('surfaces a database open failure as a rejected promise', async () => {
    const brokenFactory = {
      open() {
        throw new Error('indexedDB unavailable');
      },
    } as unknown as IDBFactory;
    await expect(openIndexedDbRepository(brokenFactory, options().opts)).rejects.toThrow(/indexedDB|unavailable/i);
  });
});
