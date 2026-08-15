import { describe, expect, it } from 'vitest';
import { planCodeFromShareUrl, prepareRunImport } from './import-source';
import { MILESTONE_ORDER } from '../domain/availability';
import {
  createStandardPlaythrough,
  parsePlaythrough,
  type Playthrough,
  type PlaythroughPackIndex,
} from '../domain/playthrough';
import { FIRE_RED_RULES } from '../domain/rules/firered-rules';
import { serializePlaythroughExport } from './export-import';
import { encodePlanCode } from './plan-code';
import { loadFireRedPackFixture } from '../test/firered-pack';

const pack = loadFireRedPackFixture();

function packIndex(): PlaythroughPackIndex {
  const byId = new Map(pack.pokemon.map((record) => [record.id, record]));
  const milestones = new Set<string>([
    ...MILESTONE_ORDER,
    ...FIRE_RED_RULES.milestones.map((milestone) => milestone.id),
  ]);
  const acquisitions = new Set(pack.acquisitions.map((record) => record.id));
  return {
    hasSpecies: (id) => byId.has(id),
    legalAbilityIds: (id) => byId.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id, moveId) =>
      (pack.learnsets.find((record) => record.pokemonId === id)?.moves ?? []).some((move) => move.moveId === moveId),
    hasMilestone: (id) => milestones.has(id),
    hasAcquisition: (id) => acquisitions.has(id),
    hasNode: (id) => id === 'starter-selection' || milestones.has(id),
    starterNodeId: () => 'starter-selection',
  };
}

const emptyFrame = (nodeId: string) => ({
  nodeId,
  kind: 'major' as const,
  party: [null, null, null, null, null, null],
  reserve: [],
  released: [],
  snapshots: {},
});

/** 4 members and 2 keyframes — two different counts, so neither can stand in for the other. */
function sampleRun(overrides: Partial<Playthrough> = {}): Playthrough {
  const base = createStandardPlaythrough(
    { id: 'run-1', name: 'Kanto ledger', starterSpeciesId: 1, createdAt: 0, updatedAt: 0, packVersion: pack.manifest.packVersion },
    packIndex(),
  );
  const members = Object.fromEntries(Array.from({ length: 4 }, (unused, index) => [`m${index}`, {
    id: `m${index}`,
    originalSpeciesId: 1,
    speciesSequence: index + 1,
    nickname: null,
    natureId: null,
    origin: { type: 'inferred' as const, acquisitionId: null, note: null },
    acquiredAtNodeId: 'starter',
    notes: '',
    lifecycle: [],
  }]));
  return parsePlaythrough({
    ...base,
    timeline: {
      ...base.timeline,
      members,
      keyframes: { starter: emptyFrame('starter'), 'brock-gym': emptyFrame('brock-gym') },
    },
    ...overrides,
  }, packIndex());
}

const prepare = (input: string, packVersion = pack.manifest.packVersion) =>
  prepareRunImport(input, packIndex(), packVersion);

describe('planCodeFromShareUrl', () => {
  it('reads a plan code out of the query string', () => {
    const code = encodePlanCode(sampleRun());
    expect(planCodeFromShareUrl(`https://pokeplanner.example/?plan=${code}`)).toBe(code);
  });

  it('reads a plan code out of the fragment, so the code never leaves the browser', () => {
    const code = encodePlanCode(sampleRun());
    expect(planCodeFromShareUrl(`https://pokeplanner.example/#plan=${code}`)).toBe(code);
  });

  it('ignores a link with no plan parameter', () => {
    expect(planCodeFromShareUrl('https://pokeplanner.example/?run=42')).toBeNull();
  });

  it('ignores a plan parameter that is not a plan code', () => {
    expect(planCodeFromShareUrl('https://pokeplanner.example/?plan=not-a-code')).toBeNull();
  });

  it('ignores a non-web scheme', () => {
    const code = encodePlanCode(sampleRun());
    expect(planCodeFromShareUrl(`javascript:void?plan=${code}`)).toBeNull();
    expect(planCodeFromShareUrl(`file:///tmp/x?plan=${code}`)).toBeNull();
  });

  it('ignores text that is not a URL at all', () => {
    expect(planCodeFromShareUrl('{ "schemaVersion": 2 }')).toBeNull();
  });
});

describe('prepareRunImport', () => {
  it('previews a JSON export with the counts the payload actually carries', () => {
    const preview = prepare(serializePlaythroughExport(sampleRun()));
    expect(preview.source).toBe('json');
    expect(preview.name).toBe('Kanto ledger');
    expect(preview.memberCount).toBe(4);
    expect(preview.milestoneCount).toBe(2);
    expect(preview.warnings).toEqual([]);
  });

  it('previews a bare plan code with the same counts as its JSON twin', () => {
    const run = sampleRun();
    const fromCode = prepare(encodePlanCode(run));
    const fromJson = prepare(serializePlaythroughExport(run));
    expect(fromCode.source).toBe('plan-code');
    expect(fromCode.memberCount).toBe(4);
    expect(fromCode.milestoneCount).toBe(2);
    expect(fromCode.name).toBe(fromJson.name);
  });

  it('previews a share link by decoding the code it carries locally', () => {
    const code = encodePlanCode(sampleRun());
    const preview = prepare(`https://pokeplanner.example/plan#plan=${code}`);
    expect(preview.source).toBe('share-url');
    expect(preview.memberCount).toBe(4);
    expect(preview.playthrough.name).toBe('Kanto ledger');
  });

  it('warns when the payload was authored against a different pack', () => {
    const preview = prepare(serializePlaythroughExport(sampleRun()), 'pack-9999');
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toContain('pack-9999');
  });

  it('rejects a web link that carries no plan code', () => {
    expect(() => prepare('https://pokeplanner.example/plan')).toThrow(/does not carry a plan code/i);
  });

  it('rejects empty input', () => {
    expect(() => prepare('   ')).toThrow(/plan code/i);
  });

  it('rejects text that is neither JSON nor a plan code', () => {
    expect(() => prepare('PP1.not-valid')).toThrow();
    expect(() => prepare('{ not valid json')).toThrow();
  });

  it('returns a validated record without writing anything', () => {
    const preview = prepare(encodePlanCode(sampleRun()));
    expect(() => parsePlaythrough(preview.playthrough, packIndex())).not.toThrow();
  });
});
