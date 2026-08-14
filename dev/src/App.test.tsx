import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { MILESTONE_ORDER } from './domain/availability';
import type { Playthrough } from './domain/playthrough';
import { encodePlanCode } from './persistence/plan-code';
import {
  MemoryPlaythroughRepository,
  type PlaythroughRepository,
  type RepositoryOptions,
} from './persistence/repository';
import {
  loadFireRedPackFixture,
} from './test/firered-pack';

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

function seededRepoFactory(record: Playthrough) {
  let repo: MemoryPlaythroughRepository | undefined;
  const factory = async (options: RepositoryOptions): Promise<PlaythroughRepository> => {
    if (!repo) {
      repo = new MemoryPlaythroughRepository(options);
      await repo.put(record);
    }
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function createRun(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /start firered/i }));
  await screen.findByRole('region', { name: /team timeline/i });
}

afterEach(cleanup);

describe('App boot and persistence', () => {
  it('shows game setup when there are no saved records', async () => {
    const { factory } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    expect(await screen.findByText(/set up a run/i)).toBeVisible();
  });

  it('blocks normal setup and retries the original repository when saved records cannot be listed', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('legacy migration failed'))
      .mockResolvedValueOnce([]);
    const put = vi.fn();
    const remove = vi.fn();
    const factory = vi.fn(async (): Promise<PlaythroughRepository> => ({
      list,
      get: vi.fn(),
      put,
      delete: remove,
    }));

    render(<App {...baseProps({ openRepository: factory })} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/saved runs.*could not be (read|loaded|migrated)/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/left unchanged/i);
    expect(screen.queryByText(/set up a run/i)).toBeNull();
    expect(screen.queryByRole('region', { name: /team timeline/i })).toBeNull();
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /retry loading saved runs/i }));

    expect(await screen.findByText(/set up a run/i)).toBeVisible();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('creates the selected starter member and targets Brock', async () => {
    const { factory, get } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Charmander' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start FireRed' }));

    await screen.findByRole('region', { name: /team timeline/i });
    await waitFor(async () => expect((await get()!.list()).length).toBe(1));
    const saved = (await get()!.list())[0];
    const starterMemberId = Object.keys(saved.timeline.members)[0];
    expect(saved.currentMilestoneId).toBe('starter');
    expect(saved.previewMilestoneId).toBe('brock-gym');
    expect(saved.timeline.members[starterMemberId].originalSpeciesId).toBe(4);
    expect(saved.timeline.keyframes.starter.party[0]).toBe(starterMemberId);
    expect(screen.getByRole('button', { name: /preview milestone.*brock/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('restores the saved run after a reload', async () => {
    const { factory } = sharedRepoFactory();
    const props = baseProps({ openRepository: factory });
    const first = render(<App {...props} />);
    await createRun();
    first.unmount();

    render(<App {...props} />);
    // No setup this time — the saved run is restored straight into the workbench.
    expect(await screen.findByRole('region', { name: /team timeline/i })).toBeVisible();
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

  it('keeps the latest rapid edit durable when save completions arrive in reverse order', async () => {
    let repo: MemoryPlaythroughRepository | undefined;
    let putCount = 0;
    const brockSave = deferred();
    const mistySave = deferred();
    const factory = async (options: RepositoryOptions): Promise<PlaythroughRepository> => {
      repo ??= new MemoryPlaythroughRepository(options);
      return {
        list: () => repo!.list(),
        get: (id) => repo!.get(id),
        put: async (record) => {
          putCount += 1;
          if (putCount > 1) {
            const completion = record.currentMilestoneId === 'brock-gym' ? brockSave : mistySave;
            await completion.promise;
          }
          return repo!.put(record);
        },
        delete: (id) => repo!.delete(id),
      };
    };
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    await waitFor(() => expect(putCount).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /set current milestone.*brock/i }));
    fireEvent.click(screen.getByRole('button', { name: /set current milestone.*misty/i }));

    await act(async () => {
      mistySave.resolve();
      await Promise.resolve();
      brockSave.resolve();
    });

    await waitFor(async () => {
      expect((await repo!.list())[0].currentMilestoneId).toBe('misty-gym');
    });
    expect(screen.getByRole('button', { name: /set current milestone.*misty/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps unsaved edits rendered and offers Retry and Export when a write fails', async () => {
    let repo: MemoryPlaythroughRepository | undefined;
    let putCount = 0;
    const factory = async (options: RepositoryOptions): Promise<PlaythroughRepository> => {
      repo ??= new MemoryPlaythroughRepository(options);
      return {
        list: () => repo!.list(),
        get: (id) => repo!.get(id),
        put: async (record) => {
          putCount += 1;
          if (putCount === 2) throw new Error('disk full');
          return repo!.put(record);
        },
        delete: (id) => repo!.delete(id),
      };
    };
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    await waitFor(() => expect(putCount).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /set current milestone.*brock/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not saved/i);
    expect(screen.getByRole('button', { name: /set current milestone.*brock/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export unsaved changes' })).toBeEnabled();
    expect((await repo!.list())[0].currentMilestoneId).toBe('starter');

    fireEvent.click(screen.getByRole('button', { name: 'Export unsaved changes' }));
    const output = screen.getByLabelText(/playthrough export/i) as HTMLTextAreaElement;
    expect(JSON.parse(output.value).currentMilestoneId).toBe('brock-gym');

    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(screen.queryByText(/not saved/i)).toBeNull());
    expect((await repo!.list())[0].currentMilestoneId).toBe('brock-gym');
  });

  it('exports the active run as validated JSON', async () => {
    const { factory } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    fireEvent.click(screen.getByRole('button', { name: 'Export run' }));
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

    fireEvent.change(screen.getByLabelText('Import run JSON'), { target: { value: '{ not valid json' } });
    fireEvent.click(screen.getByRole('button', { name: /import run/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/import/i);
    // The workbench and stored record are untouched — no overwrite on failure.
    expect(screen.getByRole('region', { name: /team timeline/i })).toBeVisible();
    const after = await get()!.list();
    expect(after).toEqual(before);
  });

  it('shows an actionable error and no partial UI when the pack is corrupt', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const { factory } = sharedRepoFactory();
    render(<App {...baseProps({ fetcher, openRepository: factory })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not|failed|unable/i);
    expect(screen.queryByText(/set up a run/i)).toBeNull();
    expect(screen.queryByRole('region', { name: /team timeline/i })).toBeNull();
  });

  it('falls back to a labeled temporary session with working export when IndexedDB fails', async () => {
    const failingFactory = async (): Promise<PlaythroughRepository> => {
      throw new Error('IndexedDB is unavailable');
    };
    render(<App {...baseProps({ openRepository: failingFactory })} />);
    // A new run still works, held only in memory, with a visible temporary-session banner.
    await createRun();
    expect(screen.getByText(/temporary session/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Export run' }));
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

  it('completes the milestone timeline acceptance journey and reconstructs its plan code', async () => {
    const active = sharedRepoFactory();
    const first = render(<App {...baseProps({ openRepository: active.factory })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Charmander' }));
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Timeline acceptance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start FireRed' }));
    await screen.findByRole('region', { name: /team timeline/i });

    // App creates and persists the requested target; the rendered timeline then creates Brock.
    expect(screen.getByRole('button', { name: /preview milestone.*brock/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Copy previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Brock keyframe' }));

    // Capture two separate identities through the App inspector, at the same acquisition sequence.
    fireEvent.change(screen.getByRole('searchbox', { name: /search firered/i }), { target: { value: 'Mankey' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Select Mankey' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Mankey to Brock party' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Mankey to Brock party' }));
    const created = await waitFor(async () => {
      const saved = (await active.get()!.list())[0];
      const ids = Object.values(saved.timeline.members)
        .filter((member) => member.originalSpeciesId === 56)
        .sort((left, right) => left.speciesSequence - right.speciesSequence)
        .map((member) => member.id);
      expect(ids).toHaveLength(2);
      return { saved, ids };
    });
    const [mankeyOneId, mankeyTwoId] = created.ids;
    const starterMemberId = created.saved.timeline.keyframes.starter.party[0]!;
    expect(mankeyOneId).not.toBe(mankeyTwoId);
    expect(created.saved.timeline.members[mankeyOneId].speciesSequence).toBe(1);
    expect(created.saved.timeline.members[mankeyTwoId].speciesSequence).toBe(2);
    expect(screen.getByText('Mankey #1')).toBeVisible();
    expect(screen.getByText('Mankey #2')).toBeVisible();

    // Box the second level-5 Mankey at Brock through its editor.
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Mankey #2 to reserve' }));

    // Promote Mt Moon through App editing so it becomes the later protected explicit override.
    fireEvent.click(screen.getByRole('button', { name: 'Detailed Planning' }));
    fireEvent.click(screen.getByRole('button', { name: /Mt\. Moon.*Auto-filled/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));

    // Copy Brock to Misty. Only active members auto-level; boxed Mankey #2 stays level 5.
    fireEvent.click(screen.getByRole('button', { name: 'Major Events' }));
    fireEvent.click(screen.getByRole('button', { name: /Misty.*Auto-filled/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy previous' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-level active party' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Misty keyframe' }));
    const mistyReserve = screen.getByRole('region', { name: /Reserve.*1 Pok/i });
    expect(mistyReserve).toHaveTextContent('Mankey #2');
    expect(mistyReserve).toHaveTextContent('Lv 5');
    await waitFor(async () => {
      const timeline = (await active.get()!.list())[0].timeline;
      expect(timeline.keyframes['misty-gym'].snapshots[starterMemberId].level).toBe(21);
      expect(timeline.keyframes['misty-gym'].snapshots[mankeyOneId].level).toBe(21);
      expect(timeline.keyframes['misty-gym'].snapshots[mankeyTwoId].level).toBe(5);
    });

    // A forward replacement affects Brock but stops at the explicit Mt Moon override.
    fireEvent.click(screen.getByRole('button', { name: /Brock.*Explicit/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace party slot 1 with Mankey #2' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Here and future populated milestones' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 protected');
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    await waitFor(async () => {
      const timeline = (await active.get()!.list())[0].timeline;
      expect(timeline.keyframes['brock-gym'].party[0]).toBe(mankeyTwoId);
      expect(timeline.overrides['mt-moon'].party[0]).toBe(starterMemberId);
      expect(timeline.keyframes['misty-gym'].party[0]).toBe(starterMemberId);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Detailed Planning' }));
    fireEvent.click(screen.getByRole('button', { name: /^Route 1 .*Auto-filled/i }));
    expect(screen.queryByText(/^Mankey #/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Route 22 .*Explicit/i }));
    expect(screen.getByText('Mankey #1')).toBeVisible();
    expect(screen.getByText('Mankey #2')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Major Events' }));
    fireEvent.click(screen.getByRole('button', { name: /Misty.*Explicit/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release Mankey #2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm release' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Mankey #2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    await waitFor(async () => {
      const member = (await active.get()!.list())[0].timeline.members[mankeyTwoId];
      expect(member.lifecycle.slice(-2).map((event) => event.type)).toEqual(['released', 'restored']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #2' }));
    const restoredEditor = await screen.findByRole('dialog', { name: /Edit Mankey #2 at Misty/i });
    expect(within(restoredEditor).getByText('Restored Pokémon')).toBeVisible();
    fireEvent.click(within(restoredEditor).getByText('Restored Pokémon'));
    expect(within(restoredEditor).getByText(/audit finding is permanent/i)).toBeVisible();

    fireEvent.change(screen.getByLabelText('Move 1'), { target: { value: '96' } });
    fireEvent.click(screen.getByRole('radio', { name: 'This milestone only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));
    await waitFor(() => expect(within(restoredEditor).getByText('Move requires an egg origin')).toBeVisible());
    fireEvent.click(within(restoredEditor).getByText('Move requires an egg origin'));
    fireEvent.click(within(restoredEditor).getByRole('button', { name: 'Mark as hatched' }));
    fireEvent.click(screen.getByRole('radio', { name: 'This milestone only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));
    await waitFor(async () => {
      expect((await active.get()!.list())[0].timeline.members[mankeyTwoId].origin.type).toBe('hatched');
    });
    await waitFor(() => expect(within(restoredEditor).getByText('Hatched Pokémon')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));

    const overrideIdsBeforePromotion = Object.keys((await active.get()!.list())[0].timeline.overrides).sort();
    fireEvent.click(screen.getByRole('button', { name: 'Detailed Planning' }));
    fireEvent.click(screen.getByRole('button', { name: /^Route 2 .*Auto-filled/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #1' }));
    await waitFor(async () => {
      const overrideIds = Object.keys((await active.get()!.list())[0].timeline.overrides).sort();
      expect(overrideIds).toEqual([...overrideIdsBeforePromotion, 'kanto-route-2'].sort());
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    fireEvent.click(screen.getByRole('button', { name: /Viridian Forest.*Auto-filled/i }));
    expect(screen.getByText('Auto-filled', { selector: '.timeline-state-label' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Export run' }));
    expect(await screen.findByRole('link', { name: 'Download JSON' })).toHaveAttribute('download', 'timeline-acceptance.json');
    fireEvent.click(screen.getByRole('button', { name: 'Export plan code' }));
    const planCode = (await screen.findByLabelText('Plan code export')) as HTMLTextAreaElement;
    expect(planCode.value).toMatch(/^PP1\./);
    const exportedState = (await active.get()!.list())[0];

    // Preview, cancel, and invalid input are non-mutating even with a live run and repository.
    fireEvent.change(screen.getByLabelText('Import plan code'), { target: { value: 'PP1.not-valid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview plan code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/plan code import failed/i);
    expect(await active.get()!.list()).toEqual([exportedState]);
    expect(screen.getByRole('region', { name: /team timeline/i })).toBeVisible();
    const differentPlanCode = encodePlanCode({
      ...exportedState,
      id: 'different-valid-preview',
      name: 'Different valid preview',
    });
    fireEvent.change(screen.getByLabelText('Import plan code'), { target: { value: differentPlanCode } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview plan code' }));
    expect(await screen.findByRole('dialog', { name: 'Plan code import preview' })).toHaveTextContent('Different valid preview');
    expect(await active.get()!.list()).toEqual([exportedState]);
    expect(JSON.parse((screen.getByLabelText('Playthrough export JSON') as HTMLTextAreaElement).value).name).toBe('Timeline acceptance');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel plan code import' }));
    expect(screen.queryByRole('dialog', { name: 'Plan code import preview' })).toBeNull();
    expect(await active.get()!.list()).toEqual([exportedState]);

    first.unmount();

    const clean = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: clean.factory })} />);
    await screen.findByText(/set up a run/i);
    fireEvent.change(screen.getByLabelText('Import plan code'), { target: { value: planCode.value } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview plan code' }));
    expect(await screen.findByRole('dialog', { name: 'Plan code import preview' })).toHaveTextContent(
      'Timeline acceptance',
    );
    expect(await clean.get()!.list()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm plan code import' }));
    await waitFor(async () => expect((await clean.get()!.list())[0]).toEqual(exportedState));
    expect(await screen.findByRole('region', { name: /team timeline/i })).toBeVisible();
  }, 30_000);

  it('reports a schema-valid oversized plan-code export without crashing or mutating the run', async () => {
    const active = sharedRepoFactory();
    const props = baseProps({ openRepository: active.factory });
    const first = render(<App {...props} />);
    await createRun();
    const original = (await active.get()!.list())[0];
    const oversized = { ...original, notes: 'x'.repeat(4 * 1024 * 1024 + 1) };
    await active.get()!.put(oversized);
    first.unmount();

    render(<App {...props} />);
    await screen.findByRole('region', { name: /team timeline/i });
    fireEvent.click(screen.getByRole('button', { name: 'Export plan code' }));

    const exportError = await screen.findByRole('alert');
    expect(exportError).toHaveTextContent(/export.*too large|expanded size/i);
    expect(exportError).toHaveTextContent(/shorten notes/i);
    expect(exportError).toHaveTextContent(/download json/i);
    expect(screen.getByRole('button', { name: 'Prepare Download JSON' })).toBeEnabled();
    expect(screen.queryByLabelText('Plan code export')).toBeNull();
    expect(screen.getByRole('region', { name: /team timeline/i })).toBeVisible();
    expect(await active.get()!.list()).toEqual([oversized]);
  }, 20_000);
});
