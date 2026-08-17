import type { FireRedPack } from '../../data/game-pack';
import type { ProgressionNode } from '../../domain/progression';
import type { GameRules } from '../../domain/rules/game-rules';
import { hasActiveSearchQuery, type MoveMatch, type Obtainability, type PokemonType } from '../../domain/search';
import {
  milestoneBands,
  searchWorkbench,
  type MilestoneBand,
  type WorkbenchMatch,
  type WorkbenchMethod,
  type WorkbenchPlacement,
} from '../../domain/workbench/search';
import { FUTURE_TEASER_SECTION_ID, NO_MATCH_SUMMARY_SECTION_ID, type WorkbenchState } from './controller';

// The milestone geometry the workbench groups by is domain logic; briefings cut the same bands.
export { milestoneBands, milestoneNodeId, type MilestoneBand } from '../../domain/workbench/search';

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
  /** The controller's own reserved id, so the section names its fold with the value it carries. */
  kind: typeof FUTURE_TEASER_SECTION_ID;
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
  name: string;
}

/** One collapsed row standing in for every eligible milestone that matched nothing. */
export interface NoMatchSummarySection {
  /** The controller's own reserved id, so the section names its fold with the value it carries. */
  kind: typeof NO_MATCH_SUMMARY_SECTION_ID;
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
 * Whether the surface is showing — and must therefore accept a selection of — nodes past the
 * planning target. Turning the milestone filter off and opening the future teaser reveal the same
 * nodes by the same rule, so the scope the results are cut to and the scope selections are
 * validated against are read from this one predicate rather than restated on either side.
 */
export function revealsFutureNodes(state: WorkbenchState): boolean {
  return !state.milestoneFilter || state.openSectionIds.has(FUTURE_TEASER_SECTION_ID);
}

/** The band a golden-path order falls in; anything past the last milestone belongs to it. */
function bandForOrder(bands: readonly MilestoneBand[], order: number): MilestoneBand {
  return bands.find((band) => order <= band.endOrder) ?? bands[bands.length - 1];
}

/**
 * Where the run stands and where it is planning to, resolved once. Every selector here classifies
 * against this one reading, so a route cannot be `locked` in a group and `future` in a detail pane.
 */
interface ResultHorizon {
  nodeById: ReadonlyMap<string, ProgressionNode>;
  bands: readonly MilestoneBand[];
  targetBand: MilestoneBand;
  /** The planning target's own golden-path order — the horizon the milestone scope cuts at. */
  targetOrder: number;
  /** How far the run has actually walked; negative infinity when it has reached nothing. */
  currentOrder: number;
}

function horizonOf(input: MilestoneResultsInput): ResultHorizon {
  const nodeById = new Map(input.pack.progression.nodes.map((node) => [node.id, node]));
  const bands = milestoneBands(input.rules.milestones, input.pack);
  const orderOf = (band: MilestoneBand): number =>
    nodeById.get(band.nodeId)?.goldenPathOrder ?? Number.POSITIVE_INFINITY;
  const targetBand = bands.find((band) => band.milestoneId === input.targetMilestoneId) ?? bands[bands.length - 1];
  const currentBand = bands.find((band) => band.milestoneId === input.currentMilestoneId);
  return {
    nodeById,
    bands,
    targetBand,
    targetOrder: orderOf(targetBand),
    currentOrder: currentBand === undefined ? Number.NEGATIVE_INFINITY : orderOf(currentBand),
  };
}

/** One search hit read at one of its placements: the shape every route row is built from. */
function routeMatchOf(match: WorkbenchMatch, placement: WorkbenchPlacement): RouteMatch {
  return {
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
  };
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
  const { nodeById, bands, targetBand, targetOrder, currentOrder } = horizonOf(input);
  // The node's own order, not the band's end: this is the same horizon the controller validates
  // route selections against, so nothing is ever listed that a selection would immediately drop.
  const scopeOrder = state.milestoneFilter ? targetOrder : Number.POSITIVE_INFINITY;
  // Opening the teaser reveals what it counts without changing what it counts, so the two horizons
  // are kept apart: the scope decides what is teased, the reveal decides what is grouped.
  const revealOrder = revealsFutureNodes(state) ? Number.POSITIVE_INFINITY : scopeOrder;

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
        if (node.goldenPathOrder > revealOrder) continue;
      }
      const rows = rowsByNodeId.get(node.id);
      if (rows === undefined) {
        rowsByNodeId.set(node.id, []);
        const siblings = nodeIdsByMilestone.get(band.milestoneId) ?? [];
        siblings.push(node.id);
        nodeIdsByMilestone.set(band.milestoneId, siblings);
      }
      rowsByNodeId.get(node.id)!.push(routeMatchOf(match, placement));
    }
  }

  const searchActive = hasActiveSearchQuery(state.query);
  // A band that holds no golden-path order at all is not a milestone the run can be shown routes
  // for, matched or otherwise; it is absent from the list rather than reported as having no matches.
  const eligible = bands.filter((band) => band.startOrder <= band.endOrder && band.startOrder <= revealOrder);
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
      expanded: state.openSectionIds.has(FUTURE_TEASER_SECTION_ID),
    });
  }
  for (const group of groups.filter((candidate) => candidate.matchCount > 0).reverse()) {
    sections.push({
      ...group,
      kind: 'matching-milestone',
      expanded: searchActive || state.openSectionIds.has(group.milestoneId),
    });
  }
  // No `searchActive` guard here, deliberately: with no query every eligible band matches, because
  // a band is only eligible when it holds golden-path orders and every such band on the spine holds
  // species. The browse-mode test pins that outcome, so a guard would be an unkillable clause.
  const hidden = groups.filter((group) => group.matchCount === 0);
  if (hidden.length > 0) {
    sections.push({
      kind: 'no-match-summary',
      hiddenMilestones: hidden.map((group) => ({
        id: group.milestoneId,
        index: group.milestoneIndex,
        name: group.name,
      })),
      expanded: state.openSectionIds.has(NO_MATCH_SUMMARY_SECTION_ID),
    });
  }

  return { sections, totalPokemon: totalPokemonIds.size, totalRoutes: totalNodeIds.size };
}

/**
 * Everything the detail pane states about ONE node, whether or not the grouping shows it. The
 * active filters are kept and simply narrowed to this node through the workbench search's own
 * `nodeId` filter, so the detail can never disagree with the row that opened it — and a node the
 * filters place nothing on is still stated, with an honest empty match set rather than a blank pane.
 *
 * Null only when the pack does not carry the node.
 */
export function selectRouteDetail(nodeId: string, input: MilestoneResultsInput): RouteResult | null {
  const { pack, rules, state } = input;
  const { nodeById, bands, targetBand, currentOrder } = horizonOf(input);
  const node = nodeById.get(nodeId);
  if (node === undefined) return null;

  const band = bandForOrder(bands, node.goldenPathOrder);
  const matches = searchWorkbench({ ...state.query, nodeId }, pack, rules)
    .flatMap((match) => match.placements.map((placement) => routeMatchOf(match, placement)))
    .sort((left, right) => left.pokemonId - right.pokemonId);

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
}

/** One way of obtaining a species at one place on the golden path. */
export interface AcquisitionPath {
  nodeId: string;
  /** The location's own name, as the progression graph gives it. */
  name: string;
  milestoneId: string;
  milestoneName: string;
  access: RouteAccess;
  /** Every way the species is obtained here — wild methods and non-wild acquisitions alike. */
  methods: readonly WorkbenchMethod[];
  /** Null when nothing here states a level (a gift or a trade arrives fixed). */
  minLevel: number | null;
  maxLevel: number | null;
  /** Progression events the pack makes this location wait on. */
  prerequisites: readonly string[];
}

/** Where and when one species can be obtained, read off the whole pack rather than a query. */
export interface PokemonLocationsResult {
  pokemonId: number;
  name: string;
  obtainability: Obtainability;
  /** Chronological by golden-path order; empty when the pack places the species nowhere. */
  paths: readonly AcquisitionPath[];
}

/**
 * Every acquisition path for one species, in progression order (spec §12). The active filters are
 * deliberately NOT applied: this pane answers "where and when can I get this", which a filter that
 * happens to be running must not silently narrow. Reachability is still read against the run, so
 * each path carries the same access verdict a route row would give it.
 *
 * Null only when the pack does not carry the species.
 */
export function selectPokemonLocations(
  pokemonId: number,
  input: MilestoneResultsInput,
): PokemonLocationsResult | null {
  const { pack, rules } = input;
  const { nodeById, bands, targetBand, currentOrder } = horizonOf(input);
  const match = searchWorkbench({}, pack, rules).find((candidate) => candidate.pokemonId === pokemonId);
  if (match === undefined) return null;

  const paths = match.placements.map((placement): AcquisitionPath => {
    // A placement is indexed off the progression graph, so its node is always one the pack carries.
    const node = nodeById.get(placement.nodeId)!;
    const band = bandForOrder(bands, node.goldenPathOrder);
    return {
      nodeId: node.id,
      name: node.name,
      milestoneId: band.milestoneId,
      milestoneName: band.name,
      access: routeAccess(node, band, targetBand.index, currentOrder),
      methods: placement.methods,
      minLevel: placement.minLevel,
      maxLevel: placement.maxLevel,
      prerequisites: [...node.prerequisiteEventIds].sort(),
    };
  });

  return { pokemonId, name: match.name, obtainability: match.obtainability, paths };
}
