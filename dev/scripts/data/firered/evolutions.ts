import type { EvolutionEdge, PokemonRecord, Provenance } from '../../../src/domain/pack';
import { z } from 'zod';
import { assertFireRedSourceContext } from './compiler-context';
import { REQUIRED_POKEAPI_SOURCE } from '../source-lock';
import evolutionSourcesInput from '../../../data/firered/sources.json';

type Endpoint = Record<string, unknown>;
type Reader = {
  read(resource: string, id: number): unknown;
  readVersion(id: number): unknown;
  readVersionGroup(id: number): unknown;
  readGeneration(id: number): unknown;
};

const normalizedSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const sourceRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(z.object({
    id: normalizedSlug,
    name: z.string().trim().min(1),
    url: z.string().url().startsWith('https://'),
    revision: z.string().regex(/^accessed-[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
    accessedOn: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
    license: z.string().trim().min(1).nullable(),
  }).strict()).min(1),
}).strict().superRefine((registry, context) => {
  if (new Set(registry.sources.map(({ id }) => id)).size !== registry.sources.length) {
    context.addIssue({ code: 'custom', message: 'Manual source IDs must be unique' });
  }
  if (new Set(registry.sources.map(({ url }) => url)).size !== registry.sources.length) {
    context.addIssue({ code: 'custom', message: 'Manual source URLs must be unique' });
  }
  for (const [index, source] of registry.sources.entries()) {
    if (source.revision !== `accessed-${source.accessedOn}`) {
      context.addIssue({ code: 'custom', path: ['sources', index, 'revision'], message: 'Source revision must match accessed date' });
    }
  }
});
const overrideProvenance = z.object({
  sourceId: normalizedSlug,
  revision: z.string().trim().min(1),
  locator: z.string().trim().min(1).nullable(),
  method: z.enum(['generated', 'manual', 'inferred']),
  confidence: z.enum(['verified', 'cross-checked', 'provisional']),
  note: z.string().nullable(),
}).strict();
const evolutionOverrideSchema = z.object({
  fromPokemonId: z.number().int().min(1).max(386),
  toPokemonId: z.number().int().min(1).max(386),
  status: z.enum(['standard', 'postgame', 'version-exclusive', 'event-only', 'transfer-only', 'unavailable']),
  milestoneId: normalizedSlug.nullable(),
  reason: normalizedSlug.nullable(),
  provenance: z.array(overrideProvenance).min(1),
}).strict().superRefine((override, context) => {
  if (override.fromPokemonId === override.toPokemonId) {
    context.addIssue({ code: 'custom', message: 'Override must change Pokemon' });
  }
  if ((override.milestoneId === null) === (override.reason === null)) {
    context.addIssue({ code: 'custom', message: 'Override must include exactly one milestone or reason' });
  }
});

export type EvolutionOverride = z.infer<typeof evolutionOverrideSchema>;
export type EvolutionSources = z.infer<typeof sourceRegistrySchema>;

export function parseEvolutionOverrides(input: unknown): EvolutionOverride[] {
  return z.array(evolutionOverrideSchema).parse(input);
}

export function parseEvolutionSources(input: unknown): EvolutionSources {
  return sourceRegistrySchema.parse(input);
}

export function assertOverrideSourcesRegistered(overrides: EvolutionOverride[], registry: EvolutionSources): void {
  const sources = new Map(registry.sources.map((source) => [source.id, source]));
  for (const override of parseEvolutionOverrides(overrides)) {
    for (const provenance of override.provenance) {
      const source = sources.get(provenance.sourceId);
      if (source === undefined || source.revision !== provenance.revision) {
        throw new Error(`Undeclared override provenance source: ${provenance.sourceId}@${provenance.revision}`);
      }
    }
  }
}

interface ChainNode {
  species: unknown;
  evolves_to: unknown;
  evolution_details: unknown;
}

function asObject(value: unknown, label: string): Endpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Expected ${label} endpoint`);
  return value as Endpoint;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${label} list`);
  return value;
}

function asChainNode(value: unknown, label: string): ChainNode {
  const endpoint = asObject(value, label);
  return { species: endpoint.species, evolves_to: endpoint.evolves_to, evolution_details: endpoint.evolution_details };
}

function referenceId(value: unknown, resource: string): number {
  const url = asObject(value, resource).url;
  if (typeof url !== 'string') throw new Error(`Expected ${resource} reference`);
  const match = new RegExp(`^/api/v2/${resource}/([1-9][0-9]*)/$`).exec(url);
  if (match === null) throw new Error(`Expected ${resource} reference`);
  return Number(match[1]);
}

function nullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`Expected ${label}`);
  return value;
}

function sourceProvenance(chainId: number): Provenance[] {
  return [{
    sourceId: REQUIRED_POKEAPI_SOURCE.id,
    revision: REQUIRED_POKEAPI_SOURCE.revision,
    locator: `evolution-chain/${chainId}`,
    method: 'generated',
    confidence: 'verified',
    note: null,
  }];
}

function normalizeTrigger(detail: Endpoint): EvolutionEdge['trigger'] {
  const trigger = asObject(detail.trigger, 'evolution trigger').name;
  if (trigger === 'trade') return 'trade';
  if (trigger === 'use-item') return 'item';
  if (trigger === 'level-up') {
    return detail.min_happiness !== null || detail.min_affection !== null ? 'friendship' : 'level';
  }
  return 'other';
}

function sourceReason(detail: Endpoint): string | null {
  if (detail.relative_physical_stats === 1) return 'attack-greater-than-defense';
  if (detail.relative_physical_stats === -1) return 'attack-less-than-defense';
  if (detail.relative_physical_stats === 0) return 'attack-equals-defense';
  if (detail.relative_physical_stats !== null) throw new Error('Unsupported relative physical stats evolution condition');
  if (detail.time_of_day === 'day') return 'daytime';
  if (detail.time_of_day === 'night') return 'nighttime';
  if (detail.time_of_day !== '') throw new Error('Unsupported time-of-day evolution condition');
  if (detail.min_beauty !== null) return `beauty-at-least-${nullablePositiveInteger(detail.min_beauty, 'minimum beauty')}`;
  return null;
}

function selectFireRedDetail(reader: Reader, details: unknown): Endpoint {
  const targetOrder = asObject(reader.readVersionGroup(7), 'version group').order;
  if (typeof targetOrder !== 'number' || !Number.isInteger(targetOrder)) throw new Error('Expected FireRed version-group order');
  const candidates = asArray(details, 'evolution details')
    .map((detail) => asObject(detail, 'evolution detail'))
    .filter((detail) => detail.base_form === null && detail.evolved_form === null)
    .map((detail) => {
      const versionGroupId = referenceId(detail.version_group, 'version-group');
      const order = asObject(reader.readVersionGroup(versionGroupId), 'version group').order;
      if (typeof order !== 'number' || !Number.isInteger(order)) throw new Error('Expected version-group order');
      return { detail, order };
    })
    .filter(({ order }) => order <= targetOrder)
    .sort((left, right) => right.order - left.order);
  if (candidates.length === 0) throw new Error('Expected a FireRed-applicable evolution detail');
  return candidates[0].detail;
}

function compileSourceEdge(fromPokemonId: number, toPokemonId: number, detail: Endpoint, chainId: number): EvolutionEdge {
  const item = detail.item ?? detail.held_item;
  return {
    fromPokemonId,
    toPokemonId,
    trigger: normalizeTrigger(detail),
    minimumLevel: nullablePositiveInteger(detail.min_level, 'minimum evolution level'),
    itemId: item === null ? null : referenceId(item, 'item'),
    locationId: detail.location === null ? null : referenceId(detail.location, 'location'),
    status: 'standard',
    milestoneId: null,
    reason: sourceReason(detail),
    provenance: sourceProvenance(chainId),
  };
}

function applyOverrides(sourceEdges: EvolutionEdge[], overrides: EvolutionOverride[]): EvolutionEdge[] {
  const byPair = new Map(overrides.map((override) => [`${override.fromPokemonId}:${override.toPokemonId}`, override]));
  if (byPair.size !== overrides.length) throw new Error('Duplicate evolution override');

  for (const override of overrides) {
    const candidates = sourceEdges.filter((edge) => edge.fromPokemonId === override.fromPokemonId && edge.toPokemonId === override.toPokemonId);
    if (candidates.length !== 1) throw new Error(`Override ${override.fromPokemonId}->${override.toPokemonId} did not match exactly one source edge`);
  }

  return sourceEdges.map((edge) => {
    const override = byPair.get(`${edge.fromPokemonId}:${edge.toPokemonId}`);
    if (override === undefined) return edge;
    return { ...edge, status: override.status, milestoneId: override.milestoneId, reason: override.reason, provenance: [...edge.provenance, ...override.provenance] };
  });
}

export function compileEvolutions(reader: Reader, pokemon: Pick<PokemonRecord, 'id'>[], overrides: EvolutionOverride[]): EvolutionEdge[] {
  assertFireRedSourceContext(reader);
  const parsedOverrides = parseEvolutionOverrides(overrides);
  assertOverrideSourcesRegistered(parsedOverrides, parseEvolutionSources(evolutionSourcesInput));
  const speciesIds = new Set(pokemon.map(({ id }) => id));
  if (pokemon.length !== 386 || speciesIds.size !== 386 || Array.from({ length: 386 }, (_, index) => index + 1).some((id) => !speciesIds.has(id))) {
    throw new Error('Expected Pokemon catalog IDs 1 through 386 exactly once');
  }
  const chainIds = new Set<number>();
  const sourceEdges: EvolutionEdge[] = [];

  for (const speciesId of [...speciesIds].sort((left, right) => left - right)) {
    const species = asObject(reader.read('pokemon-species', speciesId), 'pokemon species');
    const chainId = referenceId(species.evolution_chain, 'evolution-chain');
    if (chainIds.has(chainId)) continue;
    chainIds.add(chainId);

    const chain = asObject(reader.read('evolution-chain', chainId), 'evolution chain');
    const pending: ChainNode[] = [asChainNode(chain.chain, 'evolution chain root')];
    while (pending.length > 0) {
      const from = pending.shift()!;
      const fromPokemonId = referenceId(from.species, 'pokemon-species');
      for (const rawTarget of asArray(from.evolves_to, 'evolution targets')) {
        const target = asChainNode(rawTarget, 'evolution target');
        pending.push(target);
        const toPokemonId = referenceId(target.species, 'pokemon-species');
        if (!speciesIds.has(fromPokemonId) || !speciesIds.has(toPokemonId)) continue;
        sourceEdges.push(compileSourceEdge(fromPokemonId, toPokemonId, selectFireRedDetail(reader, target.evolution_details), chainId));
      }
    }
  }

  return applyOverrides(sourceEdges, parsedOverrides)
    .sort((left, right) => left.fromPokemonId - right.fromPokemonId || left.toPokemonId - right.toPokemonId);
}

export function deriveEvolutionClosure(seedSpeciesIds: number[], edges: EvolutionEdge[]): number[] {
  const available = new Map<number, number[]>();
  for (const edge of edges) {
    if (edge.status === 'unavailable' || edge.fromPokemonId < 1 || edge.fromPokemonId > 386 || edge.toPokemonId < 1 || edge.toPokemonId > 386) continue;
    const targets = available.get(edge.fromPokemonId) ?? [];
    targets.push(edge.toPokemonId);
    available.set(edge.fromPokemonId, targets);
  }

  const closure = new Set(seedSpeciesIds.filter((id) => Number.isInteger(id) && id >= 1 && id <= 386));
  const pending = [...closure];
  while (pending.length > 0) {
    const source = pending.shift()!;
    for (const target of available.get(source) ?? []) {
      if (!closure.has(target)) {
        closure.add(target);
        pending.push(target);
      }
    }
  }
  return [...closure].sort((left, right) => left - right);
}
