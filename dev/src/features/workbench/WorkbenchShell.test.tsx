import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchShell, type WorkbenchShellProps } from './WorkbenchShell';

function renderShell(overrides: Partial<WorkbenchShellProps> = {}) {
  return render(
    <WorkbenchShell
      runName="Kanto ledger"
      teamLabel="Team at Brock"
      runMenu={<button type="button">Run menu</button>}
      team={<p>team rung</p>}
      search={<p>search rung</p>}
      results={<p>results workspace</p>}
      inspector={<p>inspector column</p>}
      {...overrides}
    />,
  );
}

/** True when `first` precedes `second` in document order. */
function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

afterEach(cleanup);

describe('WorkbenchShell', () => {
  it('places the team before workspace content', () => {
    renderShell();
    const regions = screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'));
    expect(regions).toEqual(['Team at Brock', 'Search and filters', 'Workbench results', 'Inspector']);
    expect(regions.indexOf('Team at Brock')).toBeLessThan(regions.indexOf('Workbench results'));
  });

  it('names the team region from the planning target instead of a fixed label', () => {
    renderShell({ teamLabel: 'Team at Misty' });
    expect(screen.getByRole('region', { name: 'Team at Misty' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Team at Brock' })).toBeNull();
  });

  it('renders every slot inside the region that names it', () => {
    renderShell();
    expect(within(screen.getByRole('region', { name: 'Team at Brock' })).getByText('team rung')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Search and filters' })).getByText('search rung')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Workbench results' })).getByText('results workspace')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Inspector' })).getByText('inspector column')).toBeVisible();
  });

  it('carries run identity and the run menu in a header above every region', () => {
    renderShell();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { level: 1, name: 'Kanto ledger' })).toBeVisible();
    expect(within(header).getByRole('button', { name: 'Run menu' })).toBeVisible();
    expect(precedes(header, screen.getByRole('region', { name: 'Team at Brock' }))).toBe(true);
  });

  it('keeps import and export out of the rungs by leaving the run menu the only header control', () => {
    renderShell();
    const team = screen.getByRole('region', { name: 'Team at Brock' });
    const search = screen.getByRole('region', { name: 'Search and filters' });
    expect(within(team).queryByRole('button', { name: 'Run menu' })).toBeNull();
    expect(within(search).queryByRole('button', { name: 'Run menu' })).toBeNull();
  });

  it('places recovery notices between the header and the team rung', () => {
    renderShell({ notices: <p role="status">Temporary session</p> });
    const notice = screen.getByRole('status');
    expect(precedes(screen.getByRole('banner'), notice)).toBe(true);
    expect(precedes(notice, screen.getByRole('region', { name: 'Team at Brock' }))).toBe(true);
  });

  it('renders no notice area when there is nothing to recover from', () => {
    renderShell();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('gives the workspace the main landmark and leaves the rungs outside it', () => {
    renderShell();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('region', { name: 'Workbench results' })).toBeVisible();
    expect(within(main).getByRole('region', { name: 'Inspector' })).toBeVisible();
    expect(within(main).queryByRole('region', { name: 'Team at Brock' })).toBeNull();
    expect(within(main).queryByRole('region', { name: 'Search and filters' })).toBeNull();
  });
});
