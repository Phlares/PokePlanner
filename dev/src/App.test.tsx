import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { MILESTONE_ORDER } from './domain/availability';
import {
  MemoryPlaythroughRepository,
  type PlaythroughRepository,
  type RepositoryOptions,
} from './persistence/repository';
import { loadFireRedPackFixture } from './test/firered-pack';

const PACK_DIR = resolve(process.cwd(), 'public/data/firered');
const pack = loadFireRedPackFixture();

/** Serve the committed pack bytes so the App boot exercises the real load + hash-verify path. */
function realFetcher(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const rel = url.slice(url.indexOf('data/firered/') + 'data/firered/'.length);
    return new Response(readFileSync(resolve(PACK_DIR, rel)));
  }) as unknown as typeof fetch;
}

const realDigest = async (bytes: Uint8Array): Promise<string> =>
  createHash('sha256').update(bytes).digest('hex');

function packIndex() {
  const byId = new Map(pack.pokemon.map((record) => [record.id, record]));
  const milestones = new Set<string>(MILESTONE_ORDER);
  const acquisitions = new Set(pack.acquisitions.map((record) => record.id));
  return {
    hasSpecies: (id: number) => byId.has(id),
    legalAbilityIds: (id: number) => byId.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id: number, moveId: number) =>
      (pack.learnsets.find((record) => record.pokemonId === id)?.moves ?? []).some((move) => move.moveId === moveId),
    hasMilestone: (id: string) => milestones.has(id),
    hasAcquisition: (id: string) => acquisitions.has(id),
    hasNode: (id: string) => id === 'starter-selection' || milestones.has(id),
    starterNodeId: () => 'starter-selection',
  };
}

/** A single shared in-memory repository, so an unmount/remount can restore the saved run. */
function sharedRepoFactory(seed?: MemoryPlaythroughRepository) {
  let repo = seed;
  const factory = async (options: RepositoryOptions): Promise<PlaythroughRepository> => {
    repo ??= new MemoryPlaythroughRepository(options);
    return repo;
  };
  return { factory, get: () => repo };
}

function baseProps(overrides: Partial<Parameters<typeof App>[0]> = {}) {
  let counter = 0;
  return {
    fetcher: realFetcher(),
    digest: realDigest,
    baseUrl: '/',
    now: () => 1000,
    createId: () => `id-${(counter += 1)}`,
    ...overrides,
  };
}

async function createRun(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /create playthrough/i }));
  await screen.findByRole('region', { name: /team manifest/i });
}

afterEach(cleanup);

describe('App boot and persistence', () => {
  it('shows game setup when there are no saved records', async () => {
    const { factory } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    expect(await screen.findByText(/set up a run/i)).toBeVisible();
  });

  it('restores the saved run after a reload', async () => {
    const { factory } = sharedRepoFactory();
    const props = baseProps({ openRepository: factory });
    const first = render(<App {...props} />);
    await createRun();
    first.unmount();

    render(<App {...props} />);
    // No setup this time — the saved run is restored straight into the workbench.
    expect(await screen.findByRole('region', { name: /team manifest/i })).toBeVisible();
    expect(screen.queryByText(/set up a run/i)).toBeNull();
  });

  it('saves after a milestone edit in the workbench', async () => {
    const { factory, get } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    fireEvent.click(screen.getByRole('button', { name: /set current milestone.*brock/i }));
    await waitFor(async () => {
      const records = await get()!.list();
      expect(records[0].currentMilestoneId).toBe('brock-gym');
    });
  });

  it('exports the active run as validated JSON', async () => {
    const { factory } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    fireEvent.click(screen.getByRole('button', { name: /^export/i }));
    const output = (await screen.findByLabelText(/playthrough export/i)) as HTMLTextAreaElement;
    expect(output.value).toContain('"schemaVersion": 2');
    expect(output.value).toContain('"game": "firered"');
    expect(() => JSON.parse(output.value)).not.toThrow();
  });

  it('preserves the existing record when an import fails validation', async () => {
    const { factory, get } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    const before = await get()!.list();

    fireEvent.change(screen.getByLabelText(/import/i), { target: { value: '{ not valid json' } });
    fireEvent.click(screen.getByRole('button', { name: /import run/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/import/i);
    // The workbench and stored record are untouched — no overwrite on failure.
    expect(screen.getByRole('region', { name: /team manifest/i })).toBeVisible();
    const after = await get()!.list();
    expect(after).toEqual(before);
  });

  it('shows an actionable error and no partial UI when the pack is corrupt', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const { factory } = sharedRepoFactory();
    render(<App {...baseProps({ fetcher, openRepository: factory })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not|failed|unable/i);
    expect(screen.queryByText(/set up a run/i)).toBeNull();
    expect(screen.queryByRole('region', { name: /team manifest/i })).toBeNull();
  });

  it('falls back to a labeled temporary session with working export when IndexedDB fails', async () => {
    const failingFactory = async (): Promise<PlaythroughRepository> => {
      throw new Error('IndexedDB is unavailable');
    };
    render(<App {...baseProps({ openRepository: failingFactory })} />);
    // A new run still works, held only in memory, with a visible temporary-session banner.
    await createRun();
    expect(screen.getByText(/temporary session/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^export/i }));
    const output = (await screen.findByLabelText(/playthrough export/i)) as HTMLTextAreaElement;
    expect(output.value).toContain('"game": "firered"');
  });

  it('never writes FireRed canonical data to storage', async () => {
    const putSpy = vi.spyOn(MemoryPlaythroughRepository.prototype, 'put');
    const { factory, get } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    fireEvent.click(screen.getByRole('button', { name: /set current milestone.*brock/i }));
    await waitFor(() => expect(putSpy).toHaveBeenCalled());

    const canonicalKeys = ['pokemon', 'moves', 'encounters', 'learnsets', 'typeChart', 'indexes', 'acquisitions'];
    for (const call of putSpy.mock.calls) {
      expect(Object.keys(call[0] as object)).not.toContain('pokemon');
    }
    const stored = await get()!.list();
    for (const key of canonicalKeys) {
      expect(stored[0]).not.toHaveProperty(key);
    }
    putSpy.mockRestore();
  });
});
