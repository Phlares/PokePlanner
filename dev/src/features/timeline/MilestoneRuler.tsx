import type { ResolvedTimelineNode } from '../../domain/timeline/resolver';

export type TimelineMode = 'major' | 'detailed';

export interface TimelineRulerNode {
  id: string;
  name: string;
  targetLevel: number;
  source: ResolvedTimelineNode['source'];
  findingCount?: number;
}

export interface MilestoneRulerProps {
  mode: TimelineMode;
  nodes: readonly TimelineRulerNode[];
  selectedNodeId: string;
  onModeChange: (mode: TimelineMode) => void;
  onSelectNode: (nodeId: string) => void;
}

export function timelineSourceLabel(source: ResolvedTimelineNode['source']): string {
  if (source === 'explicit-major') return 'Explicit';
  if (source === 'explicit-override') return 'Overridden';
  return 'Auto-filled';
}

/** Ordered timeline navigation; its buttons remain keyboard-operable inside the horizontal scroller. */
export function MilestoneRuler({ mode, nodes, selectedNodeId, onModeChange, onSelectNode }: MilestoneRulerProps) {
  return (
    <nav className="timeline-ruler" aria-label="Milestone ruler">
      <div className="timeline-view-toggle" aria-label="Timeline detail">
        <button
          type="button"
          aria-pressed={mode === 'major'}
          onClick={() => onModeChange('major')}
        >
          Major Events
        </button>
        <button
          type="button"
          aria-pressed={mode === 'detailed'}
          onClick={() => onModeChange('detailed')}
        >
          Detailed Planning
        </button>
      </div>

      <ol className="timeline-ruler-list">
        {nodes.map((node, index) => {
          const stateLabel = timelineSourceLabel(node.source);
          const findingLabel = node.findingCount ? ` · ${node.findingCount} findings` : '';
          return (
            <li key={node.id} className="timeline-ruler-item" data-source={node.source}>
              <button
                type="button"
                className="timeline-ruler-node"
                aria-current={node.id === selectedNodeId ? 'step' : undefined}
                aria-label={`${node.name} · target level ${node.targetLevel} · ${stateLabel}${findingLabel}`}
                onClick={() => onSelectNode(node.id)}
              >
                <span className="timeline-ruler-order">{String(index + 1).padStart(2, '0')}</span>
                <span className="timeline-ruler-name">{node.name}</span>
                <span className="timeline-ruler-level">Lv {node.targetLevel}</span>
                <span className="timeline-ruler-state">{stateLabel}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
