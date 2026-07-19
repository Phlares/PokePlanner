import { describe, expect, it } from 'vitest';
import type {
  ProgressionEvent,
  ProgressionNode,
  ProgressionProvenance,
  ProgressionVersionFlag,
  RouteProgression,
} from './progression';
import { validateRouteProgression } from './progression';

const provenance = (sourceId = 'manual-research'): ProgressionProvenance => ({
  sourceId,
  locator: 'fixture',
  method: 'manual',
  confidence: 'verified',
  note: null,
});

const versionFlags: Record<string, ProgressionVersionFlag> = {
  firered: { available: true, exclusive: false, note: null },
};

function makeEvent(overrides: Partial<ProgressionEvent> = {}): ProgressionEvent {
  return {
    id: 'arrival',
    order: 0,
    type: 'story',
    name: 'Arrival',
    description: null,
    flags: {
      keyMilestone: true,
      gym: false,
      rivalFight: false,
      bossFight: false,
      storyFight: true,
      optional: false,
    },
    opponentIds: [],
    acquisitionIds: [],
    conditions: [],
    unlocks: [],
    versionFlags,
    provenance: [provenance()],
    ...overrides,
  };
}

function makeNode(overrides: Partial<ProgressionNode> = {}): ProgressionNode {
  return {
    id: 'pallet-town',
    name: 'Pallet Town',
    kind: 'town',
    phase: 'opening',
    goldenPathOrder: 1,
    parentNodeId: null,
    prerequisiteEventIds: [],
    nextNodeIds: [],
    location: {
      pokeApiLocationId: 88,
      pokeApiLocationAreaIds: [285],
      sourceMapIds: ['MAP_PALLET_TOWN'],
    },
    versionFlags,
    events: [],
    provenance: [provenance()],
    ...overrides,
  };
}

function makeProgression(overrides: Partial<RouteProgression> = {}): RouteProgression {
  return {
    schemaVersion: 1,
    game: {
      id: 'firered',
      name: 'Pokémon FireRed',
      versionId: 10,
      versionGroupId: 7,
      generationId: 3,
      regionId: 1,
    },
    sources: [{
      id: 'manual-research',
      name: 'FireRed research',
      revision: '1',
      license: null,
      url: 'https://example.invalid/research',
    }],
    nodes: [makeNode()],
    ...overrides,
  };
}

function makePositiveGraph(): RouteProgression {
  return makeProgression({
    nodes: [
      makeNode({
        id: 'pallet-town',
        goldenPathOrder: 0,
        nextNodeIds: ['viridian-forest'],
        events: [makeEvent({ id: 'choose-starter' })],
      }),
      makeNode({
        id: 'viridian-forest',
        name: 'Viridian Forest',
        kind: 'dungeon',
        goldenPathOrder: 10,
        branch: 'optional',
        prerequisiteEventIds: ['choose-starter'],
        nextNodeIds: ['pewter-city'],
        events: [makeEvent({ id: 'clear-forest', order: 5 })],
      }),
      makeNode({
        id: 'pewter-city',
        name: 'Pewter City',
        kind: 'city',
        goldenPathOrder: 20,
        branch: 'main',
        prerequisiteEventIds: ['clear-forest'],
        events: [makeEvent({
          id: 'reach-pewter',
          conditions: [{ kind: 'milestone-complete', operator: 'equals', value: 'choose-starter' }],
        })],
      }),
      makeNode({
        id: 'sevii-islands',
        name: 'Sevii Islands',
        kind: 'landmark',
        phase: 'postgame',
        goldenPathOrder: 100,
        branch: 'postgame',
      }),
    ],
  });
}

function expectInvalidWith(input: unknown, ...fragments: string[]) {
  const result = validateRouteProgression(input);
  expect(result.valid).toBe(false);
  if (!result.valid) {
    for (const fragment of fragments) expect(result.errors.join('\n')).toContain(fragment);
  }
}

describe('validateRouteProgression', () => {
  it('accepts the existing minimal provenance-backed document and treats an omitted branch as main', () => {
    expect(validateRouteProgression(makeProgression())).toEqual({ valid: true });
  });

  it('accepts a multi-node main path that traverses an optional node', () => {
    expect(validateRouteProgression(makePositiveGraph())).toEqual({ valid: true });
  });

  it('accepts intentionally sparse node and event ordering', () => {
    const input = makePositiveGraph();
    input.nodes[0].goldenPathOrder = 2;
    input.nodes[1].goldenPathOrder = 40;
    input.nodes[1].events.push(makeEvent({ id: 'forest-exit', order: 900 }));

    expect(validateRouteProgression(input)).toEqual({ valid: true });
  });

  it.each(['optional', 'alternate'] as const)(
    'accepts a main node and an %s node with the same goldenPathOrder',
    (branch) => {
      const input = makeProgression({ nodes: [
        makeNode({ id: 'main-node', goldenPathOrder: 10 }),
        makeNode({ id: `${branch}-node`, goldenPathOrder: 10, branch }),
      ] });

      expect(validateRouteProgression(input)).toEqual({ valid: true });
    },
  );

  it('preserves JSON Schema errors', () => {
    const input = makeProgression();
    input.nodes[0].provenance = [];

    expectInvalidWith(input, '/nodes/0/provenance minItems');
  });

  it('rejects duplicate source IDs', () => {
    const input = makeProgression();
    input.sources.push({ ...input.sources[0] });

    expectInvalidWith(input, '/sources/1/id uniqueId');
  });

  it('rejects duplicate node IDs', () => {
    const input = makeProgression();
    input.nodes.push(makeNode({ goldenPathOrder: 2 }));

    expectInvalidWith(input, '/nodes/1/id uniqueId');
  });

  it('rejects event IDs duplicated across nodes', () => {
    const input = makePositiveGraph();
    input.nodes[0].events[0].id = 'duplicate-event';
    input.nodes[1].events[0].id = 'duplicate-event';

    expectInvalidWith(input, '/nodes/1/events/0/id uniqueId');
  });

  it('rejects duplicate event order values within a node', () => {
    const input = makeProgression({
      nodes: [makeNode({ events: [makeEvent(), makeEvent({ id: 'departure' })] })],
    });

    expectInvalidWith(input, '/nodes/0/events/1/order uniqueOrder');
  });

  it('rejects an unknown parentNodeId', () => {
    const input = makeProgression();
    input.nodes[0].parentNodeId = 'missing-node';

    expectInvalidWith(input, '/nodes/0/parentNodeId reference');
  });

  it('rejects an unknown nextNodeId', () => {
    const input = makeProgression();
    input.nodes[0].nextNodeIds = ['missing-node'];

    expectInvalidWith(input, '/nodes/0/nextNodeIds/0 reference');
  });

  it('rejects an unknown prerequisiteEventId', () => {
    const input = makeProgression();
    input.nodes[0].prerequisiteEventIds = ['missing-event'];

    expectInvalidWith(input, '/nodes/0/prerequisiteEventIds/0 reference');
  });

  it('rejects an unknown node provenance sourceId', () => {
    const input = makeProgression();
    input.nodes[0].provenance[0].sourceId = 'missing-source';

    expectInvalidWith(input, '/nodes/0/provenance/0/sourceId reference');
  });

  it('rejects an unknown event provenance sourceId', () => {
    const input = makeProgression({ nodes: [makeNode({ events: [makeEvent()] })] });
    input.nodes[0].events[0].provenance[0].sourceId = 'missing-source';

    expectInvalidWith(input, '/nodes/0/events/0/provenance/0/sourceId reference');
  });

  it.each(['milestone-complete', 'milestone-incomplete'] as const)(
    'rejects an unknown %s condition event reference',
    (kind) => {
      const input = makeProgression({ nodes: [makeNode({
        events: [makeEvent({
          conditions: [{ kind, operator: 'equals', value: 'missing-event' }],
        })],
      })] });

      expectInvalidWith(input, '/nodes/0/events/0/conditions/0/value reference');
    },
  );

  it('requires milestone condition event references to be strings', () => {
    const input = makeProgression({ nodes: [makeNode({
      events: [makeEvent({
        conditions: [{ kind: 'milestone-complete', operator: 'equals', value: 42 }],
      })],
    })] });

    expectInvalidWith(input, '/nodes/0/events/0/conditions/0/value reference');
  });

  it('rejects a prerequisite event owned by the same node', () => {
    const input = makeProgression({ nodes: [makeNode({
      prerequisiteEventIds: ['arrival'],
      events: [makeEvent()],
    })] });

    expectInvalidWith(input, '/nodes/0/prerequisiteEventIds/0 cycle');
  });

  it('rejects a multi-node prerequisite dependency cycle', () => {
    const input = makeProgression({ nodes: [
      makeNode({
        id: 'node-a',
        goldenPathOrder: 0,
        prerequisiteEventIds: ['event-b'],
        nextNodeIds: ['node-b'],
        events: [makeEvent({ id: 'event-a' })],
      }),
      makeNode({
        id: 'node-b',
        goldenPathOrder: 1,
        branch: 'main',
        prerequisiteEventIds: ['event-a'],
        events: [makeEvent({ id: 'event-b' })],
      }),
    ] });

    expectInvalidWith(input, 'cycle: prerequisite dependency creates a cycle');
  });

  it('reports one bounded witness for a large prerequisite dependency cycle', () => {
    const nodeCount = 100;
    const input = makeProgression({
      nodes: Array.from({ length: nodeCount }, (_, index) => makeNode({
        id: `cycle-node-${index}`,
        goldenPathOrder: index,
        prerequisiteEventIds: index === 0
          ? ['cycle-event-1', 'cycle-event-0']
          : [`cycle-event-${(index + 1) % nodeCount}`],
        nextNodeIds: index + 1 < nodeCount ? [`cycle-node-${index + 1}`] : [],
        events: [makeEvent({ id: `cycle-event-${index}` })],
      })),
    });

    const result = validateRouteProgression(input);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const cycleErrors = result.errors.filter((error) => error.includes(' cycle:'));
      expect(cycleErrors).toHaveLength(1);
      expect(cycleErrors[0].length).toBeLessThan(512);
      expect(cycleErrors[0]).toContain('...');
    }
  });

  it('rejects a graph without any main node', () => {
    const input = makeProgression();
    input.nodes[0].branch = 'optional';

    expectInvalidWith(input, '/nodes mainPath');
  });

  it('accepts multiple independent roots whose union reaches every main node', () => {
    const input = makeProgression({ nodes: [
      makeNode({ id: 'main-a', goldenPathOrder: 0 }),
      makeNode({ id: 'main-b', goldenPathOrder: 1, branch: 'main' }),
    ] });

    expect(validateRouteProgression(input)).toEqual({ valid: true });
  });

  it('accepts a main path entered from an optional root', () => {
    const input = makeProgression({ nodes: [
      makeNode({
        id: 'optional-root',
        goldenPathOrder: 0,
        branch: 'optional',
        nextNodeIds: ['main-node'],
      }),
      makeNode({ id: 'main-node', goldenPathOrder: 1, branch: 'main' }),
    ] });

    expect(validateRouteProgression(input)).toEqual({ valid: true });
  });

  it('accepts a main cycle reached from an external optional root', () => {
    const input = makeProgression({ nodes: [
      makeNode({
        id: 'optional-root',
        goldenPathOrder: 0,
        branch: 'optional',
        nextNodeIds: ['main-a'],
      }),
      makeNode({ id: 'main-a', goldenPathOrder: 1, nextNodeIds: ['main-b'] }),
      makeNode({ id: 'main-b', goldenPathOrder: 2, branch: 'main', nextNodeIds: ['main-a'] }),
    ] });

    expect(validateRouteProgression(input)).toEqual({ valid: true });
  });

  it('rejects a rootless cycle of main nodes', () => {
    const input = makeProgression({ nodes: [
      makeNode({ id: 'main-a', goldenPathOrder: 0, nextNodeIds: ['main-b'] }),
      makeNode({ id: 'main-b', goldenPathOrder: 1, branch: 'main', nextNodeIds: ['main-a'] }),
    ] });

    expectInvalidWith(input, '/nodes mainPath');
  });

  it('collects independent semantic errors instead of stopping at the first', () => {
    const input = makeProgression();
    input.sources.push({ ...input.sources[0] });
    input.nodes[0].nextNodeIds = ['missing-node'];

    expect(validateRouteProgression(input)).toEqual({
      valid: false,
      errors: [
        '/sources/1/id uniqueId: must be unique; duplicates /sources/0/id',
        '/nodes/0/nextNodeIds/0 reference: must resolve to a declared node; unknown node ID "missing-node"',
      ],
    });
  });

  it('does not throw for a deep acyclic prerequisite graph', () => {
    const nodeCount = 10_000;
    const input = makeProgression({
      nodes: Array.from({ length: nodeCount }, (_, index) => makeNode({
        id: `node-${index}`,
        goldenPathOrder: index,
        prerequisiteEventIds: index + 1 < nodeCount ? [`event-${index + 1}`] : [],
        nextNodeIds: index + 1 < nodeCount ? [`node-${index + 1}`] : [],
        events: [makeEvent({ id: `event-${index}` })],
      })),
    });

    expect(validateRouteProgression(input)).toEqual({ valid: true });
  });

  it('does not throw for a node wider than V8 argument limits', () => {
    const childCount = 130_000;
    const childIds = Array.from({ length: childCount }, (_, index) => `wide-child-${index}`);
    const input = makeProgression({
      nodes: [
        makeNode({ id: 'wide-root', goldenPathOrder: 0, nextNodeIds: childIds }),
        ...childIds.map((id, index) => makeNode({
          id,
          goldenPathOrder: index + 1,
          branch: 'optional',
        })),
      ],
    });

    expect(validateRouteProgression(input)).toEqual({ valid: true });
  });
});
