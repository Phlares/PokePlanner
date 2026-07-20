import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgressionRail } from './ProgressionRail';
import { loadFireRedPackFixture } from '../../test/firered-pack';

const pack = loadFireRedPackFixture();

function renderRail(overrides: Partial<Parameters<typeof ProgressionRail>[0]> = {}) {
  const handlers = {
    onSelectNode: vi.fn(),
    onSelectEvent: vi.fn(),
    onSetCurrentMilestone: vi.fn(),
    onSetPreviewMilestone: vi.fn(),
  };
  render(
    <ProgressionRail
      nodes={pack.progression.nodes}
      selectedNodeId={null}
      currentMilestoneId={null}
      previewMilestoneId={null}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

afterEach(cleanup);

describe('ProgressionRail', () => {
  it('renders the node spine in chronological golden-path order', () => {
    renderRail();
    const pallet = screen.getByRole('button', { name: 'Pallet Town' });
    const route1 = screen.getByRole('button', { name: 'Route 1' });
    const viridian = screen.getByRole('button', { name: 'Viridian City' });
    expect(pallet.compareDocumentPosition(route1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(route1.compareDocumentPosition(viridian) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('selects a route node on click', () => {
    const { onSelectNode } = renderRail();
    fireEvent.click(screen.getByRole('button', { name: 'Route 22' }));
    expect(onSelectNode).toHaveBeenCalledWith('kanto-route-22');
  });

  it('selects an event separately from its route node', () => {
    const { onSelectNode, onSelectEvent } = renderRail();
    fireEvent.click(screen.getByRole('button', { name: /Optional early Rival battle/i }));
    expect(onSelectEvent).toHaveBeenCalledWith('route-22-rival-early');
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it('activates a node with the Enter and Space keys', () => {
    const { onSelectNode } = renderRail();
    const pallet = screen.getByRole('button', { name: 'Pallet Town' });
    pallet.focus();
    fireEvent.keyDown(pallet, { key: 'Enter' });
    fireEvent.keyDown(pallet, { key: ' ' });
    expect(onSelectNode).toHaveBeenCalledWith('pallet-town');
    expect(onSelectNode).toHaveBeenCalledTimes(2);
  });

  it('exposes distinct current and preview milestone controls', () => {
    const { onSetCurrentMilestone, onSetPreviewMilestone } = renderRail();
    const setCurrent = screen.getByRole('button', { name: /Set current milestone.*Brock/i });
    const setPreview = screen.getByRole('button', { name: /Preview milestone.*Brock/i });
    expect(setCurrent).not.toBe(setPreview);

    fireEvent.click(setCurrent);
    fireEvent.click(setPreview);
    expect(onSetCurrentMilestone).toHaveBeenCalledWith('brock-gym');
    expect(onSetPreviewMilestone).toHaveBeenCalledWith('brock-gym');
  });

  it('labels optional and postgame branches', () => {
    renderRail();
    const route22 = screen.getByRole('button', { name: 'Route 22' }).closest('li');
    expect(route22).not.toBeNull();
    expect(within(route22 as HTMLElement).getByText('Optional')).toBeVisible();

    const postgame = screen.getByRole('button', { name: 'Four Island' }).closest('li');
    expect(within(postgame as HTMLElement).getByText('Postgame')).toBeVisible();
  });

  it('surfaces per-node search match counts when a search is active', () => {
    renderRail({ matchCountsByNode: { 'kanto-route-22': 3 } });
    const route22 = screen.getByRole('button', { name: 'Route 22' }).closest('li');
    expect(within(route22 as HTMLElement).getByText(/3 matches/i)).toBeVisible();
  });

  it('never surfaces opponent rosters, exposure analysis, or live-run tables', () => {
    renderRail({ currentMilestoneId: 'brock-gym' });
    expect(screen.queryByText(/exposure/i)).toBeNull();
    expect(screen.queryByText(/opponent/i)).toBeNull();
    expect(screen.queryByText(/super.?effective/i)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
