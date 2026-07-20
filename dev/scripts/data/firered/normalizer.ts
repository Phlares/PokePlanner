import type { LearnsetRecord, MoveRecord, PokemonRecord, TypeChart } from '../../../src/domain/pack';
import { assertFireRedSourceContext, FIRERED_IDS } from './compiler-context';
import { asArray, asObject, endpointId, generatedProvenance, integer, resourceName, text, title, type Endpoint } from './pokeapi-endpoint';

type Reader = {
  read(resource: string, id: number): unknown;
  readPokemon(id: number): unknown;
  readVersion(id: number): unknown;
  readVersionGroup(id: number): unknown;
  readGeneration(id: number): unknown;
  listIds(resource: string): number[];
};

const PHYSICAL_TYPES = new Set(['normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel']);
const GEN_III_TYPE_IDS = Array.from({ length: 17 }, (_, index) => index + 1);
const GEN_III_TYPES = new Set<PokemonRecord['types'][number]>([
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark',
]);

function typeName(value: unknown): PokemonRecord['types'][number] {
  const name = resourceName(value, 'type');
  if (!GEN_III_TYPES.has(name as PokemonRecord['types'][number])) throw new Error(`Unsupported Generation III type: ${name}`);
  return name as PokemonRecord['types'][number];
}

function moveTypeName(value: unknown): MoveRecord['type'] {
  const name = resourceName(value, 'type');
  if (name === 'unknown') return name as MoveRecord['type'];
  return typeName(value) as MoveRecord['type'];
}

function englishName(endpoint: Endpoint): string {
  const found = asArray(endpoint.names, 'names').find((entry) => resourceName(asObject(entry, 'name').language, 'language') === 'en');
  return found === undefined ? title(text(endpoint.name, 'name')) : text(asObject(found, 'name').name, 'English name');
}

function englishShortEffect(entries: unknown, label: string): string {
  const found = asArray(entries, label).find((entry) => resourceName(asObject(entry, label).language, 'language') === 'en');
  if (found === undefined) throw new Error(`Expected English ${label}`);
  const entry = asObject(found, label);
  const short = entry.short_effect;
  if (typeof short === 'string' && short.trim() !== '') return short;
  return text(entry.effect, `${label} effect`).replaceAll('\n', ' ');
}

export type NormalizedLearnsetMove =
  | { method: 'level-up'; moveId: number; level: number }
  | { method: 'egg'; moveId: number }
  | { method: 'machine'; moveId: number }
  | { method: 'tutor'; moveId: number };
export interface NormalizedLearnsetRecord {
  pokemonId: number;
  moves: NormalizedLearnsetMove[];
  provenance: LearnsetRecord['provenance'];
}

function sourcePokemonId(speciesId: number): number {
  return speciesId === 386 ? 10001 : speciesId;
}

function generationId(change: Endpoint): number {
  return endpointId(change.generation, 'generation');
}

function rollBackGeneration<T>(current: T, entries: unknown, field: string): T {
  let value = current;
  const changes = asArray(entries, field).map((entry) => asObject(entry, field))
    .filter((entry) => generationId(entry) >= FIRERED_IDS.generationId)
    .sort((left, right) => generationId(right) - generationId(left));
  for (const change of changes) {
    if (change[field] !== undefined) value = change[field] as T;
  }
  return value;
}

function orderedGenerationChanges(entries: unknown, field: string): Endpoint[] {
  return asArray(entries, field).map((entry) => asObject(entry, field))
    .filter((entry) => generationId(entry) >= FIRERED_IDS.generationId)
    .sort((left, right) => generationId(right) - generationId(left));
}

function rollBackAbilities(current: unknown, entries: unknown): unknown[] {
  const abilities = new Map<number, unknown>();
  for (const ability of asArray(current, 'abilities')) {
    abilities.set(integer(asObject(ability, 'ability').slot, 'ability slot'), ability);
  }
  for (const change of orderedGenerationChanges(entries, 'past abilities')) {
    for (const ability of asArray(change.abilities, 'abilities')) {
      const slot = integer(asObject(ability, 'ability').slot, 'ability slot');
      if (asObject(ability, 'ability').ability === null) abilities.delete(slot);
      else abilities.set(slot, ability);
    }
  }
  return [...abilities.values()];
}

function rollBackStats(current: unknown, entries: unknown): unknown[] {
  const stats = new Map(asArray(current, 'stats').map((stat) => [resourceName(asObject(stat, 'stat').stat, 'stat'), stat]));
  for (const change of orderedGenerationChanges(entries, 'past stats')) {
    for (const stat of asArray(change.stats, 'stats')) {
      const value = asObject(stat, 'stat');
      const name = resourceName(value.stat, 'stat');
      if (name === 'special') continue;
      const currentStat = asObject(stats.get(name), 'stat');
      stats.set(name, { ...currentStat, ...value });
    }
  }
  return [...stats.values()];
}

function versionGroupOrder(reader: Reader, value: unknown): number {
  const id = endpointId(value, 'version-group');
  return integer(asObject(reader.readVersionGroup(id), 'version group').order, 'version group order');
}

function rollBackVersionGroup<T>(reader: Reader, current: T, entries: unknown, field: string): T {
  let value = current;
  const targetOrder = versionGroupOrder(reader, { url: '/api/v2/version-group/7/' });
  const changes = asArray(entries, field).map((entry) => asObject(entry, field))
    .map((entry) => ({ entry, order: versionGroupOrder(reader, entry.version_group) }))
    .filter(({ order }) => order >= targetOrder)
    .sort((left, right) => right.order - left.order);
  for (const { entry } of changes) {
    if (entry[field] !== undefined) value = entry[field] as T;
  }
  return value;
}

function rollBackMoveValues(reader: Reader, endpoint: Endpoint): Endpoint {
  let values = { ...endpoint };
  const targetOrder = versionGroupOrder(reader, { url: '/api/v2/version-group/7/' });
  const changes = asArray(endpoint.past_values, 'past values').map((entry) => asObject(entry, 'past value'))
    .map((entry) => ({ entry, order: versionGroupOrder(reader, entry.version_group) }))
    .filter(({ order }) => order >= targetOrder)
    .sort((left, right) => right.order - left.order);
  for (const { entry } of changes) {
    for (const field of ['accuracy', 'effect_chance', 'power', 'pp', 'type']) {
      if (entry[field] !== null && entry[field] !== undefined) values[field] = entry[field];
    }
  }
  return values;
}

function normalizeStats(stats: unknown, field: 'base_stat' | 'effort') {
  const values = new Map(asArray(stats, 'stats').map((entry) => {
    const stat = asObject(entry, 'stat');
    return [resourceName(stat.stat, 'stat'), integer(stat[field], field)];
  }));
  return {
    hp: values.get('hp') ?? 0,
    attack: values.get('attack') ?? 0,
    defense: values.get('defense') ?? 0,
    specialAttack: values.get('special-attack') ?? 0,
    specialDefense: values.get('special-defense') ?? 0,
    speed: values.get('speed') ?? 0,
  };
}

export function normalizeAbility(reader: Reader, value: unknown): PokemonRecord['abilities'][number] {
  const ability = asObject(value, 'ability slot');
  const abilityRef = asObject(ability.ability, 'ability');
  const id = endpointId(abilityRef, 'ability');
  const endpoint = asObject(reader.read('ability', id), 'ability');
  const effects = rollBackVersionGroup(reader, endpoint.effect_entries, endpoint.effect_changes, 'effect_entries');
  const slot = integer(ability.slot, 'ability slot');
  if (slot !== 1 && slot !== 2) throw new Error(`Unsupported ability slot: ${slot}`);
  return {
    id,
    name: englishName(endpoint),
    slot: slot as 1 | 2,
    shortEffect: englishShortEffect(effects, 'ability effects'),
  };
}

export function normalizePokemonCatalog(reader: Reader): PokemonRecord[] {
  assertFireRedSourceContext(reader);
  return reader.listIds('pokemon').filter((id) => id <= 386).map((id) => {
    const mechanicsId = sourcePokemonId(id);
    const endpoint = asObject(reader.readPokemon(mechanicsId), 'pokemon');
    const species = asObject(reader.read('pokemon-species', id), 'pokemon species');
    const historicalAbilities = rollBackAbilities(endpoint.abilities, endpoint.past_abilities);
    const historicalTypes = rollBackGeneration(endpoint.types, endpoint.past_types, 'types');
    const historicalStats = rollBackStats(endpoint.stats, endpoint.past_stats);
    return {
      id,
      slug: text(endpoint.name, 'pokemon name'),
      name: englishName(species),
      types: asArray(historicalTypes, 'types').sort((left, right) => integer(asObject(left, 'type').slot, 'type slot') - integer(asObject(right, 'type').slot, 'type slot'))
        .map((entry) => typeName(asObject(entry, 'type').type)),
      abilities: asArray(historicalAbilities, 'abilities')
        .filter((entry) => asObject(entry, 'ability').is_hidden !== true)
        .map((entry) => normalizeAbility(reader, entry))
        .filter(({ slot }) => slot === 1 || slot === 2)
        .sort((left, right) => left.slot - right.slot),
      baseStats: normalizeStats(historicalStats, 'base_stat'),
      evYield: normalizeStats(historicalStats, 'effort'),
      captureRate: integer(species.capture_rate, 'capture rate'),
      sprite: null,
      provenance: generatedProvenance(`pokemon/${mechanicsId}`),
    };
  });
}

function normalizeMove(reader: Reader, id: number): MoveRecord {
  const endpoint = asObject(reader.read('move', id), 'move');
  const values = rollBackMoveValues(reader, endpoint);
  const effects = rollBackVersionGroup(reader, endpoint.effect_entries, endpoint.effect_changes, 'effect_entries');
  const type = moveTypeName(asObject(values, 'move values').type);
  const damageClass = resourceName(asObject(values, 'move values').damage_class, 'damage class');
  return {
    id,
    slug: text(values.name, 'move name'),
    name: englishName(values),
    type,
    damageClass: damageClass === 'status' ? 'status' : PHYSICAL_TYPES.has(type) ? 'physical' : 'special',
    power: values.power === null ? null : integer(values.power, 'move power'),
    accuracy: values.accuracy === null ? null : integer(values.accuracy, 'move accuracy'),
    pp: values.pp === null ? 1 : integer(values.pp, 'move pp'),
    priority: integer(values.priority, 'move priority'),
    shortEffect: englishShortEffect(effects, 'move effects'),
    provenance: generatedProvenance(`move/${id}`),
  };
}

export function normalizeMoveCatalog(reader: Reader): MoveRecord[] {
  assertFireRedSourceContext(reader);
  return reader.listIds('move')
    .filter((id) => id <= 354)
    .map((id) => normalizeMove(reader, id));
}

export function normalizeLearnsets(reader: Reader): NormalizedLearnsetRecord[] {
  assertFireRedSourceContext(reader);
  return reader.listIds('pokemon').filter((id) => id <= 386).map((pokemonId) => {
    const mechanicsId = sourcePokemonId(pokemonId);
    const endpoint = asObject(reader.readPokemon(mechanicsId), 'pokemon');
    const moves = asArray(endpoint.moves, 'pokemon moves').flatMap((move) => {
      const entry = asObject(move, 'pokemon move');
      const moveId = endpointId(entry.move, 'move');
      if (moveId > 354) return [];
      return asArray(entry.version_group_details, 'version group details')
        .filter((detail) => endpointId(asObject(detail, 'version group detail').version_group, 'version-group') === FIRERED_IDS.versionGroupId)
        .map((detail) => {
          const value = asObject(detail, 'version group detail');
          const method = resourceName(value.move_learn_method, 'move learn method');
          if (method === 'level-up') return { method: 'level-up' as const, moveId, level: integer(value.level_learned_at, 'level learned') };
          if (method === 'egg') return { method: 'egg' as const, moveId };
          if (method === 'machine') return { method: 'machine' as const, moveId };
          if (method === 'tutor') return { method: 'tutor' as const, moveId };
          throw new Error(`Unsupported FireRed learn method: ${method}`);
        });
    });
    if (moves.length === 0) throw new Error(`Expected FireRed learnset for Pokemon ${pokemonId}`);
    return { pokemonId, moves, provenance: generatedProvenance(`pokemon/${mechanicsId}`) };
  });
}

export function normalizeTypeChart(reader: Reader): TypeChart {
  assertFireRedSourceContext(reader);
  const chart = Object.fromEntries(GEN_III_TYPE_IDS.map((id) => {
    const endpoint = asObject(reader.read('type', id), 'type');
    const relations = rollBackGeneration(endpoint.damage_relations, endpoint.past_damage_relations, 'damage_relations');
    const data = asObject(relations, 'damage relations');
    const names = (field: string) => asArray(data[field], field)
      .map((entry) => resourceName(entry, 'type'))
      .filter((name): name is PokemonRecord['types'][number] => GEN_III_TYPES.has(name as PokemonRecord['types'][number]));
    return [text(endpoint.name, 'type name'), {
      weakTo: names('double_damage_from'),
      resists: names('half_damage_from'),
      immuneTo: names('no_damage_from'),
    }];
  }));
  return { ...chart, provenance: generatedProvenance('type') } as TypeChart;
}
