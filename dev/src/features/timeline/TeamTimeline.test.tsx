import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineResolverPackView } from '../../domain/timeline/resolver';
import type { TimelineState } from '../../domain/timeline/model';
import type { TimelineFinding } from '../../domain/timeline/validation';
import { TeamTimeline, type TimelineDisplayNode } from './TeamTimeline';

const party = (memberId: string | null) => [memberId, null, null, null, null, null] as const;

function timeline(): TimelineState {
  return {
    members: {
      starter: {
        id: 'starter',
        originalSpeciesId: 1,
        speciesSequence: 1,
        nickname: null,
        natureId: null,
        origin: { type: 'inferred', acquisitionId: null, note: null },
        acquiredAtNodeId: 'starter',
        notes: '',
        lifecycle: [],
      },
    },
    keyframes: {
      'brock-gym': {
        nodeId: 'brock-gym',
        kind: 'major',
        party: party('starter'),
        reserve: [],
        released: [],
        snapshots: {
          starter: {
            speciesId: 1,
            level: 14,
            abilityId: 65,
            moves: [],
            heldItemId: null,
            placement: 'party',
            partySlot: 0,
            review: { moves: false, heldItem: false },
          },
        },
      },
    },
    overrides: {},
    preferences: { levelMode: 'manual', autoEvolveLevel: false },
  };
}

const brockResolved: TimelineDisplayNode = {
  id: 'brock-gym',
  name: 'Brock',
  targetLevel: 14,
  resolved: {
    nodeId: 'brock-gym',
    source: 'explicit-major',
    party: party('starter'),
    reserve: [],
    released: [],
    snapshots: timeline().keyframes['brock-gym'].snapshots,
  },
};

const mistyResolved: TimelineDisplayNode = {
  id: 'misty-gym',
  name: 'Misty',
  targetLevel: 21,
  resolved: { ...brockResolved.resolved, nodeId: 'misty-gym', source: 'auto-filled' },
};

const routeResolved: TimelineDisplayNode = {
  id: 'kanto-route-22',
  name: 'Route 22',
  targetLevel: 14,
  resolved: { ...brockResolved.resolved, nodeId: 'kanto-route-22', source: 'auto-filled' },
};

const pack: TimelineResolverPackView = {
  hasSpecies: () => true,
  legalAbilityIds: () => [65],
  isVersionValidMove: () => true,
  hasNode: () => true,
  hasMilestone: () => true,
  hasAcquisition: () => true,
  evolutionEdgesFrom: (speciesId) => speciesId === 1 ? [{
    fromPokemonId: 1,
    toPokemonId: 2,
    trigger: 'level',
    minimumLevel: 16,
    itemId: null,
    locationId: null,
    status: 'standard',
    milestoneId: null,
    reason: null,
    provenance: [],
  }] : [],
};

function renderTimeline(overrides: Partial<Parameters<typeof TeamTimeline>[0]> = {}) {
  const onChange = vi.fn();
  const onEditMember = vi.fn();
  render(
    <TeamTimeline
      timeline={timeline()}
      majorNodes={[brockResolved, mistyResolved]}
      detailedNodes={[routeResolved]}
      initialNodeId="misty-gym"
      findingsByNode={{}}
      pack={pack}
      speciesName={(id) => id === 1 ? 'Bulbasaur' : id === 2 ? 'Ivysaur' : `Species ${id}`}
      onChange={onChange}
      onEditMember={onEditMember}
      {...overrides}
    />,
  );
  return { onChange, onEditMember };
}

afterEach(cleanup);

describe('TeamTimeline', () => {
  it('copies the previous milestone with level and level-evolution options', () => {
    const { onChange } = renderTimeline();
    fireEvent.click(screen.getByRole('button', { name: 'Copy previous' }));
    expect(screen.getByRole('group', { name: 'Copy Brock to Misty' })).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-level active party' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-evolve level evolutions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Misty keyframe' }));

    const next = onChange.mock.calls[0][0] as TimelineState;
    expect(next.keyframes['misty-gym']).toBeDefined();
    expect(next.keyframes['misty-gym'].snapshots.starter).toMatchObject({ speciesId: 2, level: 21 });
  });

  it('defaults to Major Events and renders exactly six party slots', () => {
    renderTimeline();
    expect(screen.getByRole('button', { name: 'Major Events' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /Route 22/i })).toBeNull();
    expect(within(screen.getByRole('region', { name: /Party · 1 of 6 Pokémon/i })).getAllByRole('listitem')).toHaveLength(6);
  });

  it('promotes an auto-filled node and immediately opens its editor from the same action', () => {
    const actions: string[] = [];
    const onChange = vi.fn((_next: TimelineState) => actions.push('promote'));
    const onEditMember = vi.fn((_nodeId: string, _memberId: string) => actions.push('edit'));
    renderTimeline({ onChange, onEditMember });
    fireEvent.click(screen.getByRole('button', { name: 'Detailed Planning' }));
    fireEvent.click(screen.getByRole('button', { name: /Route 22.*Auto-filled/i }));
    expect(screen.getByText('Auto-filled', { selector: '.timeline-state-label' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Bulbasaur' }));
    const next = onChange.mock.calls.at(-1)?.[0] as TimelineState;
    expect(next.overrides['kanto-route-22']).toMatchObject({ nodeId: 'kanto-route-22', kind: 'override' });
    expect(onEditMember).toHaveBeenCalledWith('kanto-route-22', 'starter');
    expect(actions).toEqual(['promote', 'edit']);
  });

  it('does not render or promote edit actions without an editor callback', () => {
    const { onChange } = renderTimeline({ onEditMember: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Detailed Planning' }));

    expect(screen.queryByRole('button', { name: 'Edit Bulbasaur' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('requests a released-member restore without mutating timeline state', () => {
    const released = timeline();
    const snapshot = released.keyframes['brock-gym'].snapshots.starter;
    released.keyframes['brock-gym'] = {
      ...released.keyframes['brock-gym'],
      party: party(null),
      released: ['starter'],
      snapshots: { starter: { ...snapshot, placement: 'released', partySlot: null } },
    };
    const releasedBrock: TimelineDisplayNode = {
      ...brockResolved,
      resolved: {
        ...brockResolved.resolved,
        party: party(null),
        released: ['starter'],
        snapshots: released.keyframes['brock-gym'].snapshots,
      },
    };
    const onRequestRestore = vi.fn();
    const { onChange } = renderTimeline({
      timeline: released,
      majorNodes: [releasedBrock],
      detailedNodes: [],
      initialNodeId: 'brock-gym',
      onRequestRestore,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Restore Bulbasaur' }));
    expect(onRequestRestore).toHaveBeenCalledWith('brock-gym', 'starter');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('updates ruler counts and the selected-node finding summary together', () => {
    const finding = (code: string): TimelineFinding => ({
      code,
      severity: 'review',
      memberId: 'starter',
      field: 'member',
      summary: code,
      explanation: code,
      evidenceIds: [],
      resolutions: [],
    });
    renderTimeline({
      findingsByNode: {
        'brock-gym': [finding('brock')],
        'misty-gym': [finding('misty-1'), finding('misty-2')],
      },
    });

    expect(screen.getByText('2 findings')).toBeVisible();
    expect(screen.getByRole('button', { name: /Misty.*2 findings/i })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: /Brock.*1 findings/i }));
    expect(screen.getByText('1 finding')).toBeVisible();
  });

  it('summarizes an injected propagation preview without applying it', () => {
    const previewProps = {
      propagationPreview: {
        targetNodeIds: ['misty-gym', 'surge-gym'],
        skippedNodeIds: [],
        protectedNodeIds: ['erika-gym'],
        conflictNodeIds: [],
        stateVersion: 'v1',
        token: 'token',
      },
    } as unknown as Partial<Parameters<typeof TeamTimeline>[0]>;
    const { onChange } = renderTimeline(previewProps);

    expect(screen.getByText('Pending change · 2 targets · 1 protected')).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });
});
