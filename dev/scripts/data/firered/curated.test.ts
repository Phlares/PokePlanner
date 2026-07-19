import { describe, expect, it } from 'vitest';
import { validateRouteProgression, type ProgressionEvent, type ProgressionNode } from '../../../src/domain/progression';
import {
  FIRERED_ENCOUNTER_AREA_IDS,
  loadFireRedProgression,
  loadFireRedSources,
  mapEncounterAreasToNodes,
} from './curated';

const progression = loadFireRedProgression();

function allEvents(nodes: ProgressionNode[]): ProgressionEvent[] {
  return nodes.flatMap((node) => node.events);
}

function findEvent(id: string): ProgressionEvent {
  const event = allEvents(progression.nodes).find((candidate) => candidate.id === id);
  if (event === undefined) throw new Error(`Missing expected event ${id}`);
  return event;
}

function mainNodes(): ProgressionNode[] {
  return progression.nodes.filter((node) => node.branch === undefined || node.branch === 'main');
}

describe('FireRed curated route progression', () => {
  it('loads a research-source registry that validates', () => {
    const registry = loadFireRedSources();
    expect(registry.sources.length).toBeGreaterThan(0);
    expect(registry.sources.every((source) => source.id.length > 0 && source.url.startsWith('https://'))).toBe(true);
  });

  it('passes the shared validateRouteProgression contract', () => {
    expect(validateRouteProgression(progression)).toEqual({ valid: true });
    expect(progression.game).toMatchObject({ versionId: 10, versionGroupId: 7, generationId: 3 });
  });

  it('starts the golden path at Pallet Town', () => {
    const firstMain = [...mainNodes()].sort((a, b) => a.goldenPathOrder - b.goldenPathOrder)[0];
    expect(firstMain.id).toBe('pallet-town');
    expect(firstMain.name).toBe('Pallet Town');
    const minOrder = Math.min(...mainNodes().map((node) => node.goldenPathOrder));
    expect(firstMain.goldenPathOrder).toBe(minOrder);
  });

  it('models Route 22 once, selectable before Brock, with the later Victory Road visit as an event', () => {
    const route22 = progression.nodes.filter((node) => node.name === 'Route 22');
    expect(route22).toHaveLength(1);
    const node = route22[0];
    // Route 22 does not require Brock's badge to be selected.
    expect(node.prerequisiteEventIds).not.toContain('brock-gym');
    // Its later Victory-Road-adjacent visit is a gated event, not a second node.
    const laterVisit = node.events.find((event) => event.id === 'route-22-victory-road-access');
    expect(laterVisit).toBeDefined();
    expect(laterVisit!.conditions.length).toBeGreaterThan(0);
  });

  it('marks Brock as a gym key milestone', () => {
    const brock = findEvent('brock-gym');
    expect(brock.type).toBe('gym');
    expect(brock.flags.gym).toBe(true);
    expect(brock.flags.keyMilestone).toBe(true);
  });

  it('keeps optional and postgame branches without breaking main-path reachability', () => {
    const branches = new Set(progression.nodes.map((node) => node.branch ?? 'main'));
    expect(branches.has('optional') || branches.has('postgame')).toBe(true);
    // validateRouteProgression enforces that every main node stays reachable through nextNodeIds.
    expect(validateRouteProgression(progression)).toEqual({ valid: true });
  });

  it('gates Cerulean Cave behind the Sevii Network Machine restoration', () => {
    const network = findEvent('network-machine-restored');
    const caves = progression.nodes.filter((node) => node.name === 'Cerulean Cave');
    expect(caves).toHaveLength(1);
    const cave = caves[0];
    expect(cave.branch).toBe('postgame');
    expect(cave.prerequisiteEventIds).toContain('network-machine-restored');
    // The restoration is authored earlier in the chronology than the cave it unlocks.
    const networkNode = progression.nodes.find((node) => node.events.some((event) => event.id === network.id))!;
    expect(networkNode.goldenPathOrder).toBeLessThan(cave.goldenPathOrder);
  });

  it('carries non-empty, non-provisional provenance on every node and event', () => {
    const sourceIds = new Set(progression.sources.map((source) => source.id));
    for (const node of progression.nodes) {
      expect(node.provenance.length).toBeGreaterThan(0);
      for (const entry of node.provenance) {
        expect(sourceIds.has(entry.sourceId)).toBe(true);
        expect(entry.confidence).not.toBe('provisional');
      }
      for (const event of node.events) {
        expect(event.provenance.length).toBeGreaterThan(0);
        for (const entry of event.provenance) {
          expect(sourceIds.has(entry.sourceId)).toBe(true);
          expect(entry.confidence).not.toBe('provisional');
        }
      }
    }
  });

  it('registers the five research sources including PokeAPI and the pret reference', () => {
    const byId = new Map(progression.sources.map((source) => [source.id, source]));
    expect(byId.get('pokeapi-api-data')?.revision).toBe('0fb5313cb77f46269502e987a53a0bf751ae883d');
    const pret = byId.get('pret-pokefirered');
    expect(pret?.revision).toBe('df4449a27cd78dd747ce269e47d3ab4a0149d8f4');
    expect(pret?.license).toBeNull();
    expect(byId.has('bulbapedia-frlg-walkthrough')).toBe(true);
    expect(byId.has('bulbapedia-gen3-tm-hm-locations')).toBe(true);
    expect(byId.has('bulbapedia-frlg-move-tutors')).toBe(true);
  });

  it('maps all 137 encounter areas to exactly one node or an explicit exception', () => {
    expect(FIRERED_ENCOUNTER_AREA_IDS).toHaveLength(137);
    expect(new Set(FIRERED_ENCOUNTER_AREA_IDS).size).toBe(137);

    const { nodeByAreaId, exceptions } = mapEncounterAreasToNodes(progression, FIRERED_ENCOUNTER_AREA_IDS);
    expect(nodeByAreaId.size + exceptions.size).toBe(137);
    // Every id is disposed exactly once, no overlap between mapped and excepted.
    for (const id of FIRERED_ENCOUNTER_AREA_IDS) {
      const mapped = nodeByAreaId.has(id);
      const excepted = exceptions.has(id);
      expect(mapped !== excepted).toBe(true);
    }
    // Every mapped node id resolves to a real node.
    const nodeIds = new Set(progression.nodes.map((node) => node.id));
    for (const nodeId of nodeByAreaId.values()) expect(nodeIds.has(nodeId)).toBe(true);
    // Every exception carries a rationale.
    for (const exception of exceptions.values()) {
      expect(['event-only', 'unsupported-area']).toContain(exception.disposition);
      expect(exception.rationale.length).toBeGreaterThan(0);
    }
  });

  it('treats event-only distribution islands as exceptions, not nodes', () => {
    const { exceptions } = mapEncounterAreasToNodes(progression, FIRERED_ENCOUNTER_AREA_IDS);
    for (const eventOnlyAreaId of [794, 806, 807, 1212]) {
      expect(exceptions.get(eventOnlyAreaId)?.disposition).toBe('event-only');
    }
    // No node claims a distribution-only area.
    for (const node of progression.nodes) {
      for (const eventOnlyAreaId of [794, 806, 807, 1212]) {
        expect(node.location.pokeApiLocationAreaIds).not.toContain(eventOnlyAreaId);
      }
    }
  });

  it('rejects duplicate or unmapped area ids', () => {
    expect(() => mapEncounterAreasToNodes(progression, [313, 313])).toThrow(/duplicate/i);
    expect(() => mapEncounterAreasToNodes(progression, [999999])).toThrow(/unmapped|unknown/i);
  });
});
