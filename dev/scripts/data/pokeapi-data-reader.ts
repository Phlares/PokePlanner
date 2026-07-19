import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const RESOURCE_PATTERN = /^[a-z0-9-]+$/;

export class PokeApiDataReader {
  constructor(
    private readonly sourceRoot: string,
    private readonly readDirectory: typeof readdirSync = readdirSync,
  ) {}

  read(resource: string, id: number): unknown {
    if (!RESOURCE_PATTERN.test(resource)) throw new Error(`Invalid resource: ${resource}`);
    if (!Number.isInteger(id) || id < 1) throw new Error(`Invalid resource ID: ${id}`);
    const path = resolve(this.sourceRoot, 'data', 'api', 'v2', resource, String(id), 'index.json');
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  }

  readVersion(id: number): unknown { return this.read('version', id); }
  readVersionGroup(id: number): unknown { return this.read('version-group', id); }
  readGeneration(id: number): unknown { return this.read('generation', id); }
  readPokemon(id: number): unknown { return this.read('pokemon', id); }

  listIds(resource: string): number[] {
    if (!RESOURCE_PATTERN.test(resource)) throw new Error(`Invalid resource: ${resource}`);

    const directory = resolve(this.sourceRoot, 'data', 'api', 'v2', resource);
    return this.readDirectory(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[1-9][0-9]*$/.test(entry.name))
      .map((entry) => Number(entry.name))
      .filter(Number.isSafeInteger)
      .sort((left, right) => left - right);
  }

  readReferenceId(url: string, resource: string): number {
    if (!RESOURCE_PATTERN.test(resource)) throw new Error(`Invalid resource: ${resource}`);

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Expected ${resource} reference`);
    }

    const match = /^\/api\/v2\/([a-z0-9-]+)\/([1-9][0-9]*)\/$/.exec(parsed.pathname);
    if (
      parsed.origin !== 'https://pokeapi.co'
      || parsed.username !== ''
      || parsed.password !== ''
      || parsed.search !== ''
      || parsed.hash !== ''
      || match?.[1] !== resource
    ) {
      throw new Error(`Expected ${resource} reference`);
    }

    const id = Number(match[2]);
    if (!Number.isSafeInteger(id)) throw new Error(`Expected ${resource} reference`);
    return id;
  }
}
