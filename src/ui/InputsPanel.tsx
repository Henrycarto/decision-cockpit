/** The patient's values, each one a what-if control with the recorded value marked on its track. */
import type { Consciousness } from '../clinical/news2';
import { clock, dayLabel } from '../record/time';
import { CONSCIOUSNESS, NUMERIC, TOGGLES, type InputKey, type Inputs, type Measured, type NumericDef } from '../rules/inputs';

interface Props {
  inputs: Inputs;
  base: Inputs;
  measured: Measured;
  momentT: number;
  onChange: (key: InputKey, value: Inputs[InputKey]) => void;
  register: (id: string) => (el: HTMLElement | null) => void;
  hot: Set<string>;
  onHover: (id: string | null) => void;
}

const when = (t: number | undefined, now: number) => (t === undefined ? '' : now - t < 18 * 60 ? clock(t) : `${dayLabel(t).slice(0, 3)} ${clock(t)}`);
const show = (d: NumericDef, v: number) => (d.step < 1 ? v.toFixed(1) : String(v));

function NumericRow(p: Props & { d: NumericDef }) {
  const { d, inputs, base, measured, momentT, onChange, register, hot } = p;
  const v = inputs[d.key];
  const b = base[d.key];
  const changed = v !== b;
  const pct = (x: number) => ((x - d.min) / (d.max - d.min)) * 100;
  const at = d.group === 'labs' ? when(measured[d.key as 'lactate' | 'urea' | 'creatinine'], momentT) : '';
  const stale = d.key === 'lactate' && v === null && measured.staleLactate !== undefined;
  return (
    <div className={`in num${changed ? ' changed' : ''}${hot.has(`in:${d.key}`) ? ' hot' : ''}`} ref={register(`in:${d.key}`)} onMouseEnter={() => p.onHover(`in:${d.key}`)} onMouseLeave={() => p.onHover(null)}>
      <label htmlFor={`in-${d.key}`}>
        <span>{d.label}</span>
        <b>{v === null ? 'None' : show(d, v)}<small>{d.unit.startsWith('×') ? '' : ` ${d.unit}`}</small></b>
      </label>
      <div className="track">
        {b !== null && <span className="was" style={{ left: `${pct(b)}%` }} title={`Recorded: ${show(d, b)}`} />}
        <input
          id={`in-${d.key}`}
          type="range"
          min={d.min}
          max={d.max}
          step={d.step}
          value={v ?? d.min}
          className={v === null ? 'empty' : ''}
          onChange={(e) => onChange(d.key, Number(e.target.value))}
          aria-valuetext={v === null ? 'not measured' : `${show(d, v)} ${d.unit}`}
        />
      </div>
      <div className="meta">
        {changed ? (
          <>
            <span>Recorded {b === null ? 'none' : show(d, b)}</span>
            <button onClick={() => onChange(d.key, b)}>Reset</button>
          </>
        ) : stale ? (
          <span>Last {measured.staleLactate}, {when(measured.lactate, momentT)}: over 12 h old</span>
        ) : (
          at && <span>Measured {at}</span>
        )}
      </div>
    </div>
  );
}

export function InputsPanel(p: Props) {
  const { inputs, base, onChange, register, hot } = p;
  const groups: Array<[NumericDef['group'], string]> = [['vitals', `Observations, ${clock(p.measured.obs ?? p.momentT)}`], ['labs', 'Blood results'], ['care', 'Treatment so far']];
  return (
    <section className="inputs" aria-label="Patient values">
      {groups.map(([g, title]) => (
        <div key={g} className="in-group">
          <h3>{title}</h3>
          {NUMERIC.filter((d) => d.group === g).map((d) => <NumericRow key={d.key} d={d} {...p} />)}
          {g === 'vitals' && (
            <div className={`in sel${inputs.consciousness !== base.consciousness ? ' changed' : ''}${hot.has('in:consciousness') ? ' hot' : ''}`} ref={register('in:consciousness')} onMouseEnter={() => p.onHover('in:consciousness')} onMouseLeave={() => p.onHover(null)}>
              <label htmlFor="in-consciousness"><span>Consciousness</span></label>
              <select id="in-consciousness" value={inputs.consciousness} onChange={(e) => onChange('consciousness', e.target.value as Consciousness)}>
                {CONSCIOUSNESS.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
              </select>
            </div>
          )}
        </div>
      ))}
      <div className="in-group">
        <h3>Context</h3>
        {TOGGLES.map((t) => (
          <div key={t.key} className={`in tog${inputs[t.key] !== base[t.key] ? ' changed' : ''}${hot.has(`in:${t.key}`) ? ' hot' : ''}`} ref={register(`in:${t.key}`)} onMouseEnter={() => p.onHover(`in:${t.key}`)} onMouseLeave={() => p.onHover(null)}>
            <span id={`lbl-${t.key}`}>{t.label}</span>
            <button role="switch" aria-checked={inputs[t.key]} aria-labelledby={`lbl-${t.key}`} className="switch" onClick={() => onChange(t.key, !inputs[t.key])}>
              <span />
            </button>
          </div>
        ))}
        <p className="fixed">Age {inputs.age}, female. Takes atorvastatin and amlodipine at home.</p>
      </div>
    </section>
  );
}
