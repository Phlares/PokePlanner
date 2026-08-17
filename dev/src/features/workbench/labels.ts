import type { MoveRecord } from '../../domain/pack';
import type { StatKey } from '../../domain/rules/game-rules';
import type { ObtainabilityStatus } from '../../domain/search';
import type { CapabilityState } from '../../domain/timeline/capabilities';
import { titleCase } from '../text';
import type { RouteAccess, RouteGate } from './selectors';

/**
 * The one wording every workbench surface states its evidence in. The results surface, the route
 * detail and Where & When all read from here, so a route that is `Ahead` in a group cannot become
 * `Future` in a detail pane, and no surface can invent a second vocabulary for the same fact.
 * Every label is text, never a colour, so no state rests on colour alone (spec §20).
 */

/** Where a route stands relative to the run. */
export const ACCESS_LABEL: Record<RouteAccess, string> = {
  current: 'Reached',
  future: 'Ahead',
  locked: 'Locked',
  optional: 'Optional',
  postgame: 'Postgame',
};

/** The three capability verdicts worth showing; `none` has nothing to say (spec §18). */
export const CAPABILITY_LABEL: Partial<Record<CapabilityState, string>> = {
  knows: 'Knows',
  'can-now': 'Can learn now',
  conditional: 'Can learn with condition',
};

/**
 * Every way of being obtainable that is not ordinary play (spec §11). `standard` is absent on
 * purpose: it is the case the rest of the row already describes, and the four listed here are
 * exactly the statuses `Obtainability.flagged` marks, so one map is both the label and the rule.
 */
export const OBTAIN_LABEL: Partial<Record<ObtainabilityStatus, string>> = {
  postgame: 'Postgame',
  'version-exclusive': 'Version exclusive',
  'event-only': 'Event only',
  'transfer-only': 'Transfer only',
};

/** A name filter that matched the whole name or slug, not merely a substring (spec §11). */
export const EXACT_MATCH_LABEL = 'Exact match';

export function matchLabel(count: number): string {
  return `${count} ${count === 1 ? 'match' : 'matches'}`;
}

export function gateLabel(gate: RouteGate): string {
  return titleCase(gate.id);
}

/** The pack's own method vocabulary, read as words; the game names its methods, this file does not. */
export function methodLabel(methods: readonly string[]): string {
  return methods.map(titleCase).join(', ');
}

/** The level band a placement states, or null when the pack states none (a gift arrives fixed). */
export function levelLabel(min: number | null, max: number | null): string | null {
  if (min === null || max === null) return null;
  return min === max ? `Lv ${min}` : `Lv ${min}–${max}`;
}

/** Said by every surface that has to report the pack placing a species on no golden-path node. */
export function nowhereLabel(name: string): string {
  return `The pack places ${name} nowhere on the golden path.`;
}

/** The six stats, in the order every surface shows them, named once (spec §16). */
export const STAT_ORDER: readonly StatKey[] = [
  'hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed',
];

export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  specialAttack: 'Sp. Atk',
  specialDefense: 'Sp. Def',
  speed: 'Speed',
};

/**
 * The stat a move attacks with, read off the damage class the pack records for that move. A status
 * move attacks with none. Because the class is per move rather than per type, no surface has to
 * know which generation split them.
 */
const ATTACKING_STAT: Record<MoveRecord['damageClass'], StatKey | null> = {
  physical: 'attack',
  special: 'specialAttack',
  status: null,
};

/** What a move row states about how it deals damage, in one sentence (spec §17). */
export function moveClassDescription(damageClass: MoveRecord['damageClass']): string {
  const stat = ATTACKING_STAT[damageClass];
  const opening = `${titleCase(damageClass)} move`;
  return stat === null ? opening : `${opening} · uses ${STAT_LABEL[stat]}`;
}
