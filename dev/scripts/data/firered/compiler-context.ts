import { REQUIRED_POKEAPI_SOURCE } from '../source-lock';

export const FIRERED_IDS = Object.freeze({ versionId: 10, versionGroupId: 7, generationId: 3 });
const PINNED_SOURCE_TIMESTAMP = '2026-07-19T04:09:43+02:00';

interface Reader {
  readVersion(id: number): unknown;
  readVersionGroup(id: number): unknown;
  readGeneration(id: number): unknown;
}

function referenceId(value: unknown, resource: string): number {
  if (typeof value !== 'string') throw new Error(`Expected ${resource} reference`);
  const match = new RegExp(`^/api/v2/${resource}/([1-9][0-9]*)/$`).exec(value);
  if (match === null) throw new Error(`Expected ${resource} reference`);
  return Number(match[1]);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Expected ${label} endpoint`);
  return value as Record<string, unknown>;
}

function id(value: unknown, label: string): number {
  const parsed = object(value, label).id;
  if (!Number.isInteger(parsed)) throw new Error(`Expected ${label} ID`);
  return parsed as number;
}

export function assertFireRedSourceContext(reader: Reader) {
  const version = object(reader.readVersion(FIRERED_IDS.versionId), 'version');
  if (id(version, 'version') !== FIRERED_IDS.versionId) throw new Error('Expected FireRed version 10');
  if (version.name !== 'firered') throw new Error('Expected FireRed version title');
  if (object(version.version_group, 'version group').name !== 'firered-leafgreen') throw new Error('Expected FireRed version group reference title');
  const versionGroupId = referenceId(object(version.version_group, 'version group').url, 'version-group');
  if (versionGroupId !== FIRERED_IDS.versionGroupId) throw new Error('Expected FireRed version group 7');

  const versionGroup = object(reader.readVersionGroup(versionGroupId), 'version group');
  if (id(versionGroup, 'version group') !== FIRERED_IDS.versionGroupId) throw new Error('Expected FireRed version group 7');
  if (versionGroup.name !== 'firered-leafgreen') throw new Error('Expected FireRed version group title');
  if (object(versionGroup.generation, 'generation').name !== 'generation-iii') throw new Error('Expected Generation III reference title');
  const generationId = referenceId(object(versionGroup.generation, 'generation').url, 'generation');
  if (generationId !== FIRERED_IDS.generationId) throw new Error('Expected Generation III');

  const generation = object(reader.readGeneration(generationId), 'generation');
  if (id(generation, 'generation') !== FIRERED_IDS.generationId) throw new Error('Expected Generation III');
  if (generation.name !== 'generation-iii') throw new Error('Expected Generation III title');

  return Object.freeze({
    ...FIRERED_IDS,
    source: Object.freeze({
      id: REQUIRED_POKEAPI_SOURCE.id,
      revision: REQUIRED_POKEAPI_SOURCE.revision,
      license: REQUIRED_POKEAPI_SOURCE.license,
      builtAt: PINNED_SOURCE_TIMESTAMP,
    }),
  });
}
