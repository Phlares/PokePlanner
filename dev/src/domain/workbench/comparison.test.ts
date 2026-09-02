import { beforeAll, describe, expect, it } from 'vitest';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import type { FireRedPack } from '../../data/game-pack';
import { FIRE_RED_RULES } from '../rules/firered-rules';
import type { PlannedMove } from '../team';
import type { MemberSnapshot } from '../timeline/model';
import type { ResolvedTimelineNode } from '../timeline/resolver';
import type { TimelineFinding } from '../timeline/validation';
import { compareMemberCandidate } from './comparison';

const NIDORINO = 33;
const PIKACHU = 25;
const FARFETCHD = 83;

// Pack move ids: physical, special, status, and the Cut capability move.
const CUT = 15;
const TACKLE = 33;
const TAIL_WHIP = 39;
const GROWL = 45;
const THUNDER_SHOCK = 84;
const AGILITY = 97;

const move = (moveId: number): PlannedMove => ({ moveId, status: 'available-now', level: null, milestoneId: null });

let pack: FireRedPack;
beforeAll(() => {
  pack = loadFireRedPackFixture();
});

function snapshot(speciesId: number, moves: PlannedMove[] = [], overrides: Partial<MemberSnapshot> = {}): MemberSnapshot {
  return {
    speciesId,
    level: 20,
    abilityId: 0,
    moves,
    heldItemId: null,
    placement: 'party',
    partySlot: 0,
    review: { moves: false, heldItem: false },
    ...overrides,
  };
}

const NIDORINO_MOVES = [move(TACKLE), move(CUT), move(TAIL_WHIP)];
const PIKACHU_MOVES = [move(THUNDER_SHOCK), move(GROWL), move(TAIL_WHIP), move(AGILITY)];

/**
 * The Safari Zone stands one node past Fuchsia City, so Cut's Cascade Badge and the Misty gym
 * milestone are both behind the run: a Cut held by the outgoing member reads as `knows`.
 */
function node(overrides: Partial<ResolvedTimelineNode> = {}): ResolvedTimelineNode {
  return {
    nodeId: 'kanto-safari-zone',
    source: 'explicit-major',
    party: ['nidorino-1', 'pikachu-2', null, null, null, null],
    reserve: ['pikachu-3', 'farfetchd-1'],
    released: [],
    snapshots: {
      'nidorino-1': snapshot(NIDORINO, NIDORINO_MOVES, { partySlot: 0 }),
      'pikachu-2': snapshot(PIKACHU, [], { partySlot: 1 }),
      'pikachu-3': snapshot(PIKACHU, PIKACHU_MOVES, { placement: 'reserve', partySlot: null }),
      'farfetchd-1': snapshot(FARFETCHD, [move(CUT)], { placement: 'reserve', partySlot: null }),
    },
    ...overrides,
  };
}

const nidorinoMember = {
  memberId: 'nidorino-1' as const,
  snapshot: snapshot(NIDORINO, NIDORINO_MOVES, { partySlot: 0 }),
  natureId: 'brave' as const,
};
const pikachuCandidate = {
  memberId: 'pikachu-3' as const,
  snapshot: snapshot(PIKACHU, PIKACHU_MOVES, { placement: 'reserve', partySlot: null }),
  natureId: 'jolly' as const,
};
/** A species the pack knows but no team member owns: no member id, no plan, no nature. */
const pikachuSearchCandidate = {
  memberId: null,
  snapshot: snapshot(PIKACHU, []),
  natureId: null,
};

function context(node: ResolvedTimelineNode, findings: readonly TimelineFinding[] = []) {
  return { pack, rules: FIRE_RED_RULES, node, findings };
}

const diff = () => compareMemberCandidate(nidorinoMember, pikachuCandidate, context(node()));

describe('compareMemberCandidate — base facts', () => {
  it('shows stat and move-class differences', () => {
    expect(diff().stats.attack).toEqual({ before: 72, after: 55, delta: -17 });
    expect(diff().stats.speed).toEqual({ before: 65, after: 90, delta: 25 });
    expect(diff().stats.hp).toEqual({ before: 61, after: 35, delta: -26 });
    expect(diff().moveClasses.before).toEqual({ physical: 2, special: 0, status: 1 });
    expect(diff().moveClasses.after).toEqual({ physical: 0, special: 1, status: 3 });
  });

  it('reads types, abilities and natures from the pack and the member record', () => {
    expect(diff().types).toEqual({ before: ['poison'], after: ['electric'] });
    expect(diff().abilities).toEqual({ before: ['Poison Point'], after: ['Static'] });
    expect(diff().nature).toEqual({ before: 'brave', after: 'jolly' });
  });

  it('lists leaving and entering moves as ids, ascending, without moves both keep', () => {
    expect(diff().moves).toEqual({ leaving: [CUT, TACKLE], entering: [GROWL, THUNDER_SHOCK, AGILITY] });
  });
});

describe('compareMemberCandidate — capability losses', () => {
  it('warns when replacement removes the only active Cut user', () => {
    const losses = diff().capabilityLosses;
    expect(losses).toHaveLength(1);
    expect(losses).toContainEqual(expect.objectContaining({
      capabilityId: 'cut', severity: 'yellow', retainedByParty: false, candidateState: 'none',
    }));
    expect(losses[0]).toMatchObject({ reserveMemberIds: ['farfetchd-1'] });
  });

  it('identifies reserve help without counting it as active', () => {
    const loss = diff().capabilityLosses.find((entry) => entry.capabilityId === 'cut')!;
    expect(loss).toMatchObject({
      capabilityId: 'cut',
      severity: 'yellow',
      retainedByParty: false,
      reserveMemberIds: ['farfetchd-1'],
    });
  });

  it('drops the warning when another party member already knows the capability', () => {
    const node = node({
      party: ['nidorino-1', 'farfetchd-1', null, null, null, null],
      reserve: ['pikachu-3'],
      snapshots: {
        'nidorino-1': snapshot(NIDORINO, NIDORINO_MOVES, { partySlot: 0 }),
        'farfetchd-1': snapshot(FARFETCHD, [move(CUT)], { partySlot: 1 }),
        'pikachu-3': snapshot(PIKACHU, PIKACHU_MOVES, { placement: 'reserve', partySlot: null }),
      },
    });
    const loss = compareMemberCandidate(nidorinoMember, pikachuCandidate, context(node))
      .capabilityLosses.find((entry) => entry.capabilityId === 'cut')!;
    expect(loss).toMatchObject({ severity: null, retainedByParty: true });
  });

  it('scores a search candidate with no plan behind it', () => {
    const node = node({ reserve: ['farfetchd-1'] });
    const loss = compareMemberCandidate(nidorinoMember, pikachuSearchCandidate, context(node))
      .capabilityLosses.find((entry) => entry.capabilityId === 'cut')!;
    expect(loss).toMatchObject({ severity: 'yellow', candidateState: 'none', reserveMemberIds: ['farfetchd-1'] });
  });
});

describe('compareMemberCandidate — findings', () => {
  it('keeps only the outgoing member findings', () => {
    const outgoing: TimelineFinding = {
      code: 'team.weakness', severity: 'yellow', memberId: 'nidorino-1', field: 'moves',
      summary: 'Outgoing member finding', explanation: 'x', evidenceIds: [], resolutions: [],
    };
    const other: TimelineFinding = { ...outgoing, memberId: 'pikachu-2' };
    const shared: TimelineFinding = { ...outgoing, memberId: null };
    const view = diffWithFindings([outgoing, other, shared]);
    expect(view.findings).toEqual([outgoing]);
  });
});

function diffWithFindings(findings: readonly TimelineFinding[]) {
  return compareMemberCandidate(nidorinoMember, pikachuCandidate, context(node(), findings));
}
