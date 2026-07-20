import type { Provenance } from '../../../src/domain/pack';
import { REQUIRED_POKEAPI_SOURCE } from '../source-lock';

/** A decoded PokeAPI endpoint object. */
export type Endpoint = Record<string, unknown>;

/** Shared PokeAPI-JSON guards. Each throws a labelled error rather than returning a partial. */
export function asObject(value: unknown, label: string): Endpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Expected ${label} endpoint`);
  return value as Endpoint;
}

export function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${label} list`);
  return value;
}

export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Expected ${label}`);
  return value;
}

export function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`Expected ${label}`);
  return value as number;
}

export function resourceName(value: unknown, resource: string): string {
  return text(asObject(value, resource).name, `${resource} name`);
}

/** Resolve the numeric id from an endpoint reference's `url` (e.g. `/api/v2/move/33/`). */
export function endpointId(value: unknown, resource: string): number {
  const url = text(asObject(value, resource).url, `${resource} URL`);
  const match = new RegExp(`^/api/v2/${resource}/([1-9][0-9]*)/$`).exec(url);
  if (match === null) throw new Error(`Expected ${resource} reference`);
  return Number(match[1]);
}

/** Title-case a hyphenated slug (`rock-smash` → `Rock Smash`). */
export function title(slug: string): string {
  return slug.split('-').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

/** A single verified, generated provenance entry pinned to the required PokeAPI source. */
export function generatedProvenance(locator: string, note: string | null = null): Provenance[] {
  return [{
    sourceId: REQUIRED_POKEAPI_SOURCE.id,
    revision: REQUIRED_POKEAPI_SOURCE.revision,
    locator,
    method: 'generated',
    confidence: 'verified',
    note,
  }];
}
