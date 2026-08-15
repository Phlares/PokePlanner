import type { ReactNode } from 'react';

export interface WorkbenchShellProps {
  /** The constant product line above the run's own name. */
  productName?: string;
  /** The run's name — the h1, because the run is what the viewport is about. */
  runName: string;
  /** Header run controls: save state plus the compact run menu. Never a rung. */
  runMenu?: ReactNode;
  /** Persistent recovery notices (temporary memory, failed save) between header and team. */
  notices?: ReactNode;
  /** The team rung's accessible name, e.g. `Team at Brock`. Follows the planning target. */
  teamLabel: string;
  team: ReactNode;
  search: ReactNode;
  results: ReactNode;
  inspector: ReactNode;
}

/**
 * The viewport skeleton every workbench surface renders into (spec §7). The order is the point:
 * identity and run data sit in the header, the team the plan is about is the first rung, search
 * and filters are the second, and the workspace below splits into results and inspector. Import
 * and export never take a rung — they live in the header menu — so prime vertical space belongs to
 * the team and the results.
 *
 * Pure layout: it owns the landmarks and the region names and nothing else. Every slot is a node
 * the caller supplies, so the tasks that fill the rungs in change what is inside a region without
 * changing what the regions are.
 */
export function WorkbenchShell({
  productName = 'PokéPlanner',
  runName,
  runMenu,
  notices,
  teamLabel,
  team,
  search,
  results,
  inspector,
}: WorkbenchShellProps) {
  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-identity">
          <p className="eyebrow">{productName}</p>
          <h1 className="shell-run-name">{runName}</h1>
        </div>
        {runMenu}
      </header>

      {notices}

      {/* Both rungs stick as one block, so the search rung cannot overlap the team it sits under. */}
      <div className="shell-rungs">
        <section className="shell-team" aria-label={teamLabel}>
          {team}
        </section>

        <section className="shell-search" aria-label="Search and filters">
          {search}
        </section>
      </div>

      <main className="shell-workspace">
        <section className="shell-results" aria-label="Workbench results">
          {results}
        </section>
        <section className="shell-inspector" aria-label="Inspector">
          {inspector}
        </section>
      </main>
    </div>
  );
}
