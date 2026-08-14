import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameSetup } from './GameSetup';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import { parsePlaythrough, type PlaythroughPackIndex } from '../../domain/playthrough';
import { MILESTONE_ORDER } from '../../domain/availability';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';

const pack = loadFireRedPackFixture();

/** A real id-resolution surface built from the committed pack, used only to re-validate emissions. */
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

afterEach(cleanup);

describe('GameSetup', () => {
  it('enables Generation III and FireRed', () => {
    render(<GameSetup pack={pack} onCreate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Generation III/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^FireRed$/i })).toBeEnabled();
  });

  it('keeps other generations and games visible but disabled', () => {
    render(<GameSetup pack={pack} onCreate={vi.fn()} />);
    for (const name of [/Generation I\b/i, /Generation II\b/i, /Generation IV/i]) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeVisible();
      expect(button).toBeDisabled();
    }
    for (const name of [/LeafGreen/i, /Ruby/i]) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeVisible();
      expect(button).toBeDisabled();
    }
  });

  it('fixes the FireRed version, version-group, and generation ids at 10 / 7 / 3', () => {
    render(<GameSetup pack={pack} onCreate={vi.fn()} />);
    const identity = screen.getByRole('list', { name: /version identity/i });
    expect(within(identity).getByText('Version').closest('li')).toHaveTextContent('10');
    expect(within(identity).getByText('Version group').closest('li')).toHaveTextContent('7');
    expect(within(identity).getByText('Generation').closest('li')).toHaveTextContent('3');
  });

  it('enables only the Standard playthrough type', () => {
    render(<GameSetup pack={pack} onCreate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Standard/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Nuzlocke/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Professor Oak/i })).toBeDisabled();
  });

  it('creates the selected starter member at the rules-provided gate and targets Brock', () => {
    const onCreate = vi.fn();
    let id = 0;
    render(<GameSetup pack={pack} onCreate={onCreate} createId={() => `created-${++id}`} now={() => 1000} />);

    fireEvent.click(screen.getByRole('button', { name: 'Charmander' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start FireRed' }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const playthrough = onCreate.mock.calls[0][0];
    expect(() => parsePlaythrough(playthrough, packIndex())).not.toThrow();
    expect(playthrough.game).toBe('firered');
    expect(playthrough.type).toBe('standard');
    expect(playthrough.currentMilestoneId).toBe('starter');
    expect(playthrough.previewMilestoneId).toBe('brock-gym');
    expect(playthrough.starterSpeciesId).toBe(4);
    expect(playthrough.timeline.members['created-2']).toMatchObject({
      id: 'created-2',
      originalSpeciesId: 4,
      acquiredAtNodeId: 'starter',
    });
    expect(playthrough.timeline.keyframes.starter.party[0]).toBe('created-2');
    expect(playthrough.team.primary[0]?.id).toBe('created-2');
  });
});
