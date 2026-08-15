import type { FireRedPack } from '../data/game-pack';
import type { PokemonRecord } from './pack';

export type PokemonType = PokemonRecord['types'][number];

/**
 * A factual, index-backed FireRed search query. Each provided filter is intersected (AND);
 * an empty query returns every species. There is no query language and no fuzzy scoring —
 * name is a plain case-insensitive substring, the rest are exact index lookups.
 */
export interface SearchQuery {
  name?: string;
  type?: PokemonType;
  ability?: string;
  move?: string;
}

/**
 * True when at least one filter has a non-whitespace value. Read structurally rather than from a
 * fixed field list so a query type that extends {@link SearchQuery} (the workbench adds its own
 * filters) is judged on the filters it actually carries.
 */
export function hasActiveSearchQuery(query: SearchQuery): boolean {
  return Object.values(query).some((value) => typeof value === 'string' && value.trim() !== '');
}

export type ObtainabilityStatus =
  | 'standard'
  | 'postgame'
  | 'version-exclusive'
  | 'event-only'
  | 'transfer-only';

export interface Obtainability {
  status: ObtainabilityStatus;
  /** True when the species is not obtainable in ordinary (standard) FireRed play. */
  flagged: boolean;
}

export interface MoveMatch {
  moveSlug: string;
  /** In-game learn methods this species has for the queried move. */
  methods: string[];
  /** True when at least one method is valid in FireRed (excludes transfer / non-existent machines). */
  versionValid: boolean;
}

export interface SearchResult {
  pokemonId: number;
  slug: string;
  name: string;
  types: PokemonType[];
  routes: string[];
  routeCount: number;
  obtainability: Obtainability;
  moveMatch?: MoveMatch;
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
 * Classify every species into exactly one obtainability tier. This MUST mirror the
 * build-time `classifyFireRedAvailability` (scripts/data/firered/indexes.ts), which is the
 * authority the shipped pack is built from — the app cannot import that build-script module
 * across the tsconfig project boundary, so the logic is reproduced here and the two are
 * pinned together by tests. Standard availability is seeded from NON-postgame wild
 * encounters (excluding the event-only distribution areas, whose encounter areas carry a
 * null nodeId) plus the standard non-wild acquisitions, then closed over legal evolutions;
 * postgame is seeded from postgame wild plus postgame acquisitions; version/event tiers come
 * from curated acquisitions. Precedence: standard > postgame > event-only >
 * version-exclusive > transfer-only.
 */
function buildObtainability(pack: FireRedPack): Map<number, Obtainability> {
  const branchByNodeId = new Map(pack.progression.nodes.map((node) => [node.id, node.branch ?? 'main']));

  const standardWild = new Set<number>();
  const anyWild = new Set<number>();
  for (const area of pack.encounters) {
    // A null nodeId marks an event-only distribution area (Birth Island, Navel Rock, roaming
    // Kanto, …): never standard wild. Otherwise the resolved node's branch decides the tier.
    if (area.nodeId === null) continue;
    const branch = branchByNodeId.get(area.nodeId) ?? 'main';
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
  for (const record of pack.acquisitions) {
    if (!('pokemonId' in record.subject)) continue;
    const id = record.subject.pokemonId;
    if (record.status === 'standard') standardAcq.add(id);
    else if (record.status === 'postgame') postgameAcq.add(id);
    else if (record.status === 'event-only') eventAcq.add(id);
    else if (record.status === 'version-exclusive') versionAcq.add(id);
  }

  const adjacency = new Map<number, number[]>();
  for (const edge of pack.evolutions) {
    if (edge.status === 'unavailable') continue;
    const targets = adjacency.get(edge.fromPokemonId) ?? [];
    targets.push(edge.toPokemonId);
    adjacency.set(edge.fromPokemonId, targets);
  }

  const standardSet = closeOverEvolutions([...standardWild, ...standardAcq], adjacency);
  const postgameSet = new Set([...closeOverEvolutions([...postgameWild, ...postgameAcq], adjacency)]
    .filter((id) => !standardSet.has(id)));
  const versionSet = new Set([...closeOverEvolutions([...versionAcq], adjacency)]
    .filter((id) => !standardSet.has(id) && !postgameSet.has(id)));
  const eventSet = new Set([...eventAcq]
    .filter((id) => !standardSet.has(id) && !postgameSet.has(id)));

  const obtainability = new Map<number, Obtainability>();
  for (const record of pack.pokemon) {
    const id = record.id;
    let status: ObtainabilityStatus;
    if (standardSet.has(id)) status = 'standard';
    else if (postgameSet.has(id)) status = 'postgame';
    else if (eventSet.has(id)) status = 'event-only';
    else if (versionSet.has(id)) status = 'version-exclusive';
    else status = 'transfer-only';
    obtainability.set(id, { status, flagged: status !== 'standard' });
  }
  return obtainability;
}

type LearnMethodEntry = { method: string; acquisitionIds?: string[] };

/** True when the species has at least one FireRed-valid way to learn the move. */
function isMoveVersionValid(entries: readonly LearnMethodEntry[], acquisitionStatusById: Map<string, string>): boolean {
  for (const entry of entries) {
    if (entry.method === 'level-up' || entry.method === 'egg') return true;
    if (entry.method === 'machine' || entry.method === 'tutor') {
      for (const id of entry.acquisitionIds ?? []) {
        const status = acquisitionStatusById.get(id);
        if (status !== undefined && status !== 'unavailable' && status !== 'transfer-only') return true;
      }
    }
  }
  return false;
}

/**
 * Search the FireRed pack using its generated indexes and pure set intersection. Every
 * provided filter is ANDed; results are de-duplicated and ordered by National Dex id. Each
 * result carries route counts from routes-by-pokemon, an obtainability flag (future /
 * transfer-only species stay searchable but flagged), and — when a move filter is present —
 * how the species learns that move and whether the method is valid in FireRed.
 */
export function searchFireRed(query: SearchQuery, pack: FireRedPack): SearchResult[] {
  const pokemonById = new Map(pack.pokemon.map((record) => [record.id, record]));
  const learnsetByPokemon = new Map(pack.learnsets.map((record) => [record.pokemonId, record]));
  const acquisitionStatusById = new Map(pack.acquisitions.map((record) => [record.id, record.status]));
  const moveIdBySlug = new Map(pack.moves.map((record) => [record.slug, record.id]));
  const obtainability = buildObtainability(pack);

  const filters: number[][] = [];
  if (query.name !== undefined) {
    const needle = query.name.trim().toLowerCase();
    filters.push(pack.pokemon
      .filter((record) => record.name.toLowerCase().includes(needle) || record.slug.includes(needle))
      .map((record) => record.id));
  }
  if (query.type !== undefined) filters.push([...(pack.indexes.pokemonByType[query.type] ?? [])]);
  if (query.ability !== undefined) filters.push([...(pack.indexes.pokemonByAbility[query.ability] ?? [])]);

  let moveSlug: string | undefined;
  let moveId: number | undefined;
  if (query.move !== undefined) {
    moveSlug = query.move.trim().toLowerCase();
    moveId = moveIdBySlug.get(moveSlug);
    filters.push([...(pack.indexes.pokemonByMove[moveSlug] ?? [])]);
  }

  let candidateIds: number[];
  if (filters.length === 0) {
    candidateIds = pack.pokemon.map((record) => record.id);
  } else {
    let running = new Set(filters[0]);
    for (const next of filters.slice(1)) {
      const nextSet = new Set(next);
      running = new Set([...running].filter((id) => nextSet.has(id)));
    }
    candidateIds = [...running];
  }
  candidateIds.sort((a, b) => a - b);

  const results: SearchResult[] = [];
  for (const id of candidateIds) {
    const record = pokemonById.get(id);
    if (record === undefined) continue;
    const routes = pack.indexes.routesByPokemon[String(id)] ?? [];

    let moveMatch: MoveMatch | undefined;
    if (moveSlug !== undefined) {
      const learnset = learnsetByPokemon.get(id);
      const entries = (learnset?.moves ?? []).filter((move) => move.moveId === moveId);
      const methods = [...new Set(entries.map((entry) => entry.method))];
      moveMatch = {
        moveSlug,
        methods,
        versionValid: isMoveVersionValid(entries, acquisitionStatusById),
      };
    }

    results.push({
      pokemonId: id,
      slug: record.slug,
      name: record.name,
      types: [...record.types],
      routes: [...routes],
      routeCount: routes.length,
      obtainability: obtainability.get(id) ?? { status: 'transfer-only', flagged: true },
      moveMatch,
    });
  }
  return results;
}
