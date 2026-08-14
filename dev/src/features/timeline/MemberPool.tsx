import { useEffect, useRef, useState } from 'react';
import type { MemberSnapshot, PersistentMember } from '../../domain/timeline/model';

export interface MemberPoolProps {
  kind: 'reserve' | 'released';
  memberIds: readonly string[];
  members: Readonly<Record<string, PersistentMember>>;
  snapshots: Readonly<Record<string, MemberSnapshot>>;
  speciesName: (speciesId: number) => string;
  onEditMember?: (memberId: string) => void;
  onRequestRestore?: (memberId: string) => void;
}

function speciesCounts(members: Readonly<Record<string, PersistentMember>>): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  Object.values(members).forEach((member) => {
    counts.set(member.originalSpeciesId, (counts.get(member.originalSpeciesId) ?? 0) + 1);
  });
  return counts;
}

export function memberDisplayName(
  member: PersistentMember,
  snapshot: MemberSnapshot,
  nameOf: (speciesId: number) => string,
  duplicateCounts: ReadonlyMap<number, number>,
): string {
  const species = nameOf(snapshot.speciesId);
  const sequence = (duplicateCounts.get(member.originalSpeciesId) ?? 0) > 1 ? ` #${member.speciesSequence}` : '';
  return member.nickname === null ? `${species}${sequence}` : `${member.nickname} · ${species}${sequence}`;
}

/** An unbounded ownership pool. Reserve and released members are rendered by separate instances. */
export function MemberPool({ kind, memberIds, members, snapshots, speciesName, onEditMember, onRequestRestore }: MemberPoolProps) {
  const title = kind === 'reserve' ? 'Reserve' : 'Released';
  const counts = speciesCounts(members);
  const [restoreMemberId, setRestoreMemberId] = useState<string | null>(null);
  const [restoredMemberIds, setRestoredMemberIds] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(true);
  const restoreTriggers = useRef(new Map<string, HTMLButtonElement>());
  const restoreCancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (restoreMemberId !== null) restoreCancel.current?.focus();
  }, [restoreMemberId]);
  const finishRestore = (memberId: string): void => {
    onRequestRestore?.(memberId);
    setRestoredMemberIds((current) => new Set([...current, memberId]));
    setRestoreMemberId(null);
    restoreTriggers.current.get(memberId)?.focus();
  };
  const cancelRestore = (memberId: string): void => {
    setRestoreMemberId(null);
    restoreTriggers.current.get(memberId)?.focus();
  };
  return (
    <section className="timeline-pool" aria-label={`${title} · ${memberIds.length} Pokémon`}>
      <header className="timeline-pool-head">
        <h3>
          <button type="button" className="timeline-pool-toggle" aria-label={`Toggle ${title} pool`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
            {title}
          </button>
        </h3>
        <p>{kind === 'reserve' ? 'Unbounded pool' : 'Historical archive'}</p>
      </header>
      {open && <ul className="timeline-pool-list">
        {memberIds.map((memberId) => {
          const member = members[memberId];
          const snapshot = snapshots[memberId];
          if (!member || !snapshot) return null;
          const name = memberDisplayName(member, snapshot, speciesName, counts);
          return (
            <li key={memberId} className="timeline-pool-member">
              <span className="timeline-member-name">{name}</span>
              <span className="timeline-member-level">Lv {snapshot.level}</span>
              {onEditMember && (
                <button type="button" className="timeline-text-action" aria-label={`Edit ${name}`} onClick={() => onEditMember(memberId)}>
                  Edit
                </button>
              )}
              {kind === 'released' && onRequestRestore && (
                <button
                  ref={(element) => { if (element) restoreTriggers.current.set(memberId, element); }}
                  type="button"
                  className="timeline-text-action"
                  aria-label={`Restore ${name}`}
                  aria-expanded={restoreMemberId === memberId}
                  onClick={() => setRestoreMemberId(memberId)}
                >
                  Restore
                </button>
              )}
              {restoreMemberId === memberId && (
                <div className="timeline-lifecycle-confirmation" role="alertdialog" aria-modal="true" aria-label={`Restore ${name}?`}>
                  <p>Restoring moves this member to reserve and adds a permanent restored warning to its history.</p>
                  <button ref={restoreCancel} type="button" onClick={() => cancelRestore(memberId)}>Cancel restore</button>
                  <button type="button" onClick={() => finishRestore(memberId)}>Confirm restore</button>
                </div>
              )}
              {restoredMemberIds.has(memberId) && <p className="timeline-restored-warning" role="status">Restored Pokémon</p>}
            </li>
          );
        })}
      </ul>}
      {open && memberIds.length === 0 && <p className="timeline-pool-empty">No {title.toLowerCase()} members.</p>}
    </section>
  );
}
