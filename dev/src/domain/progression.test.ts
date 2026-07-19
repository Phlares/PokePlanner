import { describe, expect, it } from 'vitest';
import { validateRouteProgression } from './progression';

const validProgression = {
  schemaVersion: 1,
  game: { id: 'firered', name: 'Pokémon FireRed', versionId: 10, versionGroupId: 7, generationId: 3, regionId: 1 },
  sources: [{ id: 'manual-research', name: 'FireRed research', revision: '1', license: null, url: 'https://example.invalid/research' }],
  nodes: [{
    id: 'pallet-town', name: 'Pallet Town', kind: 'town', phase: 'opening', goldenPathOrder: 1, branch: 'main', parentNodeId: null,
    prerequisiteEventIds: [], nextNodeIds: [],
    location: { pokeApiLocationId: 88, pokeApiLocationAreaIds: [285], sourceMapIds: ['MAP_PALLET_TOWN'] },
    versionFlags: { firered: { available: true, exclusive: false, note: null } },
    events: [],
    provenance: [{ sourceId: 'manual-research', locator: 'pallet-town', method: 'manual', confidence: 'verified', note: null }],
  }],
};

describe('validateRouteProgression', () => {
  it('accepts a provenance-backed FireRed progression document', () => {
    expect(validateRouteProgression(validProgression)).toEqual({ valid: true });
  });

  it('rejects a node without provenance', () => {
    const invalid = structuredClone(validProgression);
    invalid.nodes[0].provenance = [];
    const result = validateRouteProgression(invalid);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toContain('minItems');
  });
});
