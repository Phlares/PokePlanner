import { describe, expect, it } from 'vitest';
import {
  assignMember,
  createEmptyTeam,
  moveMember,
  swapSlots,
  updateMember,
  validateTeamMember,
  type MemberPackView,
  type TeamAddress,
  type TeamMember,
} from './team';

// A tiny, injected pack view. Legality is defined only for the species used below, so the
// team logic must consult this and never hardwire canonical data.
const LEGAL_ABILITIES: Record<number, number[]> = {
  1: [65], // Bulbasaur → Overgrow
  4: [66], // Charmander → Blaze
  7: [67], // Squirtle → Torrent
  56: [72], // Mankey → Vital Spirit
};
const VERSION_VALID_MOVES = new Set<number>([10, 43, 69, 89, 33, 34]);

const pack: MemberPackView = {
  hasSpecies: (speciesId) => speciesId in LEGAL_ABILITIES,
  legalAbilityIds: (speciesId) => LEGAL_ABILITIES[speciesId] ?? [],
  isVersionValidMove: (_speciesId, moveId) => VERSION_VALID_MOVES.has(moveId),
};

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'm-mankey',
    speciesId: 56,
    level: 20,
    abilityId: 72,
    moves: [{ moveId: 10, status: 'available-now', level: null, milestoneId: null }],
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const primary0: TeamAddress = { section: 'primary', index: 0 };
const primary1: TeamAddress = { section: 'primary', index: 1 };
const reserve0: TeamAddress = { section: 'reserve', index: 0 };

describe('team shape — exactly six slots per section', () => {
  it('creates an empty team with six null slots in each section', () => {
    const team = createEmptyTeam();
    expect(team.primary).toHaveLength(6);
    expect(team.reserve).toHaveLength(6);
    expect(team.primary.every((slot) => slot === null)).toBe(true);
    expect(team.reserve.every((slot) => slot === null)).toBe(true);
  });
});

describe('assignMember — assign and replace', () => {
  it('places a member into an empty slot', () => {
    const team = assignMember(createEmptyTeam(), primary0, member(), pack);
    expect(team.primary[0]?.id).toBe('m-mankey');
    expect(team.primary[1]).toBeNull();
  });

  it('replaces the occupant of a slot', () => {
    const first = assignMember(createEmptyTeam(), primary0, member({ id: 'a', speciesId: 1, abilityId: 65 }), pack);
    const second = assignMember(first, primary0, member({ id: 'b', speciesId: 4, abilityId: 66 }), pack);
    expect(second.primary[0]?.id).toBe('b');
  });
});

describe('reorder and cross-section movement', () => {
  it('reorders within a section via swapSlots', () => {
    const team = assignMember(createEmptyTeam(), primary0, member({ id: 'a' }), pack);
    const swapped = swapSlots(team, primary0, primary1);
    expect(swapped.primary[0]).toBeNull();
    expect(swapped.primary[1]?.id).toBe('a');
  });

  it('moves a member from primary to reserve', () => {
    const team = assignMember(createEmptyTeam(), primary0, member({ id: 'a' }), pack);
    const moved = moveMember(team, primary0, reserve0);
    expect(moved.primary[0]).toBeNull();
    expect(moved.reserve[0]?.id).toBe('a');
  });
});

describe('no duplicate playthrough member ids team-wide', () => {
  it('rejects assigning a member whose id already exists elsewhere', () => {
    const team = assignMember(createEmptyTeam(), primary0, member({ id: 'dup' }), pack);
    expect(() => assignMember(team, reserve0, member({ id: 'dup' }), pack)).toThrow(/duplicate/i);
  });

  it('allows re-assigning the same id into the slot it already occupies (in-place replace)', () => {
    const team = assignMember(createEmptyTeam(), primary0, member({ id: 'x' }), pack);
    const next = assignMember(team, primary0, member({ id: 'x', level: 30 }), pack);
    expect(next.primary[0]?.level).toBe(30);
  });
});

describe('member level bounds 1..100', () => {
  it('rejects level 0 and level 101', () => {
    expect(() => validateTeamMember(member({ level: 0 }), pack)).toThrow(/level/i);
    expect(() => validateTeamMember(member({ level: 101 }), pack)).toThrow(/level/i);
  });

  it('accepts level 1 and level 100', () => {
    expect(() => validateTeamMember(member({ level: 1 }), pack)).not.toThrow();
    expect(() => validateTeamMember(member({ level: 100 }), pack)).not.toThrow();
  });
});

describe('ability must be legal for the species', () => {
  it('rejects an ability that is not in the species legal set', () => {
    expect(() => validateTeamMember(member({ speciesId: 56, abilityId: 65 }), pack)).toThrow(/ability/i);
  });

  it('accepts a legal ability', () => {
    expect(() => validateTeamMember(member({ speciesId: 56, abilityId: 72 }), pack)).not.toThrow();
  });

  it('rejects an unknown species', () => {
    expect(() => validateTeamMember(member({ speciesId: 999, abilityId: 72 }), pack)).toThrow(/species/i);
  });
});

describe('at most four unique version-valid moves; future labels preserved', () => {
  it('rejects more than four moves', () => {
    const moves = [10, 43, 69, 89, 33].map((moveId) => ({ moveId, status: 'available-now' as const, level: null, milestoneId: null }));
    expect(() => validateTeamMember(member({ moves }), pack)).toThrow(/four|4/i);
  });

  it('rejects duplicate move ids', () => {
    const moves = [10, 10].map((moveId) => ({ moveId, status: 'available-now' as const, level: null, milestoneId: null }));
    expect(() => validateTeamMember(member({ moves }), pack)).toThrow(/duplicate|unique/i);
  });

  it('rejects a move that is not version-valid for the species', () => {
    const moves = [{ moveId: 999, status: 'available-now' as const, level: null, milestoneId: null }];
    expect(() => validateTeamMember(member({ moves }), pack)).toThrow(/version|valid|move/i);
  });

  it('accepts four unique version-valid moves and preserves future labels', () => {
    const moves: TeamMember['moves'] = [
      { moveId: 10, status: 'available-now', level: null, milestoneId: null },
      { moveId: 43, status: 'future-level', level: 43, milestoneId: null },
      { moveId: 89, status: 'future-milestone', level: null, milestoneId: 'giovanni-gym' },
      { moveId: 69, status: 'available-now', level: null, milestoneId: null },
    ];
    expect(() => validateTeamMember(member({ moves }), pack)).not.toThrow();
    const team = assignMember(createEmptyTeam(), primary0, member({ moves }), pack);
    expect(team.primary[0]?.moves[1]).toEqual({ moveId: 43, status: 'future-level', level: 43, milestoneId: null });
    expect(team.primary[0]?.moves[2].status).toBe('future-milestone');
  });
});

describe('updateMember — immutable patch with re-validation', () => {
  it('applies a patch and returns a new member', () => {
    const team = assignMember(createEmptyTeam(), primary0, member({ id: 'a', level: 5 }), pack);
    const next = updateMember(team, primary0, { level: 42 }, pack);
    expect(next.primary[0]?.level).toBe(42);
  });

  it('rejects a patch that makes the member illegal', () => {
    const team = assignMember(createEmptyTeam(), primary0, member({ id: 'a' }), pack);
    expect(() => updateMember(team, primary0, { level: 200 }, pack)).toThrow(/level/i);
  });
});

describe('immutability — ops never mutate their inputs', () => {
  it('does not mutate a deeply-frozen input team or member on any op', () => {
    const seeded = assignMember(createEmptyTeam(), primary0, member({ id: 'a' }), pack);
    const frozenTeam = deepFreeze(seeded);
    const frozenMember = deepFreeze(member({ id: 'b', speciesId: 1, abilityId: 65 }));

    const afterAssign = assignMember(frozenTeam, primary1, frozenMember, pack);
    const afterSwap = swapSlots(frozenTeam, primary0, primary1);
    const afterMove = moveMember(frozenTeam, primary0, reserve0);
    const afterUpdate = updateMember(frozenTeam, primary0, { level: 9 }, pack);

    // New references, original untouched.
    expect(afterAssign).not.toBe(frozenTeam);
    expect(afterAssign.primary).not.toBe(frozenTeam.primary);
    expect(frozenTeam.primary[1]).toBeNull();
    expect(frozenTeam.primary[0]?.level).toBe(20);
    expect(afterSwap.primary[1]?.id).toBe('a');
    expect(afterMove.reserve[0]?.id).toBe('a');
    expect(afterUpdate.primary[0]?.level).toBe(9);
  });
});
