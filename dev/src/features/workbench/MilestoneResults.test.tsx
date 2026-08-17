import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MilestoneResults } from './MilestoneResults';
import type {
  GroupedWorkbenchResults,
  MatchingMilestoneSection,
  RouteMatch,
  RouteResult,
} from './selectors';

function match(overrides: Partial<RouteMatch> = {}): RouteMatch {
  return {
    pokemonId: 56,
    slug: 'mankey',
    name: 'Mankey',
    types: ['fighting'],
    methods: ['walk'],
    minLevel: 3,
    maxLevel: 5,
    exactMatch: false,
    obtainability: { status: 'standard', flagged: false },
    ...overrides,
  };
}

function route(overrides: Partial<RouteResult> = {}): RouteResult {
  return {
    nodeId: 'kanto-route-22',
    name: 'Route 22',
    milestoneId: 'milestone-1',
    milestoneIndex: 0,
    access: 'current',
    levelRange: { min: 3, max: 5 },
    matchCount: 1,
    gates: [],
    matches: [match()],
    ...overrides,
  };
}

function group(overrides: Partial<MatchingMilestoneSection> = {}): MatchingMilestoneSection {
  return {
    kind: 'matching-milestone',
    milestoneId: 'milestone-1',
    milestoneIndex: 0,
    name: 'Milestone 1',
    matchCount: 1,
    routes: [route()],
    expanded: true,
    ...overrides,
  };
}

/** The brief's shape: one future teaser, one matching group, one folded no-match range. */
function searchFixture(): GroupedWorkbenchResults {
  return {
    sections: [
      { kind: 'future-teaser', matchCount: 1, milestoneIds: ['milestone-11'], expanded: false },
      group(),
      {
        kind: 'no-match-summary',
        hiddenMilestones: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => ({
          id: `milestone-${index + 1}`,
          index,
          name: `Milestone ${index + 1}`,
        })),
        expanded: false,
      },
    ],
    totalPokemon: 2,
    totalRoutes: 2,
  };
}

function renderResults(
  results: GroupedWorkbenchResults,
  overrides: Partial<Parameters<typeof MilestoneResults>[0]> = {},
) {
  const handlers = {
    onToggleSection: vi.fn(),
    onSelectRoute: vi.fn(),
    onSelectPokemon: vi.fn(),
    onSetCurrentMilestone: vi.fn(),
    onSetPreviewMilestone: vi.fn(),
  };
  render(
    <MilestoneResults
      results={results}
      targetName="Milestone 10"
      currentMilestoneId={null}
      previewMilestoneId={null}
      selectedNodeId={null}
      selectedPokemonId={null}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

/** The `li` one matching species owns, addressed through the select button that names it. */
function matchRow(name: string, routeName = 'Route 22'): HTMLElement {
  return screen.getByRole('button', { name: `Select ${name} at ${routeName}` }).closest('li') as HTMLElement;
}

afterEach(cleanup);

describe('MilestoneResults', () => {
  it('renders matches without individual no-match milestones', () => {
    renderResults(searchFixture());

    expect(screen.getByRole('button', { name: '1 match after Milestone 10' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Milestone 1 · 1 match' })).toBeInTheDocument();
    expect(screen.getByText('Milestones 2–10 hidden · no matches')).toBeInTheDocument();
    expect(screen.queryByText('Milestone 5')).not.toBeInTheDocument();
  });

  it('names the single hidden milestone rather than giving its position', () => {
    renderResults({
      sections: [{
        kind: 'no-match-summary',
        hiddenMilestones: [{ id: 'sabrina-gym', index: 6, name: 'Sabrina' }],
        expanded: false,
      }],
      totalPokemon: 4,
      totalRoutes: 3,
    });

    expect(screen.getByRole('button', { name: 'Sabrina hidden · no matches' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Milestones 7–7 hidden · no matches' })).toBeNull();
  });

  it('counts a gapped hidden set rather than claiming a range across the groups on screen', () => {
    renderResults({
      sections: [
        group({ milestoneId: 'brock-gym', milestoneIndex: 1, name: 'Brock' }),
        {
          kind: 'no-match-summary',
          hiddenMilestones: [
            { id: 'starter', index: 0, name: 'Starter' },
            { id: 'misty-gym', index: 2, name: 'Misty' },
          ],
          expanded: false,
        },
      ],
      totalPokemon: 1,
      totalRoutes: 1,
    });

    const summary = screen.getByRole('button', { name: /hidden · no matches$/ });
    expect(summary.textContent).toBe('2 milestones hidden · no matches');
    // Milestone 2 is the group rendered right above the row; a range would claim it is hidden.
    expect(screen.getByRole('heading', { name: 'Brock · 1 match' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Milestones 1–3 hidden · no matches' })).toBeNull();
  });

  it('keeps the range when the hidden milestones run without a gap', () => {
    renderResults({
      sections: [{
        kind: 'no-match-summary',
        hiddenMilestones: [
          { id: 'starter', index: 0, name: 'Starter' },
          { id: 'brock-gym', index: 1, name: 'Brock' },
          { id: 'misty-gym', index: 2, name: 'Misty' },
        ],
        expanded: false,
      }],
      totalPokemon: 0,
      totalRoutes: 0,
    });

    const summary = screen.getByRole('button', { name: /hidden · no matches$/ });
    expect(summary.textContent).toBe('Milestones 1–3 hidden · no matches');
    expect(screen.queryByRole('button', { name: '3 milestones hidden · no matches' })).toBeNull();
  });

  it('teases several future matches as a plural count', () => {
    renderResults({
      sections: [{ kind: 'future-teaser', matchCount: 3, milestoneIds: ['a', 'b'], expanded: false }],
      totalPokemon: 3,
      totalRoutes: 1,
    });

    expect(screen.getByRole('button', { name: '3 matches after Milestone 10' })).toBeInTheDocument();
  });

  it('folds each section through its own identity', () => {
    const brock = group({ milestoneId: 'brock-gym', name: 'Brock', expanded: true });
    const misty = group({
      milestoneId: 'misty-gym',
      milestoneIndex: 1,
      name: 'Misty',
      expanded: false,
      routes: [route({ nodeId: 'cerulean-city', name: 'Cerulean City', milestoneId: 'misty-gym' })],
    });
    const handlers = renderResults({
      sections: [
        { kind: 'future-teaser', matchCount: 1, milestoneIds: ['x'], expanded: false },
        misty,
        brock,
        {
          kind: 'no-match-summary',
          hiddenMilestones: [{ id: 'starter', index: 0, name: 'Starter' }],
          expanded: false,
        },
      ],
      totalPokemon: 2,
      totalRoutes: 2,
    });

    // The collapsed group hides its routes; the expanded one shows them.
    expect(screen.getByRole('button', { name: 'Misty · 1 match' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Brock · 1 match' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: 'Cerulean City' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Route 22' })).toBeVisible();

    // Act on the collapsed second group: neither the first section nor an already-open one.
    fireEvent.click(screen.getByRole('button', { name: 'Misty · 1 match' }));
    expect(handlers.onToggleSection).toHaveBeenLastCalledWith('misty-gym');

    fireEvent.click(screen.getByRole('button', { name: '1 match after Milestone 10' }));
    expect(handlers.onToggleSection).toHaveBeenLastCalledWith('future-teaser');

    fireEvent.click(screen.getByRole('button', { name: 'Starter hidden · no matches' }));
    expect(handlers.onToggleSection).toHaveBeenLastCalledWith('no-match-summary');
    expect(handlers.onToggleSection).toHaveBeenCalledTimes(3);
  });

  it('gives a matching group no fold control while the search owns the fold', () => {
    const handlers = renderResults({
      sections: [
        { kind: 'future-teaser', matchCount: 2, milestoneIds: ['x'], expanded: false },
        group(),
        {
          kind: 'no-match-summary',
          hiddenMilestones: [{ id: 'starter', index: 0, name: 'Starter' }],
          expanded: false,
        },
      ],
      totalPokemon: 3,
      totalRoutes: 2,
    }, { searchActive: true });

    // The title still names the group, but as a heading: a fold the user cannot change is not
    // offered as a control that would report a state and then do nothing.
    const heading = screen.getByRole('heading', { name: 'Milestone 1 · 1 match' });
    expect(heading.textContent).toBe('Milestone 1 · 1 match');
    expect(within(heading).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Milestone 1 · 1 match' })).toBeNull();

    // What the search expanded is still on show, and its milestone markers still work.
    expect(screen.getByRole('button', { name: 'Route 22' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Preview milestone: Milestone 1' })).toBeVisible();

    // The two furniture rows keep their own folds throughout.
    fireEvent.click(screen.getByRole('button', { name: '2 matches after Milestone 10' }));
    fireEvent.click(screen.getByRole('button', { name: 'Starter hidden · no matches' }));
    expect(handlers.onToggleSection).toHaveBeenNthCalledWith(1, 'future-teaser');
    expect(handlers.onToggleSection).toHaveBeenNthCalledWith(2, 'no-match-summary');
  });

  it('offers the fold as a real control while browsing', () => {
    const handlers = renderResults({
      sections: [group()],
      totalPokemon: 1,
      totalRoutes: 1,
    }, { searchActive: false });

    const toggle = screen.getByRole('button', { name: 'Milestone 1 · 1 match' });
    expect(toggle.textContent).toBe('Milestone 1 · 1 match');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Milestone 1 · 1 match' })).toBeVisible();

    fireEvent.click(toggle);
    expect(handlers.onToggleSection).toHaveBeenCalledWith('milestone-1');
  });

  it('offers the hidden milestones as an escape hatch once the summary is open', () => {
    const hidden = {
      kind: 'no-match-summary' as const,
      hiddenMilestones: [
        { id: 'starter', index: 0, name: 'Starter' },
        { id: 'misty-gym', index: 2, name: 'Misty' },
      ],
      expanded: true,
    };
    const handlers = renderResults({ sections: [hidden], totalPokemon: 0, totalRoutes: 0 });

    expect(screen.getByRole('button', { name: '2 milestones hidden · no matches' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Starter')).toBeVisible();
    expect(screen.getByText('Misty')).toBeVisible();

    // Retarget to the second hidden milestone: not the first row, and not the current target.
    fireEvent.click(screen.getByRole('button', { name: 'Preview milestone: Misty' }));
    expect(handlers.onSetPreviewMilestone).toHaveBeenCalledWith('misty-gym');
    expect(handlers.onSetPreviewMilestone).not.toHaveBeenCalledWith('starter');
  });

  it('moves the plan and the progress marker from a group head', () => {
    const handlers = renderResults({
      sections: [
        group({ milestoneId: 'misty-gym', name: 'Misty', milestoneIndex: 2 }),
        group({ milestoneId: 'brock-gym', name: 'Brock', milestoneIndex: 1 }),
      ],
      totalPokemon: 1,
      totalRoutes: 1,
    }, { currentMilestoneId: 'brock-gym', previewMilestoneId: 'misty-gym' });

    // Each marker follows its own durable value: the run has reached Brock and plans to Misty.
    expect(screen.getByRole('button', { name: 'Set current milestone: Brock' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Set current milestone: Misty' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Preview milestone: Misty' })).toHaveAttribute('aria-pressed', 'true');
    const preview = screen.getByRole('button', { name: 'Preview milestone: Brock' });
    expect(preview).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(preview);
    expect(handlers.onSetPreviewMilestone).toHaveBeenCalledWith('brock-gym');
    expect(handlers.onSetCurrentMilestone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Set current milestone: Misty' }));
    expect(handlers.onSetCurrentMilestone).toHaveBeenCalledWith('misty-gym');
  });

  it('selects a route and a species independently', () => {
    const twoRoutes = group({
      routes: [
        route(),
        route({
          nodeId: 'viridian-forest',
          name: 'Viridian Forest',
          matches: [match({ pokemonId: 10, slug: 'caterpie', name: 'Caterpie' })],
        }),
      ],
      matchCount: 2,
    });
    const handlers = renderResults({ sections: [twoRoutes], totalPokemon: 2, totalRoutes: 2 }, {
      selectedNodeId: 'kanto-route-22',
      selectedPokemonId: 56,
    });

    // The second route and its species: neither the first row nor the selected one.
    const forest = screen.getByRole('button', { name: 'Viridian Forest' });
    expect(forest).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Route 22' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(forest);
    expect(handlers.onSelectRoute).toHaveBeenCalledWith('viridian-forest');
    expect(handlers.onSelectPokemon).not.toHaveBeenCalled();

    const caterpie = screen.getByRole('button', { name: 'Select Caterpie at Viridian Forest' });
    expect(caterpie).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Select Mankey at Route 22' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(caterpie);
    expect(handlers.onSelectPokemon).toHaveBeenCalledWith(10);
    expect(handlers.onSelectRoute).toHaveBeenCalledTimes(1);
  });

  it('states route access, level band and gates as text, not colour alone', () => {
    renderResults({
      sections: [group({
        routes: [
          route({ access: 'locked', gates: [{ kind: 'capability', id: 'surf' }, { kind: 'story', id: 'champion' }] }),
          route({
            nodeId: 'vermilion-city',
            name: 'Vermilion City',
            access: 'optional',
            levelRange: null,
            matches: [match({ pokemonId: 83, name: "Farfetch'd", methods: ['trade'], minLevel: null, maxLevel: null })],
          }),
        ],
        matchCount: 2,
      })],
      totalPokemon: 2,
      totalRoutes: 2,
    });

    const locked = screen.getByRole('button', { name: 'Route 22' }).closest('li') as HTMLElement;
    expect(locked).toHaveAttribute('data-access', 'locked');
    expect(within(locked).getByText('Locked')).toBeVisible();
    expect(within(locked).getByText('1 match · Lv 3–5')).toBeVisible();
    expect(within(locked).getByText('Needs Surf · Champion')).toBeVisible();

    const optional = screen.getByRole('button', { name: 'Vermilion City' }).closest('li') as HTMLElement;
    expect(optional).toHaveAttribute('data-access', 'optional');
    expect(within(optional).getByText('Optional')).toBeVisible();
    // Nothing on this route states a level, so no level band is invented for it.
    expect(within(optional).getByText('1 match')).toBeVisible();
    expect(within(optional).queryByText(/Lv/)).toBeNull();
    expect(within(optional).queryByText(/Needs/)).toBeNull();
  });

  it('states a one-level band as one level, and a real band as a range', () => {
    renderResults({
      sections: [group({
        routes: [
          route({ levelRange: { min: 5, max: 5 } }),
          route({ nodeId: 'viridian-forest', name: 'Viridian Forest', levelRange: { min: 3, max: 5 } }),
        ],
        matchCount: 1,
      })],
      totalPokemon: 1,
      totalRoutes: 2,
    });

    const flat = screen.getByRole('button', { name: 'Route 22' }).closest('li') as HTMLElement;
    expect(within(flat).getByText('1 match · Lv 5').textContent).toBe('1 match · Lv 5');
    expect(within(flat).queryByText('1 match · Lv 5–5')).toBeNull();

    const band = screen.getByRole('button', { name: 'Viridian Forest' }).closest('li') as HTMLElement;
    expect(within(band).getByText('1 match · Lv 3–5').textContent).toBe('1 match · Lv 3–5');
  });

  it('marks an exact name match in text as well as in styling', () => {
    renderResults({
      sections: [group({
        routes: [route({
          matches: [
            match({ exactMatch: true }),
            match({ pokemonId: 57, slug: 'primeape', name: 'Primeape' }),
          ],
          matchCount: 2,
        })],
      })],
      totalPokemon: 2,
      totalRoutes: 1,
    });

    const exact = screen.getByRole('button', { name: 'Select Mankey at Route 22' }).closest('li') as HTMLElement;
    expect(exact).toHaveAttribute('data-exact', 'true');
    expect(within(exact).getByText('Exact match')).toBeVisible();

    const partial = screen.getByRole('button', { name: 'Select Primeape at Route 22' }).closest('li') as HTMLElement;
    expect(partial).not.toHaveAttribute('data-exact');
    expect(within(partial).queryByText('Exact match')).toBeNull();
  });

  it('states an encounter that is not ordinarily obtainable as text, not colour alone', () => {
    renderResults({
      sections: [group({
        routes: [route({
          matches: [
            match({
              pokemonId: 23,
              slug: 'ekans',
              name: 'Ekans',
              obtainability: { status: 'version-exclusive', flagged: true },
            }),
            match({
              pokemonId: 152,
              slug: 'chikorita',
              name: 'Chikorita',
              obtainability: { status: 'transfer-only', flagged: true },
            }),
            match({ pokemonId: 56 }),
          ],
          matchCount: 3,
        })],
      })],
      totalPokemon: 3,
      totalRoutes: 1,
    });

    const exclusive = within(matchRow('Ekans')).getByText('Version exclusive');
    expect(exclusive.textContent).toBe('Version exclusive');
    expect(exclusive).toHaveAttribute('data-status', 'version-exclusive');

    const transfer = within(matchRow('Chikorita')).getByText('Transfer only');
    expect(transfer.textContent).toBe('Transfer only');
    expect(transfer).toHaveAttribute('data-status', 'transfer-only');

    // A standard encounter is the ordinary case and states nothing about obtainability.
    expect(matchRow('Mankey').querySelector('[data-status]')).toBeNull();
  });

  it('reports learn-method evidence while a move filter is active', () => {
    renderResults({
      sections: [group({
        routes: [route({
          matches: [
            match({
              pokemonId: 54,
              slug: 'psyduck',
              name: 'Psyduck',
              moveMatch: { moveSlug: 'surf', methods: ['machine'], versionValid: true },
            }),
            match({
              pokemonId: 131,
              slug: 'lapras',
              name: 'Lapras',
              moveMatch: { moveSlug: 'surf', methods: ['level-up', 'machine'], versionValid: false },
            }),
            match({ pokemonId: 56 }),
          ],
          matchCount: 3,
        })],
      })],
      totalPokemon: 3,
      totalRoutes: 1,
    });

    const psyduck = matchRow('Psyduck');
    expect(within(psyduck).getByText('Machine').textContent).toBe('Machine');
    expect(within(psyduck).getByText('Version legal').textContent).toBe('Version legal');

    const lapras = matchRow('Lapras');
    expect(within(lapras).getByText('Level Up, Machine').textContent).toBe('Level Up, Machine');
    expect(within(lapras).getByText('Transfer only').textContent).toBe('Transfer only');

    // Nothing asked this row about a move, so it reports no move evidence.
    expect(matchRow('Mankey').querySelector('[data-legal]')).toBeNull();
  });

  it('names a fold panel only while that panel is on the page', () => {
    renderResults({
      sections: [
        group({ milestoneId: 'brock-gym', milestoneIndex: 1, name: 'Brock', expanded: false }),
        group({ milestoneId: 'misty-gym', milestoneIndex: 2, name: 'Misty', expanded: true }),
        {
          kind: 'no-match-summary',
          hiddenMilestones: [
            { id: 'starter', index: 0, name: 'Starter' },
            { id: 'surge-gym', index: 3, name: 'Lt. Surge' },
          ],
          expanded: false,
        },
      ],
      totalPokemon: 1,
      totalRoutes: 1,
    });

    // Collapsed: the panel does not exist, so nothing points at it.
    expect(screen.getByRole('button', { name: 'Brock · 1 match' })).not.toHaveAttribute('aria-controls');
    expect(screen.getByRole('button', { name: '2 milestones hidden · no matches' })).not.toHaveAttribute('aria-controls');

    // Expanded: the reference resolves to the list it opens.
    const openGroup = screen.getByRole('button', { name: 'Misty · 1 match' }).getAttribute('aria-controls');
    expect(openGroup).not.toBeNull();
    expect(document.getElementById(openGroup!)).not.toBeNull();
  });

  it('names the summary panel once the summary is open', () => {
    renderResults({
      sections: [{
        kind: 'no-match-summary',
        hiddenMilestones: [
          { id: 'starter', index: 0, name: 'Starter' },
          { id: 'misty-gym', index: 2, name: 'Misty' },
        ],
        expanded: true,
      }],
      totalPokemon: 0,
      totalRoutes: 0,
    });

    const panel = screen.getByRole('button', { name: '2 milestones hidden · no matches' }).getAttribute('aria-controls');
    expect(panel).not.toBeNull();
    expect(document.getElementById(panel!)).not.toBeNull();
  });

  it('reads each match its capability state from the one shared verdict', () => {
    renderResults({
      sections: [group({
        routes: [route({
          matches: [
            match({ pokemonId: 54, slug: 'psyduck', name: 'Psyduck' }),
            match({ pokemonId: 129, slug: 'magikarp', name: 'Magikarp' }),
            match({ pokemonId: 56 }),
          ],
          matchCount: 3,
        })],
      })],
      totalPokemon: 3,
      totalRoutes: 1,
    }, { capabilityStates: new Map([[54, 'can-now'], [129, 'conditional']]) });

    const psyduck = screen.getByRole('button', { name: 'Select Psyduck at Route 22' }).closest('li') as HTMLElement;
    expect(within(psyduck).getByText('Can learn now')).toBeVisible();

    const magikarp = screen.getByRole('button', { name: 'Select Magikarp at Route 22' }).closest('li') as HTMLElement;
    expect(within(magikarp).getByText('Can learn with condition')).toBeVisible();

    // A species with no verdict states nothing rather than guessing at one.
    const mankey = screen.getByRole('button', { name: 'Select Mankey at Route 22' }).closest('li') as HTMLElement;
    expect(within(mankey).queryByText(/Can learn/)).toBeNull();
    expect(within(mankey).queryByText('Knows')).toBeNull();
  });
});
