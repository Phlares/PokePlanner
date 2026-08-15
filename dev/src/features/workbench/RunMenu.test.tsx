import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunMenu, type RunMenuProps } from './RunMenu';
import { MILESTONE_ORDER } from '../../domain/availability';
import {
  createStandardPlaythrough,
  parsePlaythrough,
  type Playthrough,
  type PlaythroughPackIndex,
} from '../../domain/playthrough';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';
import { serializePlaythroughExport } from '../../persistence/export-import';
import { prepareRunImport } from '../../persistence/import-source';
import { decodePlanCode, encodePlanCode } from '../../persistence/plan-code';
import { loadFireRedPackFixture } from '../../test/firered-pack';

const pack = loadFireRedPackFixture();

function packIndex(): PlaythroughPackIndex {
  const byId = new Map(pack.pokemon.map((record) => [record.id, record]));
  const milestones = new Set<string>([
    ...MILESTONE_ORDER,
    ...FIRE_RED_RULES.milestones.map((milestone) => milestone.id),
  ]);
  const acquisitions = new Set(pack.acquisitions.map((record) => record.id));
  return {
    hasSpecies: (id) => byId.has(id),
    legalAbilityIds: (id) => byId.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id, moveId) =>
      (pack.learnsets.find((record) => record.pokemonId === id)?.moves ?? []).some((move) => move.moveId === moveId),
    hasMilestone: (id) => milestones.has(id),
    hasAcquisition: (id) => acquisitions.has(id),
    hasNode: (id) => id === 'starter-selection' || milestones.has(id),
    starterNodeId: () => 'starter-selection',
  };
}

/** A run carrying exactly `memberCount` persistent members, so preview counts are load-bearing. */
function runWith(memberCount: number, name: string, id = 'run-1'): Playthrough {
  const base = createStandardPlaythrough(
    { id, name, starterSpeciesId: 1, createdAt: 0, updatedAt: 0, packVersion: pack.manifest.packVersion },
    packIndex(),
  );
  const members = Object.fromEntries(Array.from({ length: memberCount }, (unused, index) => [`m${index}`, {
    id: `m${index}`,
    originalSpeciesId: 1,
    speciesSequence: index + 1,
    nickname: null,
    natureId: null,
    origin: { type: 'inferred', acquisitionId: null, note: null },
    acquiredAtNodeId: 'starter',
    notes: '',
    lifecycle: [],
  }]));
  return parsePlaythrough({ ...base, timeline: { ...base.timeline, members } }, packIndex());
}

/**
 * Deterministic high-entropy text. Deflate cannot shrink it, so a few hundred kilobytes already
 * exceeds the plan code's compressed ceiling — the same failure a multi-megabyte note produces,
 * reached an order of magnitude faster.
 */
function incompressibleNotes(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/';
  let seed = 0x2f6e2b1;
  const characters: string[] = [];
  for (let index = 0; index < length; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    characters.push(alphabet[(seed >>> 24) & 63]);
  }
  return characters.join('');
}

// The mounted run holds 3 members; every imported fixture holds a different number, so a preview
// count can never be right by accident.
const MOUNTED_RUN = runWith(3, 'Kanto ledger');
const SHARED_RUN = runWith(12, 'Shared squad', 'run-shared');
const FILE_RUN = runWith(5, 'File squad', 'run-file');

function renderMenu(overrides: Partial<RunMenuProps> = {}) {
  const onImport = vi.fn();
  const onRename = vi.fn();
  const onDuplicate = vi.fn();
  const onDelete = vi.fn();
  const onThemeChange = vi.fn();
  const view = render(
    <RunMenu
      playthrough={MOUNTED_RUN}
      saveStatus="saved"
      theme="dark"
      onThemeChange={onThemeChange}
      prepareImport={(input) => prepareRunImport(input, packIndex(), pack.manifest.packVersion)}
      onImport={onImport}
      onRename={onRename}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      {...overrides}
    />,
  );
  return { onImport, onRename, onDuplicate, onDelete, onThemeChange, ...view };
}

function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Run menu' }));
}

function openImportDialog(): void {
  openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Import JSON file or plan code' }));
}

function pasteImport(text: string): void {
  fireEvent.change(screen.getByLabelText('Plan code or share link'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
}

function downloadedJson(): Playthrough {
  const link = screen.getByRole('menuitem', { name: 'Download JSON' });
  const href = link.getAttribute('href') ?? '';
  return JSON.parse(decodeURIComponent(href.slice(href.indexOf(',') + 1)));
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(cleanup);

describe('RunMenu', () => {
  it('keeps the menu closed until it is opened', () => {
    renderMenu();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Run menu' })).toHaveAttribute('aria-expanded', 'false');
    openMenu();
    expect(screen.getByRole('menu')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run menu' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('moves run data into one menu', () => {
    renderMenu();
    expect(screen.queryByLabelText('Playthrough export JSON')).not.toBeInTheDocument();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Download JSON' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy plan code' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((node) => node.textContent)).toEqual([
      'Download JSON',
      'Copy plan code',
      'Import JSON file or plan code',
      'Duplicate run',
      'Rename run',
      'Delete run',
    ]);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Dark theme' })).toBeInTheDocument();
  });

  it('offers only import and theme when there is no run yet', () => {
    renderMenu({ playthrough: null, saveStatus: 'none' });
    expect(screen.getByText('No run yet')).toBeVisible();
    openMenu();
    expect(screen.getAllByRole('menuitem').map((node) => node.textContent)).toEqual([
      'Import JSON file or plan code',
    ]);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Dark theme' })).toBeInTheDocument();
  });

  it('downloads the mounted run under a filename taken from its name', () => {
    renderMenu();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Download JSON' })).toHaveAttribute('download', 'kanto-ledger.json');
    expect(downloadedJson().name).toBe('Kanto ledger');
    expect(Object.keys(downloadedJson().timeline.members)).toHaveLength(3);
  });

  it('copies a plan code that decodes back into the mounted run', async () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy plan code' }));
    const field = (await screen.findByLabelText('Plan code')) as HTMLInputElement;
    expect(field.value).toMatch(/^PP1\./);
    expect(decodePlanCode(field.value, packIndex()).playthrough.name).toBe('Kanto ledger');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(field.value));
    expect(await screen.findByText(/copied to the clipboard/i)).toBeVisible();
  });

  it('says the code must be copied by hand when the clipboard refuses', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy plan code' }));
    expect(await screen.findByText(/copy this plan code by hand/i)).toBeVisible();
    expect(screen.getByLabelText('Plan code')).toBeVisible();
  });

  it('reports an oversized plan code and keeps the JSON download reachable', () => {
    renderMenu({ playthrough: parsePlaythrough({ ...MOUNTED_RUN, notes: incompressibleNotes(400_000) }, packIndex()) });
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy plan code' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/size limit/i);
    expect(alert).toHaveTextContent(/shorten notes/i);
    expect(alert).toHaveTextContent(/download json/i);
    expect(screen.queryByLabelText('Plan code')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Download JSON' })).toBeInTheDocument();
  }, 60_000);

  it('previews a share-url import before replacing a run', () => {
    const { onImport } = renderMenu();
    openImportDialog();
    pasteImport(`https://pokeplanner.example/plan?plan=${encodePlanCode(SHARED_RUN)}`);
    expect(screen.getByRole('dialog', { name: 'Import FireRed Run?' })).toHaveTextContent('12 Pokémon');
    expect(screen.getByRole('dialog', { name: 'Import FireRed Run?' })).toHaveTextContent('Shared squad');
    expect(onImport).not.toHaveBeenCalled();
  });

  it('previews a bare plan code through the same dialog', () => {
    const { onImport } = renderMenu();
    openImportDialog();
    pasteImport(encodePlanCode(SHARED_RUN));
    expect(screen.getByRole('dialog', { name: 'Import FireRed Run?' })).toHaveTextContent('12 Pokémon');
    expect(onImport).not.toHaveBeenCalled();
  });

  it('previews a chosen JSON file through the same dialog', async () => {
    const { onImport } = renderMenu();
    openImportDialog();
    const file = new File([serializePlaythroughExport(FILE_RUN)], 'file-squad.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('JSON file'), { target: { files: [file] } });
    expect(await screen.findByText(/File squad/)).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Import FireRed Run?' })).toHaveTextContent('5 Pokémon');
    expect(onImport).not.toHaveBeenCalled();
  });

  it('replaces the run only once the preview is confirmed', () => {
    const { onImport } = renderMenu();
    openImportDialog();
    pasteImport(encodePlanCode(SHARED_RUN));
    fireEvent.click(screen.getByRole('button', { name: 'Import run' }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0].name).toBe('Shared squad');
    expect(screen.queryByRole('dialog', { name: 'Import FireRed Run?' })).toBeNull();
  });

  it('keeps the run and the dialog when the pasted text is not importable', () => {
    const { onImport } = renderMenu();
    openImportDialog();
    pasteImport('{ not valid json');
    expect(screen.getByRole('alert')).toHaveTextContent(/import/i);
    expect(screen.getByRole('dialog', { name: 'Import FireRed Run?' })).toBeVisible();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('rejects a link that carries no plan code', () => {
    const { onImport } = renderMenu();
    openImportDialog();
    pasteImport('https://pokeplanner.example/plan');
    expect(screen.getByRole('alert')).toHaveTextContent(/does not carry a plan code/i);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('moves focus into the import dialog and returns it to the trigger on cancel', async () => {
    renderMenu();
    openImportDialog();
    const dialog = screen.getByRole('dialog', { name: 'Import FireRed Run?' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel import' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run menu' })).toHaveFocus());
  });

  it('renames the run from its own dialog', () => {
    const { onRename } = renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename run' }));
    const field = screen.getByLabelText('Run name') as HTMLInputElement;
    expect(field.value).toBe('Kanto ledger');
    fireEvent.change(field, { target: { value: 'Johto ledger' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('Johto ledger');
  });

  it('duplicates without a confirmation step', () => {
    const { onDuplicate } = renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate run' }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it('deletes only after an explicit confirmation', () => {
    const { onDelete } = renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete run' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Delete this run?' });
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete permanently' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('keeps the run when a delete confirmation is cancelled', () => {
    const { onDelete } = renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('states the save status and keeps both exports available in temporary mode', () => {
    renderMenu({ saveStatus: 'temporary' });
    expect(screen.getByText('Temporary session')).toBeVisible();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Download JSON' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy plan code' })).toBeInTheDocument();
  });

  it('names each save status distinctly', () => {
    const { rerender } = renderMenu({ saveStatus: 'saved' });
    expect(screen.getByText('Saved')).toBeVisible();
    rerender(
      <RunMenu
        playthrough={MOUNTED_RUN}
        saveStatus="unsaved"
        theme="dark"
        onThemeChange={vi.fn()}
        prepareImport={(input) => prepareRunImport(input, packIndex(), pack.manifest.packVersion)}
        onImport={vi.fn()}
        onRename={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('switches the theme in both directions from the menu', () => {
    const dark = renderMenu({ theme: 'dark' });
    openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Dark theme' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Dark theme' }));
    expect(dark.onThemeChange).toHaveBeenCalledWith('light');
    cleanup();

    const light = renderMenu({ theme: 'light' });
    openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Dark theme' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Dark theme' }));
    expect(light.onThemeChange).toHaveBeenCalledWith('dark');
  });
});
