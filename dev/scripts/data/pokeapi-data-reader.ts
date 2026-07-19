import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RESOURCE_PATTERN = /^[a-z0-9-]+$/;

export class PokeApiDataReader {
  constructor(private readonly sourceRoot: string) {}

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
}
