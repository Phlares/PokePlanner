import {
  fireRedIndexesSchema,
  parseAcquisitionRecords,
  parseEncounterAreas,
  parseEvolutionEdges,
  parseFireRedPackManifest,
  parseLearnsetRecords,
  parseMoveRecords,
  parsePokemonRecords,
  parseTypeChart,
  type AcquisitionRecord,
  type EncounterArea,
  type EvolutionEdge,
  type FireRedIndexes,
  type FireRedPackManifest,
  type LearnsetRecord,
  type MoveRecord,
  type PokemonRecord,
  type TypeChart,
} from '../domain/pack';
import { validateRouteProgression, type RouteProgression } from '../domain/progression';
import { fireRedAssetUrl, gamePackManifestUrl } from './manifest-url';

/**
 * The verified, per-milestone search indexes carried inside the pack. The build-time
 * `provenance` array on {@link FireRedIndexes} is not serialized into the split index
 * assets, so the runtime aggregate exposes the index maps only.
 */
export type FireRedPackIndexes = Omit<FireRedIndexes, 'provenance'>;

/**
 * The immutable, cross-validated FireRed planning aggregate. Every field is deeply frozen
 * so downstream pure logic (availability, search) can share it without defensive copies.
 */
export interface FireRedPack {
  readonly manifest: FireRedPackManifest;
  readonly pokemon: readonly PokemonRecord[];
  readonly moves: readonly MoveRecord[];
  readonly learnsets: readonly LearnsetRecord[];
  readonly encounters: readonly EncounterArea[];
  readonly progression: RouteProgression;
  readonly acquisitions: readonly AcquisitionRecord[];
  readonly evolutions: readonly EvolutionEdge[];
  readonly typeChart: TypeChart;
  readonly indexes: FireRedPackIndexes;
}

/** The already-parsed inputs assembled into a {@link FireRedPack}. */
export interface FireRedPackParts {
  manifest: FireRedPackManifest;
  pokemon: PokemonRecord[];
  moves: MoveRecord[];
  learnsets: LearnsetRecord[];
  encounters: EncounterArea[];
  progression: RouteProgression;
  acquisitions: AcquisitionRecord[];
  evolutions: EvolutionEdge[];
  typeChart: TypeChart;
  indexes: FireRedPackIndexes;
}

/**
 * A Web-Crypto-shaped digest adapter. It is injected so the loader never hardwires
 * `crypto.subtle`; it may return the raw digest bytes (`ArrayBuffer`) or a lowercase hex
 * string, matching either a real `crypto.subtle.digest('SHA-256', …)` or a test fake.
 */
export type FireRedDigest = (bytes: Uint8Array) => Promise<ArrayBuffer | string>;

interface AssetDescriptor {
  path: string;
  sha256: string;
}

function flattenAssets(files: FireRedPackManifest['files']): AssetDescriptor[] {
  const assets: AssetDescriptor[] = [];
  for (const [key, value] of Object.entries(files)) {
    if (key === 'indexes') {
      for (const descriptor of Object.values(value as Record<string, AssetDescriptor>)) {
        assets.push({ path: descriptor.path, sha256: descriptor.sha256 });
      }
    } else {
      const descriptor = value as AssetDescriptor;
      assets.push({ path: descriptor.path, sha256: descriptor.sha256 });
    }
  }
  return assets;
}

function digestToHex(digest: ArrayBuffer | string): string {
  if (typeof digest === 'string') return digest.trim().toLowerCase();
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function parseProgression(input: unknown): RouteProgression {
  const result = validateRouteProgression(input);
  if (!result.valid) throw new Error(`Invalid FireRed progression asset:\n${result.errors.join('\n')}`);
  return input as RouteProgression;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  }
  return value;
}

function requireResolved(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FireRed pack cross-reference failure: ${message}`);
}

/**
 * Assert every id resolves across the catalogs so a verified-but-inconsistent pack still
 * fails the whole load rather than yielding a partly dangling aggregate.
 */
function validateCrossReferences(parts: FireRedPackParts): void {
  const pokemonIds = new Set(parts.pokemon.map((record) => record.id));
  const moveIds = new Set(parts.moves.map((record) => record.id));
  const acquisitionIds = new Set(parts.acquisitions.map((record) => record.id));
  const nodeIds = new Set(parts.progression.nodes.map((node) => node.id));

  for (const learnset of parts.learnsets) {
    requireResolved(pokemonIds.has(learnset.pokemonId), `learnset references unknown Pokémon ${learnset.pokemonId}`);
    for (const move of learnset.moves) {
      requireResolved(moveIds.has(move.moveId), `learnset ${learnset.pokemonId} references unknown move ${move.moveId}`);
      if (move.method === 'machine' || move.method === 'tutor') {
        for (const id of move.acquisitionIds) {
          requireResolved(acquisitionIds.has(id), `learnset ${learnset.pokemonId} references unknown acquisition "${id}"`);
        }
      }
    }
  }
  for (const edge of parts.evolutions) {
    requireResolved(pokemonIds.has(edge.fromPokemonId), `evolution references unknown Pokémon ${edge.fromPokemonId}`);
    requireResolved(pokemonIds.has(edge.toPokemonId), `evolution references unknown Pokémon ${edge.toPokemonId}`);
  }
  for (const area of parts.encounters) {
    for (const method of area.methods) {
      for (const slot of method.slots) {
        requireResolved(pokemonIds.has(slot.pokemonId), `encounter ${area.slug} references unknown Pokémon ${slot.pokemonId}`);
      }
    }
  }
  for (const record of parts.acquisitions) {
    if ('pokemonId' in record.subject) {
      requireResolved(pokemonIds.has(record.subject.pokemonId), `acquisition "${record.id}" references unknown Pokémon ${record.subject.pokemonId}`);
    } else {
      requireResolved(moveIds.has(record.subject.moveId), `acquisition "${record.id}" references unknown move ${record.subject.moveId}`);
    }
  }
  const moveSlugs = new Set(parts.moves.map((record) => record.slug));
  for (const [slug, ids] of Object.entries(parts.indexes.pokemonByMove)) {
    requireResolved(moveSlugs.has(slug), `pokemon-by-move index references unknown move slug "${slug}"`);
    for (const id of ids) requireResolved(pokemonIds.has(id), `pokemon-by-move index references unknown Pokémon ${id}`);
  }
  for (const ids of Object.values(parts.indexes.pokemonByAbility)) {
    for (const id of ids) requireResolved(pokemonIds.has(id), `pokemon-by-ability index references unknown Pokémon ${id}`);
  }
  for (const [key, slugs] of Object.entries(parts.indexes.routesByPokemon)) {
    requireResolved(pokemonIds.has(Number(key)), `routes-by-pokemon index references unknown Pokémon ${key}`);
    for (const slug of slugs) requireResolved(nodeIds.has(slug), `routes-by-pokemon index references unknown node "${slug}"`);
  }
}

/**
 * Assemble already-parsed pack inputs into one deeply-immutable, cross-validated
 * {@link FireRedPack}. Pure: it never fetches, never touches the clock, and never mutates
 * anything the caller can observe beyond freezing the parts it takes ownership of.
 */
export function buildFireRedPack(parts: FireRedPackParts): FireRedPack {
  validateCrossReferences(parts);
  return deepFreeze({
    manifest: parts.manifest,
    pokemon: parts.pokemon,
    moves: parts.moves,
    learnsets: parts.learnsets,
    encounters: parts.encounters,
    progression: parts.progression,
    acquisitions: parts.acquisitions,
    evolutions: parts.evolutions,
    typeChart: parts.typeChart,
    indexes: parts.indexes,
  });
}

/**
 * Load and verify the content-addressed FireRed pack. Manifest-first: the v2 manifest is
 * fetched from the static base path, then every hashed asset is fetched, SHA-256-verified
 * against the manifest BEFORE parsing, parsed with its strict schema, and cross-validated.
 * The load is all-or-nothing — any missing, corrupt, or dangling asset rejects the whole
 * load with no partial pack. No request is ever issued outside the static base path.
 */
export async function loadFireRedPack(
  fetcher: typeof fetch,
  digest: FireRedDigest,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<FireRedPack> {
  const init: RequestInit | undefined = signal === undefined ? undefined : { signal };

  const manifestResponse = await fetcher(gamePackManifestUrl(baseUrl), init);
  if (!manifestResponse.ok) throw new Error(`Unable to load FireRed pack manifest: ${manifestResponse.status}`);
  const manifest = parseFireRedPackManifest(await manifestResponse.json());

  const rawByPath = new Map<string, unknown>();
  await Promise.all(flattenAssets(manifest.files).map(async (asset) => {
    const response = await fetcher(fireRedAssetUrl(baseUrl, asset.path), init);
    if (!response.ok) throw new Error(`Unable to load FireRed pack asset ${asset.path}: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = digestToHex(await digest(bytes));
    if (actual !== asset.sha256.toLowerCase()) {
      throw new Error(`FireRed pack asset ${asset.path} failed SHA-256 hash mismatch verification`);
    }
    rawByPath.set(asset.path, JSON.parse(new TextDecoder().decode(bytes)));
  }));

  const get = (path: string): unknown => {
    if (!rawByPath.has(path)) throw new Error(`FireRed pack asset ${path} was not fetched`);
    return rawByPath.get(path);
  };
  const indexShape = fireRedIndexesSchema.shape;

  return buildFireRedPack({
    manifest,
    pokemon: parsePokemonRecords(get('pokemon.json')),
    moves: parseMoveRecords(get('moves.json')),
    learnsets: parseLearnsetRecords(get('learnsets.json')),
    encounters: parseEncounterAreas(get('encounters.json')),
    progression: parseProgression(get('progression.json')),
    acquisitions: parseAcquisitionRecords(get('acquisitions.json')),
    evolutions: parseEvolutionEdges(get('evolutions.json')),
    typeChart: parseTypeChart(get('type-chart.json')),
    indexes: {
      pokemonByMove: indexShape.pokemonByMove.parse(get('indexes/pokemon-by-move.json')),
      pokemonByType: indexShape.pokemonByType.parse(get('indexes/pokemon-by-type.json')),
      pokemonByAbility: indexShape.pokemonByAbility.parse(get('indexes/pokemon-by-ability.json')),
      routesByPokemon: indexShape.routesByPokemon.parse(get('indexes/routes-by-pokemon.json')),
      availabilityByMilestone: indexShape.availabilityByMilestone.parse(get('indexes/availability-by-milestone.json')),
    },
  });
}
