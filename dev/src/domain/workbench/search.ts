import type { FireRedPack } from '../../data/game-pack';
import { acquisitionNodeId } from '../availability';
import type { AcquisitionRecord, EncounterArea } from '../pack';
import type { GameRules } from '../rules/game-rules';
import { searchFireRed, type SearchQuery, type SearchResult } from '../search';

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
export interface WorkbenchSearchQuery extends SearchQuery {}

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
 * Run a workbench query over the pack and place each hit on the progression graph. The filtering
 * itself is delegated whole to {@link searchFireRed} — this adds only what the workbench needs on
 * top of it: where each species can be obtained, and whether a typed name matched exactly. Pure:
 * the pack is read, never mutated, and nothing is truncated.
 */
export function searchWorkbench(
  query: WorkbenchSearchQuery,
  pack: FireRedPack,
  rules: GameRules,
): WorkbenchMatch[] {
  const placements = placementsByPokemon(pack, rules);
  const needle = query.name?.trim().toLowerCase() ?? '';
  return searchFireRed(query, pack).map((result) => ({
    ...result,
    exactMatch: result.name.toLowerCase() === needle || result.slug === needle,
    placements: placements.get(result.pokemonId) ?? [],
  }));
}
