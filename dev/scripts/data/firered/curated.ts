import { z } from 'zod';
import {
  validateRouteProgression,
  type ProgressionNode,
  type RouteProgression,
} from '../../../src/domain/progression';
import progressionInput from '../../../data/firered/progression.json';
import sourcesInput from '../../../data/firered/sources.json';

/**
 * The canonical set of FireRed (version 10) encounter-bearing PokeAPI location-area IDs,
 * derived from the pinned `pokeapi-api-data` snapshot (revision 0fb5313c…) via
 * `compileFireRedEncounters`. Kept as a static constant so the curated overlay can be
 * validated without a runtime PokeAPI dependency.
 */
export const FIRERED_ENCOUNTER_AREA_IDS: readonly number[] = Object.freeze([
  258, 259, 260, 261, 262, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 290, 292, 293,
  295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312,
  313, 314, 315, 317, 321, 323, 324, 325, 326, 327, 329, 330, 331, 332, 333, 336, 337, 338,
  339, 340, 341, 342, 343, 344, 345, 346, 347, 348, 450, 451, 452, 453, 454, 455, 456, 461,
  488, 489, 490, 491, 492, 493, 494, 495, 496, 497, 498, 499, 500, 501, 502, 503, 504, 505,
  506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523,
  524, 525, 526, 527, 528, 561, 562, 563, 564, 565, 566, 567, 568, 569, 570, 571, 572, 761,
  762, 763, 764, 794, 806, 807, 825, 832, 833, 1212, 1300,
]);

export type AreaExceptionDisposition = 'event-only' | 'unsupported-area';

export interface AreaException {
  disposition: AreaExceptionDisposition;
  rationale: string;
  sourceId: string;
}

/**
 * Encounter-bearing areas that intentionally do NOT belong to a golden-path node.
 * These are distribution/event-only areas: catching anything there depends on a
 * real-world event ticket or a region-locked distribution that never occurs in
 * ordinary play, so they must not enter the chronology.
 */
export const FIRERED_AREA_EXCEPTIONS: ReadonlyMap<number, AreaException> = new Map([
  [794, { disposition: 'event-only', rationale: 'Roaming Kanto is the synthetic roaming table for the Legendary beasts; it is not a walkable location and its trio is starter-dependent event content.', sourceId: 'pokeapi-api-data' }],
  [806, { disposition: 'event-only', rationale: 'Birth Island (Deoxys) is reachable only with the event-distributed Aurora Ticket, never available in ordinary play.', sourceId: 'pokeapi-api-data' }],
  [807, { disposition: 'event-only', rationale: 'Navel Rock (Ho-Oh and Lugia) is reachable only with the event-distributed MysticTicket, never available in ordinary play.', sourceId: 'pokeapi-api-data' }],
  [1212, { disposition: 'event-only', rationale: 'The Kanto Pokémon Center distribution table is a region-locked bonus-disc event slot with no in-game overworld access.', sourceId: 'pokeapi-api-data' }],
]);

export interface SourceRegistryEntry {
  id: string;
  name: string;
  url: string;
  revision: string;
  accessedOn: string;
  license: string | null;
}

export interface SourceRegistry {
  schemaVersion: number;
  sources: SourceRegistryEntry[];
}

const sourceRegistrySchema = z.object({
  schemaVersion: z.number().int().min(1),
  sources: z.array(z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1),
    url: z.string().url().startsWith('https://'),
    revision: z.string().trim().min(1),
    accessedOn: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
    license: z.string().trim().min(1).nullable(),
  }).strict()).min(1),
}).strict();

/** Load and validate the shared FireRed research-source registry (`sources.json`). */
export function loadFireRedSources(): SourceRegistry {
  return sourceRegistrySchema.parse(sourcesInput);
}

/**
 * Load `progression.json`, run it through the shared `validateRouteProgression` contract,
 * and fail loudly on any provisional (unverified) provenance on a shipped node or event.
 */
export function loadFireRedProgression(): RouteProgression {
  const result = validateRouteProgression(progressionInput);
  if (!result.valid) {
    throw new Error(`Invalid FireRed progression:\n${result.errors.join('\n')}`);
  }
  const progression = progressionInput as RouteProgression;

  for (const node of progression.nodes) {
    assertProvenance(`node "${node.id}"`, node.provenance);
    for (const event of node.events) {
      assertProvenance(`event "${event.id}"`, event.provenance);
    }
  }
  // Cross-node area integrity: no encounter area may be claimed by two nodes.
  buildAreaIndex(progression.nodes);
  return progression;
}

function assertProvenance(label: string, provenance: RouteProgression['nodes'][number]['provenance']): void {
  if (provenance.length === 0) {
    throw new Error(`${label} has no provenance`);
  }
  for (const entry of provenance) {
    if (entry.confidence === 'provisional') {
      throw new Error(`${label} carries provisional provenance for source "${entry.sourceId}"; shipped facts must be verified or cross-checked`);
    }
  }
}

function buildAreaIndex(nodes: readonly ProgressionNode[]): Map<number, string> {
  const nodeByAreaId = new Map<number, string>();
  for (const node of nodes) {
    for (const areaId of node.location.pokeApiLocationAreaIds) {
      const owner = nodeByAreaId.get(areaId);
      if (owner !== undefined) {
        throw new Error(`Encounter area ${areaId} is claimed by both "${owner}" and "${node.id}"`);
      }
      nodeByAreaId.set(areaId, node.id);
    }
  }
  return nodeByAreaId;
}

export interface AreaToNodeMapping {
  nodeByAreaId: Map<number, string>;
  exceptions: Map<number, AreaException>;
}

/**
 * Map every supplied encounter-area ID to exactly one progression node, or to an explicit
 * event-only / unsupported-area exception. Throws on duplicate input IDs, on an area claimed
 * by more than one node, and on any area lacking a disposition.
 */
export function mapEncounterAreasToNodes(
  progression: RouteProgression,
  encounterAreaIds: readonly number[],
): AreaToNodeMapping {
  const owners = buildAreaIndex(progression.nodes);
  const nodeByAreaId = new Map<number, string>();
  const exceptions = new Map<number, AreaException>();
  const seen = new Set<number>();

  for (const areaId of encounterAreaIds) {
    if (seen.has(areaId)) {
      throw new Error(`Duplicate encounter area ID in input: ${areaId}`);
    }
    seen.add(areaId);

    const owner = owners.get(areaId);
    if (owner !== undefined) {
      nodeByAreaId.set(areaId, owner);
      continue;
    }
    const exception = FIRERED_AREA_EXCEPTIONS.get(areaId);
    if (exception !== undefined) {
      exceptions.set(areaId, exception);
      continue;
    }
    throw new Error(`Unmapped encounter area ID with no node or declared exception: ${areaId}`);
  }

  return { nodeByAreaId, exceptions };
}
