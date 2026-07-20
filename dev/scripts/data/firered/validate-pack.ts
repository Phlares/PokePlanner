import {
  parseAcquisitionRecords,
  parseEncounterAreas,
  parseEvolutionEdges,
  parseFireRedIndexes,
  parseLearnsetRecords,
  parseMoveRecords,
  parsePokemonRecords,
  parseTypeChart,
  type AcquisitionRecord,
  type EncounterArea,
  type EvolutionEdge,
  type FireRedIndexes,
  type LearnsetRecord,
  type MoveRecord,
  type PokemonRecord,
  type TypeChart,
} from '../../../src/domain/pack';
import type { RouteProgression } from '../../../src/domain/progression';
import { mapEncounterAreasToNodes } from './curated';
import { classifyFireRedAvailability, type FireRedPackInputs } from './indexes';

/** The immutable FireRed scope this pack must satisfy exactly. */
export const FIRERED_SCOPE = Object.freeze({ pokemonCount: 386, moveCount: 354, typeCount: 17 });
/** The FireRed game identity keys; version, version-group, and generation are never interchangeable. */
export const FIRERED_IDENTITY = Object.freeze({ versionId: 10, versionGroupId: 7, generationId: 3 });
/** PokeAPI IDs of the 18 Orre-only Shadow moves that must never enter FireRed data. */
export const EXCLUDED_SHADOW_MOVE_IDS: readonly number[] = Object.freeze(
  Array.from({ length: 18 }, (_, index) => 10001 + index),
);

export interface FireRedPackData {
  identity: { versionId: number; versionGroupId: number; generationId: number };
  pokemon: PokemonRecord[];
  moves: MoveRecord[];
  learnsets: LearnsetRecord[];
  encounters: EncounterArea[];
  progression: RouteProgression;
  acquisitions: AcquisitionRecord[];
  evolutions: EvolutionEdge[];
  typeChart: TypeChart;
  indexes: FireRedIndexes;
}

function toInputs(data: FireRedPackData): FireRedPackInputs {
  const { pokemon, moves, learnsets, encounters, evolutions, acquisitions, progression } = data;
  return { pokemon, moves, learnsets, encounters, evolutions, acquisitions, progression };
}

/** Count the Generation III types in a type chart, excluding the trailing `provenance` key. */
export function typeCount(typeChart: TypeChart): number {
  return Object.keys(typeChart).filter((key) => key !== 'provenance').length;
}

function assertUniqueSlugs(errors: string[], label: string, records: { slug: string }[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.slug)) errors.push(`Duplicate ${label} slug "${record.slug}"`);
    seen.add(record.slug);
  }
}

interface ProvenanceEntry { confidence: string }
function assertProvenance(errors: string[], label: string, provenance: ProvenanceEntry[] | undefined): void {
  if (provenance === undefined || provenance.length === 0) {
    errors.push(`${label} is missing provenance`);
    return;
  }
  for (const entry of provenance) {
    if (entry.confidence === 'provisional') {
      errors.push(`${label} carries a provisional fact; shipped facts must be verified or cross-checked`);
    }
  }
}

/**
 * Cross-file validation of a fully compiled FireRed pack. Throws a single error whose
 * message enumerates every violation found. Enforces exact scope (386/354/17), the
 * FireRed identity, exclusion of the Orre-only Shadow moves, unique slugs, present and
 * non-provisional provenance, referential integrity across every asset, per-milestone
 * availability consistency, complete encounter-area mapping, and complete species
 * classification.
 */
export function validateFireRedPack(data: FireRedPackData): void {
  const errors: string[] = [];
  const guard = (label: string, run: () => void): void => {
    try {
      run();
    } catch (error) {
      errors.push(`${label}: ${(error as Error).message}`);
    }
  };

  // Schema conformance for every emitted asset.
  guard('pokemon schema', () => parsePokemonRecords(data.pokemon));
  guard('moves schema', () => parseMoveRecords(data.moves));
  guard('learnsets schema', () => parseLearnsetRecords(data.learnsets));
  guard('encounters schema', () => parseEncounterAreas(data.encounters));
  guard('acquisitions schema', () => parseAcquisitionRecords(data.acquisitions));
  guard('evolutions schema', () => parseEvolutionEdges(data.evolutions));
  guard('type-chart schema', () => parseTypeChart(data.typeChart));
  guard('indexes schema', () => parseFireRedIndexes(data.indexes));

  // Identity.
  if (
    data.identity.versionId !== FIRERED_IDENTITY.versionId
    || data.identity.versionGroupId !== FIRERED_IDENTITY.versionGroupId
    || data.identity.generationId !== FIRERED_IDENTITY.generationId
  ) {
    errors.push(`Identity mismatch: expected FireRed version 10 / group 7 / generation 3, received ${JSON.stringify(data.identity)}`);
  }

  // Exact scope.
  if (data.pokemon.length !== FIRERED_SCOPE.pokemonCount) errors.push(`Expected 386 species, found ${data.pokemon.length}`);
  if (data.moves.length !== FIRERED_SCOPE.moveCount) errors.push(`Expected 354 FireRed-compatible moves, found ${data.moves.length}`);
  const types = typeCount(data.typeChart);
  if (types !== FIRERED_SCOPE.typeCount) errors.push(`Expected 17 types, found ${types}`);

  // Orre-only Shadow moves excluded.
  const shadow = data.moves.filter((move) => EXCLUDED_SHADOW_MOVE_IDS.includes(move.id));
  if (shadow.length > 0) {
    errors.push(`Excluded Orre-only Shadow move present: ${shadow.map((move) => move.id).join(', ')}`);
  }

  // Unique slugs.
  assertUniqueSlugs(errors, 'species', data.pokemon);
  assertUniqueSlugs(errors, 'move', data.moves);

  // Provenance present and never provisional.
  for (const record of data.pokemon) assertProvenance(errors, `species ${record.id}`, record.provenance);
  for (const record of data.moves) assertProvenance(errors, `move ${record.id}`, record.provenance);
  for (const record of data.learnsets) assertProvenance(errors, `learnset ${record.pokemonId}`, record.provenance);
  for (const area of data.encounters) assertProvenance(errors, `encounter area ${area.locationAreaId}`, area.provenance);
  for (const record of data.acquisitions) assertProvenance(errors, `acquisition ${record.id}`, record.provenance);
  for (const edge of data.evolutions) assertProvenance(errors, `evolution ${edge.fromPokemonId}->${edge.toPokemonId}`, edge.provenance);
  assertProvenance(errors, 'type chart', data.typeChart.provenance);
  assertProvenance(errors, 'indexes', data.indexes.provenance);
  for (const node of data.progression.nodes) {
    assertProvenance(errors, `progression node ${node.id}`, node.provenance);
    for (const event of node.events) assertProvenance(errors, `progression event ${event.id}`, event.provenance);
  }

  // Referential integrity across files.
  const pokemonIds = new Set(data.pokemon.map((record) => record.id));
  const moveIds = new Set(data.moves.map((record) => record.id));
  const acquisitionIds = new Set(data.acquisitions.map((record) => record.id));

  for (const learnset of data.learnsets) {
    if (!pokemonIds.has(learnset.pokemonId)) errors.push(`Learnset references unknown species ${learnset.pokemonId}`);
    for (const move of learnset.moves) {
      if (!moveIds.has(move.moveId)) errors.push(`Learnset ${learnset.pokemonId} references unknown move ${move.moveId}`);
      if (move.method === 'machine' || move.method === 'tutor') {
        for (const id of move.acquisitionIds) {
          if (!acquisitionIds.has(id)) errors.push(`Learnset ${learnset.pokemonId} references unknown acquisition "${id}"`);
        }
      }
    }
  }
  for (const area of data.encounters) {
    for (const method of area.methods) {
      for (const slot of method.slots) {
        if (!pokemonIds.has(slot.pokemonId)) errors.push(`Encounter area ${area.locationAreaId} references unknown species ${slot.pokemonId}`);
      }
    }
  }
  for (const record of data.acquisitions) {
    const subject = record.subject;
    if ('pokemonId' in subject && !pokemonIds.has(subject.pokemonId)) errors.push(`Acquisition "${record.id}" references unknown species ${subject.pokemonId}`);
    if ('moveId' in subject && !moveIds.has(subject.moveId)) errors.push(`Acquisition "${record.id}" references unknown move ${subject.moveId}`);
  }
  for (const edge of data.evolutions) {
    if (!pokemonIds.has(edge.fromPokemonId)) errors.push(`Evolution references unknown source species ${edge.fromPokemonId}`);
    if (!pokemonIds.has(edge.toPokemonId)) errors.push(`Evolution references unknown target species ${edge.toPokemonId}`);
  }
  for (const [slug, ids] of Object.entries(data.indexes.pokemonByMove)) {
    for (const id of ids) if (!pokemonIds.has(id)) errors.push(`Index pokemon-by-move["${slug}"] references unknown species ${id}`);
  }
  for (const [type, ids] of Object.entries(data.indexes.pokemonByType)) {
    for (const id of ids) if (!pokemonIds.has(id)) errors.push(`Index pokemon-by-type["${type}"] references unknown species ${id}`);
  }
  for (const [slug, ids] of Object.entries(data.indexes.pokemonByAbility)) {
    for (const id of ids) if (!pokemonIds.has(id)) errors.push(`Index pokemon-by-ability["${slug}"] references unknown species ${id}`);
  }
  for (const key of Object.keys(data.indexes.routesByPokemon)) {
    if (!pokemonIds.has(Number(key))) errors.push(`Index routes-by-pokemon references unknown species ${key}`);
  }
  for (const node of data.progression.nodes) {
    for (const event of node.events) {
      for (const id of event.acquisitionIds ?? []) {
        if (!acquisitionIds.has(id)) errors.push(`Progression event "${event.id}" references unknown acquisition "${id}"`);
      }
    }
  }

  // Per-milestone availability consistency: buckets are disjoint and moves resolve.
  for (const [milestone, bucket] of Object.entries(data.indexes.availabilityByMilestone)) {
    const lists = [bucket.availableNow, bucket.futureLevel, bucket.futureMilestone, bucket.unavailable];
    for (const list of lists) {
      for (const entry of list) if (!moveIds.has(entry.moveId)) errors.push(`Availability["${milestone}"] references unknown move ${entry.moveId}`);
    }
    const availableNow = new Set(bucket.availableNow.map((entry) => entry.moveId));
    for (const entry of [...bucket.futureLevel, ...bucket.futureMilestone]) {
      if (availableNow.has(entry.moveId)) errors.push(`Availability["${milestone}"] lists future move ${entry.moveId} as available-now`);
    }
    for (const entry of bucket.unavailable) {
      if (availableNow.has(entry.moveId)) errors.push(`Availability["${milestone}"] lists unavailable move ${entry.moveId} as available-now`);
    }
  }

  // Every encounter-bearing area maps to a node or a declared exception.
  guard('encounter mapping', () => {
    mapEncounterAreasToNodes(data.progression, data.encounters.map((area) => area.locationAreaId));
  });

  // Every species carries exactly one availability classification.
  guard('availability classification', () => {
    const classification = classifyFireRedAvailability(toInputs(data));
    for (const record of data.pokemon) {
      if (!classification.has(record.id)) errors.push(`Species ${record.id} has no availability classification`);
    }
  });

  if (errors.length > 0) {
    throw new Error(`FireRed pack validation failed:\n- ${errors.join('\n- ')}`);
  }
}
