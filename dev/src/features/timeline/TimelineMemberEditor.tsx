import { useEffect, useMemo, useRef, useState } from 'react';
import { editSnapshotField, type SnapshotEditableField } from '../../domain/timeline/commands';
import type { CapabilityState } from '../../domain/timeline/capabilities';
import type { MemberOrigin, MemberSnapshot, PersistentMember, TimelineState } from '../../domain/timeline/model';
import {
  applyPropagation,
  previewPropagation,
  type PropagationPreview,
  type PropagationScope,
} from '../../domain/timeline/propagation';
import type { TimelineFinding } from '../../domain/timeline/validation';
import { useModalBoundary } from './modal-boundary';

export interface EditorOption<Value extends string | number> {
  id: Value;
  name: string;
}

export interface EditorCapabilityEvidence {
  id: string;
  state: CapabilityState;
  explanation: string;
}

export interface EditorSpeciesCompatibility {
  speciesId: number;
  legalAbilityIds: readonly number[];
  defaultAbilityId: number;
  legalMoveIds: readonly number[];
}

export type TimelineMemberEditorField = SnapshotEditableField | 'natureId' | 'notes' | 'origin';

export interface TimelineMemberEditorApply {
  field: TimelineMemberEditorField;
  scope: PropagationScope;
  timeline: TimelineState;
  preview: Pick<PropagationPreview, 'targetNodeIds' | 'skippedNodeIds' | 'protectedNodeIds' | 'conflictNodeIds'>;
}

export interface TimelineMemberEditorProps {
  timeline: TimelineState;
  nodeId: string;
  nodeName?: string;
  member: PersistentMember;
  snapshot: MemberSnapshot;
  memberName: string;
  milestoneOrder: readonly string[];
  speciesOptions: readonly EditorOption<number>[];
  abilityOptions: readonly EditorOption<number>[];
  moveOptions: readonly EditorOption<number>[];
  natureOptions: readonly EditorOption<string>[];
  speciesCompatibility: readonly EditorSpeciesCompatibility[];
  findings: readonly TimelineFinding[];
  capabilityEvidence: readonly EditorCapabilityEvidence[];
  onApply: (application: TimelineMemberEditorApply) => void;
  onClose: () => void;
  onRequestRelease?: (nodeId: string, memberId: string) => void;
  returnFocusTo?: HTMLElement | null;
}

type PendingSnapshotChange = {
  [Field in SnapshotEditableField]: { kind: 'snapshot'; field: Field; value: MemberSnapshot[Field] };
}[SnapshotEditableField];

type PendingChange =
  | PendingSnapshotChange
  | { kind: 'member'; field: 'natureId'; value: string | null }
  | { kind: 'member'; field: 'notes'; value: string }
  | { kind: 'member'; field: 'origin'; value: MemberOrigin };

const ORIGIN_OPTIONS: readonly EditorOption<MemberOrigin['type']>[] = [
  { id: 'inferred', name: 'Inferred' },
  { id: 'hatched', name: 'Hatched' },
  { id: 'external-trade', name: 'External trade' },
  { id: 'transfer', name: 'Transfer' },
  { id: 'event', name: 'Event' },
  { id: 'other', name: 'Other' },
];

function displayNodeName(nodeId: string): string {
  return nodeId
    .replace(/-gym$/, '')
    .split('-')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function memberTargetIds(timeline: TimelineState, memberId: string, milestoneOrder: readonly string[]): string[] {
  const order = new Map(milestoneOrder.map((nodeId, index) => [nodeId, index]));
  return [...new Set([...Object.keys(timeline.keyframes), ...Object.keys(timeline.overrides)])]
    .filter((nodeId) => {
      const frame = timeline.overrides[nodeId] ?? timeline.keyframes[nodeId];
      return frame?.snapshots[memberId] !== undefined;
    })
    .sort((left, right) => (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER));
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
  )).filter((element) => {
    if (element.getAttribute('aria-hidden') === 'true') return false;
    const closedFinding = element.closest('details:not([open])');
    return closedFinding === null || element.tagName === 'SUMMARY';
  });
}

function reconcileSpeciesTargets(
  timeline: TimelineState,
  memberId: string,
  targetNodeIds: readonly string[],
  compatibility: EditorSpeciesCompatibility,
): TimelineState {
  return targetNodeIds.reduce((next, targetNodeId) => {
    const collection = next.overrides[targetNodeId] ? 'overrides' : 'keyframes';
    const frame = next[collection][targetNodeId];
    const snapshot = frame.snapshots[memberId];
    const moves = snapshot.moves.filter((move) => compatibility.legalMoveIds.includes(move.moveId));
    const abilityId = compatibility.legalAbilityIds.includes(snapshot.abilityId)
      ? snapshot.abilityId
      : compatibility.defaultAbilityId;
    return {
      ...next,
      [collection]: {
        ...next[collection],
        [targetNodeId]: {
          ...frame,
          snapshots: {
            ...frame.snapshots,
            [memberId]: {
              ...snapshot,
              abilityId,
              moves,
              review: { ...snapshot.review, moves: snapshot.review.moves || moves.length !== snapshot.moves.length },
            },
          },
        },
      },
    };
  }, timeline);
}

/** One-change-at-a-time milestone editor. No draft mutates timeline state before scope confirmation. */
export function TimelineMemberEditor({
  timeline,
  nodeId,
  nodeName = displayNodeName(nodeId),
  member,
  snapshot,
  memberName,
  milestoneOrder,
  speciesOptions,
  abilityOptions,
  moveOptions,
  natureOptions,
  speciesCompatibility,
  findings,
  capabilityEvidence,
  onApply,
  onClose,
  onRequestRelease,
  returnFocusTo = null,
}: TimelineMemberEditorProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const releaseRef = useRef<HTMLButtonElement>(null);
  const cancelReleaseRef = useRef<HTMLButtonElement>(null);
  const confirmReleaseRef = useRef<HTMLButtonElement>(null);
  const releaseDialogRef = useRef<HTMLDivElement>(null);
  const restoreReleaseFocus = useRef(false);
  const fieldRefs = useRef<Partial<Record<TimelineMemberEditorField, HTMLElement | null>>>({});
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [scope, setScope] = useState<PropagationScope | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const canRelease = snapshot.placement !== 'released' && onRequestRelease !== undefined;
  const compatibilityBySpecies = useMemo(
    () => new Map(speciesCompatibility.map((entry) => [entry.speciesId, entry])),
    [speciesCompatibility],
  );
  useModalBoundary(dialogRef, true);
  useModalBoundary(releaseDialogRef, releaseOpen);

  const choosePending = (change: PendingChange): void => {
    setPending(change);
    setScope(null);
  };

  const pendingError = useMemo(() => {
    if (pending?.kind !== 'snapshot') return null;
    if (pending.field === 'level' && (!Number.isInteger(pending.value) || pending.value < 1 || pending.value > 100)) {
      return 'Level must be from 1 through 100.';
    }
    if (pending.field === 'heldItemId' && pending.value !== null
      && (!Number.isInteger(pending.value) || pending.value < 1)) {
      return 'Held item ID must be a positive whole number.';
    }
    if (pending.field === 'speciesId' && !compatibilityBySpecies.has(pending.value)) {
      return 'Canonical evolution configuration is unavailable.';
    }
    return null;
  }, [compatibilityBySpecies, pending]);

  const preview = useMemo(() => {
    if (!pending || !scope || pendingError) return null;
    if (pending.kind === 'snapshot') {
      return previewPropagation(
        timeline,
        editSnapshotField(member.id, pending.field, pending.value, nodeId),
        scope,
        milestoneOrder,
      );
    }
    const targetNodeIds = memberTargetIds(timeline, member.id, milestoneOrder);
    return { targetNodeIds, skippedNodeIds: [], protectedNodeIds: [], conflictNodeIds: [] };
  }, [member.id, milestoneOrder, nodeId, pending, pendingError, scope, timeline]);

  const closeEditor = (): void => {
    const focusTarget = returnFocusTo;
    onClose();
    queueMicrotask(() => focusTarget?.focus());
  };

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (releaseOpen) {
      cancelReleaseRef.current?.focus();
    } else if (restoreReleaseFocus.current) {
      restoreReleaseFocus.current = false;
      releaseRef.current?.focus();
    }
  }, [releaseOpen]);

  const cancelRelease = (): void => {
    restoreReleaseFocus.current = true;
    setReleaseOpen(false);
  };

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (releaseOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelRelease();
      } else if (event.key === 'Tab') {
        const first = cancelReleaseRef.current;
        const last = confirmReleaseRef.current;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeEditor();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = focusableElements(dialogRef.current);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      const focusEnd = !releaseOpen && !releaseRef.current?.disabled ? releaseRef.current : last;
      focusEnd?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || (!releaseOpen && document.activeElement === releaseRef.current))) {
      event.preventDefault();
      first.focus();
    }
  };

  const apply = (): void => {
    if (!pending || !scope || !preview) return;
    let next: TimelineState;
    if (pending.kind === 'snapshot') {
      const edit = editSnapshotField(member.id, pending.field, pending.value, nodeId);
      next = applyPropagation(timeline, edit, scope, milestoneOrder, preview as PropagationPreview);
      if (pending.field === 'speciesId') {
        next = reconcileSpeciesTargets(next, member.id, preview.targetNodeIds, compatibilityBySpecies.get(pending.value)!);
      }
    } else {
      const updatedMember = pending.field === 'natureId'
        ? { ...member, natureId: pending.value }
        : pending.field === 'notes'
          ? { ...member, notes: pending.value }
          : { ...member, origin: pending.value };
      next = { ...timeline, members: { ...timeline.members, [member.id]: updatedMember } };
    }
    onApply({ field: pending.field, scope, timeline: next, preview });
    setPending(null);
    setScope(null);
  };

  const resolveFinding = (finding: TimelineFinding, resolutionIndex: number): void => {
    const action = finding.resolutions[resolutionIndex]?.action;
    if (!action) return;
    if (action.type === 'set-origin') choosePending({ kind: 'member', field: 'origin', value: action.origin });
    if (action.type === 'set-level') choosePending({ kind: 'snapshot', field: 'level', value: action.level });
    if (action.type === 'remove-move') {
      choosePending({ kind: 'snapshot', field: 'moves', value: snapshot.moves.filter((move) => move.moveId !== action.moveId) });
    }
    if (action.type === 'change-ability') fieldRefs.current.abilityId?.focus();
    if (action.type === 'change-species') fieldRefs.current.speciesId?.focus();
    if (action.type === 'edit-member') closeRef.current?.focus();
  };

  const pendingSnapshotValue = <Field extends SnapshotEditableField>(field: Field): MemberSnapshot[Field] => (
    pending?.kind === 'snapshot' && pending.field === field ? pending.value as MemberSnapshot[Field] : snapshot[field]
  );
  const selectedMoves = pendingSnapshotValue('moves');
  const pendingNature = pending?.kind === 'member' && pending.field === 'natureId' ? pending.value : member.natureId;
  const pendingNotes = pending?.kind === 'member' && pending.field === 'notes' ? pending.value : member.notes;

  return (
    <div
      ref={dialogRef}
      className="timeline-editor"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${memberName} at ${nodeName}`}
      onKeyDown={onDialogKeyDown}
    >
      <header className="timeline-editor-head">
        <div>
          <p className="eyebrow">{nodeName} snapshot</p>
          <h2>Edit {memberName}</h2>
        </div>
        <button ref={closeRef} type="button" className="timeline-editor-close" onClick={closeEditor}>Close editor</button>
      </header>

      <div className="timeline-editor-body">
        <section className="timeline-editor-fields" aria-label="Member configuration">
          <label>
            <span>Level</span>
            <input
              ref={(element) => { fieldRefs.current.level = element; }}
              aria-label="Level"
              type="number"
              min="1"
              max="100"
              aria-invalid={pendingError?.startsWith('Level') || undefined}
              value={pendingSnapshotValue('level')}
              onChange={(event) => choosePending({ kind: 'snapshot', field: 'level', value: Number(event.currentTarget.value) })}
            />
          </label>
          <label>
            <span>Evolution stage</span>
            <select
              ref={(element) => { fieldRefs.current.speciesId = element; }}
              aria-label="Evolution stage"
              value={pendingSnapshotValue('speciesId')}
              onChange={(event) => choosePending({ kind: 'snapshot', field: 'speciesId', value: Number(event.currentTarget.value) })}
            >
              {speciesOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          <label>
            <span>Ability</span>
            <select
              ref={(element) => { fieldRefs.current.abilityId = element; }}
              aria-label="Ability"
              value={pendingSnapshotValue('abilityId')}
              onChange={(event) => choosePending({ kind: 'snapshot', field: 'abilityId', value: Number(event.currentTarget.value) })}
            >
              {abilityOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          {Array.from({ length: 4 }, (_, index) => (
            <label key={index}>
              <span>Move {index + 1}</span>
              <select
                aria-label={`Move ${index + 1}`}
                value={selectedMoves[index]?.moveId ?? ''}
                onChange={(event) => {
                  const moveId = Number(event.currentTarget.value);
                  const moves = selectedMoves
                    .filter((move, moveIndex) => moveIndex !== index && (!event.currentTarget.value || move.moveId !== moveId))
                    .map((move) => ({ ...move }));
                  if (event.currentTarget.value) {
                    moves.splice(Math.min(index, moves.length), 0, { moveId, status: 'available-now', level: null, milestoneId: null });
                  }
                  choosePending({ kind: 'snapshot', field: 'moves', value: moves });
                }}
              >
                <option value="">No move</option>
                {moveOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
          ))}
          <label>
            <span>Held item ID</span>
            <input
              ref={(element) => { fieldRefs.current.heldItemId = element; }}
              aria-label="Held item ID"
              type="number"
              min="1"
              aria-invalid={pendingError?.startsWith('Held item') || undefined}
              value={pendingSnapshotValue('heldItemId') ?? ''}
              onChange={(event) => choosePending({
                kind: 'snapshot', field: 'heldItemId', value: event.currentTarget.value ? Number(event.currentTarget.value) : null,
              })}
            />
          </label>
          <label>
            <span>Nature</span>
            <select
              ref={(element) => { fieldRefs.current.natureId = element; }}
              aria-label="Nature"
              value={pendingNature ?? ''}
              onChange={(event) => choosePending({ kind: 'member', field: 'natureId', value: event.currentTarget.value || null })}
            >
              <option value="">Unspecified</option>
              {natureOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          <label className="timeline-editor-notes">
            <span>Notes</span>
            <textarea
              ref={(element) => { fieldRefs.current.notes = element; }}
              aria-label="Notes"
              value={pendingNotes}
              onChange={(event) => choosePending({ kind: 'member', field: 'notes', value: event.currentTarget.value })}
            />
          </label>
        </section>

        <fieldset className="timeline-editor-origin">
          <legend>Origin</legend>
          {ORIGIN_OPTIONS.map((option) => (
            <button
              key={option.id}
              ref={option.id === member.origin.type ? (element) => { fieldRefs.current.origin = element; } : undefined}
              type="button"
              aria-pressed={(pending?.kind === 'member' && pending.field === 'origin' ? pending.value.type : member.origin.type) === option.id}
              onClick={() => choosePending({
                kind: 'member', field: 'origin', value: { type: option.id, acquisitionId: null, note: null },
              })}
            >
              Set origin: {option.name}
            </button>
          ))}
        </fieldset>

        {pending && (
          <fieldset className="timeline-editor-scope">
            <legend>Apply scope</legend>
            <label><input type="radio" name="editor-scope" checked={scope === 'here'} onChange={() => setScope('here')} />This milestone only</label>
            <label><input type="radio" name="editor-scope" checked={scope === 'forward'} onChange={() => setScope('forward')} />Here and future populated milestones</label>
            <label><input type="radio" name="editor-scope" checked={scope === 'all-populated'} onChange={() => setScope('all-populated')} />All populated milestones</label>
            {preview && (
              <p className="timeline-editor-preview" role="status">
                Affects {preview.targetNodeIds.length} {preview.targetNodeIds.length === 1 ? 'milestone' : 'milestones'}
                {preview.protectedNodeIds.length > 0 ? ` · ${preview.protectedNodeIds.length} protected` : ''}
                {preview.conflictNodeIds.length > 0 ? ` · ${preview.conflictNodeIds.length} conflicts` : ''}
              </p>
            )}
            {pendingError && <p className="timeline-editor-error" role="alert">{pendingError}</p>}
            <button type="button" className="timeline-editor-apply" disabled={!preview} onClick={apply}>Apply change</button>
          </fieldset>
        )}

        <section className="timeline-findings" aria-label={`Findings for ${memberName}`}>
          <h3>Findings</h3>
          {findings.length === 0 && <p className="timeline-editor-empty">No findings for this member.</p>}
          {findings.map((finding, findingIndex) => (
            <details key={`${finding.code}-${findingIndex}`} className="timeline-finding" data-severity={finding.severity}>
              <summary tabIndex={0}><span>{finding.severity}</span>{finding.summary}</summary>
              <p tabIndex={0}>{finding.explanation}</p>
              {finding.evidenceIds.length > 0 && <code>{finding.evidenceIds.join(' · ')}</code>}
              <div className="timeline-finding-actions">
                {finding.resolutions.map((resolution, resolutionIndex) => (
                  <button key={resolution.id} type="button" onClick={() => resolveFinding(finding, resolutionIndex)}>{resolution.label}</button>
                ))}
              </div>
            </details>
          ))}
        </section>

        {capabilityEvidence.length > 0 && (
          <section className="timeline-capabilities" aria-label={`Capability evidence for ${memberName}`}>
            <h3>Field capabilities</h3>
            <ul>{capabilityEvidence.map((entry) => <li key={entry.id}><code>{entry.id}</code><span>{entry.state}</span><p>{entry.explanation}</p></li>)}</ul>
          </section>
        )}
      </div>

      {canRelease && <footer className="timeline-editor-foot">
        {releaseOpen ? (
          <div ref={releaseDialogRef} role="alertdialog" aria-modal="true" aria-label={`Release ${memberName}?`} className="timeline-lifecycle-confirmation">
            <p>Release keeps this member in the historical archive and records the transition permanently.</p>
            <button ref={cancelReleaseRef} type="button" onClick={cancelRelease}>Cancel release</button>
            <button ref={confirmReleaseRef} type="button" onClick={() => { onRequestRelease?.(nodeId, member.id); closeEditor(); }}>Confirm release</button>
          </div>
        ) : (
          <button ref={releaseRef} type="button" className="timeline-editor-release" onClick={() => setReleaseOpen(true)}>
            Release {memberName}
          </button>
        )}
      </footer>}
    </div>
  );
}
