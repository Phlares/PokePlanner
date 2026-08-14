import { Deflate, deflateSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  createStandardPlaythrough,
  type Playthrough,
  type PlaythroughPackIndex,
} from '../domain/playthrough';
import { createEmptyTeam, type TeamMember } from '../domain/team';
import { decodePlanCode, encodePlanCode, preparePlanCodeImport } from './plan-code';

const MAX_COMPRESSED_BYTES = 256 * 1024;
const MAX_EXPANDED_BYTES = 4 * 1024 * 1024;

const LEGAL_ABILITIES: Record<number, number[]> = { 1: [65], 56: [72] };
const pack: PlaythroughPackIndex = {
  hasSpecies: (id) => id in LEGAL_ABILITIES,
  legalAbilityIds: (id) => LEGAL_ABILITIES[id] ?? [],
  isVersionValidMove: (_species, moveId) => new Set([10, 43, 89]).has(moveId),
  hasMilestone: (id) => new Set(['brock-gym', 'misty-gym', 'giovanni-gym']).has(id),
  hasAcquisition: (id) => new Set(['tm26-earthquake']).has(id),
  hasNode: (id) => id === 'starter-selection' || new Set(['brock-gym', 'misty-gym', 'giovanni-gym']).has(id),
  starterNodeId: () => 'starter-selection',
};

const mankey: TeamMember = {
  id: 'm1',
  speciesId: 56,
  level: 20,
  abilityId: 72,
  moves: [{ moveId: 10, status: 'available-now', level: null, milestoneId: null }],
};

function makePlaythrough(overrides: Partial<Parameters<typeof createStandardPlaythrough>[0]> = {}): Playthrough {
  return createStandardPlaythrough(
    {
      id: 'p1',
      name: 'Run One',
      starterSpeciesId: 1,
      createdAt: 1_000,
      updatedAt: 2_000,
      packVersion: 'firered-test',
      currentMilestoneId: 'brock-gym',
      previewMilestoneId: 'misty-gym',
      branchChoices: { beta: 'second', alpha: 'first' },
      acquisitionOverrides: ['tm26-earthquake'],
      timeline: {
        members: {
          m1: {
            id: 'm1', originalSpeciesId: 56, speciesSequence: 1, nickname: null, natureId: null,
            origin: { type: 'inferred', acquisitionId: null, note: null }, acquiredAtNodeId: 'brock-gym', notes: '', lifecycle: [],
          },
        },
        keyframes: {
          'brock-gym': {
            nodeId: 'brock-gym', kind: 'major', party: ['m1', null, null, null, null, null], reserve: [], released: [],
            snapshots: {
              m1: {
                speciesId: mankey.speciesId, level: mankey.level, abilityId: mankey.abilityId, moves: mankey.moves.map((move) => ({ ...move })),
                heldItemId: null, placement: 'party', partySlot: 0, review: { moves: false, heldItem: false },
              },
            },
          },
        },
        overrides: {}, preferences: { levelMode: 'manual', autoEvolveLevel: false },
      },
      ...overrides,
    },
    pack,
  );
}

function crc32(bytes: Uint8Array): string {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function codeForJson(value: unknown): string {
  const compressed = deflateSync(strToU8(JSON.stringify(value)));
  return codeForCompressed(compressed);
}

function codeForCompressed(compressed: Uint8Array): string {
  return `PP1.${base64Url(compressed)}.${crc32(compressed)}`;
}

describe('portable plan codes', () => {
  it('encodes deterministic self-contained plan codes', () => {
    const playthrough = makePlaythrough();
    const deepClone = JSON.parse(JSON.stringify(playthrough)) as Playthrough;
    const reordered = {
      ...Object.fromEntries(Object.entries(deepClone).reverse()),
      branchChoices: Object.fromEntries(Object.entries(deepClone.branchChoices).reverse()),
      timeline: {
        ...Object.fromEntries(Object.entries(deepClone.timeline).reverse()),
        members: Object.fromEntries(Object.entries(deepClone.timeline.members).reverse()),
        keyframes: Object.fromEntries(Object.entries(deepClone.timeline.keyframes).reverse()),
      },
    } as unknown as Playthrough;

    const code = encodePlanCode(playthrough);

    expect(code).toMatch(/^PP1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/u);
    expect(code).toBe(encodePlanCode(deepClone));
    expect(code).toBe(encodePlanCode(reordered));
    expect(decodePlanCode(code, pack).playthrough).toEqual(playthrough);
  });

  it('keeps only persistent playthrough data, excluding pack records, derived nodes, and findings', () => {
    const playthrough = makePlaythrough();
    const contaminated = JSON.parse(JSON.stringify(playthrough)) as Playthrough & Record<string, unknown>;
    contaminated.pack = { species: [{ id: 56 }] };
    contaminated.derivedNodes = [{ nodeId: 'route-1' }];
    contaminated.findings = [{ code: 'derived-warning' }];
    (contaminated.timeline as unknown as Record<string, unknown>).findings = [{ code: 'timeline-warning' }];

    expect(decodePlanCode(encodePlanCode(contaminated), pack).playthrough).toEqual(playthrough);
  });

  it('rejects checksum errors before decompression', () => {
    const code = encodePlanCode(makePlaythrough());
    const [version, payload, checksum] = code.split('.');
    const corruptedPayload = `${payload[0] === 'A' ? 'B' : 'A'}${payload.slice(1)}`;

    expect(() => decodePlanCode(`${version}.${corruptedPayload}.${checksum}`, pack)).toThrow(/checksum/i);
  });

  it('rejects a compressed payload above the fixed limit before decompression', () => {
    const compressed = new Uint8Array(MAX_COMPRESSED_BYTES + 1);
    for (let index = 0; index < compressed.length; index += 1) compressed[index] = index % 251;
    const oversizedCode = `PP1.${base64Url(compressed)}.${crc32(compressed)}`;

    expect(() => decodePlanCode(oversizedCode, pack)).toThrow(/compressed size limit/i);
  });

  it('rejects an expanded payload above the fixed limit', () => {
    const oversized = JSON.parse(JSON.stringify(makePlaythrough())) as Record<string, unknown>;
    oversized.notes = 'a'.repeat(MAX_EXPANDED_BYTES + 1);
    const oversizedCode = codeForJson(oversized);

    expect(() => decodePlanCode(oversizedCode, pack)).toThrow(/expanded size limit/i);
  });

  it('aborts expansion before processing trailing compressed work', () => {
    const chunks: Uint8Array[] = [];
    const stream = new Deflate({ level: 9 }, (chunk) => chunks.push(chunk));
    stream.push(strToU8('a'.repeat(MAX_EXPANDED_BYTES + 65_536)), false);
    stream.push(strToU8('trailing work that must not be reached'), true);
    expect(chunks).toHaveLength(2);

    // The first valid non-final chunk already crosses the expanded limit. Corrupting the trailing
    // chunk makes a full-stream decoder fail with invalid DEFLATE data instead of the size error.
    const corruptTail = chunks[1].slice();
    corruptTail.fill(0xff);
    const compressed = new Uint8Array(chunks[0].length + corruptTail.length);
    compressed.set(chunks[0]);
    compressed.set(corruptTail, chunks[0].length);

    expect(() => decodePlanCode(codeForCompressed(compressed), pack)).toThrow(/expanded size limit/i);
  });

  it('rejects unsupported plan-code and playthrough schema versions', () => {
    const code = encodePlanCode(makePlaythrough());
    expect(() => decodePlanCode(code.replace(/^PP1/u, 'PP2'), pack)).toThrow(/format version|client update/i);

    const future = JSON.parse(JSON.stringify(makePlaythrough())) as Record<string, unknown>;
    future.schemaVersion = 999;
    expect(() => decodePlanCode(codeForJson(future), pack)).toThrow(/schema|version/i);
  });

  it('migrates older schemas and validates every referenced pack id before preview', () => {
    const legacy = {
      schemaVersion: 1,
      id: 'legacy-plan',
      name: 'Legacy Plan',
      game: 'firered',
      type: 'standard',
      packVersion: 'firered-old',
      starterSpeciesId: 1,
      createdAt: 5,
      updatedAt: 6,
      currentMilestoneId: 'brock-gym',
      previewMilestoneId: null,
      team: createEmptyTeam(),
      branchChoices: {},
      notes: '',
      acquisitionOverrides: [],
      checkoffs: { routesCompleted: {}, encountered: {}, captured: {} },
    };

    const preview = preparePlanCodeImport(codeForJson(legacy), pack, 'firered-test');
    expect(preview).toMatchObject({
      name: 'Legacy Plan',
      game: 'firered',
      memberCount: 0,
      milestoneCount: 1,
      migrated: true,
    });
    expect(preview.warnings).toEqual([
      'This plan was migrated from an older schema.',
      'This plan uses pack "firered-old"; the current pack is "firered-test".',
    ]);

    expect(() => decodePlanCode(codeForJson({ ...legacy, starterSpeciesId: 999 }), pack)).toThrow(/starter|species/i);
  });
});
