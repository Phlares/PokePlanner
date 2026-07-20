import { describe, expect, it } from 'vitest';
import { validateRouteProgression, type ProgressionEvent, type ProgressionNode } from '../../../src/domain/progression';
import { parseLearnsetRecords, type AcquisitionRecord } from '../../../src/domain/pack';
import type { NormalizedLearnsetRecord } from './normalizer';
import {
  attachAcquisitionIds,
  FIRERED_ENCOUNTER_AREA_IDS,
  loadFireRedAcquisitions,
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

const acquisitions = loadFireRedAcquisitions();

function machines(kind: 'tm' | 'hm'): AcquisitionRecord[] {
  return acquisitions.filter((record) => record.subject.kind === kind);
}
function tutors(): AcquisitionRecord[] {
  return acquisitions.filter((record) => record.subject.kind === 'tutor');
}
function machineByNumber(kind: 'tm' | 'hm', machineNumber: number): AcquisitionRecord {
  const found = acquisitions.find((record) =>
    record.subject.kind === kind
    && 'machineNumber' in record.subject && record.subject.machineNumber === machineNumber);
  if (found === undefined) throw new Error(`Missing ${kind}${machineNumber}`);
  return found;
}
function tutorByMove(moveId: number): AcquisitionRecord {
  const found = tutors().find((record) => record.subject.kind === 'tutor' && record.subject.moveId === moveId);
  if (found === undefined) throw new Error(`Missing tutor for move ${moveId}`);
  return found;
}
function speciesOf(kind: AcquisitionRecord['subject']['kind'], pokemonId: number): AcquisitionRecord[] {
  return acquisitions.filter((record) =>
    record.subject.kind === kind && 'pokemonId' in record.subject && record.subject.pokemonId === pokemonId);
}
function notesOf(record: AcquisitionRecord): string {
  return record.provenance.map((entry) => entry.note ?? '').join(' | ');
}

describe('FireRed TM, HM, and tutor acquisitions', () => {
  it('records exactly 50 TMs, 8 HMs, and 18 move tutors', () => {
    expect(machines('tm')).toHaveLength(50);
    expect(machines('hm')).toHaveLength(8);
    expect(tutors()).toHaveLength(18);
  });

  it('marks HM08 Dive unavailable while keeping the seven usable HMs', () => {
    const dive = machineByNumber('hm', 8);
    expect(dive.status).toBe('unavailable');
    expect(dive.subject.kind === 'hm' && dive.subject.moveId).toBe(291);

    const usable = machines('hm').filter((record) => record.status !== 'unavailable');
    expect(usable).toHaveLength(7);
    const usableMoveIds = usable.map((record) => (record.subject.kind === 'hm' ? record.subject.moveId : -1)).sort((a, b) => a - b);
    // Cut(15) Fly(19) Surf(57) Strength(70) Waterfall(127) Flash(148) Rock Smash(249)
    expect(usableMoveIds).toEqual([15, 19, 57, 70, 127, 148, 249]);
  });

  it('carries non-empty provenance that resolves against the research-source registry', () => {
    const sources = new Map(loadFireRedProgression().sources.map((source) => [source.id, source]));
    for (const record of acquisitions) {
      expect(record.provenance.length).toBeGreaterThan(0);
      for (const entry of record.provenance) {
        const source = sources.get(entry.sourceId);
        expect(source, `unresolved source ${entry.sourceId}`).toBeDefined();
        expect(entry.revision).toBe(source!.revision);
        expect(entry.confidence).not.toBe('provisional');
      }
    }
  });

  it('gives TM39 Rock Tomb after Brock', () => {
    const tm39 = machineByNumber('tm', 39);
    expect(tm39.subject.kind === 'tm' && tm39.subject.moveId).toBe(317);
    expect(tm39.milestoneId).toBe('brock-gym');
    expect(tm39.prerequisites).toContain('brock-gym');
  });

  it('anchors HM01 Cut to the S.S. Anne with a Cascade Badge field-use note', () => {
    const cut = machineByNumber('hm', 1);
    expect(cut.subject.kind === 'hm' && cut.subject.moveId).toBe(15);
    expect(cut.milestoneId).toBe('misty-gym');
    expect(notesOf(cut)).toMatch(/S\.S\. Anne/);
    expect(notesOf(cut)).toMatch(/Cascade Badge/);
  });

  it('anchors HM03 Surf to the Safari Zone with a Soul Badge field-use note', () => {
    const surf = machineByNumber('hm', 3);
    expect(surf.subject.kind === 'hm' && surf.subject.moveId).toBe(57);
    expect(surf.milestoneId).toBe('koga-gym');
    expect(notesOf(surf)).toMatch(/Safari Zone/);
    expect(notesOf(surf)).toMatch(/Soul Badge/);
  });

  it('places the Rock Slide tutor in Rock Tunnel', () => {
    const rockSlide = tutorByMove(157);
    expect(notesOf(rockSlide)).toMatch(/Rock Tunnel/);
  });

  it('retains a postgame drawer for a later-milestone tutor', () => {
    const bodySlam = tutorByMove(34);
    expect(bodySlam.status).toBe('postgame');
    expect(bodySlam.milestoneId).toBe('champion');
    expect(bodySlam.prerequisites.length).toBeGreaterThan(0);
    // A later-badge gated machine also exists (Victory Road grade).
    expect(acquisitions.some((record) => record.milestoneId === 'giovanni-gym')).toBe(true);
  });
});

describe('FireRed non-wild Pokemon acquisitions', () => {
  it('offers the three starters as a mutually exclusive choice', () => {
    for (const id of [1, 4, 7]) {
      const starter = speciesOf('starter', id);
      expect(starter).toHaveLength(1);
      expect(starter[0].status).toBe('standard');
      expect(starter[0].milestoneId).toBe('starter-selection');
    }
  });

  it('records the Celadon Eevee and Silph Co. Lapras gifts', () => {
    expect(speciesOf('gift', 133)).toHaveLength(1);
    expect(speciesOf('gift', 131)).toHaveLength(1);
  });

  it('records the Fighting Dojo Hitmonlee/Hitmonchan choice', () => {
    const lee = speciesOf('gift', 106);
    const chan = speciesOf('gift', 107);
    expect(lee).toHaveLength(1);
    expect(chan).toHaveLength(1);
    expect(notesOf(lee[0])).toMatch(/Fighting Dojo/);
    expect(notesOf(chan[0])).toMatch(/Fighting Dojo/);
  });

  it('records the fossil revivals including Old Amber Aerodactyl', () => {
    expect(speciesOf('fossil', 138)).toHaveLength(1); // Omanyte
    expect(speciesOf('fossil', 140)).toHaveLength(1); // Kabuto
    expect(speciesOf('fossil', 142)).toHaveLength(1); // Aerodactyl
  });

  it('records the trade-only Pokemon', () => {
    for (const id of [122, 83, 108, 124, 114]) {
      expect(speciesOf('trade', id)).toHaveLength(1);
    }
  });

  it('records a Game Corner prize Pokemon', () => {
    expect(speciesOf('game-corner', 137)).toHaveLength(1); // Porygon
  });

  it('records the two Poke Flute Snorlax as separate static facts', () => {
    expect(speciesOf('static', 143)).toHaveLength(2);
  });

  it('records the three legendary birds as standard statics and Mewtwo as postgame', () => {
    for (const id of [144, 145, 146]) {
      const bird = speciesOf('static', id);
      expect(bird).toHaveLength(1);
      expect(bird[0].status).toBe('standard');
    }
    const mewtwo = speciesOf('static', 150);
    expect(mewtwo).toHaveLength(1);
    expect(mewtwo[0].status).toBe('postgame');
  });

  it('gates the roaming beasts on the chosen starter', () => {
    const raikou = speciesOf('static', 243)[0];
    const entei = speciesOf('static', 244)[0];
    const suicune = speciesOf('static', 245)[0];
    for (const beast of [raikou, entei, suicune]) expect(beast.status).toBe('postgame');
    expect(notesOf(raikou)).toMatch(/Squirtle/);
    expect(notesOf(entei)).toMatch(/Bulbasaur/);
    expect(notesOf(suicune)).toMatch(/Charmander/);
  });

  it('records the event-only mythicals and roaming birds as event-only', () => {
    for (const id of [151, 249, 250, 386]) {
      const event = speciesOf('event', id);
      expect(event).toHaveLength(1);
      expect(event[0].status).toBe('event-only');
    }
  });

  it('records version-exclusive and transfer-only species with the correct status', () => {
    const vulpix = speciesOf('transfer', 37);
    expect(vulpix).toHaveLength(1);
    expect(vulpix[0].status).toBe('version-exclusive');
    expect(notesOf(vulpix[0])).toMatch(/LeafGreen/);
    expect(acquisitions.some((record) => record.status === 'transfer-only')).toBe(true);
  });
});

describe('attachAcquisitionIds', () => {
  const provenance = [{
    sourceId: 'pokeapi-api-data',
    revision: '0fb5313cb77f46269502e987a53a0bf751ae883d',
    locator: 'pokemon/56',
    method: 'generated' as const,
    confidence: 'verified' as const,
    note: null,
  }];

  it('joins machine and tutor learn entries to concrete acquisition facts', () => {
    const normalized: NormalizedLearnsetRecord[] = [{
      pokemonId: 56,
      moves: [
        { method: 'level-up', moveId: 2, level: 1 },
        { method: 'machine', moveId: 317 }, // Rock Tomb (TM39)
        { method: 'tutor', moveId: 157 }, // Rock Slide
        { method: 'egg', moveId: 34 },
      ],
      provenance,
    }];

    const result = attachAcquisitionIds(normalized, acquisitions);
    expect(() => parseLearnsetRecords(result)).not.toThrow();

    const moves = result[0].moves;
    const machine = moves.find((move) => move.method === 'machine')!;
    const tutor = moves.find((move) => move.method === 'tutor')!;
    const expectedMachine = acquisitions
      .filter((record) => (record.subject.kind === 'tm' || record.subject.kind === 'hm') && record.subject.moveId === 317)
      .map((record) => record.id).sort();
    const expectedTutor = acquisitions
      .filter((record) => record.subject.kind === 'tutor' && record.subject.moveId === 157)
      .map((record) => record.id).sort();
    expect(machine.method === 'machine' && [...machine.acquisitionIds].sort()).toEqual(expectedMachine);
    expect(tutor.method === 'tutor' && [...tutor.acquisitionIds].sort()).toEqual(expectedTutor);
    expect(expectedMachine.length).toBeGreaterThan(0);
    expect(expectedTutor.length).toBeGreaterThan(0);

    // Untouched methods are preserved verbatim.
    expect(moves.find((move) => move.method === 'level-up')).toEqual({ method: 'level-up', moveId: 2, level: 1 });
    expect(moves.find((move) => move.method === 'egg')).toEqual({ method: 'egg', moveId: 34 });
  });

  it('throws when a machine learn entry resolves to zero acquisitions', () => {
    const normalized: NormalizedLearnsetRecord[] = [{
      pokemonId: 56,
      moves: [{ method: 'machine', moveId: 300 }], // Air Cutter is not a FireRed TM/HM
      provenance,
    }];
    expect(() => attachAcquisitionIds(normalized, acquisitions)).toThrow();
  });
});
