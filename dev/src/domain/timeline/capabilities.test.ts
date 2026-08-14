import { describe, expect, it } from 'vitest';
import type { EvolutionEdge } from '../pack';
import type { ProgressionContext } from '../rules/game-rules';
import { copyKeyframe } from './commands';
import {
  evaluateCapability,
  evaluateResourceAssignments,
  type CapabilityEvaluationContext,
  type FiniteResourceInventory,
} from './capabilities';
import type { MemberSnapshot, TimelineState } from './model';
import type { ResolvedTimelineNode } from './resolver';

const SURF = { id: 'surf', kind: 'field-move' as const, moveId: 57, requiredBadgeId: 'soul-badge', availableAtMilestoneId: 'koga-gym' };

const progressionContext = (badges: readonly string[] = [], milestones: readonly string[] = []): ProgressionContext => ({
  currentNodeId: 'fuchsia-city',
  targetMilestoneId: 'koga-gym',
  completedMilestoneIds: new Set(milestones),
  badgeIds: new Set(badges),
  badgeCount: badges.length,
  branchChoices: {},
});

function surfContext(overrides: Partial<CapabilityEvaluationContext> = {}): CapabilityEvaluationContext {
  return {
    capability: SURF,
    progressionContext: progressionContext(['soul-badge'], ['koga-gym']),
    canLearnMove: (speciesId, moveId) => speciesId === 131 && moveId === 57,
    sources: [{ id: 'hm03-safari-zone', available: true }],
    ...overrides,
  };
}

function member(overrides: Partial<MemberSnapshot> = {}): MemberSnapshot {
  return {
    speciesId: 131,
    level: 25,
    abilityId: 1,
    moves: [],
    heldItemId: 1,
    placement: 'party',
    partySlot: 0,
    review: { moves: false, heldItem: false },
    ...overrides,
  };
}

function resolvedNode(): ResolvedTimelineNode {
  return {
    nodeId: 'koga-gym',
    source: 'explicit-major',
    party: ['m1', 'm2', null, null, null, null],
    reserve: [],
    released: [],
    snapshots: {
      m1: member({ heldItemId: 99, moves: [{ moveId: 57, status: 'available-now', level: null, milestoneId: null }] }),
      m2: member({ partySlot: 1, heldItemId: 99, moves: [{ moveId: 57, status: 'available-now', level: null, milestoneId: null }] }),
    },
  };
}

function inventory(): FiniteResourceInventory {
  return { heldItems: new Map([[99, 1]]), moves: new Map([[57, 1]]) };
}

function timeline(): TimelineState {
  const partyMember = member({
    level: 12,
    moves: [{ moveId: 57, status: 'available-now', level: null, milestoneId: null }],
    heldItemId: 99,
  });
  const reserveMember = member({ level: 12, placement: 'reserve', partySlot: null, heldItemId: 33 });
  return {
    members: {
      m1: { id: 'm1', originalSpeciesId: 131, speciesSequence: 1, nickname: null, natureId: null, origin: { type: 'inferred', acquisitionId: null, note: null }, acquiredAtNodeId: 'brock-gym', notes: '', lifecycle: [] },
      m2: { id: 'm2', originalSpeciesId: 131, speciesSequence: 2, nickname: null, natureId: null, origin: { type: 'inferred', acquisitionId: null, note: null }, acquiredAtNodeId: 'brock-gym', notes: '', lifecycle: [] },
    },
    keyframes: {
      'brock-gym': {
        nodeId: 'brock-gym', kind: 'major', party: ['m1', null, null, null, null, null], reserve: ['m2'], released: [],
        snapshots: { m1: partyMember, m2: reserveMember },
      },
    },
    overrides: {},
    preferences: { levelMode: 'manual', autoEvolveLevel: false },
  };
}

const evolutions = (edges: readonly EvolutionEdge[]) => ({
  hasSpecies: () => true,
  legalAbilityIds: () => [1],
  isVersionValidMove: () => true,
  hasNode: () => true,
  hasMilestone: () => true,
  hasAcquisition: () => true,
  evolutionEdgesFrom: (speciesId: number) => edges.filter((edge) => edge.fromPokemonId === speciesId),
});

const levelEvolution = (overrides: Partial<EvolutionEdge> = {}): EvolutionEdge => ({
  fromPokemonId: 131,
  toPokemonId: 132,
  trigger: 'level',
  minimumLevel: 20,
  itemId: null,
  locationId: null,
  status: 'standard',
  milestoneId: null,
  reason: null,
  provenance: [{ sourceId: 'test-source', revision: '1', locator: null, method: 'manual', confidence: 'verified', note: null }],
  ...overrides,
});

describe('evaluateCapability', () => {
  it('distinguishes knows, can-now, conditional, and none with source evidence', () => {
    const knows = evaluateCapability(member({ moves: [{ moveId: 57, status: 'available-now', level: null, milestoneId: null }] }), surfContext());
    const canNow = evaluateCapability(member(), surfContext());
    const conditional = evaluateCapability(member(), surfContext({
      progressionContext: progressionContext(),
      sources: [{ id: 'hm03-safari-zone', available: false }],
    }));
    const none = evaluateCapability(member({ speciesId: 25 }), surfContext());

    expect(knows).toMatchObject({ state: 'knows', evidenceIds: expect.arrayContaining(['capability:surf', 'move:57', 'hm03-safari-zone']) });
    expect(canNow).toMatchObject({ state: 'can-now', evidenceIds: expect.arrayContaining(['move:57', 'hm03-safari-zone']) });
    expect(conditional).toMatchObject({ state: 'conditional', evidenceIds: expect.arrayContaining(['move:57', 'hm03-safari-zone']) });
    expect(none.state).toBe('none');
    expect(conditional.explanation).toMatch(/not currently available/i);
  });
});

describe('evaluateResourceAssignments', () => {
  it('returns unverified rather than a conflict when canonical inventory is absent', () => {
    expect(evaluateResourceAssignments(resolvedNode(), undefined)).toContainEqual(
      expect.objectContaining({ severity: 'unverified', code: 'resource.inventory-missing' }),
    );
  });

  it('reports finite held-item and move contention as advisory yellow findings', () => {
    const findings = evaluateResourceAssignments(resolvedNode(), inventory());

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'yellow', code: 'resource.held-item-contended', evidenceIds: expect.arrayContaining(['item:99']) }),
      expect.objectContaining({ severity: 'yellow', code: 'resource.move-contended', evidenceIds: expect.arrayContaining(['move:57']) }),
    ]));
  });
});

describe('copyKeyframe', () => {
  it('copies party and reserve immutably, levels only active members, evolves only level edges, and marks copied state for review', () => {
    const original = timeline();
    const copied = copyKeyframe(original, 'brock-gym', 'misty-gym', {
      levelMode: 'match', targetLevel: 21, autoEvolveLevel: true,
      pack: evolutions([
        levelEvolution(),
        levelEvolution({ toPokemonId: 133, trigger: 'item', minimumLevel: null, itemId: 5 }),
      ]),
    });

    expect(copied.keyframes['misty-gym']).toMatchObject({ party: ['m1', null, null, null, null, null], reserve: ['m2'] });
    expect(copied.keyframes['misty-gym'].snapshots.m1).toMatchObject({ level: 21, speciesId: 132, review: { moves: true, heldItem: true } });
    expect(copied.keyframes['misty-gym'].snapshots.m2).toMatchObject({ level: 12, speciesId: 131, review: { moves: true, heldItem: true } });
    expect(original.keyframes['brock-gym'].snapshots.m1).toMatchObject({ level: 12, speciesId: 131, review: { moves: false, heldItem: false } });
    expect(copied.keyframes['misty-gym'].snapshots.m1.moves).not.toBe(original.keyframes['brock-gym'].snapshots.m1.moves);
  });
});
