import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFireRedPack, type FireRedPack } from '../data/game-pack';
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
} from '../domain/pack';
import { validateRouteProgression, type RouteProgression } from '../domain/progression';

/**
 * Scoped test helper (Task 11): assemble a real {@link FireRedPack} from the committed
 * generated assets under `public/data/firered/*.json`. It reads the bytes with `node:fs`,
 * runs the same strict `parse*` validators the runtime loader uses, and calls
 * {@link buildFireRedPack} so UI tests assert against real facts (Route 22 Mankey, the Brock
 * milestone) instead of hand-rolled doubles. No network, no Web Crypto, no hash step — the
 * bytes are already on disk and trusted; this only exists for tests.
 */
const PACK_DIR = resolve(process.cwd(), 'public/data/firered');

function readAsset(path: string): unknown {
  return JSON.parse(readFileSync(resolve(PACK_DIR, path), 'utf8'));
}

function parseProgression(input: unknown): RouteProgression {
  const result = validateRouteProgression(input);
  if (!result.valid) {
    throw new Error(`Fixture progression asset is invalid:\n${result.errors.join('\n')}`);
  }
  return input as RouteProgression;
}

let cached: FireRedPack | null = null;

/** Build (once, memoized) the real FireRed pack for interface tests. */
export function loadFireRedPackFixture(): FireRedPack {
  if (cached !== null) return cached;
  const indexShape = fireRedIndexesSchema.shape;
  cached = buildFireRedPack({
    manifest: parseFireRedPackManifest(readAsset('manifest.json')),
    pokemon: parsePokemonRecords(readAsset('pokemon.json')),
    moves: parseMoveRecords(readAsset('moves.json')),
    learnsets: parseLearnsetRecords(readAsset('learnsets.json')),
    encounters: parseEncounterAreas(readAsset('encounters.json')),
    progression: parseProgression(readAsset('progression.json')),
    acquisitions: parseAcquisitionRecords(readAsset('acquisitions.json')),
    evolutions: parseEvolutionEdges(readAsset('evolutions.json')),
    typeChart: parseTypeChart(readAsset('type-chart.json')),
    indexes: {
      pokemonByMove: indexShape.pokemonByMove.parse(readAsset('indexes/pokemon-by-move.json')),
      pokemonByType: indexShape.pokemonByType.parse(readAsset('indexes/pokemon-by-type.json')),
      pokemonByAbility: indexShape.pokemonByAbility.parse(readAsset('indexes/pokemon-by-ability.json')),
      routesByPokemon: indexShape.routesByPokemon.parse(readAsset('indexes/routes-by-pokemon.json')),
      availabilityByMilestone: indexShape.availabilityByMilestone.parse(
        readAsset('indexes/availability-by-milestone.json'),
      ),
    },
  });
  return cached;
}
