import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import routeProgressionSchema from '../../data/schemas/route-progression.schema.json';

export interface ProgressionGame {
  id: string;
  name: string;
  versionId: number;
  versionGroupId: number;
  generationId: number;
  regionId?: number | null;
}

export interface ProgressionSource {
  id: string;
  name: string;
  revision: string;
  license: string | null;
  url: string;
}

export type ProgressionProvenanceMethod = 'generated' | 'manual' | 'inferred';
export type ProgressionConfidence = 'verified' | 'cross-checked' | 'provisional';

export interface ProgressionProvenance {
  sourceId: string;
  locator?: string | null;
  method: ProgressionProvenanceMethod;
  confidence: ProgressionConfidence;
  note?: string | null;
}

export interface ProgressionVersionFlag {
  available: boolean;
  exclusive: boolean;
  note?: string | null;
}

export type ProgressionVersionFlags = Record<string, ProgressionVersionFlag>;

export type ProgressionConditionKind =
  | 'milestone-complete'
  | 'milestone-incomplete'
  | 'item-owned'
  | 'badge-owned'
  | 'starter-selected'
  | 'version'
  | 'choice'
  | 'time'
  | 'custom';

export type ProgressionConditionOperator = 'equals' | 'not-equals' | 'includes' | 'excludes';

export interface ProgressionCondition {
  kind: ProgressionConditionKind;
  operator: ProgressionConditionOperator;
  value: string | number | boolean;
  note?: string | null;
}

export interface ProgressionFlags {
  keyMilestone: boolean;
  gym: boolean;
  rivalFight: boolean;
  bossFight: boolean;
  storyFight: boolean;
  optional: boolean;
}

export type ProgressionUnlockKind =
  | 'location'
  | 'encounter-method'
  | 'item'
  | 'tm'
  | 'hm'
  | 'tutor'
  | 'trade'
  | 'service'
  | 'custom';

export interface ProgressionUnlock {
  kind: ProgressionUnlockKind;
  refId: string;
  note?: string | null;
}

export type ProgressionEventType =
  | 'story'
  | 'checkpoint'
  | 'gym'
  | 'rival'
  | 'trainer'
  | 'boss'
  | 'gift'
  | 'static-encounter'
  | 'trade'
  | 'item'
  | 'tm-hm'
  | 'tutor'
  | 'choice';

export interface ProgressionEvent {
  id: string;
  order: number;
  type: ProgressionEventType;
  name: string;
  description?: string | null;
  flags: ProgressionFlags;
  opponentIds?: string[];
  acquisitionIds?: string[];
  conditions: ProgressionCondition[];
  unlocks: ProgressionUnlock[];
  versionFlags: ProgressionVersionFlags;
  provenance: ProgressionProvenance[];
}

export type ProgressionNodeKind = 'town' | 'city' | 'route' | 'dungeon' | 'building' | 'landmark' | 'facility';
export type ProgressionBranch = 'main' | 'optional' | 'alternate' | 'postgame';

export interface ProgressionLocation {
  pokeApiLocationId: number | null;
  pokeApiLocationAreaIds: number[];
  sourceMapIds: string[];
}

export interface ProgressionNode {
  id: string;
  name: string;
  kind: ProgressionNodeKind;
  phase: string;
  goldenPathOrder: number;
  branch?: ProgressionBranch;
  parentNodeId?: string | null;
  prerequisiteEventIds: string[];
  nextNodeIds: string[];
  location: ProgressionLocation;
  versionFlags: ProgressionVersionFlags;
  events: ProgressionEvent[];
  provenance: ProgressionProvenance[];
}

export interface RouteProgression {
  schemaVersion: number;
  game: ProgressionGame;
  sources: ProgressionSource[];
  nodes: ProgressionNode[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validateSchema = ajv.compile<RouteProgression>(routeProgressionSchema);

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

function semanticError(path: string, keyword: string, message: string): string {
  return `${path} ${keyword}: ${message}`;
}

function validateSemantics(progression: RouteProgression): string[] {
  const errors: string[] = [];
  const sourceIndexById = new Map<string, number>();

  progression.sources.forEach((source, sourceIndex) => {
    const firstIndex = sourceIndexById.get(source.id);
    if (firstIndex !== undefined) {
      errors.push(semanticError(
        `/sources/${sourceIndex}/id`,
        'uniqueId',
        `must be unique; duplicates /sources/${firstIndex}/id`,
      ));
    } else {
      sourceIndexById.set(source.id, sourceIndex);
    }
  });

  const nodeIndexById = new Map<string, number>();
  const eventOwnerById = new Map<string, { nodeId: string; nodeIndex: number; eventIndex: number }>();

  progression.nodes.forEach((node, nodeIndex) => {
    const firstNodeIndex = nodeIndexById.get(node.id);
    if (firstNodeIndex !== undefined) {
      errors.push(semanticError(
        `/nodes/${nodeIndex}/id`,
        'uniqueId',
        `must be unique; duplicates /nodes/${firstNodeIndex}/id`,
      ));
    } else {
      nodeIndexById.set(node.id, nodeIndex);
    }

    const eventIndexByOrder = new Map<number, number>();
    node.events.forEach((event, eventIndex) => {
      const firstEvent = eventOwnerById.get(event.id);
      if (firstEvent) {
        errors.push(semanticError(
          `/nodes/${nodeIndex}/events/${eventIndex}/id`,
          'uniqueId',
          `must be globally unique; duplicates /nodes/${firstEvent.nodeIndex}/events/${firstEvent.eventIndex}/id`,
        ));
      } else {
        eventOwnerById.set(event.id, { nodeId: node.id, nodeIndex, eventIndex });
      }

      const firstEventOrderIndex = eventIndexByOrder.get(event.order);
      if (firstEventOrderIndex !== undefined) {
        errors.push(semanticError(
          `/nodes/${nodeIndex}/events/${eventIndex}/order`,
          'uniqueOrder',
          `must be unique within this node; duplicates /nodes/${nodeIndex}/events/${firstEventOrderIndex}/order`,
        ));
      } else {
        eventIndexByOrder.set(event.order, eventIndex);
      }
    });
  });

  const sourceIds = new Set(sourceIndexById.keys());
  const nodeIds = new Set(nodeIndexById.keys());

  progression.nodes.forEach((node, nodeIndex) => {
    if (node.parentNodeId != null && !nodeIds.has(node.parentNodeId)) {
      errors.push(semanticError(
        `/nodes/${nodeIndex}/parentNodeId`,
        'reference',
        `must resolve to a declared node; unknown node ID "${node.parentNodeId}"`,
      ));
    }

    node.nextNodeIds.forEach((nextNodeId, nextNodeIndex) => {
      if (!nodeIds.has(nextNodeId)) {
        errors.push(semanticError(
          `/nodes/${nodeIndex}/nextNodeIds/${nextNodeIndex}`,
          'reference',
          `must resolve to a declared node; unknown node ID "${nextNodeId}"`,
        ));
      }
    });

    node.prerequisiteEventIds.forEach((eventId, prerequisiteIndex) => {
      if (!eventOwnerById.has(eventId)) {
        errors.push(semanticError(
          `/nodes/${nodeIndex}/prerequisiteEventIds/${prerequisiteIndex}`,
          'reference',
          `must resolve to a declared event; unknown event ID "${eventId}"`,
        ));
      }
    });

    node.provenance.forEach((entry, provenanceIndex) => {
      if (!sourceIds.has(entry.sourceId)) {
        errors.push(semanticError(
          `/nodes/${nodeIndex}/provenance/${provenanceIndex}/sourceId`,
          'reference',
          `must resolve to a declared source; unknown source ID "${entry.sourceId}"`,
        ));
      }
    });

    node.events.forEach((event, eventIndex) => {
      event.provenance.forEach((entry, provenanceIndex) => {
        if (!sourceIds.has(entry.sourceId)) {
          errors.push(semanticError(
            `/nodes/${nodeIndex}/events/${eventIndex}/provenance/${provenanceIndex}/sourceId`,
            'reference',
            `must resolve to a declared source; unknown source ID "${entry.sourceId}"`,
          ));
        }
      });

      event.conditions.forEach((condition, conditionIndex) => {
        if (condition.kind !== 'milestone-complete' && condition.kind !== 'milestone-incomplete') return;

        const path = `/nodes/${nodeIndex}/events/${eventIndex}/conditions/${conditionIndex}/value`;
        if (typeof condition.value !== 'string') {
          errors.push(semanticError(path, 'reference', 'must be a string event ID for milestone conditions'));
        } else if (!eventOwnerById.has(condition.value)) {
          errors.push(semanticError(
            path,
            'reference',
            `must resolve to a declared event; unknown event ID "${condition.value}"`,
          ));
        }
      });
    });
  });

  validatePrerequisiteCycles(progression, nodeIndexById, eventOwnerById, errors);
  validateMainPath(progression, nodeIndexById, errors);
  return errors;
}

function validatePrerequisiteCycles(
  progression: RouteProgression,
  nodeIndexById: ReadonlyMap<string, number>,
  eventOwnerById: ReadonlyMap<string, { nodeId: string }>,
  errors: string[],
): void {
  const dependencies = new Map<string, Array<{ nodeId: string; path: string }>>();

  progression.nodes.forEach((node, nodeIndex) => {
    if (nodeIndexById.get(node.id) !== nodeIndex) return;
    const nodeDependencies: Array<{ nodeId: string; path: string }> = [];
    node.prerequisiteEventIds.forEach((eventId, prerequisiteIndex) => {
      const owner = eventOwnerById.get(eventId);
      if (owner) {
        nodeDependencies.push({
          nodeId: owner.nodeId,
          path: `/nodes/${nodeIndex}/prerequisiteEventIds/${prerequisiteIndex}`,
        });
      }
    });
    dependencies.set(node.id, nodeDependencies);
  });

  const state = new Map<string, 'visiting' | 'visited'>();
  for (const startingNodeId of dependencies.keys()) {
    if (state.has(startingNodeId)) continue;

    const activePath = [startingNodeId];
    const activeIndexById = new Map([[startingNodeId, 0]]);
    const frames = [{ nodeId: startingNodeId, dependencyIndex: 0 }];
    state.set(startingNodeId, 'visiting');

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const nodeDependencies = dependencies.get(frame.nodeId) ?? [];
      const dependency = nodeDependencies[frame.dependencyIndex];

      if (!dependency) {
        state.set(frame.nodeId, 'visited');
        activeIndexById.delete(frame.nodeId);
        activePath.pop();
        frames.pop();
        continue;
      }

      frame.dependencyIndex += 1;
      const dependencyState = state.get(dependency.nodeId);
      if (dependencyState === 'visiting') {
        const cycleStart = activeIndexById.get(dependency.nodeId) ?? 0;
        errors.push(semanticError(
          dependency.path,
          'cycle',
          `prerequisite dependency creates a cycle: ${formatCycleWitness(activePath, cycleStart, dependency.nodeId)}`,
        ));
        return;
      } else if (dependencyState !== 'visited') {
        state.set(dependency.nodeId, 'visiting');
        activeIndexById.set(dependency.nodeId, activePath.length);
        activePath.push(dependency.nodeId);
        frames.push({ nodeId: dependency.nodeId, dependencyIndex: 0 });
      }
    }
  }
}

function formatCycleWitness(activePath: string[], cycleStart: number, closingNodeId: string): string {
  const maxIdLength = 40;
  const maxCycleNodes = 8;
  const cycleLength = activePath.length - cycleStart;
  const witness: string[] = [];

  if (cycleLength <= maxCycleNodes) {
    for (let index = cycleStart; index < activePath.length; index += 1) witness.push(activePath[index]);
  } else {
    for (let index = cycleStart; index < cycleStart + 4; index += 1) witness.push(activePath[index]);
    witness.push('...');
    for (let index = activePath.length - 3; index < activePath.length; index += 1) witness.push(activePath[index]);
  }
  witness.push(closingNodeId);

  return witness.map((nodeId) => (
    nodeId.length <= maxIdLength ? nodeId : `${nodeId.slice(0, maxIdLength - 3)}...`
  )).join(' -> ');
}

function validateMainPath(
  progression: RouteProgression,
  nodeIndexById: ReadonlyMap<string, number>,
  errors: string[],
): void {
  const uniqueNodes = progression.nodes.filter((node, index) => nodeIndexById.get(node.id) === index);
  const nodeById = new Map(uniqueNodes.map((node) => [node.id, node]));
  const mainNodes = uniqueNodes.filter((node) => node.branch === undefined || node.branch === 'main');

  if (mainNodes.length === 0) {
    errors.push(semanticError('/nodes', 'mainPath', 'must contain at least one main node'));
    return;
  }

  const incomingNodeIds = new Set<string>();
  for (const node of uniqueNodes) {
    for (const nextNodeId of node.nextNodeIds) {
      if (nodeById.has(nextNodeId)) incomingNodeIds.add(nextNodeId);
    }
  }

  const graphRoots = uniqueNodes.filter((node) => !incomingNodeIds.has(node.id));
  const reachable = new Set<string>();
  const pending = graphRoots.map((node) => node.id);
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    const node = nodeById.get(nodeId);
    if (node) {
      for (const nextNodeId of node.nextNodeIds) pending.push(nextNodeId);
    }
  }

  const unreachable = mainNodes.filter((node) => !reachable.has(node.id)).map((node) => node.id);
  if (unreachable.length === 0) return;

  errors.push(semanticError(
    '/nodes',
    'mainPath',
    `every main node must be reachable from the graph roots through nextNodeIds; unreachable main node IDs: ${unreachable.join(', ')}`,
  ));
}

export function validateRouteProgression(input: unknown): ValidationResult {
  if (!validateSchema(input)) {
    return {
      valid: false,
      errors: (validateSchema.errors ?? []).map(
        (error) => `${error.instancePath || '/'} ${error.keyword}: ${error.message ?? 'invalid'}`,
      ),
    };
  }

  const errors = validateSemantics(input);
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
