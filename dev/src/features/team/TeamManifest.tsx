import { useMemo } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import {
  assignMember,
  swapSlots,
  type MemberPackView,
  type PlannedMove,
  type SixSlots,
  type Slot,
  type SlotIndex,
  type TeamSection,
  type TeamState,
} from '../../domain/team';
import type { MemberDraft } from '../workbench/PokemonInspector';

const MAX_MOVES = 4;

/** The read-only legality surface team ops validate against; embeds no canonical data, only lookups. */
function memberPackView(pack: FireRedPack): MemberPackView {
  const pokemonById = new Map(pack.pokemon.map((record) => [record.id, record]));
  const learnsetByPokemon = new Map(pack.learnsets.map((record) => [record.pokemonId, record]));
  return {
    hasSpecies: (id) => pokemonById.has(id),
    legalAbilityIds: (id) => pokemonById.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id, moveId) =>
      (learnsetByPokemon.get(id)?.moves ?? []).some((move) => move.moveId === moveId),
  };
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(' ');
}

/** The future-planning label a planned move carries, or null for a currently-available move. */
function moveLabel(move: PlannedMove): string | null {
  if (move.status === 'future-level' && move.level !== null) return `Lv ${move.level}`;
  if (move.status === 'future-milestone' && move.milestoneId !== null) return titleCase(move.milestoneId);
  return null;
}

export interface TeamManifestProps {
  team: TeamState;
  pack: FireRedPack;
  /** The inspector's current proposed member; the source for add/replace. */
  draft: MemberDraft | null;
  onTeamChange: (next: TeamState) => void;
  createId?: () => string;
}

const SECTION_LABEL: Record<TeamSection, string> = { primary: 'Primary', reserve: 'Reserve' };
const OTHER_SECTION: Record<TeamSection, TeamSection> = { primary: 'reserve', reserve: 'primary' };

/**
 * The fixed primary/reserve team manifest. Six primary and six reserve slots are always rendered.
 * Each occupied slot shows its planned level, selected ability, and up to four planned moves with
 * their future-availability labels preserved. Every mutation goes through the immutable Task 9 team
 * operations and is emitted upward for App to validate and persist; this surface computes no team
 * score, recommendation, damage, or snapshot.
 */
export function TeamManifest({ team, pack, draft, onTeamChange, createId = () => crypto.randomUUID() }: TeamManifestProps) {
  const view = useMemo(() => memberPackView(pack), [pack]);
  const speciesById = useMemo(() => new Map(pack.pokemon.map((record) => [record.id, record])), [pack]);
  const moveNameById = useMemo(() => new Map(pack.moves.map((record) => [record.id, record.name])), [pack]);

  const place = (section: TeamSection, index: SlotIndex): void => {
    if (draft === null) return;
    const member = { id: createId(), speciesId: draft.speciesId, level: draft.level, abilityId: draft.abilityId, moves: draft.moves.slice(0, MAX_MOVES) };
    onTeamChange(assignMember(team, { section, index }, member, view));
  };

  const swap = (a: { section: TeamSection; index: SlotIndex }, b: { section: TeamSection; index: SlotIndex }): void => {
    onTeamChange(swapSlots(team, a, b));
  };

  const abilityName = (speciesId: number, abilityId: number): string =>
    speciesById.get(speciesId)?.abilities.find((ability) => ability.id === abilityId)?.name ?? `Ability #${abilityId}`;

  const renderSlot = (section: TeamSection, slot: Slot, index: SlotIndex) => {
    const position = index + 1;
    const species = slot === null ? null : speciesById.get(slot.speciesId) ?? null;
    return (
      <li key={index} className="manifest-slot" data-filled={slot !== null || undefined}>
        <div className="manifest-slot-head">
          <code className="manifest-slot-index">{SECTION_LABEL[section][0]}{position}</code>
          <span className="manifest-slot-name">{slot === null ? 'Empty' : species?.name ?? `Species #${slot.speciesId}`}</span>
          {slot !== null && <span className="manifest-slot-level">Lv {slot.level}</span>}
        </div>

        {slot !== null && (
          <>
            <p className="manifest-slot-ability">{abilityName(slot.speciesId, slot.abilityId)}</p>
            <div className="member-moves">
              {slot.moves.length === 0 ? (
                <span className="member-move member-move-empty">No moves planned</span>
              ) : (
                slot.moves.map((move) => {
                  const label = moveLabel(move);
                  return (
                    <span key={move.moveId} className="member-move" data-status={move.status}>
                      <span className="member-move-name">{moveNameById.get(move.moveId) ?? `Move #${move.moveId}`}</span>
                      {label !== null && <span className="member-move-label">{label}</span>}
                    </span>
                  );
                })
              )}
            </div>
          </>
        )}

        <div className="manifest-slot-actions">
          {slot === null ? (
            <button
              type="button"
              className="manifest-action"
              disabled={draft === null}
              aria-label={`Add to ${section} slot ${position}`}
              onClick={() => place(section, index)}
            >
              Add
            </button>
          ) : (
            <>
              <button
                type="button"
                className="manifest-action"
                disabled={draft === null}
                aria-label={`Replace ${section} slot ${position}`}
                onClick={() => place(section, index)}
              >
                Replace
              </button>
              <button
                type="button"
                className="manifest-action"
                disabled={index === 0}
                aria-label={`Move ${section} slot ${position} up`}
                onClick={() => swap({ section, index }, { section, index: (index - 1) as SlotIndex })}
              >
                Up
              </button>
              <button
                type="button"
                className="manifest-action"
                disabled={index === 5}
                aria-label={`Move ${section} slot ${position} down`}
                onClick={() => swap({ section, index }, { section, index: (index + 1) as SlotIndex })}
              >
                Down
              </button>
              <button
                type="button"
                className="manifest-action"
                aria-label={`Send ${section} slot ${position} to ${OTHER_SECTION[section]}`}
                onClick={() => swap({ section, index }, { section: OTHER_SECTION[section], index })}
              >
                To {SECTION_LABEL[OTHER_SECTION[section]].toLowerCase()}
              </button>
            </>
          )}
        </div>
      </li>
    );
  };

  const renderSection = (section: TeamSection, slots: SixSlots) => (
    <section className="manifest-section" aria-label={`${SECTION_LABEL[section]} team`}>
      <h4>{SECTION_LABEL[section]}</h4>
      <ol className="manifest-slots">
        {slots.map((slot, index) => renderSlot(section, slot, index as SlotIndex))}
      </ol>
    </section>
  );

  return (
    <div className="manifest-sections">
      {renderSection('primary', team.primary)}
      {renderSection('reserve', team.reserve)}
    </div>
  );
}
