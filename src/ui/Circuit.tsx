/** The rules as circuits: each criterion a node that lights when it is met, feeding its score. */
import type { Criterion, Group, Result } from '../rules/engine';

const GROUPS: Array<[Group, string, string]> = [
  ['news2', 'NEWS2', 'Royal College of Physicians, 2017'],
  ['curb65', 'CURB-65', 'British Thoracic Society'],
  ['redflag', 'Sepsis red flags', 'UK Sepsis Trust'],
  ['kidney', 'Kidney function', 'CKD-EPI 2021'],
];

interface Props {
  result: Result;
  register: (id: string) => (el: HTMLElement | null) => void;
  hot: Set<string>;
  onHover: (id: string | null) => void;
  flipped: Set<string>; // criteria that changed state against the recorded values
}

function Node({ c, register, hot, onHover, flipped }: { c: Criterion } & Omit<Props, 'result'>) {
  return (
    <li
      ref={register(c.id)}
      className={`node ${c.fired ? `on ${c.tone}` : 'off'}${hot.has(c.id) ? ' hot' : ''}${flipped.has(c.id) ? ' flipped' : ''}`}
      onMouseEnter={() => onHover(c.id)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="led" aria-hidden />
      <span className="label">{c.label}</span>
      <span className="value">{c.value}</span>
      {c.points !== undefined ? (
        <span className={`pts p${c.points}`} aria-label={`${c.points} points`}>{c.points}</span>
      ) : (
        <span className="margin">{c.fired ? 'Met' : c.margin ?? 'Not met'}</span>
      )}
    </li>
  );
}

export function Circuit({ result, register, hot, onHover, flipped }: Props) {
  return (
    <section className="circuit" aria-label="Rules">
      {GROUPS.map(([g, title, source]) => {
        const s = result.scores.find((x) => x.id === g)!;
        const items = result.criteria.filter((c) => c.group === g);
        return (
          <div key={g} className="rule">
            <div className="rule-crit">
              <h3>
                {title} <small>{source}</small>
              </h3>
              <ul>
                {items.map((c) => <Node key={c.id} c={c} register={register} hot={hot} onHover={onHover} flipped={flipped} />)}
              </ul>
            </div>
            <div
              className={`score ${s.tone}${hot.has(`score:${g}`) ? ' hot' : ''}${flipped.has(s.id) ? ' flipped' : ''}`}
              ref={register(`score:${g}`)}
              onMouseEnter={() => onHover(`score:${g}`)}
              onMouseLeave={() => onHover(null)}
            >
              <span className="s-label">{s.label}</span>
              <span className="s-value">{s.value}</span>
              <span className="s-band">{s.band}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
