import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import type { FireRedPack } from '../../data/game-pack';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';
import type { PlannedMove } from '../../domain/team';
import type { MemberSnapshot } from '../../domain/timeline/model';
import type { ResolvedTimelineNode } from '../../domain/timeline/resolver';
import type { TimelineFinding } from '../../domain/timeline/validation';
import { compareMemberCandidate } from '../../domain/workbench/comparison';
import { MemberComparison } from './MemberComparison';

const NIDORINO = 33;
const PIKACHU = 25;
const FARFETCHD = 83;
const CUT = 15;
const TACKLE = 33;
const TAIL_WHIP = 39;
const GROWL = 45;
const THUNDER_SHOCK = 84;
const AGILITY = 97;

let pack: FireRedPack;
afterEach(cleanup);

const move = (moveId: number): PlannedMove => ({ moveId, status: 'available-now', level: null, milestoneId: null });

function snapshot(speciesId: number, moves: PlannedMove[] = []): MemberSnapshot {
  return {
    speciesId, level: 20, abilityId: 0, moves, heldItemId: null,
    placement: 'party', partySlot: 0, review: { moves: false, heldItem: false },
  };
}

/** One node past Fuchsia City: Cut's badge and milestone are behind the run, so a Cut reads `knows`. */
function node(): ResolvedTimelineNode {
  const farfetchd = snapshot(FARFETCHD, [move(CUT)]);
  return {
    nodeId: 'kanto-safari-zone',
    source: 'explicit-major',
    party: ['nidorino-1', 'pikachu-2', null, null, null, null],
    reserve: ['pikachu-3', 'farfetchd-1'],
    released: [],
    snapshots: {
      'nidorino-1': snapshot(NIDORINO, [move(TACKLE), move(CUT), move(TAIL_WHIP)]),
      'pikachu-2': snapshot(PIKACHU),
      'pikachu-3': snapshot(PIKACHU, [move(THUNDER_SHOCK), move(GROWL), move(TAIL_WHIP), move(AGILITY)]),
      'farfetchd-1': farfetchd,
    },
  };
}

const OUTGOING_FINDING: TimelineFinding = {
  code: 'team.weakness', severity: 'yellow', memberId: 'nidorino-1', field: 'move',
  summary: 'Outgoing member finding', explanation: 'x', evidenceIds: [], resolutions: [],
};

function buildView() {
  pack = loadFireRedPackFixture();
  const member = {
    memberId: 'nidorino-1',
    snapshot: snapshot(NIDORINO, [move(TACKLE), move(CUT), move(TAIL_WHIP)]),
    natureId: 'brave' as string | null,
  };
  const candidate = {
    memberId: 'pikachu-3',
    snapshot: snapshot(PIKACHU, [move(THUNDER_SHOCK), move(GROWL), move(TAIL_WHIP), move(AGILITY)]),
    natureId: 'jolly' as string | null,
  };
  return compareMemberCandidate(member, candidate, {
    pack, rules: FIRE_RED_RULES, node: node(), findings: [OUTGOING_FINDING],
  });
}

function renderComparison(overrides: Partial<Parameters<typeof MemberComparison>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <MemberComparison
      view={buildView()}
      memberName="Nidorino"
      candidateName="Pikachu"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { ...utils, onConfirm, onCancel };
}

describe('MemberComparison', () => {
  it('labels the section for the two subjects', () => {
    renderComparison();
    expect(screen.getByRole('section', { name: 'Compare Nidorino with Pikachu' })).toBeDefined();
  });

  it('tables the six stats with signed deltas', () => {
    renderComparison();
    const table = screen.getByRole('table', { name: 'Stat comparison' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(7);
    expect(within(table).getByRole('rowheader', { name: 'Attack' })
      .closest('tr')!.textContent).toContain('-17');
    expect(within(table).getByRole('rowheader', { name: 'Speed' })
      .closest('tr')!.textContent).toContain('+25');
  });

  it('puts the candidate move-class counts beside Attack and Sp. Atk', () => {
    renderComparison();
    const table = screen.getByRole('table', { name: 'Stat comparison' });
    expect(within(table).getByRole('rowheader', { name: 'Attack' })
      .closest('tr')!.textContent).toContain('0 physical');
    expect(within(table).getByRole('rowheader', { name: 'Sp. Atk' })
      .closest('tr')!.textContent).toContain('1 special');
  });

  it('states type, ability and nature changes as text', () => {
    renderComparison();
    const section = screen.getByRole('section', { name: 'Compare Nidorino with Pikachu' });
    expect(section.textContent).toContain('poison');
    expect(section.textContent).toContain('electric');
    expect(section.textContent).toContain('Poison Point');
    expect(section.textContent).toContain('Static');
    expect(section.textContent).toContain('brave');
    expect(section.textContent).toContain('jolly');
  });

  it('lists the moves leaving and entering by name', () => {
    renderComparison();
    const leaving = screen.getByRole('list', { name: 'Moves leaving' });
    expect(within(leaving).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['Cut', 'Tackle']);
    const entering = screen.getByRole('list', { name: 'Moves entering' });
    expect(within(entering).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['Growl', 'Thunder Shock', 'Agility']);
  });

  it('names a yellow loss with the candidate state and reserve help', () => {
    renderComparison();
    const warning = screen.getByRole('alert');
    expect(warning.textContent).toContain('Cut');
    expect(warning.textContent).toContain('none');
    expect(warning.textContent).toContain('farfetchd-1');
  });

  it('lists the outgoing member findings', () => {
    renderComparison();
    expect(screen.getByText('Outgoing member finding')).toBeDefined();
  });

  it('offers Replace and Cancel, each calling its handler', () => {
    const { onConfirm, onCancel } = renderComparison();
    fireEvent.click(screen.getByRole('button', { name: 'Replace Nidorino with Pikachu' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
