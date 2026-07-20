import { useMemo, useState } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import {
  evaluateMoveAvailability,
  type AvailabilityContext,
  type MoveAvailabilityEntry,
} from '../../domain/availability';
import type { PlannedMove, PlannedMoveStatus } from '../../domain/team';

export interface MoveAvailabilityProps {
  pokemonId: number;
  pack: FireRedPack;
  context: AvailabilityContext;
  /** Emitted when the planner plans one move; future choices keep their availability label. */
  onPlanMove?: (move: PlannedMove) => void;
}

interface DrawerEntry {
  entry: MoveAvailabilityEntry;
  name: string;
  location: string | null;
  planned: PlannedMove;
}

function plannedFrom(entry: MoveAvailabilityEntry): PlannedMove {
  const status = entry.status as PlannedMoveStatus;
  return {
    moveId: entry.moveId,
    status,
    level: entry.status === 'future-level' ? entry.evidence.level : null,
    milestoneId: entry.status === 'future-milestone' ? entry.evidence.milestoneId : null,
  };
}

/**
 * The move-availability drawers for one Pokémon in the current planning context. It CONSUMES the
 * pure Task 8 `evaluateMoveAvailability` verdict and sorts moves into four SEPARATE native
 * `<details>` disclosures: current level-up, upcoming level-up, available machine/tutor/breeding,
 * and future-milestone. Every future entry surfaces its milestone, location, and prerequisite
 * evidence so a planned future choice is never silently promoted into the current set.
 */
export function MoveAvailability({ pokemonId, pack, context, onPlanMove }: MoveAvailabilityProps) {
  const [plannedMoveIds, setPlannedMoveIds] = useState<ReadonlySet<number>>(() => new Set());

  const report = useMemo(
    () => evaluateMoveAvailability(context, pokemonId, pack),
    [context, pokemonId, pack],
  );

  const groups = useMemo(() => {
    const nameById = new Map(pack.moves.map((record) => [record.id, record.name] as const));
    const nodeNameById = new Map(pack.progression.nodes.map((node) => [node.id, node.name] as const));
    const decorate = (entries: MoveAvailabilityEntry[]): DrawerEntry[] =>
      entries.map((entry) => ({
        entry,
        name: nameById.get(entry.moveId) ?? `Move #${entry.moveId}`,
        location: entry.evidence.location === null
          ? null
          : nodeNameById.get(entry.evidence.location) ?? entry.evidence.location,
        planned: plannedFrom(entry),
      }));
    return {
      currentLevelUp: decorate(report.availableNow.filter((entry) => entry.evidence.method === 'level-up')),
      futureLevel: decorate(report.futureLevel),
      machineTutor: decorate(report.availableNow.filter((entry) => entry.evidence.method !== 'level-up')),
      futureMilestone: decorate(report.futureMilestone),
    };
  }, [report, pack]);

  const plan = (planned: PlannedMove): void => {
    setPlannedMoveIds((current) => new Set(current).add(planned.moveId));
    onPlanMove?.(planned);
  };

  const renderEntry = (item: DrawerEntry, showEvidence: boolean) => {
    const { entry, name } = item;
    const isPlanned = plannedMoveIds.has(entry.moveId);
    return (
      <li key={entry.moveId} className="move-entry">
        <div className="move-entry-head">
          <span className="move-entry-name">{name}</span>
          {isPlanned && <span className="move-entry-planned">Planned</span>}
          <button
            type="button"
            className="move-entry-plan"
            aria-label={`Plan ${name}`}
            aria-pressed={isPlanned}
            onClick={() => plan(item.planned)}
          >
            Plan
          </button>
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
        {groups.currentLevelUp.map((item) => renderEntry(item, false))}
      </MoveDrawer>

      <MoveDrawer
        group="future-level-up"
        title="Upcoming level-up moves"
        count={groups.futureLevel.length}
      >
        {groups.futureLevel.map((item) => renderEntry(item, true))}
      </MoveDrawer>

      <MoveDrawer
        group="machine-tutor"
        title="Available machine, tutor & breeding moves"
        count={groups.machineTutor.length}
      >
        {groups.machineTutor.map((item) => renderEntry(item, true))}
      </MoveDrawer>

      <MoveDrawer
        group="future-milestone"
        title="Future-milestone moves"
        count={groups.futureMilestone.length}
      >
        {groups.futureMilestone.map((item) => renderEntry(item, true))}
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
