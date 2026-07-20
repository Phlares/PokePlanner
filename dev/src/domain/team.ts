import type { AvailabilityStatus } from './availability';

/**
 * The label vocabulary a planned team move can carry. It reuses the availability statuses,
 * minus `unavailable`: only version-valid moves may be planned onto a member, but a move that
 * is planned ahead of time keeps its `future-level` / `future-milestone` label so the UI never
 * silently promotes a future option into the current set.
 */
export type PlannedMoveStatus = Exclude<AvailabilityStatus, 'unavailable'>;

/**
 * One planned move on a team member. Only ids/refs and the availability label live here — no
 * canonical move data (name, power, type) is embedded. The label fields carry the provenance
 * of a future choice: `level` for `future-level`, `milestoneId` for `future-milestone`.
 */
export interface PlannedMove {
  moveId: number;
  status: PlannedMoveStatus;
  level: number | null;
  milestoneId: string | null;
}

/**
 * A single planned team member. Identity is the playthrough-scoped `id` (unique across the
 * whole team), distinct from the canonical `speciesId`. Only references and user choices are
 * stored; canonical species/ability/move data stays in the pack.
 */
export interface TeamMember {
  id: string;
  speciesId: number;
  level: number;
  abilityId: number;
  moves: readonly PlannedMove[];
  nickname?: string | null;
  notes?: string | null;
}

export type Slot = TeamMember | null;
export type SixSlots = readonly [Slot, Slot, Slot, Slot, Slot, Slot];

/** Two fixed-length sections: the active primary six and the reserve six. */
export interface TeamState {
  primary: SixSlots;
  reserve: SixSlots;
}

export type TeamSection = 'primary' | 'reserve';
export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5;
export interface TeamAddress {
  section: TeamSection;
  index: SlotIndex;
}

/**
 * The injected, read-only legality surface. Team logic consults this instead of embedding
 * canonical data, so tests (and later the real pack) supply the rules. Every check is a pure
 * lookup keyed by id.
 */
export interface MemberPackView {
  hasSpecies(speciesId: number): boolean;
  legalAbilityIds(speciesId: number): readonly number[];
  isVersionValidMove(speciesId: number, moveId: number): boolean;
}

const SLOT_COUNT = 6;
const MAX_MOVES = 4;

function emptySlots(): SixSlots {
  return [null, null, null, null, null, null];
}

/** A fresh, empty team: six null slots in each section. */
export function createEmptyTeam(): TeamState {
  return { primary: emptySlots(), reserve: emptySlots() };
}

function assertIndex(index: number): asserts index is SlotIndex {
  if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) {
    throw new Error(`Team slot index must be an integer 0..${SLOT_COUNT - 1}; received ${index}`);
  }
}

function sectionSlots(team: TeamState, section: TeamSection): SixSlots {
  return section === 'primary' ? team.primary : team.reserve;
}

function withSectionSlots(team: TeamState, section: TeamSection, slots: SixSlots): TeamState {
  return section === 'primary'
    ? { primary: slots, reserve: team.reserve }
    : { primary: team.primary, reserve: slots };
}

/** Return a NEW six-slot tuple with `value` at `index`; the input tuple is never mutated. */
function slotsWith(slots: SixSlots, index: SlotIndex, value: Slot): SixSlots {
  const next = slots.slice();
  next[index] = value;
  return next as unknown as SixSlots;
}

/** Read the slot at an address (throws on an out-of-range index). */
export function getSlot(team: TeamState, address: TeamAddress): Slot {
  assertIndex(address.index);
  return sectionSlots(team, address.section)[address.index];
}

function eachMember(team: TeamState): TeamMember[] {
  const members: TeamMember[] = [];
  for (const slot of team.primary) if (slot !== null) members.push(slot);
  for (const slot of team.reserve) if (slot !== null) members.push(slot);
  return members;
}

/**
 * Validate one member against injected pack data and the fixed team rules: known species,
 * level 1..100, an ability that is legal for the species, and at most four unique moves that
 * are each version-valid for the species. Future-move labels are checked for internal
 * consistency but never rewritten. Throws on the first violation.
 */
export function validateTeamMember(member: TeamMember, pack: MemberPackView): void {
  if (typeof member.id !== 'string' || member.id.length === 0) {
    throw new Error('Team member id must be a non-empty string');
  }
  if (!pack.hasSpecies(member.speciesId)) {
    throw new Error(`Unknown species ${member.speciesId} for team member "${member.id}"`);
  }
  if (!Number.isInteger(member.level) || member.level < 1 || member.level > 100) {
    throw new Error(`Team member "${member.id}" level must be an integer 1..100; received ${member.level}`);
  }
  const legalAbilities = pack.legalAbilityIds(member.speciesId);
  if (!legalAbilities.includes(member.abilityId)) {
    throw new Error(`Ability ${member.abilityId} is not legal for species ${member.speciesId} (member "${member.id}")`);
  }
  if (member.moves.length > MAX_MOVES) {
    throw new Error(`Team member "${member.id}" may have at most four (4) moves; received ${member.moves.length}`);
  }
  const seen = new Set<number>();
  for (const move of member.moves) {
    if (seen.has(move.moveId)) {
      throw new Error(`Team member "${member.id}" has duplicate move id ${move.moveId}; move ids must be unique`);
    }
    seen.add(move.moveId);
    if (!pack.isVersionValidMove(member.speciesId, move.moveId)) {
      throw new Error(`Move ${move.moveId} is not a version-valid move for species ${member.speciesId} (member "${member.id}")`);
    }
    assertMoveLabel(member.id, move);
  }
}

function assertMoveLabel(memberId: string, move: PlannedMove): void {
  switch (move.status) {
    case 'available-now':
      if (move.level !== null || move.milestoneId !== null) {
        throw new Error(`Available move ${move.moveId} on "${memberId}" must not carry a future label`);
      }
      break;
    case 'future-level':
      if (move.level === null) {
        throw new Error(`Future-level move ${move.moveId} on "${memberId}" must carry its required level`);
      }
      break;
    case 'future-milestone':
      if (move.milestoneId === null) {
        throw new Error(`Future-milestone move ${move.moveId} on "${memberId}" must carry its gating milestone`);
      }
      break;
    default: {
      const exhaustive: never = move.status;
      throw new Error(`Unsupported planned move status: ${String(exhaustive)}`);
    }
  }
}

function assertUniqueMemberIds(team: TeamState): void {
  const seen = new Set<string>();
  for (const member of eachMember(team)) {
    if (seen.has(member.id)) {
      throw new Error(`Duplicate team member id "${member.id}"; member ids must be unique team-wide`);
    }
    seen.add(member.id);
  }
}

/** Validate the whole team: every member is legal and all ids are unique team-wide. */
export function validateTeamState(team: TeamState, pack: MemberPackView): void {
  if (team.primary.length !== SLOT_COUNT || team.reserve.length !== SLOT_COUNT) {
    throw new Error(`Each team section must have exactly ${SLOT_COUNT} slots`);
  }
  for (const member of eachMember(team)) validateTeamMember(member, pack);
  assertUniqueMemberIds(team);
}

/**
 * Place `member` at `address`, replacing any occupant. Returns NEW state; the input team and
 * member are never mutated. The member is validated against injected pack data and the result
 * is checked for team-wide id uniqueness (an in-place replace of the same id is allowed).
 */
export function assignMember(team: TeamState, address: TeamAddress, member: TeamMember, pack: MemberPackView): TeamState {
  assertIndex(address.index);
  validateTeamMember(member, pack);
  const slots = slotsWith(sectionSlots(team, address.section), address.index, member);
  const next = withSectionSlots(team, address.section, slots);
  assertUniqueMemberIds(next);
  return next;
}

/** Exchange the contents of two addresses (any section). Returns NEW state; inputs untouched. */
export function swapSlots(team: TeamState, a: TeamAddress, b: TeamAddress): TeamState {
  assertIndex(a.index);
  assertIndex(b.index);
  const valueA = getSlot(team, a);
  const valueB = getSlot(team, b);
  let next = team;
  next = withSectionSlots(next, a.section, slotsWith(sectionSlots(next, a.section), a.index, valueB));
  next = withSectionSlots(next, b.section, slotsWith(sectionSlots(next, b.section), b.index, valueA));
  return next;
}

/**
 * Relocate the member at `from` to an empty slot at `to` (any section), leaving `from` empty.
 * Throws if `from` is empty or `to` is occupied — use {@link swapSlots} to exchange two
 * members. Returns NEW state; inputs untouched.
 */
export function moveMember(team: TeamState, from: TeamAddress, to: TeamAddress): TeamState {
  assertIndex(from.index);
  assertIndex(to.index);
  const moving = getSlot(team, from);
  if (moving === null) throw new Error('Cannot move an empty slot');
  if (getSlot(team, to) !== null) throw new Error('Cannot move onto an occupied slot; swap instead');
  let next = withSectionSlots(team, from.section, slotsWith(sectionSlots(team, from.section), from.index, null));
  next = withSectionSlots(next, to.section, slotsWith(sectionSlots(next, to.section), to.index, moving));
  return next;
}

/**
 * Apply a shallow patch to the member at `address`, re-validating the result and preserving
 * team-wide id uniqueness. Returns NEW state; the input team and member are never mutated.
 */
export function updateMember(
  team: TeamState,
  address: TeamAddress,
  patch: Partial<TeamMember>,
  pack: MemberPackView,
): TeamState {
  assertIndex(address.index);
  const current = getSlot(team, address);
  if (current === null) throw new Error('Cannot update an empty slot');
  const updated: TeamMember = { ...current, ...patch };
  validateTeamMember(updated, pack);
  const slots = slotsWith(sectionSlots(team, address.section), address.index, updated);
  const next = withSectionSlots(team, address.section, slots);
  assertUniqueMemberIds(next);
  return next;
}
