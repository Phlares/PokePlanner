import { Inflate, deflateSync, strFromU8, strToU8 } from 'fflate';
import {
  migratePlaythrough,
  type Playthrough,
  type PlaythroughPackIndex,
} from '../domain/playthrough';
import type {
  LifecycleEvent,
  MemberSnapshot,
  PersistentMember,
  TimelineKeyframe,
  TimelineState,
} from '../domain/timeline/model';
import type { PlannedMove } from '../domain/team';

const FORMAT_VERSION = 'PP1';
const MAX_COMPRESSED_BYTES = 256 * 1024;
const MAX_EXPANDED_BYTES = 4 * 1024 * 1024;
const MAX_BASE64URL_LENGTH = Math.ceil(MAX_COMPRESSED_BYTES / 3) * 4;
const INFLATE_INPUT_CHUNK_BYTES = 64;

export interface DecodedPlanCode {
  playthrough: Playthrough;
  migrated: boolean;
}

export interface PlanCodeImportPreview extends DecodedPlanCode {
  name: string;
  game: Playthrough['game'];
  memberCount: number;
  milestoneCount: number;
  warnings: string[];
}

function copyMove(move: PlannedMove): PlannedMove {
  return {
    moveId: move.moveId,
    status: move.status,
    level: move.level,
    milestoneId: move.milestoneId,
  };
}

function copyLifecycleEvent(event: LifecycleEvent): LifecycleEvent {
  return {
    type: event.type,
    nodeId: event.nodeId,
    from: event.from,
    to: event.to,
    reason: event.reason,
  };
}

function copyMember(member: PersistentMember): PersistentMember {
  return {
    id: member.id,
    originalSpeciesId: member.originalSpeciesId,
    speciesSequence: member.speciesSequence,
    nickname: member.nickname,
    natureId: member.natureId,
    origin: {
      type: member.origin.type,
      acquisitionId: member.origin.acquisitionId,
      note: member.origin.note,
    },
    acquiredAtNodeId: member.acquiredAtNodeId,
    notes: member.notes,
    lifecycle: member.lifecycle.map(copyLifecycleEvent),
  };
}

function copySnapshot(snapshot: MemberSnapshot): MemberSnapshot {
  return {
    speciesId: snapshot.speciesId,
    level: snapshot.level,
    abilityId: snapshot.abilityId,
    moves: snapshot.moves.map(copyMove),
    heldItemId: snapshot.heldItemId,
    placement: snapshot.placement,
    partySlot: snapshot.partySlot,
    review: {
      moves: snapshot.review.moves,
      heldItem: snapshot.review.heldItem,
    },
  };
}

function mapRecord<T, U>(record: Readonly<Record<string, T>>, mapValue: (value: T) => U): Record<string, U> {
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, mapValue(record[key])]),
  );
}

function copyKeyframe(keyframe: TimelineKeyframe): TimelineKeyframe {
  return {
    nodeId: keyframe.nodeId,
    kind: keyframe.kind,
    party: [...keyframe.party],
    reserve: [...keyframe.reserve],
    released: [...keyframe.released],
    snapshots: mapRecord(keyframe.snapshots, copySnapshot),
  };
}

function copyTimeline(timeline: TimelineState): TimelineState {
  return {
    members: mapRecord(timeline.members, copyMember),
    keyframes: mapRecord(timeline.keyframes, copyKeyframe),
    overrides: mapRecord(timeline.overrides, copyKeyframe),
    preferences: {
      levelMode: timeline.preferences.levelMode,
      autoEvolveLevel: timeline.preferences.autoEvolveLevel,
    },
  };
}

/** Select only current persistent fields. Pack records, resolver output, and findings are omitted. */
function persistentPlaythrough(playthrough: Playthrough): Omit<Playthrough, 'team'> {
  return {
    schemaVersion: playthrough.schemaVersion,
    packVersion: playthrough.packVersion,
    id: playthrough.id,
    name: playthrough.name,
    game: playthrough.game,
    type: playthrough.type,
    createdAt: playthrough.createdAt,
    updatedAt: playthrough.updatedAt,
    starterSpeciesId: playthrough.starterSpeciesId,
    branchChoices: mapRecord(playthrough.branchChoices, (choice) => choice),
    currentMilestoneId: playthrough.currentMilestoneId,
    previewMilestoneId: playthrough.previewMilestoneId,
    timeline: copyTimeline(playthrough.timeline),
    notes: playthrough.notes,
    acquisitionOverrides: [...playthrough.acquisitionOverrides],
    checkoffs: {
      routesCompleted: mapRecord(playthrough.checkoffs.routesCompleted, (value) => value),
      encountered: mapRecord(playthrough.checkoffs.encountered, (value) => value),
      captured: mapRecord(playthrough.checkoffs.captured, (value) => value),
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  // Array order is persistent domain state (party slots, move order, lifecycle order, and pools).
  if (Array.isArray(value)) return value.map(canonicalize);
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(source[key])]),
  );
}

function canonicalCompactJson(playthrough: Playthrough): string {
  return JSON.stringify(canonicalize(persistentPlaythrough(playthrough)));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length % 4 === 1) {
    throw new Error('Plan code has an invalid base64url payload');
  }
  if (encoded.length > MAX_BASE64URL_LENGTH) {
    throw new Error(`Plan code exceeds the compressed size limit of ${MAX_COMPRESSED_BYTES} bytes`);
  }
  const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  let binary: string;
  try {
    binary = atob(base64);
  } catch (error) {
    throw new Error(`Plan code has an invalid base64url payload: ${error instanceof Error ? error.message : String(error)}`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length > MAX_COMPRESSED_BYTES) {
    throw new Error(`Plan code exceeds the compressed size limit of ${MAX_COMPRESSED_BYTES} bytes`);
  }
  if (bytesToBase64Url(bytes) !== encoded) throw new Error('Plan code has a non-canonical base64url payload');
  return bytes;
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

function parseCode(code: string): Uint8Array {
  const normalized = code.trim();
  const [version] = normalized.split('.', 1);
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported plan-code format version "${version || 'missing'}"; update PokePlanner to import this code`);
  }
  const parts = normalized.split('.');
  if (parts.length !== 3 || !/^[0-9a-f]{8}$/u.test(parts[2])) {
    throw new Error('Plan code has an invalid checksum field');
  }
  const compressed = base64UrlToBytes(parts[1]);
  if (crc32(compressed) !== parts[2]) throw new Error('Plan code checksum does not match its payload');
  return compressed;
}

function inflateWithinLimit(compressed: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let expandedBytes = 0;
  const sizeError = new Error(`Plan code exceeds the expanded size limit of ${MAX_EXPANDED_BYTES} bytes`);
  const inflater = new Inflate((chunk) => {
    if (chunk.length > MAX_EXPANDED_BYTES - expandedBytes) throw sizeError;
    chunks.push(chunk);
    expandedBytes += chunk.length;
  });
  try {
    for (let offset = 0; offset < compressed.length; offset += INFLATE_INPUT_CHUNK_BYTES) {
      const end = Math.min(offset + INFLATE_INPUT_CHUNK_BYTES, compressed.length);
      inflater.push(compressed.subarray(offset, end), end === compressed.length);
    }
  } catch (error) {
    if (error === sizeError) throw sizeError;
    throw new Error(`Plan code could not be decompressed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const expanded = new Uint8Array(expandedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    expanded.set(chunk, offset);
    offset += chunk.length;
  }
  return expanded;
}

/** Encode the current persistent playthrough as PP1.base64url(raw-deflate-json).crc32. */
export function encodePlanCode(playthrough: Playthrough): string {
  const expanded = strToU8(canonicalCompactJson(playthrough));
  if (expanded.length > MAX_EXPANDED_BYTES) {
    throw new Error(`Plan code exceeds the expanded size limit of ${MAX_EXPANDED_BYTES} bytes`);
  }
  const compressed = deflateSync(expanded, { level: 9 });
  if (compressed.length > MAX_COMPRESSED_BYTES) {
    throw new Error(`Plan code exceeds the compressed size limit of ${MAX_COMPRESSED_BYTES} bytes`);
  }
  return `${FORMAT_VERSION}.${bytesToBase64Url(compressed)}.${crc32(compressed)}`;
}

/** Verify and decode a plan code, then migrate and validate every pack reference without writing. */
export function decodePlanCode(code: string, pack: PlaythroughPackIndex): DecodedPlanCode {
  const compressed = parseCode(code);
  const expanded = inflateWithinLimit(compressed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(expanded));
  } catch (error) {
    throw new Error(`Plan code does not contain valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = migratePlaythrough(parsed, pack);
  if (!result.ok) throw new Error(`Plan code failed validation: ${result.error}`);
  return { playthrough: result.playthrough, migrated: result.migrated };
}

/** Build a confirmation preview only after full format, schema, and pack-reference validation. */
export function preparePlanCodeImport(
  code: string,
  pack: PlaythroughPackIndex,
  currentPackVersion?: string,
): PlanCodeImportPreview {
  const decoded = decodePlanCode(code, pack);
  const { playthrough } = decoded;
  const warnings: string[] = [];
  if (decoded.migrated) warnings.push('This plan was migrated from an older schema.');
  if (currentPackVersion !== undefined && playthrough.packVersion !== currentPackVersion) {
    warnings.push(`This plan uses pack "${playthrough.packVersion}"; the current pack is "${currentPackVersion}".`);
  }
  return {
    ...decoded,
    name: playthrough.name,
    game: playthrough.game,
    memberCount: Object.keys(playthrough.timeline.members).length,
    milestoneCount: Object.keys(playthrough.timeline.keyframes).length,
    warnings,
  };
}
