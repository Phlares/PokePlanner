import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineResolverPackView } from '../../domain/timeline/resolver';
import type { TimelineState } from '../../domain/timeline/model';
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
      findings={[]}
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

  it('resolves Detailed Planning routes and promotes an edited auto-filled node to an override', () => {
    const { onChange, onEditMember } = renderTimeline();
    fireEvent.click(screen.getByRole('button', { name: 'Detailed Planning' }));
    fireEvent.click(screen.getByRole('button', { name: /Route 22.*Auto-filled/i }));
    expect(screen.getByText('Auto-filled', { selector: '.timeline-state-label' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Bulbasaur' }));
    const next = onChange.mock.calls.at(-1)?.[0] as TimelineState;
    expect(next.overrides['kanto-route-22']).toMatchObject({ nodeId: 'kanto-route-22', kind: 'override' });
    expect(onEditMember).toHaveBeenCalledWith('kanto-route-22', 'starter');
  });

  it('restores a released identity to the unbounded reserve through the lifecycle command', () => {
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
    const { onChange } = renderTimeline({
      timeline: released,
      majorNodes: [releasedBrock],
      detailedNodes: [],
      initialNodeId: 'brock-gym',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Restore Bulbasaur' }));
    const next = onChange.mock.calls[0][0] as TimelineState;
    expect(next.keyframes['brock-gym'].reserve).toContain('starter');
    expect(next.members.starter.lifecycle.at(-1)?.type).toBe('restored');
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
