import { describe, expect, it } from 'vitest';
import type { AcquisitionRecord, EncounterArea, EvolutionEdge, LearnsetRecord, PokemonRecord } from '../pack';
import type { RouteProgression } from '../progression';
import type { GameRules, ProgressionContext } from '../rules/game-rules';
import type { MemberSnapshot, PersistentMember } from './model';
import type { ResolvedTimelineNode } from './resolver';
import {
  inferMemberOrigin,
  validateResolvedNode,
  type TimelineValidationContext,
} from './validation';

const SOURCE = {
  sourceId: 'test-source', revision: '1', locator: null,
  method: 'manual' as const, confidence: 'verified' as const, note: null,
};

const NODE_IDS = ['pallet-town', 'kanto-route-1', 'kanto-route-22', 'pewter-city'] as const;
const progression: RouteProgression = {
  schemaVersion: 1,
  game: { id: 'firered', name: 'FireRed', versionId: 10, versionGroupId: 7, generationId: 3 },
  sources: [],
  nodes: NODE_IDS.map((id, goldenPathOrder) => ({
    id,
    name: id,
    kind: id.includes('route') ? 'route' : id === 'pewter-city' ? 'city' : 'town',
    phase: 'test',
    goldenPathOrder,
    prerequisiteEventIds: [],
    nextNodeIds: goldenPathOrder + 1 < NODE_IDS.length ? [NODE_IDS[goldenPathOrder + 1]] : [],
    location: { pokeApiLocationId: null, pokeApiLocationAreaIds: [], sourceMapIds: [] },
    versionFlags: {},
    events: [],
    provenance: [],
  })),
};

const progressionContext = (completedMilestoneIds: readonly string[] = [], badgeIds: readonly string[] = []): ProgressionContext => ({
  currentNodeId: 'kanto-route-22',
  targetMilestoneId: 'brock-gym',
  completedMilestoneIds: new Set(completedMilestoneIds),
  badgeIds: new Set(badgeIds),
  badgeCount: badgeIds.length,
  branchChoices: {},
});

const rules: GameRules = {
  gameId: 'firered',
  initialProgress: () => ({ currentNodeId: 'pallet-town', targetMilestoneId: 'brock-gym' }),
  milestones: [{ id: 'brock-gym', nodeId: 'pewter-city', name: 'Brock', targetLevel: 14, badgeId: 'boulder-badge' }],
  natures: [],
  // A ruleset with no natures and no hidden values: the interface admits it without a branch.
  hiddenStatBounds: { lowest: { individual: 0, effort: 0 }, highest: { individual: 0, effort: 0 } },
  natureStatModifiers: [{ effect: 'neutral', multiplier: 1 }],
  statValue: ({ base }) => base,
  capabilities: new Map(),
  targetLevel: () => 14,
  targetLevelAtNode: () => 14,
  canTrade: (context) => context.completedMilestoneIds.has('trade-unlocked'),
  acquisitionNodeId: () => null,
  tradedObedienceLimit: (context) => context.badgeIds.has('earth-badge') ? null : 10,
};

function pokemon(id: number): PokemonRecord {
  return {
    id,
    slug: `pokemon-${id}`,
    name: `Pokemon ${id}`,
    types: ['normal'],
    abilities: [{ id: 1, name: 'Ability', slot: 1, shortEffect: 'Test ability.' }],
    baseStats: { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 },
    evYield: { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 },
    captureRate: 255,
    sprite: null,
    provenance: [SOURCE],
  };
}

function encounter(pokemonId: number, nodeId: string, slug = `${nodeId}-area`): EncounterArea {
  return {
    locationAreaId: 1,
    locationId: 1,
    slug,
    name: slug,
    nodeId,
    methodRates: { walk: 100 },
    methods: [{ method: 'walk', slots: [{ pokemonId, chance: 100, maxChance: 100, minLevel: 2, maxLevel: 4, conditions: [] }] }],
    provenance: [SOURCE],
  };
}

function acquisition(
  id: string,
  pokemonId: number,
  kind: Extract<AcquisitionRecord['subject'], { pokemonId: number }>['kind'],
  status: AcquisitionRecord['status'] = 'standard',
): AcquisitionRecord {
  return {
    id,
    name: id,
    subject: { kind, pokemonId },
    milestoneId: null,
    prerequisites: [],
    repeatable: false,
    status,
    provenance: [SOURCE],
  };
}

function learnset(pokemonId: number, moves: LearnsetRecord['moves']): LearnsetRecord {
  return { pokemonId, moves, provenance: [SOURCE] };
}

function evolution(overrides: Partial<EvolutionEdge> = {}): EvolutionEdge {
  return {
    fromPokemonId: 1,
    toPokemonId: 2,
    trigger: 'level',
    minimumLevel: 16,
    itemId: null,
    locationId: null,
    status: 'standard',
    milestoneId: null,
    reason: null,
    provenance: [SOURCE],
    ...overrides,
  };
}

function member(overrides: Partial<PersistentMember> = {}): PersistentMember {
  return {
    id: 'm1',
    originalSpeciesId: 1,
    speciesSequence: 1,
    nickname: null,
    natureId: null,
    origin: { type: 'inferred', acquisitionId: null, note: null },
    acquiredAtNodeId: 'kanto-route-22',
    notes: '',
    lifecycle: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<MemberSnapshot> = {}): MemberSnapshot {
  return {
    speciesId: 1,
    level: 8,
    abilityId: 1,
    moves: [],
    heldItemId: null,
    placement: 'party',
    partySlot: 0,
    review: { moves: false, heldItem: false },
    ...overrides,
  };
}

function resolvedNode(snapshotOverrides: Partial<MemberSnapshot> = {}, nodeId = 'kanto-route-22'): ResolvedTimelineNode {
  return {
    nodeId,
    source: 'explicit-major',
    party: ['m1', null, null, null, null, null],
    reserve: [],
    released: [],
    snapshots: { m1: snapshot(snapshotOverrides) },
  };
}

function validationContext(overrides: Partial<TimelineValidationContext> = {}): TimelineValidationContext {
  return {
    members: { m1: member() },
    progression,
    progressionContext: progressionContext(),
    rules,
    pack: {
      pokemon: [pokemon(1)],
      learnsets: [learnset(1, [{ method: 'level-up', moveId: 1, level: 1 }])],
      encounters: [encounter(1, 'kanto-route-22')],
      acquisitions: [],
      evolutions: [],
    },
    ...overrides,
  };
}

describe('validateResolvedNode', () => {
  it('reports conditional egg origin as yellow and never throws', () => {
    const node = resolvedNode({ moves: [{ moveId: 99, status: 'available-now', level: null, milestoneId: null }] });
    const context = validationContext({
      pack: { ...validationContext().pack, learnsets: [learnset(1, [{ method: 'egg', moveId: 99 }])] },
    });

    expect(() => validateResolvedNode(node, context)).not.toThrow();
    expect(validateResolvedNode(node, context)).toContainEqual(expect.objectContaining({
      code: 'move.egg-origin', severity: 'yellow', memberId: 'm1', field: 'move',
      evidenceIds: ['learnset:egg', 'move:99', 'pokemon:1'],
    }));
    const finding = validateResolvedNode(node, context).find((candidate) => candidate.code === 'move.egg-origin');
    expect(finding?.summary.length).toBeGreaterThan(0);
    expect(finding?.explanation.length).toBeGreaterThan(0);
    expect(finding?.resolutions).toContainEqual(expect.objectContaining({ id: 'origin.hatched' }));
  });

  it('reports trading before trade unlock as red', () => {
    const traded = member({ origin: { type: 'external-trade', acquisitionId: null, note: null } });
    const findings = validateResolvedNode(resolvedNode(), validationContext({ members: { m1: traded } }));

    expect(findings).toContainEqual(expect.objectContaining({ code: 'origin.trade-locked', severity: 'red' }));
  });

  it('keeps restored audit as a permanent yellow finding', () => {
    const restored = member({
      lifecycle: [
        { type: 'released', nodeId: 'kanto-route-1', from: 'party', to: 'released', reason: null },
        { type: 'restored', nodeId: 'kanto-route-22', from: 'released', to: 'reserve', reason: null },
      ],
    });

    expect(validateResolvedNode(resolvedNode(), validationContext({ members: { m1: restored } }))).toContainEqual(
      expect.objectContaining({ code: 'member.restored', memberId: 'm1', severity: 'yellow' }),
    );
  });

  it('does not apply traded obedience to an ordinary self-obtained member', () => {
    const selfObtained = validateResolvedNode(resolvedNode({ level: 100 }), validationContext());
    const traded = validateResolvedNode(
      resolvedNode({ level: 11 }),
      validationContext({ members: { m1: member({ origin: { type: 'external-trade', acquisitionId: null, note: null } }) } }),
    );

    expect(selfObtained).not.toContainEqual(expect.objectContaining({ code: 'level.traded-obedience' }));
    expect(traded).toContainEqual(expect.objectContaining({ code: 'level.traded-obedience', severity: 'red' }));
  });

  it('returns findings rather than throwing for impossible user-authored move and ability choices', () => {
    const findings = validateResolvedNode(
      resolvedNode({ abilityId: 999, moves: [{ moveId: 999, status: 'available-now', level: null, milestoneId: null }] }),
      validationContext(),
    );

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ability.invalid', severity: 'red' }),
      expect.objectContaining({ code: 'move.unavailable', severity: 'red' }),
    ]));
  });

  it('reports an unknown saved origin acquisition as user configuration instead of throwing', () => {
    const configured = member({ origin: { type: 'event', acquisitionId: 'missing-event', note: null } });

    expect(() => validateResolvedNode(resolvedNode(), validationContext({ members: { m1: configured } }))).not.toThrow();
    expect(validateResolvedNode(resolvedNode(), validationContext({ members: { m1: configured } }))).toContainEqual(
      expect.objectContaining({ code: 'origin.acquisition-unknown', severity: 'red', evidenceIds: ['missing-event'] }),
    );
  });

  it('uses unverified findings when canonical pack evidence is absent', () => {
    const findings = validateResolvedNode(resolvedNode(), validationContext({
      pack: { pokemon: undefined, learnsets: undefined, encounters: undefined, acquisitions: undefined, evolutions: undefined },
    }));

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'origin.evidence-missing', severity: 'unverified' }),
      expect.objectContaining({ code: 'ability.evidence-missing', severity: 'unverified' }),
    ]));
  });

  it('throws only when canonical learnset evidence is corrupt', () => {
    const node = resolvedNode({ moves: [{ moveId: 50, status: 'available-now', level: null, milestoneId: null }] });
    const context = validationContext({
      pack: {
        ...validationContext().pack,
        learnsets: [learnset(1, [{ method: 'machine', moveId: 50, acquisitionIds: ['missing-tm'] }])],
      },
    });

    expect(() => validateResolvedNode(node, context)).toThrow(/corrupt canonical pack.*missing-tm/i);
  });

  it('reports a canonically unavailable machine instead of treating it as unverified timing', () => {
    const unavailableMachine: AcquisitionRecord = {
      id: 'hm99-unavailable',
      name: 'Unavailable HM',
      subject: { kind: 'hm', moveId: 50, itemId: 999, machineNumber: 99 },
      milestoneId: null,
      prerequisites: [],
      repeatable: false,
      status: 'unavailable',
      provenance: [SOURCE],
    };
    const findings = validateResolvedNode(
      resolvedNode({ moves: [{ moveId: 50, status: 'available-now', level: null, milestoneId: null }] }),
      validationContext({
        pack: {
          ...validationContext().pack,
          acquisitions: [unavailableMachine],
          learnsets: [learnset(1, [{ method: 'machine', moveId: 50, acquisitionIds: ['hm99-unavailable'] }])],
        },
      }),
    );

    expect(findings).toContainEqual(expect.objectContaining({ code: 'move.unavailable', severity: 'red' }));
  });

  it('reports evolution timing and trade requirements without blocking the configuration', () => {
    const levelFindings = validateResolvedNode(
      resolvedNode({ speciesId: 2, level: 15 }),
      validationContext({
        pack: { ...validationContext().pack, pokemon: [pokemon(1), pokemon(2)], evolutions: [evolution()] },
      }),
    );
    const tradeFindings = validateResolvedNode(
      resolvedNode({ speciesId: 2 }),
      validationContext({
        pack: {
          ...validationContext().pack,
          pokemon: [pokemon(1), pokemon(2)],
          evolutions: [evolution({ trigger: 'trade', minimumLevel: null })],
        },
      }),
    );

    expect(levelFindings).toContainEqual(expect.objectContaining({ code: 'evolution.level-locked', severity: 'red' }));
    expect(tradeFindings).toContainEqual(expect.objectContaining({ code: 'evolution.trade-locked', severity: 'red' }));
  });

  it('reports when the inferred ordinary path occurs after the configured acquisition node', () => {
    const earlyMember = member({ acquiredAtNodeId: 'kanto-route-1' });
    const findings = validateResolvedNode(
      resolvedNode(),
      validationContext({ members: { m1: earlyMember } }),
    );

    expect(findings).toContainEqual(expect.objectContaining({
      code: 'origin.acquisition-conflict', severity: 'red', evidenceIds: ['kanto-route-1', 'kanto-route-22', 'kanto-route-22-area'],
    }));
  });

  it('returns unverified when an ordinary acquisition exists but its timing is unknown', () => {
    const unknownTiming = acquisition('ordinary-unknown-timing', 1, 'gift');
    const context = validationContext({
      pack: { ...validationContext().pack, encounters: [], acquisitions: [unknownTiming] },
    });

    expect(inferMemberOrigin(member(), 'kanto-route-22', context)).toMatchObject({
      status: 'ordinary-timing-unverified',
      origin: { type: 'inferred', acquisitionId: 'ordinary-unknown-timing' },
      requestedOriginTypes: [],
      evidenceIds: ['ordinary-unknown-timing'],
    });
    expect(validateResolvedNode(resolvedNode(), context)).toContainEqual(expect.objectContaining({
      code: 'origin.timing-unverified', severity: 'unverified', evidenceIds: ['ordinary-unknown-timing'],
    }));
    expect(validateResolvedNode(resolvedNode(), context)).not.toContainEqual(expect.objectContaining({
      code: 'origin.no-ordinary-path', severity: 'red',
    }));
  });

  it.each([
    {
      name: 'duplicate placements',
      node: { ...resolvedNode(), party: ['m1', 'm1', null, null, null, null] as ResolvedTimelineNode['party'] },
      code: 'node.placement-duplicate',
    },
    {
      name: 'unknown members',
      node: {
        ...resolvedNode(),
        party: ['unknown', null, null, null, null, null] as ResolvedTimelineNode['party'],
        snapshots: { unknown: snapshot() },
      },
      code: 'node.member-unknown',
    },
    {
      name: 'missing snapshots',
      node: { ...resolvedNode(), snapshots: {} },
      code: 'node.snapshot-missing',
    },
    {
      name: 'unplaced snapshots',
      node: {
        ...resolvedNode(),
        party: [null, null, null, null, null, null] as ResolvedTimelineNode['party'],
        snapshots: { m1: snapshot() },
      },
      code: 'node.snapshot-unplaced',
    },
  ])('reports $name as advisory findings instead of throwing', ({ node, code }) => {
    const context = validationContext();

    expect(() => validateResolvedNode(node, context)).not.toThrow();
    expect(validateResolvedNode(node, context)).toContainEqual(expect.objectContaining({ code, severity: 'red' }));
  });

  it('sorts finding evidence and resolutions independently of catalog and audit order', () => {
    const configured = member({
      lifecycle: [
        { type: 'restored', nodeId: 'kanto-route-22', from: 'released', to: 'reserve', reason: null },
        { type: 'restored', nodeId: 'kanto-route-1', from: 'released', to: 'reserve', reason: null },
      ],
    });
    const context = validationContext({
      members: { m1: configured },
      pack: {
        ...validationContext().pack,
        encounters: [],
        acquisitions: [
          acquisition('z-transfer', 1, 'transfer', 'transfer-only'),
          acquisition('a-event', 1, 'event', 'event-only'),
        ],
      },
    });
    const findings = validateResolvedNode(resolvedNode(), context);
    const origin = findings.find((candidate) => candidate.code === 'origin.no-ordinary-path');
    const restored = findings.find((candidate) => candidate.code === 'member.restored');

    expect(inferMemberOrigin(configured, 'kanto-route-22', context).requestedOriginTypes).toEqual(['event', 'transfer']);
    expect(origin?.evidenceIds).toEqual(['a-event', 'z-transfer']);
    expect(origin?.resolutions.map((resolution) => resolution.id)).toEqual(['origin.event', 'origin.transfer']);
    expect(restored?.evidenceIds).toEqual(['kanto-route-1', 'kanto-route-22']);
  });
});

describe('inferMemberOrigin', () => {
  it('infers the earliest ordinary acquisition valid at the selected node', () => {
    const context = validationContext({
      pack: {
        ...validationContext().pack,
        encounters: [encounter(1, 'pewter-city', 'late-area'), encounter(1, 'kanto-route-22', 'early-area')],
      },
    });

    expect(inferMemberOrigin(member(), 'pewter-city', context)).toMatchObject({
      status: 'ordinary',
      origin: { type: 'inferred', acquisitionId: 'early-area' },
      evidenceIds: ['early-area', 'kanto-route-22'],
      requestedOriginTypes: [],
      traded: false,
    });
  });

  it('requests event origin only when no ordinary path can explain the member', () => {
    const context = validationContext({
      pack: {
        ...validationContext().pack,
        encounters: [],
        acquisitions: [acquisition('event-species-1', 1, 'event', 'event-only')],
      },
    });

    expect(inferMemberOrigin(member(), 'kanto-route-22', context)).toMatchObject({
      status: 'requires-override',
      requestedOriginTypes: ['event'],
      evidenceIds: ['event-species-1'],
    });
  });

  it('marks an inferred in-game trade as traded for obedience', () => {
    const tradeRules: GameRules = { ...rules, acquisitionNodeId: (id) => id === 'trade-species-1' ? 'kanto-route-1' : null };
    const context = validationContext({
      rules: tradeRules,
      pack: {
        ...validationContext().pack,
        encounters: [],
        acquisitions: [acquisition('trade-species-1', 1, 'trade')],
      },
    });

    expect(inferMemberOrigin(member(), 'kanto-route-22', context)).toMatchObject({
      status: 'ordinary', traded: true, evidenceIds: ['kanto-route-1', 'trade-species-1'],
    });
    expect(validateResolvedNode(resolvedNode({ level: 11 }), context)).toContainEqual(
      expect.objectContaining({ code: 'level.traded-obedience', severity: 'red' }),
    );
  });

  it('requires an external trade for a version-exclusive acquisition even when its node is known', () => {
    const exclusive = acquisition('exclusive-species-1', 1, 'gift', 'version-exclusive');
    const context = validationContext({
      rules: { ...rules, acquisitionNodeId: () => 'kanto-route-1' },
      pack: { ...validationContext().pack, encounters: [], acquisitions: [exclusive] },
    });

    expect(inferMemberOrigin(member(), 'kanto-route-22', context)).toMatchObject({
      status: 'requires-override', requestedOriginTypes: ['external-trade'],
    });
  });
});
