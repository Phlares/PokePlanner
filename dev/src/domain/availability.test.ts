import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadFireRedPack, type FireRedPack } from '../data/game-pack';
import { evaluateMoveAvailability, MILESTONE_ORDER, type AvailabilityContext, type MoveAvailabilityReport } from './availability';
import { FIRE_RED_RULES } from './rules/firered-rules';

/**
 * Build the real, verified pack from the committed assets by driving the real loader with a
 * disk-backed fetcher and a Node SHA-256 digest (the manifest hashes are real SHA-256).
 */
const PACK_DIR = resolve(process.cwd(), 'public/data/firered');
const digest = (bytes: Uint8Array): Promise<string> =>
  Promise.resolve(createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
const fetcher = ((input: string): Promise<Response> => {
  const rel = String(input).replace(/^\/data\/firered\//, '');
  return Promise.resolve(new Response(readFileSync(resolve(PACK_DIR, rel))));
}) as unknown as typeof fetch;

const MANKEY = 56;
const SQUIRTLE = 7;

// Mankey level-up moves: L1 Scratch(10)/Leer(43), L6(67), L11(2)… L46 Thrash(37).
const SCRATCH = 10;
const LEER = 43;
const THRASH_L46 = 37;
const SEISMIC_TOSS = 69; // level-up L26 AND tutor-seismic-toss (null milestone) → override to now.
const STRENGTH_HM = 70; // hm04-strength, gated behind erika-gym.
const EARTHQUAKE_TM = 89; // tm26-earthquake, gated behind giovanni-gym.
const BODY_SLAM_TUTOR = 34; // tutor-body-slam, postgame (champion).
const DIVE = 291; // Squirtle learns Dive only via hm08-dive (unavailable in FireRed).

let pack: FireRedPack;
beforeAll(async () => {
  pack = await loadFireRedPack(fetcher, digest, '/');
});

function findEntry(report: MoveAvailabilityReport, moveId: number) {
  const buckets = ['availableNow', 'futureLevel', 'futureMilestone', 'unavailable'] as const;
  for (const bucket of buckets) {
    const entry = report[bucket].find((candidate) => candidate.moveId === moveId);
    if (entry) return { bucket, entry };
  }
  return null;
}

describe('availability milestone compatibility', () => {
  it('delegates the legacy milestone order to FireRed planning rules', () => {
    expect(MILESTONE_ORDER).toEqual([
      'brock-gym', 'misty-gym', 'surge-gym', 'erika-gym', 'koga-gym', 'sabrina-gym', 'blaine-gym', 'giovanni-gym', 'champion',
    ]);
  });
});

describe('evaluateMoveAvailability — Route 22 Mankey before Brock', () => {
  const beforeBrock: AvailabilityContext = { currentMilestoneId: 'starter-selection' };

  it('places the earliest level-up moves in availableNow with evidence', () => {
    const report = evaluateMoveAvailability(beforeBrock, MANKEY, pack);
    for (const moveId of [SCRATCH, LEER]) {
      const found = findEntry(report, moveId);
      expect(found?.bucket).toBe('availableNow');
      expect(found?.entry.evidence.method).toBe('level-up');
      expect(found?.entry.evidence.reason.length).toBeGreaterThan(0);
    }
  });

  it('excludes later-level moves from the current set (they are future-level)', () => {
    const report = evaluateMoveAvailability(beforeBrock, MANKEY, pack);
    const thrash = findEntry(report, THRASH_L46);
    expect(thrash?.bucket).toBe('futureLevel');
    expect(thrash?.entry.evidence.level).toBe(46);
    // No later-level move leaks into the current level-up set.
    for (const entry of report.availableNow) {
      if (entry.evidence.method === 'level-up' && entry.evidence.level !== null) {
        expect(entry.evidence.level).toBeLessThanOrEqual(46);
      }
    }
  });

  it('places machines/tutors gated behind future gyms in futureMilestone with the gating milestone', () => {
    const report = evaluateMoveAvailability(beforeBrock, MANKEY, pack);
    const strength = findEntry(report, STRENGTH_HM);
    expect(strength?.bucket).toBe('futureMilestone');
    expect(strength?.entry.evidence.milestoneId).toBe('erika-gym');

    const earthquake = findEntry(report, EARTHQUAKE_TM);
    expect(earthquake?.bucket).toBe('futureMilestone');
    expect(earthquake?.entry.evidence.milestoneId).toBe('giovanni-gym');

    const bodySlam = findEntry(report, BODY_SLAM_TUTOR);
    expect(bodySlam?.bucket).toBe('futureMilestone');
    expect(bodySlam?.entry.evidence.milestoneId).toBe('champion');
  });

  it('respects an acquisition override: a null-milestone tutor makes a later level-up move available now', () => {
    const report = evaluateMoveAvailability(beforeBrock, MANKEY, pack);
    const seismic = findEntry(report, SEISMIC_TOSS);
    expect(seismic?.bucket).toBe('availableNow');
    expect(seismic?.entry.evidence.method).toBe('tutor');
  });

  it('keeps the four availability buckets disjoint', () => {
    const report = evaluateMoveAvailability(beforeBrock, MANKEY, pack);
    const all = [...report.availableNow, ...report.futureLevel, ...report.futureMilestone, ...report.unavailable];
    const ids = all.map((entry) => entry.moveId);
    expect(new Set(ids).size).toBe(ids.length);
    // A caught Mankey can learn something now.
    expect(report.availableNow.length).toBeGreaterThan(0);
  });
});

describe('evaluateMoveAvailability — buckets, boundaries and purity', () => {
  it('marks moves whose only path does not exist in FireRed as unavailable', () => {
    const report = evaluateMoveAvailability({ currentMilestoneId: 'champion' }, SQUIRTLE, pack);
    const dive = findEntry(report, DIVE);
    expect(dive?.bucket).toBe('unavailable');
    expect(dive?.entry.evidence.reason.length).toBeGreaterThan(0);
  });

  it('keeps every current level-up move at or below the boundary and every future one above it', () => {
    const report = evaluateMoveAvailability({ currentMilestoneId: 'starter-selection' }, MANKEY, pack);
    const nowLevels = report.availableNow
      .filter((entry) => entry.evidence.method === 'level-up' && entry.evidence.level !== null)
      .map((entry) => entry.evidence.level as number);
    const futureLevels = report.futureLevel.map((entry) => entry.evidence.level as number);
    const boundary = Math.max(0, ...nowLevels);
    for (const level of futureLevels) expect(level).toBeGreaterThan(boundary);
  });

  it('is pure: it never mutates the frozen context and preview does not affect a current-only call', () => {
    const context: AvailabilityContext = Object.freeze({ currentMilestoneId: 'starter-selection' });
    const first = evaluateMoveAvailability(context, MANKEY, pack);
    // A separate current-only call must be unaffected by any later preview call.
    evaluateMoveAvailability({ currentMilestoneId: 'starter-selection', previewMilestoneId: 'champion' }, MANKEY, pack);
    const second = evaluateMoveAvailability(context, MANKEY, pack);
    expect(second).toEqual(first);
    expect(context).toEqual({ currentMilestoneId: 'starter-selection' });
  });

  it('previews a future milestone without mutating saved current: gated machines become available now', () => {
    const current = evaluateMoveAvailability({ currentMilestoneId: 'starter-selection' }, MANKEY, pack);
    const preview = evaluateMoveAvailability(
      { currentMilestoneId: 'starter-selection', previewMilestoneId: 'giovanni-gym' },
      MANKEY,
      pack,
    );
    expect(findEntry(current, EARTHQUAKE_TM)?.bucket).toBe('futureMilestone');
    expect(findEntry(preview, EARTHQUAKE_TM)?.bucket).toBe('availableNow');
  });
});
