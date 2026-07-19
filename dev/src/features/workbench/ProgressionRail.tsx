import type { KeyboardEvent } from 'react';
import { MILESTONE_ORDER } from '../../domain/availability';
import type { ProgressionBranch, ProgressionEvent, ProgressionNode } from '../../domain/progression';

const CONTROLLABLE_MILESTONES = new Set<string>(MILESTONE_ORDER);

const BRANCH_LABEL: Partial<Record<ProgressionBranch, string>> = {
  optional: 'Optional',
  alternate: 'Alternate',
  postgame: 'Postgame',
};

export interface ProgressionRailProps {
  nodes: readonly ProgressionNode[];
  selectedNodeId: string | null;
  currentMilestoneId: string | null;
  previewMilestoneId: string | null;
  /** Node-id → matching-Pokémon count, present only while a search is active. */
  matchCountsByNode?: Readonly<Record<string, number>>;
  onSelectNode: (nodeId: string) => void;
  onSelectEvent: (eventId: string) => void;
  onSetCurrentMilestone: (milestoneId: string) => void;
  onSetPreviewMilestone: (milestoneId: string | null) => void;
}

function matchLabel(count: number): string {
  return `${count} ${count === 1 ? 'match' : 'matches'}`;
}

/**
 * The functional chronological spine of the FireRed run: every progression node in
 * golden-path order, its events, and the milestone controls that move the current or preview
 * marker. It renders progression facts only — never opponent rosters, exposure verdicts, or
 * live-run state (Plan 3). Nodes are real buttons, so Enter/Space activate them natively; an
 * explicit key handler keeps that testable without a synthetic-event library.
 */
export function ProgressionRail({
  nodes,
  selectedNodeId,
  currentMilestoneId,
  previewMilestoneId,
  matchCountsByNode,
  onSelectNode,
  onSelectEvent,
  onSetCurrentMilestone,
  onSetPreviewMilestone,
}: ProgressionRailProps) {
  const ordered = [...nodes].sort((a, b) => a.goldenPathOrder - b.goldenPathOrder);

  const onNodeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, nodeId: string): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectNode(nodeId);
    }
  };

  const isMilestone = (event: ProgressionEvent): boolean => event.flags.keyMilestone;

  return (
    <nav className="rail" aria-label="FireRed progression spine">
      <ol className="rail-spine">
        {ordered.map((node, index) => {
          const branchLabel = node.branch ? BRANCH_LABEL[node.branch] : undefined;
          const matchCount = matchCountsByNode?.[node.id];
          const hasMilestone = node.events.some(isMilestone);
          return (
            <li key={node.id} className="rail-node" data-milestone={hasMilestone || undefined}>
              <div className="rail-node-head">
                <code className="rail-node-order">{String(index + 1).padStart(2, '0')}</code>
                <button
                  type="button"
                  className="rail-node-select"
                  aria-label={node.name}
                  aria-pressed={selectedNodeId === node.id}
                  onClick={() => onSelectNode(node.id)}
                  onKeyDown={(event) => onNodeKeyDown(event, node.id)}
                >
                  <span className="rail-node-name">{node.name}</span>
                  <span className="rail-node-kind">{node.kind}</span>
                </button>
              </div>
              <div className="rail-node-meta">
                {branchLabel && <span className="rail-node-branch">{branchLabel}</span>}
                {matchCount !== undefined && (
                  <span className="rail-node-matches">{matchLabel(matchCount)}</span>
                )}
              </div>
              {node.events.length > 0 && (
                <ul className="rail-events">
                  {node.events.map((event) => {
                    const controllable = CONTROLLABLE_MILESTONES.has(event.id);
                    return (
                      <li key={event.id} className="rail-event" data-milestone={isMilestone(event) || undefined}>
                        <button
                          type="button"
                          className="rail-event-select"
                          onClick={() => onSelectEvent(event.id)}
                        >
                          {event.name}
                        </button>
                        {controllable && (
                          <div className="rail-milestone-controls">
                            <button
                              type="button"
                              className="rail-milestone-current"
                              aria-label={`Set current milestone: ${event.name}`}
                              aria-pressed={currentMilestoneId === event.id}
                              onClick={() => onSetCurrentMilestone(event.id)}
                            >
                              Set current
                            </button>
                            <button
                              type="button"
                              className="rail-milestone-preview"
                              aria-label={`Preview milestone: ${event.name}`}
                              aria-pressed={previewMilestoneId === event.id}
                              onClick={() => onSetPreviewMilestone(event.id)}
                            >
                              Preview
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
