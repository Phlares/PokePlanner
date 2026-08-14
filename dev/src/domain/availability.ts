import type { FireRedPack } from '../data/game-pack';
import type { AcquisitionRecord, LearnsetRecord } from './pack';
import { FIRE_RED_MILESTONE_ORDER } from './rules/firered-rules';

/**
 * The chronological FireRed gym progression used to order milestones. This is the play
 * order of the eight Kanto badges followed by the postgame (`champion`) frontier — the
 * same ordering the build-time availability index encodes. Note this is the ORDER moves
 * are fought in, which differs from the geographic node order (Viridian's Giovanni gym is
 * reached early but fought last).
 */
export const MILESTONE_ORDER = FIRE_RED_MILESTONE_ORDER;

export type MilestoneId = (typeof MILESTONE_ORDER)[number];

/**
 * Saved current milestone plus an optional hypothetical preview milestone. Passed by value
 * and never mutated; `previewMilestoneId`, when present, governs gating for a look-ahead
 * without disturbing the saved current milestone.
 */
export interface AvailabilityContext {
  currentMilestoneId: string | null;
  previewMilestoneId?: string | null;
}

export type AvailabilityMethod = 'level-up' | 'machine' | 'tutor' | 'egg' | 'transfer';
export type AvailabilityStatus = 'available-now' | 'future-level' | 'future-milestone' | 'unavailable';

/** Provenance for a single move-availability verdict. Every field is always present. */
export interface AvailabilityEvidence {
  method: AvailabilityMethod;
  level: number | null;
  milestoneId: string | null;
  location: string | null;
  prerequisite: string | null;
  reason: string;
}

export interface MoveAvailabilityEntry {
  moveId: number;
  status: AvailabilityStatus;
  evidence: AvailabilityEvidence;
}

export interface MoveAvailabilityReport {
  pokemonId: number;
  currentMilestoneId: string | null;
  previewMilestoneId: string | null;
  availableNow: MoveAvailabilityEntry[];
  futureLevel: MoveAvailabilityEntry[];
  futureMilestone: MoveAvailabilityEntry[];
  unavailable: MoveAvailabilityEntry[];
}

/** Ordinal 0 is "obtainable from the start" (null / starter-selection); gyms are 1…9. */
function milestoneOrdinal(milestoneId: string | null): number {
  if (milestoneId === null || milestoneId === 'starter-selection') return 0;
  const index = MILESTONE_ORDER.indexOf(milestoneId as MilestoneId);
  if (index === -1) throw new Error(`Unknown availability milestone "${milestoneId}"`);
  return index + 1;
}

const STATUS_RANK: Record<AvailabilityStatus, number> = {
  'available-now': 0,
  'future-level': 1,
  'future-milestone': 2,
  unavailable: 3,
};

interface Candidate {
  status: AvailabilityStatus;
  evidence: AvailabilityEvidence;
  /** Milestone ordinal for future-milestone tie-breaking (earliest wins). */
  ordinal: number;
}

function acquisitionReason(record: AcquisitionRecord): string {
  for (const entry of record.provenance) {
    if (entry.note !== null && entry.note.trim() !== '') return entry.note;
  }
  return record.name;
}

/**
 * Classify how obtainable a single machine/tutor acquisition is, relative to the effective
 * milestone. Unavailable/transfer-only statuses are permanently blocked; obtainable ones
 * are available now if their milestone has been reached, otherwise gated to the future.
 */
function classifyAcquisition(
  record: AcquisitionRecord,
  method: 'machine' | 'tutor',
  effectiveOrdinal: number,
  location: string | null,
): Candidate {
  const prerequisite = record.prerequisites[0] ?? null;
  const reason = acquisitionReason(record);
  if (record.status === 'unavailable' || record.status === 'transfer-only') {
    return {
      status: 'unavailable',
      ordinal: Number.POSITIVE_INFINITY,
      evidence: { method, level: null, milestoneId: record.milestoneId, location, prerequisite, reason },
    };
  }
  const ordinal = milestoneOrdinal(record.milestoneId);
  if (ordinal <= effectiveOrdinal) {
    return {
      status: 'available-now',
      ordinal,
      evidence: { method, level: null, milestoneId: record.milestoneId, location, prerequisite, reason },
    };
  }
  return {
    status: 'future-milestone',
    ordinal,
    evidence: { method, level: null, milestoneId: record.milestoneId, location, prerequisite, reason },
  };
}

/** Prefer the least-blocked candidate; tie-break future-milestone by earliest gym. */
function betterCandidate(current: Candidate | null, next: Candidate): Candidate {
  if (current === null) return next;
  const currentRank = STATUS_RANK[current.status];
  const nextRank = STATUS_RANK[next.status];
  if (nextRank < currentRank) return next;
  if (nextRank === currentRank && next.ordinal < current.ordinal) return next;
  return current;
}

/**
 * Evaluate every learnable move of one Pokémon into disjoint availability buckets for the
 * given planning context. PURE: the context is read by value and never mutated, the preview
 * milestone (when present) governs milestone gating without affecting a current-only call,
 * and each verdict carries full method/level/milestone/location/prerequisite/reason
 * evidence. Level-up moves above the species' earliest catchable level are future-level;
 * machine/tutor moves gated behind a not-yet-reached gym are future-milestone; paths that do
 * not exist in FireRed are unavailable.
 */
export function evaluateMoveAvailability(
  context: AvailabilityContext,
  pokemonId: number,
  pack: FireRedPack,
): MoveAvailabilityReport {
  const currentMilestoneId = context.currentMilestoneId;
  const previewMilestoneId = context.previewMilestoneId ?? null;
  const hasPreview = context.previewMilestoneId !== undefined && context.previewMilestoneId !== null;
  const effectiveOrdinal = milestoneOrdinal(hasPreview ? previewMilestoneId : currentMilestoneId);

  const learnset: LearnsetRecord | undefined = pack.learnsets.find((record) => record.pokemonId === pokemonId);
  const report: MoveAvailabilityReport = {
    pokemonId,
    currentMilestoneId,
    previewMilestoneId,
    availableNow: [],
    futureLevel: [],
    futureMilestone: [],
    unavailable: [],
  };
  if (learnset === undefined) return report;

  const acquisitionById = new Map(pack.acquisitions.map((record) => [record.id, record]));
  const routes = pack.indexes.routesByPokemon[String(pokemonId)] ?? [];
  const catchLocation = routes[0] ?? null;

  // Earliest catchable level: the minimum wild-encounter level in the pack, or the lowest
  // level-up move (fallback for species without wild encounters). Level-up moves at or below
  // this are current; higher ones require additional leveling.
  const encounterLevels: number[] = [];
  for (const area of pack.encounters) {
    for (const method of area.methods) {
      for (const slot of method.slots) {
        if (slot.pokemonId === pokemonId) encounterLevels.push(slot.minLevel);
      }
    }
  }
  const levelUpLevels = learnset.moves.filter((move) => move.method === 'level-up').map((move) => (move as { level: number }).level);
  const boundaryLevel = encounterLevels.length > 0
    ? Math.min(...encounterLevels)
    : (levelUpLevels.length > 0 ? Math.min(...levelUpLevels) : 1);

  const bestByMove = new Map<number, Candidate>();
  const consider = (moveId: number, candidate: Candidate): void => {
    bestByMove.set(moveId, betterCandidate(bestByMove.get(moveId) ?? null, candidate));
  };

  for (const move of learnset.moves) {
    switch (move.method) {
      case 'level-up': {
        const status: AvailabilityStatus = move.level <= boundaryLevel ? 'available-now' : 'future-level';
        consider(move.moveId, {
          status,
          ordinal: 0,
          evidence: {
            method: 'level-up',
            level: move.level,
            milestoneId: null,
            location: catchLocation,
            prerequisite: null,
            reason: status === 'available-now'
              ? `Learned by level-up at level ${move.level}.`
              : `Learned by level-up at level ${move.level}; requires leveling past ${boundaryLevel}.`,
          },
        });
        break;
      }
      case 'egg': {
        consider(move.moveId, {
          status: 'available-now',
          ordinal: 0,
          evidence: {
            method: 'egg',
            level: null,
            milestoneId: null,
            location: null,
            prerequisite: null,
            reason: 'Inheritable as an Egg Move through breeding.',
          },
        });
        break;
      }
      case 'machine':
      case 'tutor': {
        for (const acquisitionId of move.acquisitionIds) {
          const record = acquisitionById.get(acquisitionId);
          if (record === undefined) continue;
          consider(move.moveId, classifyAcquisition(record, move.method, effectiveOrdinal, record.name));
        }
        break;
      }
      case 'transfer': {
        consider(move.moveId, {
          status: 'unavailable',
          ordinal: Number.POSITIVE_INFINITY,
          evidence: {
            method: 'transfer',
            level: null,
            milestoneId: null,
            location: null,
            prerequisite: null,
            reason: move.reason,
          },
        });
        break;
      }
      default: {
        const exhaustive: never = move;
        throw new Error(`Unsupported learn method: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  for (const [moveId, candidate] of bestByMove) {
    const entry: MoveAvailabilityEntry = { moveId, status: candidate.status, evidence: candidate.evidence };
    switch (candidate.status) {
      case 'available-now': report.availableNow.push(entry); break;
      case 'future-level': report.futureLevel.push(entry); break;
      case 'future-milestone': report.futureMilestone.push(entry); break;
      case 'unavailable': report.unavailable.push(entry); break;
    }
  }

  const byMoveId = (a: MoveAvailabilityEntry, b: MoveAvailabilityEntry): number => a.moveId - b.moveId;
  report.availableNow.sort(byMoveId);
  report.futureLevel.sort(byMoveId);
  report.futureMilestone.sort(byMoveId);
  report.unavailable.sort(byMoveId);
  return report;
}
