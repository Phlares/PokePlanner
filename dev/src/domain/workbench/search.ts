import type { FireRedPack } from '../../data/game-pack';
import { acquisitionNodeId, evaluateAcquisitionAtNode } from '../availability';
import type { AcquisitionRecord, EncounterArea } from '../pack';
import type { ProgressionNode, ProgressionUnlock } from '../progression';
import type { CapabilityRule, GameRules, PlanningMilestone, ProgressionContext } from '../rules/game-rules';
import { isMoveVersionValid, searchFireRed, type SearchQuery, type SearchResult } from '../search';
import {
  highlightCapability,
  type CapabilityHighlight,
  type CapabilitySource,
  type CapabilityState,
} from '../timeline/capabilities';
import type { MemberSnapshot } from '../timeline/model';
import type { ResolvedTimelineNode } from '../timeline/resolver';

/**
 * The workbench's search query. It extends the pack-level {@link SearchQuery} rather than widening
 * it, so workbench-only filters never reach the immutable pack boundary; `hasActiveSearchQuery`
 * reads queries structurally and therefore judges the extensions too.
 *
 * EVERY FILTER ADDED HERE MUST BE AN OPTIONAL `string`. `hasActiveSearchQuery` decides that a query
 * is active by finding a non-blank string value and ignores values of any other type, so a filter
 * declared as `string[]`, `Set`, `number` or `boolean` would read as "no search" no matter what the
 * user typed — silently putting the whole workbench back into browse mode. Model a multi-value
 * filter as a delimited string, or extend the predicate first.
 */
export interface WorkbenchSearchQuery extends SearchQuery {
  /** A {@link GameRules.capabilities} id (`surf`, `strength`, …); matches everything that supplies it. */
  capability?: string;
  /** A progression node id; narrows every match to what that one route places there. */
  nodeId?: string;
}

/** A wild encounter method carried by the pack (walk, surf, the rods, …). */
export type EncounterMethod = EncounterArea['methods'][number]['method'];
/** A non-wild way to obtain a species (starter, gift, trade, fossil, …). */
export type AcquisitionMethod = Extract<AcquisitionRecord['subject'], { pokemonId: number }>['kind'];
/** How a species is obtained at one node. */
export type WorkbenchMethod = EncounterMethod | AcquisitionMethod;

/** One species' presence at one progression node, merged across every slot that hosts it. */
export interface WorkbenchPlacement {
  nodeId: string;
  /** Every way the species is obtained here, ordered for stable rendering. */
  methods: readonly WorkbenchMethod[];
  /** Null when nothing at this node states a level (a gift or trade arrives fixed). */
  minLevel: number | null;
  maxLevel: number | null;
}

/** A pack search result placed on the progression graph and scored against the typed name. */
export interface WorkbenchMatch extends SearchResult {
  /** True only when a name filter matched the whole name or slug, not merely a substring. */
  exactMatch: boolean;
  /** Chronological (golden-path) placements; empty when the pack cannot locate the species. */
  placements: readonly WorkbenchPlacement[];
}

interface PlacementDraft {
  methods: Set<WorkbenchMethod>;
  minLevel: number | null;
  maxLevel: number | null;
}

/**
 * Index every species onto the progression nodes that host it. Wild slots supply the method and the
 * level band (repeated slots for one node and method widen the same band rather than multiplying
 * rows); non-wild acquisitions add the node their rules or progression events anchor them to.
 * Encounter areas whose node is absent from the progression graph (the Sevii chambers, the roaming
 * and event distributions) have no place on the spine and are skipped.
 */
function placementsByPokemon(pack: FireRedPack, rules: GameRules): Map<number, WorkbenchPlacement[]> {
  const orderByNodeId = new Map(pack.progression.nodes.map((node) => [node.id, node.goldenPathOrder]));
  const drafts = new Map<number, Map<string, PlacementDraft>>();
  const draftAt = (pokemonId: number, nodeId: string): PlacementDraft => {
    const byNode = drafts.get(pokemonId) ?? new Map<string, PlacementDraft>();
    drafts.set(pokemonId, byNode);
    const draft = byNode.get(nodeId) ?? { methods: new Set<WorkbenchMethod>(), minLevel: null, maxLevel: null };
    byNode.set(nodeId, draft);
    return draft;
  };

  for (const area of pack.encounters) {
    if (area.nodeId === null || !orderByNodeId.has(area.nodeId)) continue;
    for (const method of area.methods) {
      for (const slot of method.slots) {
        const draft = draftAt(slot.pokemonId, area.nodeId);
        draft.methods.add(method.method);
        draft.minLevel = draft.minLevel === null ? slot.minLevel : Math.min(draft.minLevel, slot.minLevel);
        draft.maxLevel = draft.maxLevel === null ? slot.maxLevel : Math.max(draft.maxLevel, slot.maxLevel);
      }
    }
  }

  for (const record of pack.acquisitions) {
    if (!('pokemonId' in record.subject)) continue;
    const nodeId = acquisitionNodeId(record, pack.progression, rules);
    if (nodeId === null || !orderByNodeId.has(nodeId)) continue;
    draftAt(record.subject.pokemonId, nodeId).methods.add(record.subject.kind);
  }

  const placements = new Map<number, WorkbenchPlacement[]>();
  for (const [pokemonId, byNode] of drafts) {
    placements.set(pokemonId, [...byNode.entries()]
      .sort(([left], [right]) => (orderByNodeId.get(left) ?? 0) - (orderByNodeId.get(right) ?? 0))
      .map(([nodeId, draft]) => ({
        nodeId,
        methods: [...draft.methods].sort(),
        minLevel: draft.minLevel,
        maxLevel: draft.maxLevel,
      })));
  }
  return placements;
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

/** Every golden-path node inside one band, in walking order. */
function bandNodes(band: MilestoneBand, pack: FireRedPack): ProgressionNode[] {
  return pack.progression.nodes
    .filter((node) => node.goldenPathOrder >= band.startOrder && node.goldenPathOrder <= band.endOrder)
    .sort((left, right) => left.goldenPathOrder - right.goldenPathOrder);
}

/** Every species with a FireRed-valid way of learning one move, judged by the pack search's rule. */
function versionValidLearners(pack: FireRedPack, moveId: number): Set<number> {
  const statusById = new Map(pack.acquisitions.map((record) => [record.id, record.status]));
  return new Set(pack.learnsets
    .filter((record) => isMoveVersionValid(record.moves.filter((move) => move.moveId === moveId), statusById))
    .map((record) => record.pokemonId));
}

/**
 * The pack's answer to "can this species learn this move", with its uncertainty kept intact: `true`
 * where the species itself has a FireRed-valid method, `null` where only something it evolves into
 * does — that is a real path to the capability, but one the plan has to grow into — and `false`
 * where the pack knows of none. {@link evaluateCapability} turns the null into `conditional`.
 */
export function packLearnability(pack: FireRedPack): (speciesId: number, moveId: number) => boolean | null {
  const evolutionsFrom = new Map<number, number[]>();
  for (const edge of pack.evolutions) {
    if (edge.status === 'unavailable') continue;
    const targets = evolutionsFrom.get(edge.fromPokemonId) ?? [];
    targets.push(edge.toPokemonId);
    evolutionsFrom.set(edge.fromPokemonId, targets);
  }
  const learnersByMove = new Map<number, Set<number>>();

  return (speciesId, moveId) => {
    let learners = learnersByMove.get(moveId);
    if (learners === undefined) {
      learners = versionValidLearners(pack, moveId);
      learnersByMove.set(moveId, learners);
    }
    if (learners.has(speciesId)) return true;
    const seen = new Set([speciesId]);
    const pending = [speciesId];
    while (pending.length > 0) {
      for (const next of evolutionsFrom.get(pending.pop()!) ?? []) {
        if (seen.has(next)) continue;
        if (learners.has(next)) return null;
        seen.add(next);
        pending.push(next);
      }
    }
    return false;
  };
}

/** Every species with any path at all to a capability: the same set its search filter admits. */
function capabilitySpeciesIds(
  capabilityId: string,
  pack: FireRedPack,
  rules: GameRules,
): Set<number> {
  const capability = rules.capabilities.get(capabilityId);
  if (capability === undefined) return new Set();
  const learnability = packLearnability(pack);
  return new Set(pack.pokemon
    .filter((record) => learnability(record.id, capability.moveId) !== false)
    .map((record) => record.id));
}

/**
 * Run a workbench query over the pack and place each hit on the progression graph. The filtering
 * itself is delegated whole to {@link searchFireRed} — this adds only what the workbench needs on
 * top of it: where each species can be obtained, whether a typed name matched exactly, and the two
 * workbench-only filters the pack search knows nothing about. A capability filter admits every
 * species with any path to that field move; a node filter narrows each match to that one route, and
 * drops matches placed nowhere on it. Pure: the pack is read, never mutated, and nothing is cut.
 */
export function searchWorkbench(
  query: WorkbenchSearchQuery,
  pack: FireRedPack,
  rules: GameRules,
): WorkbenchMatch[] {
  const placements = placementsByPokemon(pack, rules);
  const needle = query.name?.trim().toLowerCase() ?? '';
  // A blank filter is no filter, the same reading `hasActiveSearchQuery` gives an empty query.
  const capabilityId = query.capability?.trim() ?? '';
  const nodeId = query.nodeId?.trim() ?? '';
  const capable = capabilityId === '' ? null : capabilitySpeciesIds(capabilityId, pack, rules);
  return searchFireRed(query, pack)
    .filter((result) => capable === null || capable.has(result.pokemonId))
    .map((result) => ({
      ...result,
      exactMatch: result.name.toLowerCase() === needle || result.slug === needle,
      placements: (placements.get(result.pokemonId) ?? [])
        .filter((placement) => nodeId === '' || placement.nodeId === nodeId),
    }))
    .filter((match) => nodeId === '' || match.placements.length > 0);
}

/** What a briefing token names: a field capability, a machine, or a place on the spine. */
export type BriefingTokenKind = 'capability' | 'tm' | 'hm' | 'location';

/**
 * One interactive term in a milestone briefing. Every token is a search the workbench can actually
 * run — a term with nothing to look up is not shown at all — and its id is the slug of its own
 * label, so the domain reference it points at lives only in {@link BriefingToken.searchQuery}.
 */
export interface BriefingToken {
  id: string;
  label: string;
  kind: BriefingTokenKind;
  /**
   * True when this same term stands in BOTH halves of its own briefing: the leg's content wants it,
   * and finishing the leg is what grants it. Koga is the FireRed case — Fuchsia's water wants Surf,
   * and the Soul Badge is what makes Surf usable. Both facts are true, but two bare rows reading
   * `REQUIRES SURF` / `UNLOCKS SURF` render as a contradiction, so the relation is stated here for
   * the header to render coherently rather than left to be re-derived by set arithmetic.
   */
  inBothHalves: boolean;
  searchQuery: WorkbenchSearchQuery;
}

/** A token before the briefing knows whether its term also stands in the other half. */
type UnplacedToken = Omit<BriefingToken, 'inBothHalves'>;

/** What one planning milestone asks of a run, and what it hands back. */
export interface MilestoneBriefing {
  /**
   * The field capabilities this leg's ENCOUNTERS use — not everything that gates the leg. It is read
   * from the encounter methods at the leg's nodes, and the pack's method vocabulary (`walk`, `surf`,
   * the rods, `rock-smash`, `pokeflute`, the gift kinds, `only-one`, `event`) names exactly two
   * capabilities. `cut`, `fly`, `strength`, `flash` and `waterfall` gate *traversal*, which the pack
   * records nowhere — 6 unlocks, 5 conditions and 23 prerequisite events across 74 nodes — so they
   * can never appear here however gated the leg really is. Read this as "what the water and the
   * rubble on this leg want", never as a complete list of what the leg needs.
   */
  requires: readonly BriefingToken[];
  unlocks: readonly BriefingToken[];
}

export interface MilestoneBriefingContext {
  pack: FireRedPack;
  rules: GameRules;
}

function tokenId(label: string): string {
  return label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function capabilityToken(capability: CapabilityRule, pack: FireRedPack): UnplacedToken | null {
  const move = pack.moves.find((record) => record.id === capability.moveId);
  if (move === undefined) return null;
  return { id: tokenId(move.name), label: move.name, kind: 'capability', searchQuery: { capability: capability.id } };
}

function locationToken(node: ProgressionNode): UnplacedToken {
  return { id: tokenId(node.name), label: node.name, kind: 'location', searchQuery: { nodeId: node.id } };
}

/** A `tm39` / `hm03` unlock reference resolved against the acquisition the pack records for it. */
function machineToken(unlock: ProgressionUnlock, pack: FireRedPack): UnplacedToken | null {
  if (unlock.kind !== 'tm' && unlock.kind !== 'hm') return null;
  const reference = /^(?:tm|hm)0*(\d+)$/.exec(unlock.refId);
  if (reference === null) return null;
  const record = pack.acquisitions.find((candidate) => candidate.subject.kind === unlock.kind
    && 'machineNumber' in candidate.subject && candidate.subject.machineNumber === Number(reference[1]));
  const subject = record?.subject;
  if (record === undefined || subject === undefined || !('moveId' in subject)) return null;
  const move = pack.moves.find((candidate) => candidate.id === subject.moveId);
  if (move === undefined) return null;
  return { id: tokenId(record.name), label: record.name, kind: unlock.kind, searchQuery: { move: move.slug } };
}

/** Drop the terms the workbench has nothing to look up: a token is always a runnable search. */
function searchableTokens(tokens: readonly (UnplacedToken | null)[]): UnplacedToken[] {
  return tokens.filter((token): token is UnplacedToken => token !== null);
}

/**
 * Read one milestone's briefing off the progression graph. Nothing here is tabulated by hand: a
 * requirement is a field capability standing over the leg that ends at this milestone (an encounter
 * method the ruleset also names as a capability), and an unlock is the capability the ruleset gates
 * on this milestone, whatever machine its own progression event grants, and the golden-path leg that
 * completing it opens next — which is exactly the band the workbench stops calling locked.
 *
 * A term can legitimately land in both halves, so the two lists are computed first and the overlap
 * is stamped onto each token afterwards; see {@link BriefingToken.inBothHalves}.
 */
export function selectMilestoneBriefing(
  milestoneId: string,
  context: MilestoneBriefingContext,
): MilestoneBriefing {
  const { pack, rules } = context;
  const bands = milestoneBands(rules.milestones, pack);
  const index = bands.findIndex((band) => band.milestoneId === milestoneId);
  if (index === -1) return { requires: [], unlocks: [] };

  const legNodeIds = new Set(bandNodes(bands[index], pack).map((node) => node.id));
  const legMethods = new Set<string>();
  for (const area of pack.encounters) {
    if (area.nodeId === null || !legNodeIds.has(area.nodeId)) continue;
    for (const method of area.methods) legMethods.add(method.method);
  }
  const capabilities = [...rules.capabilities.values()];
  const required = searchableTokens(capabilities
    .filter((capability) => legMethods.has(capability.id))
    .map((capability) => capabilityToken(capability, pack)));

  const event = pack.progression.nodes
    .flatMap((node) => node.events)
    .find((candidate) => candidate.id === milestoneId);
  const nextBand = bands[index + 1];
  const unlocked = searchableTokens([
    ...capabilities
      .filter((capability) => capability.availableAtMilestoneId === milestoneId)
      .map((capability) => capabilityToken(capability, pack)),
    ...(event?.unlocks ?? []).map((unlock) => machineToken(unlock, pack)),
    ...(nextBand === undefined ? [] : bandNodes(nextBand, pack)
      .filter((node) => (node.branch ?? 'main') === 'main')
      .map(locationToken)),
  ]);

  const shared = new Set(required.map((token) => token.id)
    .filter((id) => unlocked.some((token) => token.id === id)));
  const place = (tokens: readonly UnplacedToken[]): BriefingToken[] => tokens
    .map((token) => ({ ...token, inBothHalves: shared.has(token.id) }));

  return { requires: place(required), unlocks: place(unlocked) };
}

/** Aggregate capability evidence for the collapsed reserve box. */
export interface ReserveCapabilitySummary {
  counts: Readonly<Record<CapabilityState, number>>;
  /** Reserve members with any path to the capability, in reserve order. */
  memberIds: readonly string[];
}

/** One capability searched across everything the workbench can show it on. */
export interface CapabilitySearchResult {
  capabilityId: string;
  /** Keyed by member id. */
  party: Readonly<Record<string, CapabilityHighlight>>;
  /** Keyed by member id. */
  reserve: Readonly<Record<string, CapabilityHighlight>>;
  reserveSummary: ReserveCapabilitySummary;
  /** Keyed by species id; only species with a path to the capability appear. */
  candidates: Readonly<Record<number, CapabilityHighlight>>;
}

/** A fresh tally every time: one shared object would let any caller's mutation poison the rest. */
const emptyStateCounts = (): Record<CapabilityState, number> => ({
  knows: 0, 'can-now': 0, conditional: 0, none: 0,
});

/**
 * Where a run stands at one progression node: every progression event strictly before it on the
 * golden path has happened, and nothing at or after it has. A *planning* milestone answers to its
 * band instead of to its node, because the pack anchors an event where it is fought rather than
 * where it is walked past — Giovanni's gym stands in Viridian City, the second node on the spine,
 * and would otherwise hand out the Earth Badge before the first gym. Badges and the planning target
 * both follow from the bands too: the target is the first band the run has not yet walked past.
 * Reading the target off `completedMilestoneIds` instead would never leave the first milestone,
 * because that set holds progression EVENT ids and FireRed's `starter` milestone is the event
 * `starter-selection` — an id that can never enter it.
 */
export function progressionContextAtNode(
  nodeId: string,
  pack: FireRedPack,
  rules: GameRules,
): ProgressionContext {
  const currentOrder = pack.progression.nodes.find((node) => node.id === nodeId)?.goldenPathOrder ?? -1;
  const bands = milestoneBands(rules.milestones, pack);
  const completedMilestoneIds = new Set<string>();
  for (const node of pack.progression.nodes) {
    if (node.goldenPathOrder >= currentOrder) continue;
    for (const event of node.events) completedMilestoneIds.add(event.id);
  }
  for (const band of bands) {
    if (currentOrder <= band.endOrder) completedMilestoneIds.delete(band.milestoneId);
  }
  const badgeIds = new Set(rules.milestones
    .filter((milestone) => milestone.badgeId !== null && completedMilestoneIds.has(milestone.id))
    .map((milestone) => milestone.badgeId!));
  const target = bands.find((band) => currentOrder <= band.endOrder) ?? bands.at(-1);
  return {
    currentNodeId: nodeId,
    targetMilestoneId: target?.milestoneId ?? '',
    completedMilestoneIds,
    badgeIds,
    badgeCount: badgeIds.size,
    branchChoices: {},
  };
}

/** Every canonical way the pack teaches a capability's move, timed against where the run stands. */
export function capabilitySources(
  capability: CapabilityRule,
  nodeId: string,
  pack: FireRedPack,
  rules: GameRules,
): CapabilitySource[] {
  return pack.acquisitions
    .filter((record) => 'moveId' in record.subject && record.subject.moveId === capability.moveId)
    .map((record) => ({
      id: record.id,
      available: evaluateAcquisitionAtNode(record, nodeId, pack.progression, rules).available,
    }));
}

/** A species with no plan behind it: the shape a search candidate enters the evaluator as. */
function candidateSnapshot(speciesId: number): MemberSnapshot {
  return {
    speciesId,
    level: 1,
    abilityId: 0,
    moves: [],
    heldItemId: null,
    placement: 'reserve',
    partySlot: null,
    review: { moves: false, heldItem: false },
  };
}

/**
 * Search one field capability across the party, the reserve and every species that could supply it.
 * All three read the same {@link evaluateCapability} verdict through {@link highlightCapability};
 * they differ only in the snapshot handed to it, so no surface can drift from another. Advisory
 * only: a `none` verdict blocks nothing, it just has nothing to show.
 */
export function searchCapability(
  capabilityId: string,
  node: ResolvedTimelineNode,
  pack: FireRedPack,
  rules: GameRules,
): CapabilitySearchResult {
  const capability = rules.capabilities.get(capabilityId);
  if (capability === undefined) {
    return {
      capabilityId,
      party: {},
      reserve: {},
      reserveSummary: { counts: emptyStateCounts(), memberIds: [] },
      candidates: {},
    };
  }

  const context = {
    capability,
    progressionContext: progressionContextAtNode(node.nodeId, pack, rules),
    canLearnMove: packLearnability(pack),
    sources: capabilitySources(capability, node.nodeId, pack, rules),
  };
  const membersIn = (memberIds: readonly (string | null)[]): Record<string, CapabilityHighlight> => {
    const highlights: Record<string, CapabilityHighlight> = {};
    for (const memberId of memberIds) {
      const snapshot = memberId === null ? undefined : node.snapshots[memberId];
      if (memberId === null || snapshot === undefined) continue;
      highlights[memberId] = highlightCapability(snapshot, memberId, context);
    }
    return highlights;
  };

  const reserve = membersIn(node.reserve);
  const counts = emptyStateCounts();
  for (const highlight of Object.values(reserve)) counts[highlight.state] += 1;

  // A candidate is a species with no plan behind it. Anything already on the team has one, and its
  // own snapshot is the truth about it, so it is answered for as a member and never again as a bare
  // species — otherwise one Pokémon would carry two states at once.
  const party = membersIn(node.party);
  const teamSpeciesIds = new Set([...Object.values(party), ...Object.values(reserve)]
    .map((highlight) => highlight.speciesId));
  const candidates: Record<number, CapabilityHighlight> = {};
  for (const record of pack.pokemon) {
    if (teamSpeciesIds.has(record.id)) continue;
    const highlight = highlightCapability(candidateSnapshot(record.id), null, context);
    if (highlight.state !== 'none') candidates[record.id] = highlight;
  }

  return {
    capabilityId,
    party,
    reserve,
    reserveSummary: {
      counts,
      // `reserve` is keyed in reserve order and already holds only members with a snapshot.
      memberIds: Object.keys(reserve).filter((memberId) => reserve[memberId].state !== 'none'),
    },
    candidates,
  };
}
