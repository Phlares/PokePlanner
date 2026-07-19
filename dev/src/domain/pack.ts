import { z } from 'zod';

const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const pokemonId = positiveInteger.max(386);
const moveId = positiveInteger.max(354);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Expected a normalized slug');
const nonEmptyText = z.string().trim().min(1);
const localAssetPath = z.string().regex(
  /^(?!\/)(?!.*(?:^|\/)\.\.?\/)[a-z0-9][a-z0-9._/-]*\.json$/,
  'Expected a local JSON asset path',
);
const provenanceSchema = z.object({
  sourceId: slug,
  revision: nonEmptyText,
  locator: nonEmptyText.nullable(),
  method: z.enum(['generated', 'manual', 'inferred']),
  confidence: z.enum(['verified', 'cross-checked', 'provisional']),
  note: z.string().nullable(),
}).strict();
const provenanceList = z.array(provenanceSchema).min(1);
const typeSchema = z.enum([
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark',
]);
const moveTypeSchema = z.union([typeSchema, z.literal('unknown')]);
const uniquePokemonIds = z.array(pokemonId).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'IDs must be unique' });
});

const statSchema = z.object({
  hp: nonNegativeInteger,
  attack: nonNegativeInteger,
  defense: nonNegativeInteger,
  specialAttack: nonNegativeInteger,
  specialDefense: nonNegativeInteger,
  speed: nonNegativeInteger,
}).strict();

const abilitySchema = z.object({
  id: positiveInteger,
  name: nonEmptyText,
  slot: z.union([z.literal(1), z.literal(2)]),
  shortEffect: nonEmptyText,
}).strict();
const abilityListSchema = z.array(abilitySchema).min(1).superRefine((abilities, context) => {
  if (new Set(abilities.map((ability) => ability.id)).size !== abilities.length) {
    context.addIssue({ code: 'custom', message: 'Ability IDs must be unique' });
  }
  if (new Set(abilities.map((ability) => ability.slot)).size !== abilities.length) {
    context.addIssue({ code: 'custom', message: 'Ability slots must be unique' });
  }
  if (!abilities.some((ability) => ability.slot === 1)) {
    context.addIssue({ code: 'custom', message: 'Ability lists must include slot 1' });
  }
});

export const pokemonRecordSchema = z.object({
  id: pokemonId,
  slug,
  name: nonEmptyText,
  types: z.array(typeSchema).min(1).max(2).superRefine((types, context) => {
    if (new Set(types).size !== types.length) context.addIssue({ code: 'custom', message: 'Types must be unique' });
  }),
  abilities: abilityListSchema,
  baseStats: statSchema,
  evYield: statSchema,
  captureRate: nonNegativeInteger.max(255),
  sprite: z.string().regex(/^(?!\/)(?!.*\.\.\/)[a-z0-9][a-z0-9._/-]*\.(?:png|gif)$/).nullable(),
  provenance: provenanceList,
}).strict();

export const moveRecordSchema = z.object({
  id: moveId,
  slug,
  name: nonEmptyText,
  type: moveTypeSchema,
  damageClass: z.enum(['physical', 'special', 'status']),
  power: nonNegativeInteger.nullable(),
  accuracy: z.number().int().min(1).max(100).nullable(),
  pp: positiveInteger,
  priority: z.number().int(),
  shortEffect: nonEmptyText,
  provenance: provenanceList,
}).strict();

const levelUpMoveMethodSchema = z.object({ method: z.literal('level-up'), moveId, level: nonNegativeInteger }).strict();
const machineMoveMethodSchema = z.object({ method: z.literal('machine'), moveId, acquisitionIds: z.array(slug).min(1) }).strict();
const tutorMoveMethodSchema = z.object({ method: z.literal('tutor'), moveId, acquisitionIds: z.array(slug).min(1) }).strict();
const eggMoveMethodSchema = z.object({ method: z.literal('egg'), moveId }).strict();
const transferMoveMethodSchema = z.object({ method: z.literal('transfer'), moveId, reason: nonEmptyText }).strict();
export const moveMethodSchema = z.discriminatedUnion('method', [
  levelUpMoveMethodSchema, machineMoveMethodSchema, tutorMoveMethodSchema, eggMoveMethodSchema, transferMoveMethodSchema,
]);

export const learnsetRecordSchema = z.object({
  pokemonId,
  moves: z.array(moveMethodSchema).min(1),
  provenance: provenanceList,
}).strict();

const encounterSlotSchema = z.object({
  pokemonId,
  chance: nonNegativeInteger.max(100),
  maxChance: nonNegativeInteger.max(100),
  minLevel: positiveInteger.max(100),
  maxLevel: positiveInteger.max(100),
  conditions: z.array(slug),
}).strict().refine((slot) => slot.maxLevel >= slot.minLevel, 'Maximum level must not precede minimum level');
const encounterMethodSchema = z.object({
  method: z.enum(['walk', 'surf', 'old-rod', 'good-rod', 'super-rod', 'rock-smash', 'gift', 'gift-egg', 'only-one', 'pokeflute', 'event']),
  slots: z.array(encounterSlotSchema).min(1),
}).strict();
export const encounterAreaSchema = z.object({
  locationAreaId: positiveInteger,
  locationId: positiveInteger.nullable(),
  slug,
  name: nonEmptyText,
  nodeId: slug.nullable(),
  methodRates: z.record(slug, nonNegativeInteger.max(100)),
  methods: z.array(encounterMethodSchema).min(1),
  provenance: provenanceList,
}).strict();

const machineAcquisitionSchema = z.object({ kind: z.enum(['tm', 'hm']), moveId, itemId: positiveInteger, machineNumber: positiveInteger }).strict();
const tutorAcquisitionSchema = z.object({ kind: z.literal('tutor'), moveId }).strict();
const pokemonAcquisitionSchema = z.object({ kind: z.enum(['starter', 'gift', 'gift-egg', 'static', 'trade', 'game-corner', 'fossil', 'event', 'transfer']), pokemonId }).strict();
export const acquisitionSubjectSchema = z.discriminatedUnion('kind', [machineAcquisitionSchema, tutorAcquisitionSchema, pokemonAcquisitionSchema]);
export const acquisitionRecordSchema = z.object({
  id: slug,
  name: nonEmptyText,
  subject: acquisitionSubjectSchema,
  milestoneId: slug.nullable(),
  prerequisites: z.array(slug),
  repeatable: z.boolean(),
  status: z.enum(['standard', 'postgame', 'version-exclusive', 'event-only', 'transfer-only', 'unavailable']),
  provenance: provenanceList,
}).strict();

export const evolutionEdgeSchema = z.object({
  fromPokemonId: pokemonId,
  toPokemonId: pokemonId,
  trigger: z.enum(['level', 'trade', 'item', 'friendship', 'other']),
  minimumLevel: positiveInteger.nullable(),
  itemId: positiveInteger.nullable(),
  locationId: positiveInteger.nullable(),
  status: z.enum(['standard', 'postgame', 'version-exclusive', 'event-only', 'transfer-only', 'unavailable']),
  milestoneId: slug.nullable(),
  reason: z.string().nullable(),
  provenance: provenanceList,
}).strict().refine((edge) => edge.fromPokemonId !== edge.toPokemonId, 'Evolution must change Pokemon');

const typeRelationsSchema = z.object({
  weakTo: z.array(typeSchema),
  resists: z.array(typeSchema),
  immuneTo: z.array(typeSchema),
}).strict();
export const typeChartSchema = z.object({
  normal: typeRelationsSchema, fighting: typeRelationsSchema, flying: typeRelationsSchema, poison: typeRelationsSchema,
  ground: typeRelationsSchema, rock: typeRelationsSchema, bug: typeRelationsSchema, ghost: typeRelationsSchema,
  steel: typeRelationsSchema, fire: typeRelationsSchema, water: typeRelationsSchema, grass: typeRelationsSchema,
  electric: typeRelationsSchema, psychic: typeRelationsSchema, ice: typeRelationsSchema, dragon: typeRelationsSchema,
  dark: typeRelationsSchema,
  provenance: provenanceList,
}).strict();

const currentMoveSchema = z.object({ moveId, status: z.literal('available-now') }).strict();
const futureLevelMoveSchema = z.object({ moveId, status: z.literal('future-level'), level: positiveInteger }).strict();
const futureMilestoneMoveSchema = z.object({ moveId, status: z.literal('future-milestone'), milestoneId: slug }).strict();
const unavailableMoveSchema = z.object({ moveId, status: z.literal('unavailable'), reason: nonEmptyText }).strict();
const moveAvailabilitySchema = z.object({
  availableNow: z.array(currentMoveSchema),
  futureLevel: z.array(futureLevelMoveSchema),
  futureMilestone: z.array(futureMilestoneMoveSchema),
  unavailable: z.array(unavailableMoveSchema),
}).strict();
const pokemonIdKey = z.string().regex(/^[1-9][0-9]*$/).refine(
  (value) => Number(value) <= 386,
  'Expected a Generation I-III Pokemon ID key',
);
const idIndexSchema = z.record(slug, uniquePokemonIds);
const pokemonByTypeSchema = z.object({
  normal: uniquePokemonIds, fighting: uniquePokemonIds, flying: uniquePokemonIds, poison: uniquePokemonIds,
  ground: uniquePokemonIds, rock: uniquePokemonIds, bug: uniquePokemonIds, ghost: uniquePokemonIds,
  steel: uniquePokemonIds, fire: uniquePokemonIds, water: uniquePokemonIds, grass: uniquePokemonIds,
  electric: uniquePokemonIds, psychic: uniquePokemonIds, ice: uniquePokemonIds, dragon: uniquePokemonIds,
  dark: uniquePokemonIds,
}).strict();
export const fireRedIndexesSchema = z.object({
  pokemonByMove: idIndexSchema,
  pokemonByType: pokemonByTypeSchema,
  pokemonByAbility: idIndexSchema,
  routesByPokemon: z.record(pokemonIdKey, z.array(slug).min(1)),
  availabilityByMilestone: z.record(slug, moveAvailabilitySchema),
  provenance: provenanceList,
}).strict();

const assetDescriptorSchema = z.object({
  path: localAssetPath,
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest'),
  schemaVersion: z.literal(1),
}).strict();
const manifestFileTreeSchema = z.object({
  pokemon: assetDescriptorSchema,
  moves: assetDescriptorSchema,
  learnsets: assetDescriptorSchema,
  encounters: assetDescriptorSchema,
  progression: assetDescriptorSchema,
  acquisitions: assetDescriptorSchema,
  evolutions: assetDescriptorSchema,
  'type-chart': assetDescriptorSchema,
  indexes: z.object({
    'pokemon-by-move': assetDescriptorSchema,
    'pokemon-by-type': assetDescriptorSchema,
    'pokemon-by-ability': assetDescriptorSchema,
    'routes-by-pokemon': assetDescriptorSchema,
    'availability-by-milestone': assetDescriptorSchema,
  }).strict(),
}).strict();

export const fireRedPackManifestSchema = z.object({
  schemaVersion: z.literal(2),
  packVersion: nonEmptyText,
  game: z.object({
    id: z.literal('firered'),
    name: z.literal('Pokémon FireRed'),
    versionId: z.literal(10),
    versionGroupId: z.literal(7),
    generationId: z.literal(3),
  }).strict(),
  sources: z.array(z.object({ id: slug, revision: nonEmptyText }).strict()).min(1),
  builtAt: z.string().datetime({ offset: true }),
  validation: z.object({ valid: z.literal(true), pokemonCount: nonNegativeInteger, moveCount: nonNegativeInteger, typeCount: z.literal(17) }).strict(),
  files: manifestFileTreeSchema,
}).strict();

export type Provenance = z.infer<typeof provenanceSchema>;
export type PokemonRecord = z.infer<typeof pokemonRecordSchema>;
export type MoveRecord = z.infer<typeof moveRecordSchema>;
export type LearnsetRecord = z.infer<typeof learnsetRecordSchema>;
export type EncounterArea = z.infer<typeof encounterAreaSchema>;
export type AcquisitionRecord = z.infer<typeof acquisitionRecordSchema>;
export type EvolutionEdge = z.infer<typeof evolutionEdgeSchema>;
export type TypeChart = z.infer<typeof typeChartSchema>;
export type FireRedIndexes = z.infer<typeof fireRedIndexesSchema>;
export type FireRedPackManifest = z.infer<typeof fireRedPackManifestSchema>;

export function parsePokemonRecords(input: unknown): PokemonRecord[] { return z.array(pokemonRecordSchema).parse(input); }
export function parseMoveRecords(input: unknown): MoveRecord[] { return z.array(moveRecordSchema).parse(input); }
export function parseLearnsetRecords(input: unknown): LearnsetRecord[] { return z.array(learnsetRecordSchema).parse(input); }
export function parseEncounterAreas(input: unknown): EncounterArea[] { return z.array(encounterAreaSchema).parse(input); }
export function parseAcquisitionRecords(input: unknown): AcquisitionRecord[] { return z.array(acquisitionRecordSchema).parse(input); }
export function parseEvolutionEdges(input: unknown): EvolutionEdge[] { return z.array(evolutionEdgeSchema).parse(input); }
export function parseTypeChart(input: unknown): TypeChart { return typeChartSchema.parse(input); }
export function parseFireRedIndexes(input: unknown): FireRedIndexes { return fireRedIndexesSchema.parse(input); }
export function parseFireRedPackManifest(input: unknown): FireRedPackManifest { return fireRedPackManifestSchema.parse(input); }
