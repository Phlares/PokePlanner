import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistentMember, TimelineState } from '../../domain/timeline/model';
import type { TimelineFinding } from '../../domain/timeline/validation';
import { TimelineMemberEditor } from './TimelineMemberEditor';

const member: PersistentMember = {
  id: 'mankey-2',
  originalSpeciesId: 56,
  speciesSequence: 2,
  nickname: null,
  natureId: null,
  origin: { type: 'inferred', acquisitionId: null, note: null },
  acquiredAtNodeId: 'brock-gym',
  notes: '',
  lifecycle: [],
};

function timeline(): TimelineState {
  const frames = Object.fromEntries(['brock-gym', 'misty-gym', 'surge-gym'].map((nodeId, index) => [nodeId, {
    nodeId,
    kind: 'major' as const,
    party: ['mankey-2', null, null, null, null, null] as const,
    reserve: [],
    released: [],
    snapshots: {
      'mankey-2': {
        speciesId: 56,
        level: 14 + index * 7,
        abilityId: 61,
        moves: [],
        heldItemId: null,
        placement: 'party' as const,
        partySlot: 0 as const,
        review: { moves: false, heldItem: false },
      },
    },
  }]));
  return {
    members: { 'mankey-2': member },
    keyframes: frames,
    overrides: {},
    preferences: { levelMode: 'manual', autoEvolveLevel: false },
  };
}

const originFinding: TimelineFinding = {
  code: 'move.egg-origin',
  severity: 'yellow',
  memberId: 'mankey-2',
  field: 'origin',
  summary: 'Egg move needs a hatched origin',
  explanation: 'Choose the hatched origin only when this member came from breeding.',
  evidenceIds: ['move:68'],
  resolutions: [{
    id: 'origin.hatched',
    label: 'Use hatched origin',
    action: { type: 'set-origin', origin: { type: 'hatched', acquisitionId: null, note: null } },
  }],
};

function renderEditor(overrides: Partial<Parameters<typeof TimelineMemberEditor>[0]> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <TimelineMemberEditor
      timeline={timeline()}
      nodeId="brock-gym"
      member={member}
      snapshot={timeline().keyframes['brock-gym'].snapshots['mankey-2']}
      memberName="Mankey #2"
      milestoneOrder={['brock-gym', 'misty-gym', 'surge-gym']}
      speciesOptions={[{ id: 56, name: 'Mankey' }, { id: 57, name: 'Primeape' }]}
      abilityOptions={[{ id: 61, name: 'Vital Spirit' }, { id: 72, name: 'Anger Point' }]}
      moveOptions={[{ id: 68, name: 'Counter' }]}
      natureOptions={[{ id: 'adamant', name: 'Adamant' }]}
      findings={[originFinding]}
      capabilityEvidence={[{ id: 'cut', state: 'conditional', explanation: 'Can learn Cut after the Cascade Badge.' }]}
      onApply={onApply}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onApply, onClose };
}

afterEach(cleanup);

describe('TimelineMemberEditor', () => {
  it('previews forward propagation before applying', () => {
    const { onApply } = renderEditor();
    fireEvent.change(screen.getByLabelText('Ability'), { target: { value: '72' } });
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: 'Here and future populated milestones' }));
    expect(screen.getByText('Affects 3 milestones')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ scope: 'forward', field: 'abilityId' }));
    const next = onApply.mock.calls[0][0].timeline as TimelineState;
    expect(next.keyframes['brock-gym'].snapshots['mankey-2'].abilityId).toBe(72);
    expect(next.keyframes['surge-gym'].snapshots['mankey-2']).toMatchObject({ abilityId: 72, level: 28 });
  });

  it('keeps nature member-wide after the preview and apply flow', () => {
    const { onApply } = renderEditor();
    fireEvent.change(screen.getByLabelText('Nature'), { target: { value: 'adamant' } });
    fireEvent.click(screen.getByRole('radio', { name: 'This milestone only' }));
    expect(screen.getByText('Affects 3 milestones')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));

    const applied = onApply.mock.calls[0][0];
    expect(applied).toMatchObject({ scope: 'here', field: 'natureId' });
    expect(applied.timeline.members['mankey-2'].natureId).toBe('adamant');
    expect(applied.timeline.keyframes['misty-gym'].snapshots['mankey-2'].abilityId).toBe(61);
  });

  it('keeps planned moves compact when a later empty slot is edited', () => {
    const { onApply } = renderEditor();
    fireEvent.change(screen.getByLabelText('Move 4'), { target: { value: '68' } });
    fireEvent.click(screen.getByRole('radio', { name: 'This milestone only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));

    expect(onApply.mock.calls[0][0].timeline.keyframes['brock-gym'].snapshots['mankey-2'].moves).toEqual([
      { moveId: 68, status: 'available-now', level: null, milestoneId: null },
    ]);
  });

  it('keeps an invalid level draft visible without applying it', () => {
    const { onApply } = renderEditor();
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('radio', { name: 'This milestone only' }));

    expect(screen.getByText('Level must be from 1 through 100.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply change' })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('renders focusable finding explanations and explicit origin resolutions', () => {
    renderEditor();
    const summary = screen.getByText('Egg move needs a hatched origin');
    expect(summary).toHaveAttribute('tabindex', '0');
    fireEvent.click(summary);
    expect(screen.getByText(/Choose the hatched origin/)).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Use hatched origin' })).toBeVisible();
    expect(screen.getByText(/Can learn Cut after the Cascade Badge/)).toBeVisible();
  });

  it('traps focus in the dialog and restores the edit trigger on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Edit Mankey #2';
    document.body.append(trigger);
    trigger.focus();
    const { onClose } = renderEditor({ returnFocusTo: trigger, onRequestRelease: vi.fn() });
    const dialog = screen.getByRole('dialog', { name: 'Edit Mankey #2 at Brock' });
    const close = within(dialog).getByRole('button', { name: 'Close editor' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(within(dialog).getByRole('button', { name: 'Release Mankey #2' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('requires confirmation before requesting release', () => {
    const onRequestRelease = vi.fn();
    renderEditor({ onRequestRelease });
    fireEvent.click(screen.getByRole('button', { name: 'Release Mankey #2' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Release Mankey #2?' });
    expect(within(confirmation).getByText(/keeps this member in the historical archive/i)).toBeVisible();
    expect(within(confirmation).getByRole('button', { name: 'Cancel release' })).toHaveFocus();
    expect(onRequestRelease).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm release' }));
    expect(onRequestRelease).toHaveBeenCalledWith('brock-gym', 'mankey-2');
  });
});
