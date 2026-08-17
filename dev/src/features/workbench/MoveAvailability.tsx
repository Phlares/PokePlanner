import { useId, useMemo } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import {
  evaluateMoveAvailability,
  type AvailabilityContext,
  type MoveAvailabilityEntry,
} from '../../domain/availability';
import { titleCase } from '../text';
import { moveClassDescription } from './labels';

export interface MoveAvailabilityProps {
  pokemonId: number;
  pack: FireRedPack;
  context: AvailabilityContext;
}

interface DrawerEntry {
  entry: MoveAvailabilityEntry;
  name: string;
  /** Null only when the pack names the move nowhere, which leaves nothing to state about it. */
  type: string | null;
  description: string | null;
  location: string | null;
}

/**
 * The move-availability drawers for one Pokémon in the current planning context. It CONSUMES the
 * pure `evaluateMoveAvailability` verdict and sorts moves into four SEPARATE native `<details>`
 * disclosures: current level-up, upcoming level-up, available machine/tutor/breeding, and
 * future-milestone. Every future entry surfaces its milestone, location, and prerequisite evidence
 * so a planned future choice is never silently promoted into the current set.
 *
 * Every row is read-only (spec §5): it names the move, its type, its damage class and the stat it
 * attacks with, and the requirement it waits on. Choosing moves for an owned member belongs to the
 * timeline member editor, never to a browsing surface.
 */
export function MoveAvailability({ pokemonId, pack, context }: MoveAvailabilityProps) {
  const descriptionId = useId();

  const report = useMemo(
    () => evaluateMoveAvailability(context, pokemonId, pack),
    [context, pokemonId, pack],
  );

  const groups = useMemo(() => {
    const moveById = new Map(pack.moves.map((record) => [record.id, record] as const));
    const nodeNameById = new Map(pack.progression.nodes.map((node) => [node.id, node.name] as const));
    const decorate = (entries: MoveAvailabilityEntry[]): DrawerEntry[] =>
      entries.map((entry) => {
        const move = moveById.get(entry.moveId);
        const location = entry.evidence.location === null
          ? null
          : nodeNameById.get(entry.evidence.location) ?? entry.evidence.location;
        // A move the pack names nowhere states its id and nothing else; nothing is guessed at.
        return move === undefined
          ? { entry, name: `Move #${entry.moveId}`, type: null, description: null, location }
          : {
            entry,
            name: move.name,
            type: titleCase(move.type),
            description: moveClassDescription(move.damageClass),
            location,
          };
      });
    return {
      currentLevelUp: decorate(report.availableNow.filter((entry) => entry.evidence.method === 'level-up')),
      futureLevel: decorate(report.futureLevel),
      machineTutor: decorate(report.availableNow.filter((entry) => entry.evidence.method !== 'level-up')),
      futureMilestone: decorate(report.futureMilestone),
    };
  }, [report, pack]);

  const renderEntry = (item: DrawerEntry, group: string, showEvidence: boolean) => {
    const { entry, name } = item;
    const classId = `${descriptionId}-${group}-${entry.moveId}`;
    return (
      <li key={entry.moveId} className="move-entry">
        <div className="move-entry-head">
          <span
            className="move-entry-name"
            aria-describedby={item.description === null ? undefined : classId}
          >
            {name}
          </span>
          {item.type !== null && <span className="move-entry-type">{item.type}</span>}
          {item.description !== null && (
            <span className="move-entry-class" id={classId}>{item.description}</span>
          )}
        </div>
        {showEvidence && (
          <dl className="move-evidence">
            {entry.evidence.level !== null && (
              <div className="move-evidence-row">
                <dt>Level</dt>
                <dd>{entry.evidence.level}</dd>
              </div>
            )}
            {entry.evidence.milestoneId !== null && (
              <div className="move-evidence-row">
                <dt>Milestone</dt>
                <dd>{entry.evidence.milestoneId}</dd>
              </div>
            )}
            {item.location !== null && (
              <div className="move-evidence-row">
                <dt>Location</dt>
                <dd>{item.location}</dd>
              </div>
            )}
            {entry.evidence.prerequisite !== null && (
              <div className="move-evidence-row">
                <dt>Prerequisite</dt>
                <dd>{entry.evidence.prerequisite}</dd>
              </div>
            )}
            <p className="move-evidence-reason">{entry.evidence.reason}</p>
          </dl>
        )}
      </li>
    );
  };

  return (
    <div className="move-availability">
      <MoveDrawer
        group="current-level-up"
        title="Current level-up moves"
        count={groups.currentLevelUp.length}
        defaultOpen
      >
        {groups.currentLevelUp.map((item) => renderEntry(item, 'current-level-up', false))}
      </MoveDrawer>

      <MoveDrawer
        group="future-level-up"
        title="Upcoming level-up moves"
        count={groups.futureLevel.length}
      >
        {groups.futureLevel.map((item) => renderEntry(item, 'future-level-up', true))}
      </MoveDrawer>

      <MoveDrawer
        group="machine-tutor"
        title="Available machine, tutor & breeding moves"
        count={groups.machineTutor.length}
      >
        {groups.machineTutor.map((item) => renderEntry(item, 'machine-tutor', true))}
      </MoveDrawer>

      <MoveDrawer
        group="future-milestone"
        title="Future-milestone moves"
        count={groups.futureMilestone.length}
      >
        {groups.futureMilestone.map((item) => renderEntry(item, 'future-milestone', true))}
      </MoveDrawer>
    </div>
  );
}

interface MoveDrawerProps {
  group: string;
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function MoveDrawer({ group, title, count, defaultOpen, children }: MoveDrawerProps) {
  return (
    <details className="move-drawer" data-group={group} open={defaultOpen || undefined}>
      <summary className="move-drawer-summary">
        <span className="move-drawer-title">{title}</span>
        <span className="move-drawer-count">{count}</span>
      </summary>
      {count > 0 ? (
        <ul className="move-list">{children}</ul>
      ) : (
        <p className="move-empty">No moves in this group.</p>
      )}
    </details>
  );
}
