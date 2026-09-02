import type { MemberComparisonView } from '../../domain/workbench/comparison';
import type { StatKey } from '../../domain/rules/game-rules';

const STAT_ROWS: { key: StatKey; label: string; moveClass?: 'physical' | 'special' }[] = [
  { key: 'hp', label: 'HP' },
  { key: 'attack', label: 'Attack', moveClass: 'physical' },
  { key: 'defense', label: 'Defense' },
  { key: 'specialAttack', label: 'Sp. Atk', moveClass: 'special' },
  { key: 'specialDefense', label: 'Sp. Def' },
  { key: 'speed', label: 'Speed' },
];

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

export interface MemberComparisonProps {
  view: MemberComparisonView;
  memberName: string;
  candidateName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MemberComparison({ view, memberName, candidateName, onConfirm, onCancel }: MemberComparisonProps) {
  return (
    <section className="member-comparison" role="section" aria-label={`Compare ${memberName} with ${candidateName}`}>
      <h2>
        Compare {memberName} with {candidateName}
      </h2>
      <table className="mc-stats" aria-label="Stat comparison">
        <thead>
          <tr>
            <th scope="col">Stat</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col">Delta</th>
            <th scope="col">Candidate moves</th>
          </tr>
        </thead>
        <tbody>
          {STAT_ROWS.map(({ key, label, moveClass }) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td>{view.stats[key].before}</td>
              <td>{view.stats[key].after}</td>
              <td>{formatDelta(view.stats[key].delta)}</td>
              <td>{moveClass !== undefined ? `${view.moveClasses.after[moveClass]} ${moveClass}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mc-line">
        Types {view.types.before.join(', ')} → {view.types.after.join(', ')}
      </p>
      <p className="mc-line">
        Ability {view.abilities.before.join(', ')} → {view.abilities.after.join(', ')}
      </p>
      <p className="mc-line">
        Nature {view.nature.before ?? 'none'} → {view.nature.after ?? 'none'}
      </p>
      <div className="mc-moves">
        <h3>Moves leaving</h3>
        <ul aria-label="Moves leaving">
          {view.moves.leaving.map((id) => (
            <li key={id}>{view.moveNames[id] ?? id}</li>
          ))}
        </ul>
        <h3>Moves entering</h3>
        <ul aria-label="Moves entering">
          {view.moves.entering.map((id) => (
            <li key={id}>{view.moveNames[id] ?? id}</li>
          ))}
        </ul>
      </div>
      {view.capabilityLosses.filter((loss) => loss.severity === 'yellow').map((loss) => {
        const label = view.capabilityLabels[loss.capabilityId] ?? loss.capabilityId;
        const reserve = loss.reserveMemberIds.length > 0 ? loss.reserveMemberIds.join(', ') : 'none';
        return (
          <p key={loss.capabilityId} className="mc-warning" role="alert">
            {label}: {candidateName} would not supply it ({loss.candidateState}). Reserve help: {reserve}.
          </p>
        );
      })}
      {view.findings.length > 0 && (
        <div>
          <h3>Findings</h3>
          <ul>
            {view.findings.map((finding, index) => (
              <li key={index}>{finding.summary}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mc-actions">
        <button type="button" onClick={onConfirm}>
          Replace {memberName} with {candidateName}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
