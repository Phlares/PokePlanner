import type { EncounterArea } from '../../../src/domain/pack';
import { assertFireRedSourceContext, FIRERED_IDS } from './compiler-context';
import { asArray, asObject, endpointId, generatedProvenance, integer, resourceName, text, title, type Endpoint } from './pokeapi-endpoint';

type EncounterMethod = EncounterArea['methods'][number]['method'];
type Reader = {
  read(resource: string, id: number): unknown;
  readVersion(id: number): unknown;
  readVersionGroup(id: number): unknown;
  readGeneration(id: number): unknown;
  listIds(resource: string): number[];
};

const METHOD_CATEGORIES = new Map<string, EncounterMethod>([
  ['walk', 'walk'],
  ['surf', 'surf'],
  ['old-rod', 'old-rod'],
  ['good-rod', 'good-rod'],
  ['super-rod', 'super-rod'],
  ['rock-smash', 'rock-smash'],
  ['gift', 'gift'],
  ['gift-egg', 'gift-egg'],
  ['only-one', 'only-one'],
  ['pokeflute', 'pokeflute'],
  ['roaming-grass', 'event'],
  ['colosseum-bonus-disc-jpn', 'event'],
]);

function boundedInteger(value: unknown, label: string): number {
  const parsed = integer(value, label);
  if (parsed < 0 || parsed > 100) throw new Error(`Expected ${label} from 0 through 100`);
  return parsed;
}

function englishName(endpoint: Endpoint): string {
  const named = endpoint.names;
  if (!Array.isArray(named)) return title(text(endpoint.name, 'name'));
  const english = named.find((entry) => resourceName(asObject(entry, 'name').language, 'language') === 'en');
  return english === undefined ? title(text(endpoint.name, 'name')) : text(asObject(english, 'name').name, 'English name');
}

function categoryFor(sourceMethod: string, areaId: number): EncounterMethod {
  const category = METHOD_CATEGORIES.get(sourceMethod);
  if (category === undefined) throw new Error(`Unsupported FireRed encounter method: ${sourceMethod} in location area ${areaId}`);
  return category;
}

function isFireRedVersion(value: unknown): boolean {
  return endpointId(asObject(value, 'version detail').version, 'version') === FIRERED_IDS.versionId;
}

function methodName(reader: Reader, value: unknown): string {
  const id = endpointId(value, 'encounter-method');
  return text(asObject(reader.read('encounter-method', id), 'encounter method').name, 'encounter method name');
}

function conditionNames(reader: Reader, value: unknown): string[] {
  return asArray(value, 'encounter conditions')
    .map((condition) => {
      const id = endpointId(condition, 'encounter-condition-value');
      return text(asObject(reader.read('encounter-condition-value', id), 'encounter condition value').name, 'encounter condition value name');
    })
    .sort((left, right) => left.localeCompare(right));
}

export function compileFireRedEncounters(reader: Reader): EncounterArea[] {
  assertFireRedSourceContext(reader);

  return reader.listIds('location-area').flatMap((locationAreaId) => {
    const area = asObject(reader.read('location-area', locationAreaId), 'location area');
    if (integer(area.id, 'location area ID') !== locationAreaId) throw new Error(`Expected location area ${locationAreaId}`);
    const pokemonEncounters = asArray(area.pokemon_encounters, 'pokemon encounters');
    const fireRedDetails = pokemonEncounters.flatMap((entry) => {
      const pokemonEncounter = asObject(entry, 'pokemon encounter');
      return asArray(pokemonEncounter.version_details, 'Pokemon version details')
        .filter(isFireRedVersion)
        .map((versionDetail) => ({ pokemonEncounter, versionDetail: asObject(versionDetail, 'Pokemon version detail') }));
    });
    if (fireRedDetails.length === 0) return [];

    const locationId = endpointId(area.location, 'location');
    const location = asObject(reader.read('location', locationId), 'location');
    if (integer(location.id, 'location ID') !== locationId) throw new Error(`Expected location ${locationId}`);

    const methodRates = new Map<string, number>();
    for (const rateEntry of asArray(area.encounter_method_rates, 'encounter method rates')) {
      const entry = asObject(rateEntry, 'encounter method rate');
      const method = categoryFor(methodName(reader, entry.encounter_method), locationAreaId);
      const fireRedRate = asArray(entry.version_details, 'method rate version details')
        .map((detail) => asObject(detail, 'method rate version detail'))
        .find(isFireRedVersion);
      if (fireRedRate !== undefined) methodRates.set(method, boundedInteger(fireRedRate.rate, 'encounter method rate'));
    }

    const methods = new Map<EncounterMethod, EncounterArea['methods'][number]['slots']>();
    for (const { pokemonEncounter, versionDetail } of fireRedDetails) {
      const pokemonId = endpointId(pokemonEncounter.pokemon, 'pokemon');
      if (pokemonId > 386) throw new Error(`Expected Generation I-III Pokemon ID in location area ${locationAreaId}`);
      const maxChance = integer(versionDetail.max_chance, 'version max chance');
      if (maxChance < 0) throw new Error('Expected non-negative version max chance');
      for (const encounterDetail of asArray(versionDetail.encounter_details, 'encounter details')) {
        const detail = asObject(encounterDetail, 'encounter detail');
        const method = categoryFor(methodName(reader, detail.method), locationAreaId);
        const slots = methods.get(method) ?? [];
        slots.push({
          pokemonId,
          chance: boundedInteger(detail.chance, 'encounter chance'),
          maxChance,
          minLevel: integer(detail.min_level, 'minimum encounter level'),
          maxLevel: integer(detail.max_level, 'maximum encounter level'),
          conditions: conditionNames(reader, detail.condition_values),
        });
        methods.set(method, slots);
      }
    }

    return [{
      locationAreaId,
      locationId,
      slug: text(area.name, 'location area name'),
      name: englishName(location),
      nodeId: text(location.name, 'location name'),
      methodRates: Object.fromEntries([...methodRates.entries()].sort(([left], [right]) => left.localeCompare(right))),
      methods: [...methods.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([method, slots]) => ({
          method,
          slots: slots.sort((left, right) => left.pokemonId - right.pokemonId
            || right.chance - left.chance
            || left.conditions.join(',').localeCompare(right.conditions.join(','))),
        })),
      provenance: generatedProvenance(`location-area/${locationAreaId}`),
    }];
  });
}
