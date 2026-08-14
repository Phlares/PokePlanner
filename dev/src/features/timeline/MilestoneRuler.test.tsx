import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MilestoneRuler, type TimelineRulerNode } from './MilestoneRuler';

const majorNodes: TimelineRulerNode[] = [
  { id: 'brock-gym', name: 'Brock', targetLevel: 14, source: 'explicit-major' },
  { id: 'misty-gym', name: 'Misty', targetLevel: 21, source: 'auto-filled' },
];

const detailedNodes: TimelineRulerNode[] = [
  { id: 'kanto-route-22', name: 'Route 22', targetLevel: 14, source: 'auto-filled' },
];

afterEach(cleanup);

describe('MilestoneRuler', () => {
  it('presents Major Events as the active default view', () => {
    render(
      <MilestoneRuler
        mode="major"
        nodes={majorNodes}
        selectedNodeId="brock-gym"
        onModeChange={vi.fn()}
        onSelectNode={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: 'Timeline detail' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Major Events' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Brock.*level 14.*Explicit/i })).toHaveAttribute('aria-current', 'step');
  });

  it('exposes detailed route selection through semantic buttons', () => {
    const onModeChange = vi.fn();
    const onSelectNode = vi.fn();
    const { rerender } = render(
      <MilestoneRuler
        mode="major"
        nodes={majorNodes}
        selectedNodeId="brock-gym"
        onModeChange={onModeChange}
        onSelectNode={onSelectNode}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Detailed Planning' }));
    expect(onModeChange).toHaveBeenCalledWith('detailed');

    rerender(
      <MilestoneRuler
        mode="detailed"
        nodes={detailedNodes}
        selectedNodeId="kanto-route-22"
        onModeChange={onModeChange}
        onSelectNode={onSelectNode}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Route 22.*Auto-filled/i }));
    expect(onSelectNode).toHaveBeenCalledWith('kanto-route-22');
  });
});
