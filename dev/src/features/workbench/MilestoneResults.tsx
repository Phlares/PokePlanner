import { useId } from 'react';
import type { CapabilityState } from '../../domain/timeline/capabilities';
import { titleCase } from '../text';
import { FUTURE_TEASER_SECTION_ID, NO_MATCH_SUMMARY_SECTION_ID } from './controller';
import {
  ACCESS_LABEL,
  CAPABILITY_LABEL,
  EXACT_MATCH_LABEL,
  OBTAIN_LABEL,
  gateLabel,
  levelLabel,
  matchLabel,
} from './labels';
import type {
  FutureTeaserSection,
  GroupedWorkbenchResults,
  HiddenMilestone,
  MatchingMilestoneSection,
  NoMatchSummarySection,
  RouteResult,
} from './selectors';

/**
 * What the folded row stands for. One hidden milestone is named — the row has the space and the name
 * is what the rest of the workbench calls it. Several are given as chronological positions, because
 * listing every name is the enumeration this row exists to replace. Positions read 1-based; the
 * indexes behind them are the ruleset's own 0-based order.
 *
 * A range is only honest while the hidden set is unbroken. Matching milestones are rendered as their
 * own groups between the hidden ones, so the usual set has gaps: there the row states how many are
 * hidden rather than a span that would claim the groups on screen.
 */
function hiddenRangeLabel(hidden: readonly HiddenMilestone[]): string {
  if (hidden.length === 1) return hidden[0].name;
  const positions = hidden.map((milestone) => milestone.index + 1);
  const first = Math.min(...positions);
  const last = Math.max(...positions);
  if (last - first + 1 !== hidden.length) return `${hidden.length} milestones`;
  return `Milestones ${first}–${last}`;
}

interface MilestoneMarkerProps {
  milestoneId: string;
  name: string;
  currentMilestoneId: string | null;
  previewMilestoneId: string | null;
  onSetCurrentMilestone: (milestoneId: string) => void;
  onSetPreviewMilestone: (milestoneId: string) => void;
}

/**
 * The two durable markers a milestone row carries: where the plan points, and how far the run has
 * actually walked. Both are stated on every milestone the surface shows — matched or hidden — so
 * opening the no-match summary is a real escape hatch and not just an explanation.
 */
function MilestoneMarkers({
  milestoneId,
  name,
  currentMilestoneId,
  previewMilestoneId,
  onSetCurrentMilestone,
  onSetPreviewMilestone,
}: MilestoneMarkerProps) {
  return (
    <div className="results-milestone-markers">
      <button
        type="button"
        className="results-milestone-current"
        aria-label={`Set current milestone: ${name}`}
        aria-pressed={currentMilestoneId === milestoneId}
        onClick={() => onSetCurrentMilestone(milestoneId)}
      >
        Set current
      </button>
      <button
        type="button"
        className="results-milestone-preview"
        aria-label={`Preview milestone: ${name}`}
        aria-pressed={previewMilestoneId === milestoneId}
        onClick={() => onSetPreviewMilestone(milestoneId)}
      >
        Preview
      </button>
    </div>
  );
}

export interface MilestoneResultsProps {
  results: GroupedWorkbenchResults;
  /** The planning target's name; the teaser states what the scope hides against it. */
  targetName: string;
  currentMilestoneId: string | null;
  previewMilestoneId: string | null;
  selectedNodeId: string | null;
  selectedPokemonId: number | null;
  /**
   * Whether a query is filtering the sections. An active search expands every matching group itself
   * (spec §10), so the fold is not the user's to give while one runs — see {@link MilestoneResults}.
   */
  searchActive?: boolean;
  /**
   * Species id → capability verdict while a capability search runs, empty otherwise. It arrives
   * resolved because party, reserve and candidates answer to one evaluator; a species missing from
   * it has no verdict, which is not the same as a negative one.
   */
  capabilityStates?: ReadonlyMap<number, CapabilityState>;
  onToggleSection: (sectionId: string) => void;
  onSelectRoute: (nodeId: string) => void;
  onSelectPokemon: (pokemonId: number) => void;
  onSetCurrentMilestone: (milestoneId: string) => void;
  onSetPreviewMilestone: (milestoneId: string) => void;
}

/**
 * The primary result surface: the future-match teaser, the matching milestone groups newest first,
 * and the one folded row standing for every eligible milestone that matched nothing (spec §10).
 *
 * It renders the grouping it is handed and derives nothing: the order, the folds, the counts and the
 * route classification all arrive resolved from `selectMilestoneResults`. Every fold it offers is a
 * real button carrying `aria-expanded` over the list it controls — and it offers a matching group's
 * fold only while browsing, because an active search expands those groups itself and a control that
 * cannot change anything must not be presented as one. Every state a row reports — access, gates,
 * exact match, capability verdict — is present as text, so nothing here needs hover or colour to be
 * read.
 */
export function MilestoneResults({
  results,
  targetName,
  currentMilestoneId,
  previewMilestoneId,
  selectedNodeId,
  selectedPokemonId,
  searchActive = false,
  capabilityStates,
  onToggleSection,
  onSelectRoute,
  onSelectPokemon,
  onSetCurrentMilestone,
  onSetPreviewMilestone,
}: MilestoneResultsProps) {
  const baseId = useId();
  const panelId = (sectionId: string): string => `${baseId}-${sectionId}`;
  const markers = { currentMilestoneId, previewMilestoneId, onSetCurrentMilestone, onSetPreviewMilestone };

  const renderMatch = (route: RouteResult, match: RouteResult['matches'][number]) => {
    const capability = capabilityStates?.get(match.pokemonId);
    const capabilityLabel = capability === undefined ? undefined : CAPABILITY_LABEL[capability];
    const obtainLabel = OBTAIN_LABEL[match.obtainability.status];
    return (
      <li key={match.pokemonId} className="results-match" data-exact={match.exactMatch ? 'true' : undefined}>
        <button
          type="button"
          className="results-match-select"
          aria-label={`Select ${match.name} at ${route.name}`}
          aria-pressed={selectedPokemonId === match.pokemonId}
          onClick={() => onSelectPokemon(match.pokemonId)}
        >
          <span className="results-match-name">{match.name}</span>
          <span className="results-match-methods">{match.methods.map(titleCase).join(', ')}</span>
        </button>
        {match.exactMatch && <span className="results-match-exact">{EXACT_MATCH_LABEL}</span>}
        {obtainLabel !== undefined && (
          <span className="results-match-obtain" data-status={match.obtainability.status}>{obtainLabel}</span>
        )}
        {match.moveMatch !== undefined && (
          <span className="results-match-move" data-legal={match.moveMatch.versionValid ? 'true' : 'false'}>
            <span className="results-match-learn">{match.moveMatch.methods.map(titleCase).join(', ')}</span>
            <span className="results-match-validity">
              {match.moveMatch.versionValid ? 'Version legal' : 'Transfer only'}
            </span>
          </span>
        )}
        {capabilityLabel !== undefined && (
          <span className="results-match-capability" data-state={capability}>{capabilityLabel}</span>
        )}
      </li>
    );
  };

  const renderRoute = (route: RouteResult) => (
    <li key={route.nodeId} className="results-route" data-access={route.access}>
      <div className="results-route-head">
        <button
          type="button"
          className="results-route-select"
          aria-label={route.name}
          aria-pressed={selectedNodeId === route.nodeId}
          onClick={() => onSelectRoute(route.nodeId)}
        >
          <span className="results-route-name">{route.name}</span>
          <span className="results-route-access">{ACCESS_LABEL[route.access]}</span>
        </button>
        <p className="results-route-meta">
          {matchLabel(route.matchCount)}
          {route.levelRange !== null && ` · ${levelLabel(route.levelRange.min, route.levelRange.max)}`}
        </p>
        {route.gates.length > 0 && (
          <p className="results-route-gates">Needs {route.gates.map(gateLabel).join(' · ')}</p>
        )}
      </div>
      <ul className="results-matches">
        {route.matches.map((match) => renderMatch(route, match))}
      </ul>
    </li>
  );

  const renderGroup = (section: MatchingMilestoneSection) => {
    const title = `${section.name} · ${matchLabel(section.matchCount)}`;
    return (
      <li key={section.milestoneId} className="results-group" data-expanded={section.expanded ? 'true' : undefined}>
        <div className="results-group-head">
          {/* While a search runs the group is expanded by the search itself, so there is no fold to
              offer: the title is a plain heading rather than a control that would report a state and
              then change nothing. Browsing, the same title is the fold it has always been. */}
          <h3 className="results-group-heading">
            {searchActive ? title : (
              <button
                type="button"
                className="results-group-toggle"
                aria-expanded={section.expanded}
                aria-controls={section.expanded ? panelId(section.milestoneId) : undefined}
                onClick={() => onToggleSection(section.milestoneId)}
              >
                {title}
              </button>
            )}
          </h3>
          <MilestoneMarkers milestoneId={section.milestoneId} name={section.name} {...markers} />
        </div>
        {section.expanded && (
          <ul className="results-routes" id={panelId(section.milestoneId)}>
            {section.routes.map(renderRoute)}
          </ul>
        )}
      </li>
    );
  };

  const renderSummary = (section: NoMatchSummarySection) => (
    <li key={section.kind} className="results-summary">
      <button
        type="button"
        className="results-summary-toggle"
        aria-expanded={section.expanded}
        aria-controls={section.expanded ? panelId(section.kind) : undefined}
        onClick={() => onToggleSection(section.kind)}
      >
        {hiddenRangeLabel(section.hiddenMilestones)} hidden · no matches
      </button>
      {section.expanded && (
        <ul className="results-hidden" id={panelId(section.kind)}>
          {section.hiddenMilestones.map((milestone) => (
            <li key={milestone.id} className="results-hidden-milestone">
              <span className="results-hidden-name">{milestone.name}</span>
              <MilestoneMarkers milestoneId={milestone.id} name={milestone.name} {...markers} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );

  const renderTeaser = (section: FutureTeaserSection) => (
    <li key={section.kind} className="results-teaser">
      <button
        type="button"
        className="results-teaser-toggle"
        aria-expanded={section.expanded}
        onClick={() => onToggleSection(section.kind)}
      >
        {matchLabel(section.matchCount)} after {targetName}
      </button>
    </li>
  );

  return (
    <nav className="results" aria-label="Milestone groups">
      <ol className="results-sections">
        {results.sections.map((section) => {
          // Each reserved row is recognised through the controller's own constant, so renaming one
          // is a type error here rather than a fold that silently stops working.
          if (section.kind === FUTURE_TEASER_SECTION_ID) return renderTeaser(section);
          if (section.kind === NO_MATCH_SUMMARY_SECTION_ID) return renderSummary(section);
          return renderGroup(section);
        })}
      </ol>
    </nav>
  );
}
