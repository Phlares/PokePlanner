import { useState } from 'react';
import type { LevelMode } from '../../domain/rules/game-rules';
import { copyKeyframe } from '../../domain/timeline/commands';
import type { TimelineKeyframe, TimelineState } from '../../domain/timeline/model';
import type { PropagationPreview } from '../../domain/timeline/propagation';
import type { ResolvedTimelineNode, TimelineResolverPackView } from '../../domain/timeline/resolver';
import type { TimelineFinding } from '../../domain/timeline/validation';
import { MemberPool, memberDisplayName } from './MemberPool';
import {
  MilestoneRuler,
  timelineSourceLabel,
  type TimelineMode,
  type TimelineRulerNode,
} from './MilestoneRuler';

export interface TimelineDisplayNode extends Omit<TimelineRulerNode, 'source'> {
  progressionNodeId?: string;
  resolved: ResolvedTimelineNode;
}

export interface TeamTimelineProps {
  timeline: TimelineState;
  majorNodes: readonly TimelineDisplayNode[];
  detailedNodes: readonly TimelineDisplayNode[];
  findingsByNode: Readonly<Record<string, readonly TimelineFinding[]>>;
  pack: TimelineResolverPackView;
  speciesName: (speciesId: number) => string;
  onChange: (next: TimelineState) => void;
  initialNodeId?: string;
  onEditMember?: (nodeId: string, memberId: string) => void;
  onRequestRestore?: (nodeId: string, memberId: string) => void;
  propagationPreview?: PropagationPreview | null;
}

export function explicitOverrideFrom(node: ResolvedTimelineNode): TimelineKeyframe {
  return {
    nodeId: node.nodeId,
    kind: 'override',
    party: [...node.party] as TimelineKeyframe['party'],
    reserve: [...node.reserve],
    released: [...node.released],
    snapshots: Object.fromEntries(Object.entries(node.snapshots).map(([memberId, snapshot]) => [memberId, {
      ...snapshot,
      moves: snapshot.moves.map((move) => ({ ...move })),
      review: { ...snapshot.review },
    }])),
  };
}

function memberSpeciesCounts(timeline: TimelineState): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  Object.values(timeline.members).forEach((member) => {
    counts.set(member.originalSpeciesId, (counts.get(member.originalSpeciesId) ?? 0) + 1);
  });
  return counts;
}

/** Desktop timeline ledger. Detailed route state stays derived until the first edit promotes it. */
export function TeamTimeline({
  timeline,
  majorNodes,
  detailedNodes,
  findingsByNode,
  pack,
  speciesName,
  onChange,
  initialNodeId,
  onEditMember,
  onRequestRestore,
  propagationPreview = null,
}: TeamTimelineProps) {
  const initialMajor = majorNodes.find((node) => node.id === initialNodeId) ?? majorNodes[0] ?? detailedNodes[0];
  const [mode, setMode] = useState<TimelineMode>('major');
  const [selectedNodeId, setSelectedNodeId] = useState(initialMajor?.id ?? '');
  const [copyOpen, setCopyOpen] = useState(false);
  const [autoLevel, setAutoLevel] = useState(false);
  const [levelMode, setLevelMode] = useState<Exclude<LevelMode, 'manual'>>(
    timeline.preferences.levelMode === 'manual' ? 'match' : timeline.preferences.levelMode,
  );
  const [autoEvolve, setAutoEvolve] = useState(false);

  const visibleNodes = mode === 'major' ? majorNodes : detailedNodes;
  const selected = visibleNodes.find((node) => node.id === selectedNodeId) ?? visibleNodes[0];
  if (!selected) return <p className="timeline-empty">No timeline nodes are available.</p>;

  const selectMode = (nextMode: TimelineMode): void => {
    const nextNodes = nextMode === 'major' ? majorNodes : detailedNodes;
    let nextSelected = nextNodes.find((node) => node.id === selectedNodeId);
    if (!nextSelected && nextMode === 'detailed') {
      const major = majorNodes.find((node) => node.id === selectedNodeId);
      nextSelected = nextNodes.find((node) => node.id === major?.progressionNodeId);
    }
    setMode(nextMode);
    setSelectedNodeId(nextSelected?.id ?? nextNodes[0]?.id ?? '');
    setCopyOpen(false);
  };

  const selectNode = (nodeId: string): void => {
    setSelectedNodeId(nodeId);
    setCopyOpen(false);
  };

  const selectedMajorIndex = mode === 'major' ? majorNodes.findIndex((node) => node.id === selected.id) : -1;
  const priorPopulated = selectedMajorIndex <= 0 ? undefined : [...majorNodes]
    .slice(0, selectedMajorIndex)
    .reverse()
    .find((node) => timeline.keyframes[node.id]);
  const canCopy = mode === 'major' && timeline.keyframes[selected.id] === undefined && priorPopulated !== undefined;

  const createKeyframe = (): void => {
    if (!priorPopulated) return;
    onChange(copyKeyframe(timeline, priorPopulated.id, selected.id, {
      levelMode: autoLevel ? levelMode : 'manual',
      targetLevel: selected.targetLevel,
      autoEvolveLevel: autoLevel && autoEvolve,
      pack,
    }));
    setCopyOpen(false);
  };

  const editMember = (memberId: string): void => {
    if (!onEditMember) return;
    if (selected.resolved.source === 'auto-filled') {
      onChange({
        ...timeline,
        overrides: { ...timeline.overrides, [selected.id]: explicitOverrideFrom(selected.resolved) },
      });
    }
    onEditMember(selected.id, memberId);
  };

  const counts = memberSpeciesCounts(timeline);
  const sourceLabel = timelineSourceLabel(selected.resolved.source);
  const selectedFindings = findingsByNode[selected.id] ?? [];
  const findingSummary = `${selectedFindings.length} ${selectedFindings.length === 1 ? 'finding' : 'findings'}`;
  const filledPartyCount = selected.resolved.party.filter((memberId) => memberId !== null).length;

  return (
    <div className="team-timeline" data-source={selected.resolved.source}>
      <MilestoneRuler
        mode={mode}
        nodes={visibleNodes.map((node) => ({
          ...node,
          source: node.resolved.source,
          findingCount: findingsByNode[node.id]?.length ?? 0,
        }))}
        selectedNodeId={selected.id}
        onModeChange={selectMode}
        onSelectNode={selectNode}
      />

      <header className="timeline-node-head">
        <div>
          <p className="eyebrow">{mode === 'major' ? 'Checkpoint' : 'Route state'}</p>
          <h2>{selected.name}</h2>
        </div>
        <div className="timeline-node-meta">
          <span className="timeline-state-label" data-source={selected.resolved.source}>{sourceLabel}</span>
          <span>Target Lv {selected.targetLevel}</span>
          <span>{findingSummary}</span>
        </div>
      </header>

      {canCopy && (
        <div className="timeline-copy">
          <button type="button" className="timeline-control" aria-expanded={copyOpen} onClick={() => setCopyOpen((open) => !open)}>
            Copy previous
          </button>
          {copyOpen && (
            <div className="timeline-copy-options" role="group" aria-label={`Copy ${priorPopulated.name} to ${selected.name}`}>
              <label>
                <input type="checkbox" checked={autoLevel} onChange={(event) => setAutoLevel(event.currentTarget.checked)} />
                Auto-level active party
              </label>
              {autoLevel && (
                <div className="timeline-level-options" role="radiogroup" aria-label="Auto-level policy">
                  {(['under', 'match', 'over'] as const).map((value) => (
                    <label key={value}>
                      <input type="radio" name="timeline-level-mode" value={value} checked={levelMode === value} onChange={() => setLevelMode(value)} />
                      {value === 'under' ? 'Under −5' : value === 'match' ? 'Match' : 'Over +5'}
                    </label>
                  ))}
                </div>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={autoLevel && autoEvolve}
                  disabled={!autoLevel}
                  onChange={(event) => setAutoEvolve(event.currentTarget.checked)}
                />
                Auto-evolve level evolutions
              </label>
              <button type="button" className="timeline-control timeline-control-primary" onClick={createKeyframe}>
                Create {selected.name} keyframe
              </button>
            </div>
          )}
        </div>
      )}

      {propagationPreview && (
        <p className="timeline-propagation-preview" role="status">
          Pending change · {propagationPreview.targetNodeIds.length} targets · {propagationPreview.protectedNodeIds.length} protected
        </p>
      )}

      {selectedFindings.length > 0 && (
        <section className="timeline-findings timeline-node-findings" aria-label={`Findings at ${selected.name}`}>
          <h3>Findings</h3>
          {selectedFindings.map((finding, index) => (
            <details key={`${finding.code}-${finding.memberId ?? 'node'}-${index}`} className="timeline-finding" data-severity={finding.severity}>
              <summary tabIndex={0}><span>{finding.severity}</span>{finding.summary}</summary>
              <p tabIndex={0}>{finding.explanation}</p>
              {finding.evidenceIds.length > 0 && <code>{finding.evidenceIds.join(' · ')}</code>}
            </details>
          ))}
        </section>
      )}

      <section className="timeline-party" aria-label={`Party · ${filledPartyCount} of 6 Pokémon`}>
        <h3>Party</h3>
        <ol className="timeline-party-list">
          {selected.resolved.party.map((memberId, index) => {
            const member = memberId === null ? undefined : timeline.members[memberId];
            const snapshot = memberId === null ? undefined : selected.resolved.snapshots[memberId];
            const name = member && snapshot ? memberDisplayName(member, snapshot, speciesName, counts) : null;
            return (
              <li key={index} className="timeline-party-slot" data-filled={name !== null || undefined}>
                <code>P{index + 1}</code>
                {name === null || !snapshot ? (
                  <span className="timeline-party-empty">Empty</span>
                ) : (
                  <>
                    <span className="timeline-member-name">{name}</span>
                    <span className="timeline-member-level">Lv {snapshot.level}</span>
                    {onEditMember && (
                      <button type="button" className="timeline-text-action" aria-label={`Edit ${name}`} onClick={() => editMember(memberId!)}>
                        Edit
                      </button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="timeline-pools">
        <MemberPool
          kind="reserve"
          memberIds={selected.resolved.reserve}
          members={timeline.members}
          snapshots={selected.resolved.snapshots}
          speciesName={speciesName}
          onEditMember={onEditMember ? editMember : undefined}
        />
        <MemberPool
          kind="released"
          memberIds={selected.resolved.released}
          members={timeline.members}
          snapshots={selected.resolved.snapshots}
          speciesName={speciesName}
          onEditMember={onEditMember ? editMember : undefined}
          onRequestRestore={onRequestRestore ? (memberId) => onRequestRestore(selected.id, memberId) : undefined}
        />
      </div>
    </div>
  );
}
