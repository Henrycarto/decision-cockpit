/** What the rules recommend, why, and the nearest change that would make it something else. */
import type { Decision, Result } from '../rules/engine';
import type { InputKey, Inputs } from '../rules/inputs';
import type { Tip } from '../rules/tipping';

const LEVEL = ['Routine', 'Urgent', 'Emergency', 'Critical care'];

interface Props {
  result: Result;
  baseline: Result;
  tips: Record<Decision['id'], Tip[]>;
  register: (id: string) => (el: HTMLElement | null) => void;
  hot: Set<string>;
  onHover: (id: string | null) => void;
  onApply: (key: InputKey, value: Inputs[InputKey]) => void;
}

export function Decisions({ result, baseline, tips, register, hot, onHover, onApply }: Props) {
  const label = new Map(result.criteria.map((c) => [c.id, c]));
  return (
    <section className="decisions" aria-label="Recommendations" aria-live="polite">
      {result.decisions.map((d) => {
        const was = baseline.decisions.find((x) => x.id === d.id)!;
        const changed = was.key !== d.key;
        const because = d.from
          .map((f) => label.get(f) ?? result.criteria.find((c) => c.group === f && c.fired) ?? null)
          .filter((c, i, a): c is NonNullable<typeof c> => !!c && c.fired && a.indexOf(c) === i);
        const groupFired = result.criteria.filter((c) => c.fired && d.from.includes(c.group));
        const reasons = [...new Map([...because, ...groupFired].map((c) => [c.id, c])).values()].slice(0, 6);
        return (
          <article
            key={d.id}
            ref={register(`dec:${d.id}`)}
            className={`decision l${d.level}${changed ? ' changed' : ''}${hot.has(`dec:${d.id}`) ? ' hot' : ''}`}
            onMouseEnter={() => onHover(`dec:${d.id}`)}
            onMouseLeave={() => onHover(null)}
          >
            <header>
              <span className="kicker">{d.title}</span>
              <span className={`level l${d.level}`}>{LEVEL[d.level]}</span>
            </header>
            <h3>{d.headline}</h3>
            {changed && <p className="was">Recorded values: {was.headline}</p>}
            {d.detail.map((t, i) => <p key={i}>{t}</p>)}
            {reasons.length > 0 && (
              <div className="because">
                {reasons.map((c) => <span key={c.id} className={`chip ${c.tone}`}>{c.label}</span>)}
              </div>
            )}
            {tips[d.id].length > 0 && (
              <div className="tips">
                <h4>Would change if</h4>
                <ul>
                  {tips[d.id].slice(0, 3).map((t) => (
                    <li key={t.key}>
                      <button onClick={() => onApply(t.key, t.value)} title="Try this value">
                        <span className="what">{t.label} {t.from} to {t.to}</span>
                        <span className="then">{t.headline}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="source">{d.source}</p>
          </article>
        );
      })}
    </section>
  );
}
