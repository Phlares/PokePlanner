import { beforeAll, describe, expect, it } from 'vitest';
import type { FireRedPack } from '../../data/game-pack';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';
import type { WorkbenchSearchQuery } from '../../domain/workbench/search';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import { createWorkbenchState, type WorkbenchState } from './controller';
import {
  milestoneNodeId,
  selectMilestoneResults,
  type GroupedWorkbenchResults,
  type MatchingMilestoneSection,
  type MilestoneResultsInput,
  type RouteResult,
} from './selectors';

let pack: FireRedPack;
beforeAll(() => {
  pack = loadFireRedPackFixture();
});

interface Scenario {
  query?: WorkbenchSearchQuery;
  milestoneFilter?: boolean;
  openMilestoneIds?: string[];
  current?: string | null;
  target?: string | null;
}

function input(scenario: Scenario): MilestoneResultsInput {
  const current = scenario.current ?? null;
  const target = scenario.target ?? null;
  const state: WorkbenchState = {
    ...createWorkbenchState({ currentProgressId: current, planningTargetId: target }),
    query: scenario.query ?? {},
    milestoneFilter: scenario.milestoneFilter ?? true,
    openMilestoneIds: new Set(scenario.openMilestoneIds ?? []),
  };
  return {
    pack,
    rules: FIRE_RED_RULES,
    state,
    currentMilestoneId: current,
    targetMilestoneId: target,
  };
}

const groups = (result: GroupedWorkbenchResults): MatchingMilestoneSection[] =>
  result.sections.filter((section): section is MatchingMilestoneSection => section.kind === 'matching-milestone');

const groupFor = (result: GroupedWorkbenchResults, milestoneId: string): MatchingMilestoneSection => {
  const group = groups(result).find((section) => section.milestoneId === milestoneId);
  expect(group, `no matching group for ${milestoneId}`).toBeDefined();
  return group!;
};

const allRoutes = (result: GroupedWorkbenchResults): RouteResult[] =>
  groups(result).flatMap((section) => [...section.routes]);

const chronological = (milestoneIds: readonly string[]): string[] => {
  const order = new Map(FIRE_RED_RULES.milestones.map((milestone, index) => [milestone.id, index]));
  return [...milestoneIds].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
};

describe('milestoneNodeId', () => {
  it('maps a milestone onto the progression node that carries it', () => {
    const progressionIds = new Set(pack.progression.nodes.map((node) => node.id));
    // The starter milestone is configured before the pack's first node, so it borrows it.
    expect(milestoneNodeId('starter', FIRE_RED_RULES.milestones, progressionIds)).toBe('pallet-town');
    expect(milestoneNodeId('brock-gym', FIRE_RED_RULES.milestones, progressionIds)).toBe('pewter-city');
  });
});

describe('selectMilestoneResults — section order', () => {
  it('orders future teaser, matching groups, then one no-match summary', () => {
    const result = selectMilestoneResults(input({ query: { type: 'normal' }, target: 'brock-gym' }));
    expect(result.sections.map((section) => section.kind)).toEqual([
      'future-teaser', 'matching-milestone', 'no-match-summary',
    ]);
    expect(result.sections[1]).toMatchObject({ milestoneIndex: 1, expanded: true });
  });

  it('orders matching milestone groups newest first', () => {
    const result = selectMilestoneResults(input({ query: { type: 'normal' }, target: 'misty-gym' }));
    expect(groups(result).map((section) => section.milestoneId)).toEqual(['misty-gym', 'brock-gym']);
    expect(groups(result).map((section) => section.milestoneIndex)).toEqual([2, 1]);
  });

  it('folds every eligible milestone without matches into one summary row', () => {
    const result = selectMilestoneResults(input({ query: { type: 'normal' }, target: 'misty-gym' }));
    expect(result.sections.filter((section) => section.kind === 'no-match-summary')).toHaveLength(1);
    expect(result.sections.at(-1)).toEqual({
      kind: 'no-match-summary',
      hiddenMilestones: [{ id: 'starter', index: 0 }],
      expanded: false,
    });

    // Caterpie is in the Brock band only, so Misty is hidden too — a hidden milestone whose
    // chronological index is neither zero nor its position in the hidden list.
    const sparse = selectMilestoneResults(input({ query: { name: 'Caterpie' }, target: 'misty-gym' }));
    expect(sparse.sections.at(-1)).toEqual({
      kind: 'no-match-summary',
      hiddenMilestones: [{ id: 'starter', index: 0 }, { id: 'misty-gym', index: 2 }],
      expanded: false,
    });
  });

  it('never reports a structurally empty milestone band as unmatched', () => {
    // Giovanni's gym is anchored at Viridian City (order 2) but fought after Blaine (order 40), so
    // its band spans [41, 40] and can hold no node at all. An empty band is not a milestone that
    // "has no matches" — it must not be eligible, and must never reach the summary row.
    const result = selectMilestoneResults(input({ query: { type: 'normal' }, milestoneFilter: false }));
    const summary = result.sections.find((section) => section.kind === 'no-match-summary');
    expect(summary).toBeDefined();
    if (summary?.kind !== 'no-match-summary') return;
    expect(summary.hiddenMilestones).toContainEqual({ id: 'starter', index: 0 });
    expect(summary.hiddenMilestones.map((milestone) => milestone.id)).not.toContain('giovanni-gym');
    expect(groups(result).map((section) => section.milestoneId)).not.toContain('giovanni-gym');
  });

  it('teases the matches beyond the milestone scope in chronological order', () => {
    const result = selectMilestoneResults(input({ query: { type: 'normal' }, target: 'misty-gym' }));
    const teaser = result.sections[0];
    expect(teaser.kind).toBe('future-teaser');
    if (teaser.kind !== 'future-teaser') return;
    expect(teaser.milestoneIds.length).toBeGreaterThan(1);
    // Species, not milestones: far more Normal-types wait ahead than there are milestones left.
    expect(teaser.matchCount).toBeGreaterThan(teaser.milestoneIds.length);
    expect(teaser.milestoneIds).toEqual(chronological(teaser.milestoneIds));
    expect(teaser.milestoneIds[0]).toBe('surge-gym');
    expect(teaser.milestoneIds).not.toContain('brock-gym');
    expect(teaser.expanded).toBe(false);
  });

  it('drops the teaser and reveals future groups when the milestone filter is off', () => {
    const result = selectMilestoneResults(input({
      query: { type: 'normal' }, target: 'brock-gym', milestoneFilter: false,
    }));
    expect(result.sections.some((section) => section.kind === 'future-teaser')).toBe(false);
    const indexes = groups(result).map((section) => section.milestoneIndex);
    expect(indexes.length).toBeGreaterThan(1);
    expect(Math.max(...indexes)).toBeGreaterThan(1);
  });

  it('never teases future matches while browsing', () => {
    // With no query every species "matches", so a teaser would announce most of the dex as waiting
    // ahead. The teaser is search-result furniture: spec §10 binds it to an active search, and
    // §9's browse enumeration has no such row.
    const result = selectMilestoneResults(input({ target: 'brock-gym' }));
    expect(result.sections.some((section) => section.kind === 'future-teaser')).toBe(false);
    expect(result.sections.map((section) => section.kind)).toEqual(['matching-milestone', 'matching-milestone']);
  });

  it('shows every eligible milestone as its own group while browsing', () => {
    // Browsing the whole game: one group per milestone that owns any golden-path order, newest
    // first, with neither a teaser nor a summary. Giovanni's empty band is absent, not "unmatched".
    const result = selectMilestoneResults(input({ milestoneFilter: false }));
    expect(result.sections.every((section) => section.kind === 'matching-milestone')).toBe(true);
    expect(groups(result).map((section) => section.milestoneIndex)).toEqual([9, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('omits the summary when every eligible milestone matches', () => {
    const result = selectMilestoneResults(input({ target: 'brock-gym' }));
    expect(result.sections.some((section) => section.kind === 'no-match-summary')).toBe(false);
    expect(groups(result).map((section) => section.milestoneId)).toEqual(['brock-gym', 'starter']);
  });

  it('scopes to the target milestone node itself, not to its band', () => {
    // Giovanni's gym sits in Viridian City (walked third, fought last), so the pack anchors the
    // milestone at golden-path order 2. The scope follows that node exactly, which is the same
    // horizon the controller validates route selections against.
    const result = selectMilestoneResults(input({ target: 'giovanni-gym' }));
    expect(groups(result).map((section) => section.milestoneId)).toEqual(['brock-gym', 'starter']);
    expect(groupFor(result, 'brock-gym').routes.map((route) => route.nodeId))
      .toEqual(['viridian-city', 'kanto-route-1']);
  });

  it('expands only the folds the controller holds open when no search is active', () => {
    const result = selectMilestoneResults(input({ target: 'brock-gym', openMilestoneIds: ['brock-gym'] }));
    expect(groups(result).map((section) => [section.milestoneId, section.expanded])).toEqual([
      ['brock-gym', true], ['starter', false],
    ]);
  });
});

describe('selectMilestoneResults — route rows', () => {
  it('sorts routes closest to the milestone first', () => {
    const result = selectMilestoneResults(input({ query: { type: 'normal' }, target: 'brock-gym' }));
    const routes = groupFor(result, 'brock-gym').routes;
    expect(routes.map((route) => route.nodeId)).toEqual(['kanto-route-2', 'kanto-route-22', 'kanto-route-1']);
    // Each of those three hosts two Normal-type species, so a per-row count is a real count.
    expect(routes.map((route) => route.matchCount)).toEqual([2, 2, 2]);
    expect(routes.map((route) => route.matches.length)).toEqual([2, 2, 2]);
  });

  it('carries match count, level range, method and exact-match state', () => {
    const result = selectMilestoneResults(input({ query: { name: 'Caterpie' }, target: 'brock-gym' }));
    const routes = groupFor(result, 'brock-gym').routes;
    expect(routes.map((route) => route.nodeId)).toEqual(['viridian-forest', 'kanto-route-2']);
    expect(routes[0]).toMatchObject({
      nodeId: 'viridian-forest',
      name: 'Viridian Forest',
      milestoneId: 'brock-gym',
      milestoneIndex: 1,
      matchCount: 1,
      levelRange: { min: 3, max: 5 },
    });
    expect(routes[0].matches).toEqual([{
      pokemonId: 10,
      slug: 'caterpie',
      name: 'Caterpie',
      types: ['bug'],
      methods: ['walk'],
      minLevel: 3,
      maxLevel: 5,
      exactMatch: true,
      obtainability: { status: 'standard', flagged: false },
      moveMatch: undefined,
    }]);
    expect(groupFor(result, 'brock-gym').matchCount).toBe(1);
  });

  it('leaves the level range null when nothing on the route states a level', () => {
    const result = selectMilestoneResults(input({ query: { name: 'farfetchd' }, target: 'surge-gym' }));
    const route = groupFor(result, 'surge-gym').routes[0];
    expect(route).toMatchObject({ nodeId: 'vermilion-city', levelRange: null, matchCount: 1 });
    expect(route.matches[0]).toMatchObject({ methods: ['trade'], minLevel: null, maxLevel: null });
  });

  it('classifies every route access state against the current and target milestones', () => {
    const result = selectMilestoneResults(input({
      query: { type: 'normal' }, target: 'misty-gym', current: 'brock-gym', milestoneFilter: false,
    }));
    const access = new Map(allRoutes(result).map((route) => [route.nodeId, route.access]));
    expect(access.get('kanto-route-1')).toBe('current');
    expect(access.get('kanto-route-22')).toBe('optional');
    expect(access.get('kanto-route-4')).toBe('future');
    expect(access.get('kanto-route-5')).toBe('locked');
    expect(access.get('cerulean-cave')).toBe('postgame');
  });

  it('gates a route on a capability only when the capability is the sole way in', () => {
    // Tentacool is at Cerulean City on the surf slots and nowhere else there: no Surf, no Tentacool.
    const surfOnly = selectMilestoneResults(input({ query: { name: 'Tentacool' }, target: 'misty-gym' }));
    const cerulean = groupFor(surfOnly, 'misty-gym').routes.find((route) => route.nodeId === 'cerulean-city');
    expect(cerulean?.matches.map((match) => match.methods)).toEqual([['surf']]);
    expect(cerulean?.gates).toEqual([{ kind: 'capability', id: 'surf' }]);
  });

  it('does not gate a route on a capability that only shortcuts a reachable match', () => {
    // Every Water-type at Viridian City is also on a rod slot, Psyduck on both. A player holding a
    // Super Rod and no Surf is not blocked here, so Surf is not a gate.
    const water = selectMilestoneResults(input({ query: { type: 'water' }, target: 'brock-gym' }));
    const viridian = groupFor(water, 'brock-gym').routes.find((route) => route.nodeId === 'viridian-city');
    expect(viridian?.matches.some((match) => match.methods.includes('surf'))).toBe(true);
    expect(viridian?.gates).toEqual([]);
  });

  it('surfaces the story gates the pack puts on the node itself', () => {
    const all = selectMilestoneResults(input({ query: { type: 'normal' }, milestoneFilter: false }));
    const cave = allRoutes(all).find((route) => route.nodeId === 'cerulean-cave');
    expect(cave?.matches.length).toBeGreaterThan(0);
    expect(cave?.gates).toEqual([
      { kind: 'story', id: 'champion' },
      { kind: 'story', id: 'network-machine-restored' },
    ]);
  });
});

describe('selectMilestoneResults — totals', () => {
  it('counts every match rather than a truncated page of them', () => {
    const result = selectMilestoneResults(input({ target: 'champion', milestoneFilter: false }));
    expect(result.totalPokemon).toBeGreaterThan(50);
    expect(result.totalRoutes).toBeGreaterThan(50);
    const shownPokemon = new Set(allRoutes(result).flatMap((route) => route.matches.map((match) => match.pokemonId)));
    const shownRoutes = new Set(allRoutes(result).map((route) => route.nodeId));
    expect(shownPokemon.size).toBe(result.totalPokemon);
    expect(shownRoutes.size).toBe(result.totalRoutes);
  });

  it('keeps totals whole while the milestone filter hides most of them', () => {
    const scoped = selectMilestoneResults(input({ query: { type: 'normal' }, target: 'brock-gym' }));
    const shown = new Set(allRoutes(scoped).flatMap((route) => route.matches.map((match) => match.pokemonId)));
    expect(shown.size).toBeGreaterThan(0);
    expect(scoped.totalPokemon).toBeGreaterThan(shown.size);
  });
});
