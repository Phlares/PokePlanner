/**
 * One party position at the planning target. A filled slot carries all three facts or none of
 * them — the union makes "a member id with no name" unrepresentable rather than something the
 * renderer has to defend against, so there is one condition to read and one to test.
 */
export type TeamStripSlot =
  | { memberId: null }
  | { memberId: string; name: string; level: number };

export interface TeamStripProps {
  /** The planning target the party is resolved at, e.g. `Brock`. */
  targetName: string;
  targetLevel: number;
  /** The six party positions in slot order; shorter or longer lists render as given. */
  slots: readonly TeamStripSlot[];
  reserveCount: number;
  findingCount: number;
  /** How levels are being generated at this target, already worded for reading. */
  levelPolicyLabel: string;
  selectedMemberId: string | null;
  onSelectMember: (memberId: string) => void;
  onOpenTimeline: () => void;
}

/**
 * The sticky team rung: the party the plan is actually about, always in view above the results.
 *
 * It emits selection and nothing else. A primary click selects and highlights a member; editing,
 * comparing, reserving and releasing belong to the surfaces that own the timeline, so this strip
 * takes no mutation callback and can never change a run. Selection is announced with
 * `aria-pressed` and drawn with a rule weight rather than a colour, so it survives both themes and
 * a monochrome screen.
 */
export function TeamStrip({
  targetName,
  targetLevel,
  slots,
  reserveCount,
  findingCount,
  levelPolicyLabel,
  selectedMemberId,
  onSelectMember,
  onOpenTimeline,
}: TeamStripProps) {
  return (
    <div className="team-strip">
      <div className="team-strip-target">
        <p className="eyebrow">Planning target</p>
        <p className="team-strip-target-name">{targetName} · Target Lv {targetLevel}</p>
      </div>

      {/* The markers are off for the ledger look, which drops list semantics in Safari/VoiceOver
          unless the role is stated back explicitly. */}
      <ol className="team-strip-slots" role="list">
        {slots.map((slot, index) => {
          const position = index + 1;
          if (slot.memberId === null) {
            return (
              <li key={index} className="team-strip-slot">
                <code className="team-strip-slot-index">P{position}</code>
                <span className="team-strip-slot-empty">Empty</span>
              </li>
            );
          }
          const selected = slot.memberId === selectedMemberId;
          return (
            <li key={index} className="team-strip-slot">
              <button
                type="button"
                className="team-strip-slot-select"
                aria-pressed={selected}
                data-selected={selected ? 'true' : undefined}
                aria-label={`Party slot ${position}: ${slot.name}, level ${slot.level}`}
                onClick={() => onSelectMember(slot.memberId)}
              >
                <code className="team-strip-slot-index">P{position}</code>
                <span className="team-strip-slot-name">{slot.name}</span>
                <span className="team-strip-slot-level">Lv {slot.level}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="team-strip-aside">
        <p className="team-strip-summary">
          Reserve {reserveCount} · Findings {findingCount} · {levelPolicyLabel}
        </p>
        <button type="button" className="team-strip-timeline" onClick={onOpenTimeline}>
          Open timeline
        </button>
      </div>
    </div>
  );
}
