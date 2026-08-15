import type { FireRedPack } from '../../data/game-pack';
import type { ProgressionNode } from '../../domain/progression';
import type { GameRules, PlanningMilestone } from '../../domain/rules/game-rules';
import { hasActiveSearchQuery, type MoveMatch, type Obtainability, type PokemonType } from '../../domain/search';
import { searchWorkbench, type WorkbenchMethod } from '../../domain/workbench/search';
import type { WorkbenchState } from './controller';

/**
 * How reachable a route is from where the run stands. `postgame` and `optional` describe the
 * branch the pack puts the node on; the rest are temporal — `locked` is beyond the planning
 * target, `current` is already reached, `future` is inside the plan but not yet walked.
 */
export type RouteAccess = 'current' | 'future' | 'locked' | 'optional' | 'postgame';

/** Something that must be held or done before a route's matches can be reached. */
export interface RouteGate {
  kind: 'capability' | 'story';
  /** A rules capability id (`surf`, `rock-smash`, …) or the progression event that unblocks it. */
  id: string;
}

/** One matching species under a route row. */
export interface RouteMatch {
  pokemonId: number;
  slug: string;
  name: string;
  types: readonly PokemonType[];
  /** Every acquisition method that yields this species here. */
  methods: readonly WorkbenchMethod[];
  minLevel: number | null;
  maxLevel: number | null;
  exactMatch: boolean;
  obtainability: Obtainability;
  moveMatch?: MoveMatch;
}

/** One route row inside a milestone group. */
export interface RouteResult {
  nodeId: string;
  name: string;
  milestoneId: string;
  milestoneIndex: number;
  access: RouteAccess;
  /** The level band the matches are found at, or null when nothing here states a level. */
  levelRange: { min: number; max: number } | null;
  /** Distinct matching species on this route. */
  matchCount: number;
  gates: readonly RouteGate[];
  matches: readonly RouteMatch[];
}

/** Every matching route leading up to one planning milestone. */
export interface MilestoneResultGroup {
  milestoneId: string;
  /** 0-based chronological index in `GameRules.milestones`. */
  milestoneIndex: number;
  name: string;
  /** Distinct matching species across the group's routes. */
  matchCount: number;
  routes: readonly RouteResult[];
}

/** One subdued row standing in for everything the milestone scope hides ahead of the target. */
export interface FutureTeaserSection {
  kind: 'future-teaser';
  matchCount: number;
  milestoneIds: readonly string[];
  expanded: boolean;
}

export type MatchingMilestoneSection = MilestoneResultGroup & {
  kind: 'matching-milestone';
  expanded: boolean;
};

/** One eligible milestone the active search hid, named and chronologically placed. */
export interface HiddenMilestone {
  id: string;
  /** 0-based chronological index in `GameRules.milestones`, so the row can be labelled as a range. */
  index: number;
}

/** One collapsed row standing in for every eligible milestone that matched nothing. */
export interface NoMatchSummarySection {
  kind: 'no-match-summary';
  hiddenMilestones: readonly HiddenMilestone[];
  expanded: boolean;
}

export type WorkbenchResultSection =
  | FutureTeaserSection
  | MatchingMilestoneSection
  | NoMatchSummarySection;

export interface GroupedWorkbenchResults {
  sections: readonly WorkbenchResultSection[];
  /** Distinct matching species anywhere on the spine, whatever the sections choose to show. */
  totalPokemon: number;
  /** Distinct matching routes anywhere on the spine, whatever the sections choose to show. */
  totalRoutes: number;
}

export interface MilestoneResultsInput {
  pack: FireRedPack;
  rules: GameRules;
  /** Ephemeral navigation state; the only owner of the query, the folds and the filter. */
  state: WorkbenchState;
  /** Durable saved progress — what the run has actually reached. */
  currentMilestoneId: string | null;
  /** The planning horizon: the previewed milestone when one is set, else the saved one. */
  targetMilestoneId: string | null;
}

/**
 * Map one persisted milestone or node id onto the progression location that carries it. The starter
 * milestone is configured before the pack's first node, so it borrows that node's location.
 */
export function milestoneNodeId(
  milestoneId: string,
  milestones: readonly PlanningMilestone[],
  progressionIds: ReadonlySet<string>,
): string {
  const configured = milestones.find((milestone) => milestone.id === milestoneId)?.nodeId;
  if (configured !== undefined && progressionIds.has(configured)) return configured;
  if (milestoneId === 'starter' && progressionIds.has('pallet-town')) return 'pallet-town';
  return configured ?? milestoneId;
}

/** One milestone's slice of the golden path: every order in `[startOrder, endOrder]`. */
export interface MilestoneBand {
  milestoneId: string;
  index: number;
  name: string;
  nodeId: string;
  startOrder: number;
  endOrder: number;
}

/**
 * Cut the golden path into one contiguous band per milestone. A band ends at the order of the node
 * carrying its milestone, kept as a running maximum so the spine stays monotone even where the pack
 * anchors a milestone out of geographic order (Giovanni's gym sits in Viridian City, walked early
 * but fought last, and so claims an empty band rather than reordering the spine).
 */
export function milestoneBands(
  milestones: readonly PlanningMilestone[],
  pack: FireRedPack,
): readonly MilestoneBand[] {
  const progressionIds = new Set(pack.progression.nodes.map((node) => node.id));
  const orderByNodeId = new Map(pack.progression.nodes.map((node) => [node.id, node.goldenPathOrder]));
  let previousEnd = Number.NEGATIVE_INFINITY;
  return milestones.map((milestone, index) => {
    const nodeId = milestoneNodeId(milestone.id, milestones, progressionIds);
    const endOrder = Math.max(orderByNodeId.get(nodeId) ?? previousEnd, previousEnd);
    const band: MilestoneBand = {
      milestoneId: milestone.id,
      index,
      name: milestone.name,
      nodeId,
      startOrder: previousEnd + 1,
      endOrder,
    };
    previousEnd = endOrder;
    return band;
  });
}

/** The band a golden-path order falls in; anything past the last milestone belongs to it. */
function bandForOrder(bands: readonly MilestoneBand[], order: number): MilestoneBand {
  return bands.find((band) => order <= band.endOrder) ?? bands[bands.length - 1];
}

/**
 * Classify one route. The branch the pack puts a node on wins over where the run stands — postgame
 * content is postgame however far ahead you plan — then the planning horizon, then the detour flag,
 * and only then how far the run has actually walked.
 */
function routeAccess(
  node: ProgressionNode,
  band: MilestoneBand,
  targetIndex: number,
  currentOrder: number,
): RouteAccess {
  // An absent branch is the golden path, the same normalization the pack's own consumers apply.
  const branch = node.branch ?? 'main';
  if (branch === 'postgame') return 'postgame';
  if (band.index > targetIndex) return 'locked';
  if (branch !== 'main') return 'optional';
  return node.goldenPathOrder <= currentOrder ? 'current' : 'future';
}

/**
 * The gates standing between the run and this route's matches: the field capabilities without which
 * a match cannot be obtained here at all, and the story events the pack makes the node itself wait
 * on. A capability that merely offers a second way to a match already reachable another way is not
 * a gate — Viridian City's water is on the rods as well as on Surf, so a rod holder is not blocked.
 * A match is therefore capability-locked only when *every* method that yields it is a capability.
 */
function routeGates(
  node: ProgressionNode,
  matches: readonly RouteMatch[],
  rules: GameRules,
): RouteGate[] {
  const capabilityIds = new Set<string>();
  for (const match of matches) {
    if (!match.methods.every((method) => rules.capabilities.has(method))) continue;
    for (const method of match.methods) capabilityIds.add(method);
  }
  return [
    ...[...capabilityIds].sort().map((id): RouteGate => ({ kind: 'capability', id })),
    ...[...node.prerequisiteEventIds].sort().map((id): RouteGate => ({ kind: 'story', id })),
  ];
}

function levelRangeOf(matches: readonly RouteMatch[]): { min: number; max: number } | null {
  const levels = matches.flatMap((match) => (
    match.minLevel === null || match.maxLevel === null ? [] : [match.minLevel, match.maxLevel]
  ));
  return levels.length === 0 ? null : { min: Math.min(...levels), max: Math.max(...levels) };
}

/**
 * Turn the durable run, the pack and the ephemeral controller state into the grouped result view
 * the workbench renders. The pipeline is fixed: the milestone scope is taken first, the query is
 * run second, matches are grouped into milestone bands third, and each group's routes are ordered
 * last — reverse chronological, closest to the milestone first.
 *
 * One scope order drives the whole shape. Everything at or before it is grouped and rendered;
 * everything past it is counted into the single future teaser, and every milestone band that
 * begins past it is simply not eligible. Turning the milestone filter off pushes that order to
 * infinity, which empties the teaser and reveals the future groups through the same code.
 *
 * Pure: it holds no state, reads every selection from the controller state it is handed, and never
 * truncates — `totalPokemon` and `totalRoutes` count the whole match set whatever is displayed.
 */
export function selectMilestoneResults(input: MilestoneResultsInput): GroupedWorkbenchResults {
  const { pack, rules, state } = input;
  const nodeById = new Map(pack.progression.nodes.map((node) => [node.id, node]));
  const bands = milestoneBands(rules.milestones, pack);
  const orderOf = (band: MilestoneBand): number => nodeById.get(band.nodeId)?.goldenPathOrder ?? Number.POSITIVE_INFINITY;

  const targetBand = bands.find((band) => band.milestoneId === input.targetMilestoneId) ?? bands[bands.length - 1];
  const currentBand = bands.find((band) => band.milestoneId === input.currentMilestoneId);
  const currentOrder = currentBand === undefined ? Number.NEGATIVE_INFINITY : orderOf(currentBand);
  // The node's own order, not the band's end: this is the same horizon the controller validates
  // route selections against, so nothing is ever listed that a selection would immediately drop.
  const scopeOrder = state.milestoneFilter ? orderOf(targetBand) : Number.POSITIVE_INFINITY;

  const rowsByNodeId = new Map<string, RouteMatch[]>();
  const nodeIdsByMilestone = new Map<string, string[]>();
  const futurePokemonIds = new Set<number>();
  const futureMilestoneIds = new Set<string>();
  const totalPokemonIds = new Set<number>();
  const totalNodeIds = new Set<string>();

  for (const match of searchWorkbench(state.query, pack, rules)) {
    for (const placement of match.placements) {
      const node = nodeById.get(placement.nodeId);
      if (node === undefined) continue;
      const band = bandForOrder(bands, node.goldenPathOrder);
      totalPokemonIds.add(match.pokemonId);
      totalNodeIds.add(node.id);
      if (node.goldenPathOrder > scopeOrder) {
        futurePokemonIds.add(match.pokemonId);
        futureMilestoneIds.add(band.milestoneId);
        continue;
      }
      const rows = rowsByNodeId.get(node.id);
      if (rows === undefined) {
        rowsByNodeId.set(node.id, []);
        const siblings = nodeIdsByMilestone.get(band.milestoneId) ?? [];
        siblings.push(node.id);
        nodeIdsByMilestone.set(band.milestoneId, siblings);
      }
      rowsByNodeId.get(node.id)!.push({
        pokemonId: match.pokemonId,
        slug: match.slug,
        name: match.name,
        types: match.types,
        methods: placement.methods,
        minLevel: placement.minLevel,
        maxLevel: placement.maxLevel,
        exactMatch: match.exactMatch,
        obtainability: match.obtainability,
        moveMatch: match.moveMatch,
      });
    }
  }

  const searchActive = hasActiveSearchQuery(state.query);
  // A band that holds no golden-path order at all is not a milestone the run can be shown routes
  // for, matched or otherwise; it is absent from the list rather than reported as having no matches.
  const eligible = bands.filter((band) => band.startOrder <= band.endOrder && band.startOrder <= scopeOrder);
  const groups: MilestoneResultGroup[] = eligible.map((band) => {
    const routes = (nodeIdsByMilestone.get(band.milestoneId) ?? [])
      .map((nodeId): RouteResult => {
        const node = nodeById.get(nodeId)!;
        const matches = [...rowsByNodeId.get(nodeId)!].sort((left, right) => left.pokemonId - right.pokemonId);
        return {
          nodeId,
          name: node.name,
          milestoneId: band.milestoneId,
          milestoneIndex: band.index,
          access: routeAccess(node, band, targetBand.index, currentOrder),
          levelRange: levelRangeOf(matches),
          matchCount: matches.length,
          gates: routeGates(node, matches, rules),
          matches,
        };
      })
      // Reverse chronological: the encounter closest to the milestone reads first.
      .sort((left, right) => nodeById.get(right.nodeId)!.goldenPathOrder - nodeById.get(left.nodeId)!.goldenPathOrder);
    return {
      milestoneId: band.milestoneId,
      milestoneIndex: band.index,
      name: band.name,
      matchCount: new Set(routes.flatMap((route) => route.matches.map((match) => match.pokemonId))).size,
      routes,
    };
  });

  const sections: WorkbenchResultSection[] = [];
  // The teaser and the summary are search-result furniture (spec §10). Browsing has no "matches" to
  // count and no milestone to explain away, so neither row is emitted without an active query.
  if (searchActive && futurePokemonIds.size > 0) {
    sections.push({
      kind: 'future-teaser',
      matchCount: futurePokemonIds.size,
      milestoneIds: bands.filter((band) => futureMilestoneIds.has(band.milestoneId)).map((band) => band.milestoneId),
      expanded: false,
    });
  }
  for (const group of groups.filter((candidate) => candidate.matchCount > 0).reverse()) {
    sections.push({
      ...group,
      kind: 'matching-milestone',
      expanded: searchActive || state.openMilestoneIds.has(group.milestoneId),
    });
  }
  // No `searchActive` guard here, deliberately: with no query every eligible band matches, because
  // a band is only eligible when it holds golden-path orders and every such band on the spine holds
  // species. The browse-mode test pins that outcome, so a guard would be an unkillable clause.
  const hidden = groups.filter((group) => group.matchCount === 0);
  if (hidden.length > 0) {
    sections.push({
      kind: 'no-match-summary',
      hiddenMilestones: hidden.map((group) => ({ id: group.milestoneId, index: group.milestoneIndex })),
      expanded: false,
    });
  }

  return { sections, totalPokemon: totalPokemonIds.size, totalRoutes: totalNodeIds.size };
}
