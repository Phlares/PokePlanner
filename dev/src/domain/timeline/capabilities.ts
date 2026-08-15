import type { CapabilityRule, FiniteResourceInventory as RulesFiniteResourceInventory, ProgressionContext } from '../rules/game-rules';
import type { MemberSnapshot } from './model';
import type { ResolvedTimelineNode } from './resolver';
import type { FindingField, TimelineFinding } from './validation';

export type CapabilityState = 'knows' | 'can-now' | 'conditional' | 'none';
export type FiniteResourceInventory = RulesFiniteResourceInventory;

export interface CapabilitySource {
  id: string;
  /** Null preserves uncertainty from an incomplete canonical source adapter. */
  available: boolean | null;
}

export interface CapabilityEvaluationContext {
  capability: CapabilityRule;
  progressionContext: ProgressionContext;
  /** Returns null only when canonical learnability cannot be established. */
  canLearnMove(speciesId: number, moveId: number): boolean | null;
  sources: readonly CapabilitySource[] | undefined;
}

export interface CapabilityEvaluation {
  state: CapabilityState;
  evidenceIds: readonly string[];
  explanation: string;
}

/**
 * One evaluation attributed to the subject it was made for. This is the single evidence model every
 * capability surface renders — party slot, reserve box and search result alike — so no component
 * ever recomputes a state of its own.
 */
export interface CapabilityHighlight extends CapabilityEvaluation {
  speciesId: number;
  /** The timeline member described, or null for a search candidate that is not on the team. */
  memberId: string | null;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function capabilityEvidence(context: CapabilityEvaluationContext): string[] {
  return sortedUnique([
    `capability:${context.capability.id}`,
    `move:${context.capability.moveId}`,
    ...(context.sources?.map((source) => source.id) ?? []),
  ]);
}

function capabilityUnlocked(context: CapabilityEvaluationContext): boolean {
  const { capability, progressionContext } = context;
  return (capability.requiredBadgeId === null || progressionContext.badgeIds.has(capability.requiredBadgeId))
    && (capability.availableAtMilestoneId === null || progressionContext.completedMilestoneIds.has(capability.availableAtMilestoneId));
}

/**
 * Explain whether one configured member already supplies, can immediately acquire, could later
 * acquire, or cannot supply a field capability. The result is an advisory search aid, never a gate.
 */
export function evaluateCapability(member: MemberSnapshot, context: CapabilityEvaluationContext): CapabilityEvaluation {
  const { capability } = context;
  const evidenceIds = capabilityEvidence(context);
  const unlocked = capabilityUnlocked(context);
  const knowsMove = member.moves.some((move) => (
    move.moveId === capability.moveId && move.status === 'available-now'
  ));
  const canLearn = context.canLearnMove(member.speciesId, capability.moveId);
  const sourcesAvailableNow = context.sources?.some((source) => source.available === true) ?? false;

  if (knowsMove && unlocked) {
    return { state: 'knows', evidenceIds, explanation: `This member knows move ${capability.moveId} and can use ${capability.id} now.` };
  }
  if (canLearn === true && unlocked && sourcesAvailableNow) {
    return { state: 'can-now', evidenceIds, explanation: `This member can learn move ${capability.moveId} from an available canonical source and use ${capability.id} now.` };
  }
  if (knowsMove || canLearn === true || canLearn === null) {
    return { state: 'conditional', evidenceIds, explanation: `This member could supply ${capability.id}, but its required move or field access is not currently available.` };
  }
  return { state: 'none', evidenceIds, explanation: `This member has no known way to supply ${capability.id}.` };
}

/**
 * Attribute one {@link evaluateCapability} result to its subject. Party members, reserve members and
 * search candidates differ only in the snapshot handed in — a candidate is simply a species with no
 * planned moves and no member id — so every surface reads the same state from the same evaluator.
 */
export function highlightCapability(
  member: MemberSnapshot,
  memberId: string | null,
  context: CapabilityEvaluationContext,
): CapabilityHighlight {
  return { ...evaluateCapability(member, context), speciesId: member.speciesId, memberId };
}

interface ResourceAssignment {
  kind: 'held-item' | 'move';
  resourceId: number;
  memberId: string;
}

function assignmentsFor(node: ResolvedTimelineNode): ResourceAssignment[] {
  return Object.entries(node.snapshots).flatMap(([memberId, snapshot]) => [
    ...(snapshot.heldItemId === null ? [] : [{ kind: 'held-item' as const, resourceId: snapshot.heldItemId, memberId }]),
    ...snapshot.moves.map((move) => ({ kind: 'move' as const, resourceId: move.moveId, memberId })),
  ]);
}

function resourceFinding(
  code: string,
  severity: TimelineFinding['severity'],
  field: FindingField,
  memberId: string | null,
  summary: string,
  explanation: string,
  evidenceIds: readonly string[],
): TimelineFinding {
  return {
    code,
    severity,
    memberId,
    field,
    summary,
    explanation,
    evidenceIds: sortedUnique(evidenceIds),
    resolutions: [],
  };
}

/**
 * Report shared finite-resource contention without preventing the user-authored plan. Rulesets
 * opt in by supplying canonical counts; an absent inventory is explicitly unverified, not a conflict.
 */
export function evaluateResourceAssignments(
  node: ResolvedTimelineNode,
  inventory: FiniteResourceInventory | undefined,
): TimelineFinding[] {
  const assignments = assignmentsFor(node);
  if (assignments.length === 0) return [];
  if (inventory === undefined) {
    return assignments.map((assignment) => resourceFinding(
      'resource.inventory-missing',
      'unverified',
      assignment.kind,
      assignment.memberId,
      'Finite resource inventory is unavailable',
      'The active ruleset has no canonical inventory for this assigned move or held item, so its shared availability cannot be verified.',
      [assignment.kind === 'move' ? `move:${assignment.resourceId}` : `item:${assignment.resourceId}`, `member:${assignment.memberId}`],
    ));
  }

  const findings: TimelineFinding[] = [];
  for (const kind of ['held-item', 'move'] as const) {
    const grouped = new Map<number, ResourceAssignment[]>();
    for (const assignment of assignments.filter((candidate) => candidate.kind === kind)) {
      const items = grouped.get(assignment.resourceId) ?? [];
      items.push(assignment);
      grouped.set(assignment.resourceId, items);
    }
    for (const [resourceId, uses] of grouped) {
      const count = (kind === 'held-item' ? inventory.heldItems : inventory.moves).get(resourceId);
      if (count === undefined || uses.length <= count) continue;
      const prefix = kind === 'move' ? 'move' : 'item';
      findings.push(resourceFinding(
        `resource.${kind}-contended`,
        'yellow',
        kind,
        null,
        'Finite resource is assigned more than once',
        `${uses.length} planned assignments share ${count} canonical ${count === 1 ? 'copy' : 'copies'} of this resource. Choose which assignment should retain it.`,
        [`${prefix}:${resourceId}`, ...uses.map((use) => `member:${use.memberId}`)],
      ));
    }
  }
  return findings;
}
