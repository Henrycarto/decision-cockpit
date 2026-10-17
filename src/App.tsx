import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PATIENT, byId } from './record/record';
import { clock, stamp } from './record/time';
import { evaluate } from './rules/engine';
import { connected, wires as wiresOf } from './rules/graph';
import { MOMENTS, NUMERIC, TOGGLES, inputsAt, type InputKey, type Inputs } from './rules/inputs';
import { tippingPoints } from './rules/tipping';
import { Circuit } from './ui/Circuit';
import { Decisions } from './ui/Decisions';
import { InputsPanel } from './ui/InputsPanel';
import { Wires } from './ui/Wires';

const EDITABLE: InputKey[] = [...NUMERIC.map((n) => n.key), ...TOGGLES.map((t) => t.key), 'consciousness'];

/** ?moment=registrar&systolic=89 opens a moment with what-if values applied, so a scenario can be shared. */
function fromUrl(): { moment: string; overrides: Partial<Inputs> } {
  const q = new URLSearchParams(window.location.search);
  const moment = MOMENTS.some((m) => m.id === q.get('moment')) ? q.get('moment')! : 'registrar';
  const overrides: Partial<Inputs> = {};
  for (const k of EDITABLE) {
    const v = q.get(k);
    if (v === null) continue;
    if (TOGGLES.some((t) => t.key === k)) (overrides as Record<string, unknown>)[k] = v === '1';
    else if (k === 'consciousness') (overrides as Record<string, unknown>)[k] = v;
    else if (!Number.isNaN(Number(v))) (overrides as Record<string, unknown>)[k] = Number(v);
  }
  return { moment, overrides };
}

export default function App() {
  const init = useMemo(fromUrl, []);
  const [momentId, setMomentId] = useState(init.moment);
  const moment = MOMENTS.find((m) => m.id === momentId)!;
  const { inputs: base, measured } = useMemo(() => inputsAt(moment.t, moment), [moment]);
  const [inputs, setInputs] = useState<Inputs>(() => ({ ...inputsAt(moment.t, moment).inputs, ...init.overrides }));
  const [hover, setHover] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const board = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);
  const dimmed = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;

  const result = useMemo(() => evaluate(inputs), [inputs]);
  const baseline = useMemo(() => evaluate(base), [base]);
  const tips = useMemo(() => tippingPoints(inputs), [inputs]);
  const ws = useMemo(() => wiresOf(result, inputs), [result, inputs]);
  const hot = useMemo(() => (hover ? connected(ws, hover) : null), [ws, hover]);

  const changed = EDITABLE.filter((k) => inputs[k] !== base[k]);
  const flipped = useMemo(() => {
    const s = new Set<string>();
    result.criteria.forEach((c, i) => c.fired !== baseline.criteria[i].fired && s.add(c.id));
    result.scores.forEach((c, i) => c.value !== baseline.scores[i].value && s.add(c.id));
    return s;
  }, [result, baseline]);
  const changedDecisions = result.decisions.filter((d, i) => d.key !== baseline.decisions[i].key).length;

  useEffect(() => {
    const q = new URLSearchParams({ moment: momentId });
    for (const k of changed) {
      const v = inputs[k];
      q.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    const id = window.setTimeout(() => window.history.replaceState(null, '', `?${q}`), 200);
    return () => window.clearTimeout(id);
  }, [momentId, inputs, changed]);

  const register = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) nodes.current.set(id, el);
      else nodes.current.delete(id);
    },
    [],
  );

  const set = useCallback((key: InputKey, value: Inputs[InputKey]) => {
    setInputs((cur) => {
      const next = { ...cur, [key]: value } as Inputs;
      // keep the blood pressure physiological while either end is dragged
      if (key === 'systolic' && next.diastolic > next.systolic - 10) next.diastolic = Math.max(30, next.systolic - 10);
      if (key === 'diastolic' && next.diastolic > next.systolic - 10) next.systolic = Math.min(200, next.diastolic + 10);
      return next;
    });
  }, []);

  const pickMoment = (id: string) => {
    const m = MOMENTS.find((x) => x.id === id)!;
    setMomentId(id);
    setInputs(inputsAt(m.t, m).inputs);
  };

  const note = byId.get(moment.noteId)!;
  const hotSet = hot ?? new Set<string>();

  return (
    <div className="shell">
      <header className="banner">
        <div className="who">
          <h1>{PATIENT.name}</h1>
          <span>{PATIENT.age}, {PATIENT.sex}. {PATIENT.number}</span>
        </div>
        <div className="dx">
          <b>{PATIENT.diagnosis}</b>
          <span>Ward 4B, bed 3. {stamp(moment.t)}.</span>
        </div>
        <span className="allergy">{inputs.penicillinAllergy ? 'Penicillin allergy' : PATIENT.allergies}</span>
        <div className="spacer" />
        <button className="btn" onClick={() => setTheme(dimmed ? 'light' : 'dark')} aria-pressed={dimmed}>
          {dimmed ? 'Bright display' : 'Dim display'}
        </button>
      </header>

      <nav className="bar" aria-label="Decision moment">
        <span className="bar-lbl">Decision moment</span>
        <div className="seg" role="radiogroup">
          {MOMENTS.map((m) => (
            <button key={m.id} role="radio" aria-checked={m.id === momentId} className={m.id === momentId ? 'on' : ''} onClick={() => pickMoment(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className={`mode${changed.length ? ' whatif' : ''}`} aria-live="polite">
          {changed.length ? (
            <>
              <b>What if</b>
              <span>
                {changed.length} {changed.length === 1 ? 'value' : 'values'} changed, {changedDecisions} {changedDecisions === 1 ? 'decision' : 'decisions'} different
              </span>
              <button className="btn small" onClick={() => setInputs(base)}>Back to the record</button>
            </>
          ) : (
            <>
              <b>The record</b>
              <span>Values as charted. Move any control to ask what if.</span>
            </>
          )}
        </div>
      </nav>

      <div className="board" ref={board}>
        <Wires wires={ws} nodes={nodes} board={board} hot={hot} tick={`${momentId}:${changed.length}:${JSON.stringify(result.decisions.map((d) => d.key))}`} />
        <InputsPanel inputs={inputs} base={base} measured={measured} momentT={moment.t} onChange={set} register={register} hot={hotSet} onHover={setHover} />
        <Circuit result={result} register={register} hot={hotSet} onHover={setHover} flipped={flipped} />
        <div className="right">
          <section className="recorded">
            <span className="kicker">What the team recorded, {clock(note.t)}</span>
            <p><b>{note.author}.</b> {note.detail}</p>
          </section>
          <Decisions result={result} baseline={baseline} tips={tips} register={register} hot={hotSet} onHover={setHover} onApply={set} />
        </div>
      </div>

      <footer className="foot">
        A fictional patient (Bed 3 in the ward monitor and the patient timeline) and simplified rules, for demonstrating interface design and
        explainable decision logic. Not a medical device and not clinical guidance. Hover any node to trace what it depends on and what depends on it.
      </footer>
    </div>
  );
}
