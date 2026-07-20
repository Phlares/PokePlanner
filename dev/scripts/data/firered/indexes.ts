import type {
  AcquisitionRecord,
  EncounterArea,
  EvolutionEdge,
  FireRedIndexes,
  LearnsetRecord,
  MoveRecord,
  PokemonRecord,
} from '../../../src/domain/pack';
import type { RouteProgression } from '../../../src/domain/progression';
import { mapEncounterAreasToNodes } from './curated';
import { generatedProvenance } from './pokeapi-endpoint';

export interface FireRedPackInputs {
  pokemon: PokemonRecord[];
  moves: MoveRecord[];
  learnsets: LearnsetRecord[];
  encounters: EncounterArea[];
  evolutions: EvolutionEdge[];
  acquisitions: AcquisitionRecord[];
  progression: RouteProgression;
}

export type SpeciesStatus = 'standard' | 'postgame' | 'version-exclusive' | 'event-only' | 'transfer-only';
export interface SpeciesClassification {
  pokemonId: number;
  status: SpeciesStatus;
  source: string;
}

const TYPE_KEYS = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark',
] as const;

/**
 * Ordered availability milestones for the per-milestone move-availability index.
 * The eight Kanto badge gyms in canonical FireRed order, then the postgame
 * (`champion`) frontier. Ordinal 0 is reserved for "obtainable from the start".
 */
const MILESTONE_ORDER = [
  'brock-gym', 'misty-gym', 'surge-gym', 'erika-gym', 'koga-gym', 'sabrina-gym', 'blaine-gym', 'giovanni-gym', 'champion',
] as const;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function sortedUnique(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function milestoneOrdinal(milestoneId: string | null): number {
  if (milestoneId === null || milestoneId === 'starter-selection') return 0;
  const index = MILESTONE_ORDER.indexOf(milestoneId as (typeof MILESTONE_ORDER)[number]);
  if (index === -1) throw new Error(`Unknown acquisition milestone "${milestoneId}"`);
  return index + 1;
}

function buildIdIndex(pairs: Iterable<[string, number]>): Record<string, number[]> {
  const grouped = new Map<string, Set<number>>();
  for (const [key, id] of pairs) {
    const set = grouped.get(key) ?? new Set<number>();
    set.add(id);
    grouped.set(key, set);
  }
  const result: Record<string, number[]> = {};
  for (const key of [...grouped.keys()].sort()) result[key] = sortedUnique(grouped.get(key)!);
  return result;
}

function firstProvenanceNote(record: AcquisitionRecord): string {
  for (const entry of record.provenance) if (entry.note !== null && entry.note.trim() !== '') return entry.note;
  return `${record.name} is not obtainable in FireRed.`;
}

function buildAvailabilityByMilestone(acquisitions: AcquisitionRecord[]): FireRedIndexes['availabilityByMilestone'] {
  const byMove = new Map<number, AcquisitionRecord[]>();
  for (const record of acquisitions) {
    if (record.subject.kind !== 'tm' && record.subject.kind !== 'hm' && record.subject.kind !== 'tutor') continue;
    const list = byMove.get(record.subject.moveId) ?? [];
    list.push(record);
    byMove.set(record.subject.moveId, list);
  }

  const availability: FireRedIndexes['availabilityByMilestone'] = {};
  for (const milestone of MILESTONE_ORDER) {
    availability[milestone] = { availableNow: [], futureLevel: [], futureMilestone: [], unavailable: [] };
  }

  for (const [moveId, records] of byMove) {
    const obtainable = records.filter((record) => record.status !== 'unavailable');
    if (obtainable.length === 0) {
      const reason = firstProvenanceNote(records[0]);
      for (const milestone of MILESTONE_ORDER) availability[milestone].unavailable.push({ moveId, status: 'unavailable', reason });
      continue;
    }
    const earliestOrdinal = Math.min(...obtainable.map((record) => milestoneOrdinal(record.milestoneId)));
    const earliestSlug = earliestOrdinal === 0 ? null : MILESTONE_ORDER[earliestOrdinal - 1];
    MILESTONE_ORDER.forEach((milestone, index) => {
      const milestoneOrd = index + 1;
      if (earliestOrdinal <= milestoneOrd) {
        availability[milestone].availableNow.push({ moveId, status: 'available-now' });
      } else {
        availability[milestone].futureMilestone.push({ moveId, status: 'future-milestone', milestoneId: earliestSlug! });
      }
    });
  }

  for (const milestone of MILESTONE_ORDER) {
    availability[milestone].availableNow.sort((a, b) => a.moveId - b.moveId);
    availability[milestone].futureMilestone.sort((a, b) => a.moveId - b.moveId);
    availability[milestone].unavailable.sort((a, b) => a.moveId - b.moveId);
  }
  return availability;
}

function closeOverEvolutions(seeds: Iterable<number>, adjacency: Map<number, number[]>): Set<number> {
  const closure = new Set<number>(seeds);
  const pending = [...closure];
  while (pending.length > 0) {
    const from = pending.shift()!;
    for (const to of adjacency.get(from) ?? []) {
      if (!closure.has(to)) {
        closure.add(to);
        pending.push(to);
      }
    }
  }
  return closure;
}

/**
 * Classify every one of the 386 species with exactly one primary availability
 * status. Standard availability is seeded from FireRed wild encounters (excluding
 * the event-only distribution areas) plus the curated standard non-wild
 * acquisitions, then closed over legal evolutions. Postgame, event-only, and
 * version-exclusive tiers are seeded from curated acquisitions and likewise closed
 * over evolutions; anything left over is transfer-only. Precedence:
 * standard > postgame > event-only > version-exclusive > transfer-only.
 */
export function classifyFireRedAvailability(inputs: FireRedPackInputs): Map<number, SpeciesClassification> {
  const { pokemon, encounters, evolutions, acquisitions, progression } = inputs;

  const { nodeByAreaId, exceptions } = mapEncounterAreasToNodes(progression, encounters.map((area) => area.locationAreaId));
  const branchByNodeId = new Map(progression.nodes.map((node) => [node.id, node.branch ?? 'main']));

  const standardWild = new Set<number>();
  const anyWild = new Set<number>();
  for (const area of encounters) {
    if (exceptions.has(area.locationAreaId)) continue;
    const nodeId = nodeByAreaId.get(area.locationAreaId);
    const branch = nodeId === undefined ? 'main' : branchByNodeId.get(nodeId) ?? 'main';
    for (const method of area.methods) {
      for (const slot of method.slots) {
        anyWild.add(slot.pokemonId);
        if (branch !== 'postgame') standardWild.add(slot.pokemonId);
      }
    }
  }
  const postgameWild = new Set([...anyWild].filter((id) => !standardWild.has(id)));

  const standardAcq = new Set<number>();
  const postgameAcq = new Set<number>();
  const eventAcq = new Set<number>();
  const versionAcq = new Set<number>();
  for (const record of acquisitions) {
    if (!('pokemonId' in record.subject)) continue;
    const id = record.subject.pokemonId;
    if (record.status === 'standard') standardAcq.add(id);
    else if (record.status === 'postgame') postgameAcq.add(id);
    else if (record.status === 'event-only') eventAcq.add(id);
    else if (record.status === 'version-exclusive') versionAcq.add(id);
  }

  const adjacency = new Map<number, number[]>();
  for (const edge of evolutions) {
    if (edge.status === 'unavailable') continue;
    const targets = adjacency.get(edge.fromPokemonId) ?? [];
    targets.push(edge.toPokemonId);
    adjacency.set(edge.fromPokemonId, targets);
  }

  const standardSet = closeOverEvolutions([...standardWild, ...standardAcq], adjacency);
  const postgameSet = new Set([...closeOverEvolutions([...postgameWild, ...postgameAcq], adjacency)].filter((id) => !standardSet.has(id)));
  const versionSet = new Set([...closeOverEvolutions([...versionAcq], adjacency)]
    .filter((id) => !standardSet.has(id) && !postgameSet.has(id)));
  const eventSet = new Set([...eventAcq].filter((id) => !standardSet.has(id) && !postgameSet.has(id)));

  const classification = new Map<number, SpeciesClassification>();
  for (const record of pokemon) {
    const id = record.id;
    let status: SpeciesStatus;
    let source: string;
    if (standardSet.has(id)) {
      status = 'standard';
      source = standardWild.has(id) ? 'wild' : standardAcq.has(id) ? 'acquisition' : 'evolution';
    } else if (postgameSet.has(id)) {
      status = 'postgame';
      source = postgameWild.has(id) ? 'wild-postgame' : postgameAcq.has(id) ? 'acquisition' : 'evolution';
    } else if (eventSet.has(id)) {
      status = 'event-only';
      source = 'event';
    } else if (versionSet.has(id)) {
      status = 'version-exclusive';
      source = versionAcq.has(id) ? 'acquisition' : 'evolution';
    } else {
      status = 'transfer-only';
      source = 'transfer';
    }
    classification.set(id, { pokemonId: id, status, source });
  }
  return classification;
}

/**
 * Build the derived FireRed search and availability indexes from validated,
 * already-compiled pack inputs. All arrays are sorted ascending and duplicate-free
 * for deterministic output.
 */
export function buildFireRedIndexes(inputs: FireRedPackInputs): FireRedIndexes {
  const { pokemon, moves, learnsets, encounters, progression } = inputs;

  const moveSlugById = new Map(moves.map((move) => [move.id, move.slug]));

  // pokemonByMove: move slug -> species that can learn it (any method).
  const movePairs: [string, number][] = [];
  for (const learnset of learnsets) {
    const seen = new Set<number>();
    for (const move of learnset.moves) {
      if (seen.has(move.moveId)) continue;
      seen.add(move.moveId);
      const slug = moveSlugById.get(move.moveId);
      if (slug === undefined) throw new Error(`Learnset move ${move.moveId} has no move record`);
      movePairs.push([slug, learnset.pokemonId]);
    }
  }
  const pokemonByMove = buildIdIndex(movePairs);

  // pokemonByType: fixed 17-type object.
  const typeBuckets = new Map<string, Set<number>>(TYPE_KEYS.map((key) => [key, new Set<number>()]));
  const abilityPairs: [string, number][] = [];
  for (const record of pokemon) {
    for (const type of record.types) typeBuckets.get(type)!.add(record.id);
    for (const ability of record.abilities) abilityPairs.push([slugify(ability.name), record.id]);
  }
  const pokemonByType = Object.fromEntries(
    TYPE_KEYS.map((key) => [key, sortedUnique(typeBuckets.get(key)!)]),
  ) as FireRedIndexes['pokemonByType'];
  const pokemonByAbility = buildIdIndex(abilityPairs);

  // routesByPokemon: species -> progression node slugs (excludes event-only areas).
  const { nodeByAreaId, exceptions } = mapEncounterAreasToNodes(progression, encounters.map((area) => area.locationAreaId));
  const routeSets = new Map<number, Set<string>>();
  for (const area of encounters) {
    if (exceptions.has(area.locationAreaId)) continue;
    const nodeId = nodeByAreaId.get(area.locationAreaId);
    if (nodeId === undefined) continue;
    for (const method of area.methods) {
      for (const slot of method.slots) {
        const set = routeSets.get(slot.pokemonId) ?? new Set<string>();
        set.add(nodeId);
        routeSets.set(slot.pokemonId, set);
      }
    }
  }
  const routesByPokemon: Record<string, string[]> = {};
  for (const id of [...routeSets.keys()].sort((a, b) => a - b)) {
    routesByPokemon[String(id)] = [...routeSets.get(id)!].sort();
  }

  const availabilityByMilestone = buildAvailabilityByMilestone(inputs.acquisitions);

  return {
    pokemonByMove,
    pokemonByType,
    pokemonByAbility,
    routesByPokemon,
    availabilityByMilestone,
    provenance: generatedProvenance(
      'derived/firered-indexes',
      'Search indexes and per-milestone availability derived from the pinned FireRed catalogs, encounters, evolutions, and curated acquisitions.',
    ),
  };
}
