/**
 * Tipping points: for each decision, the smallest single change to one input that would change
 * what the rules recommend. Found by walking each input away from its value, one step at a time,
 * in both directions. Answers "how close is this to being a different decision?"
 */
import { CONSCIOUSNESS, NUMERIC, TOGGLES, type InputKey, type Inputs } from './inputs';
import { evaluate, type Decision } from './engine';

export interface Tip {
  key: InputKey;
  label: string;
  from: string;
  to: string;
  value: Inputs[InputKey];
  distance: number; // share of the input's range; toggles and categories rank after small numeric changes
  headline: string; // what the decision would become
}

type Id = Decision['id'];

const round = (v: number, step: number) => (step < 1 ? Math.round(v * 10) / 10 : Math.round(v));
const valid = (i: Inputs) => i.diastolic <= i.systolic - 10;

export function tippingPoints(base: Inputs): Record<Id, Tip[]> {
  const start = Object.fromEntries(evaluate(base).decisions.map((d) => [d.id, d.key])) as Record<Id, string>;
  const out = Object.fromEntries(Object.keys(start).map((k) => [k, [] as Tip[]])) as Record<Id, Tip[]>;
  const record = (tip: Omit<Tip, 'headline'>, trial: Inputs, seen: Set<Id>) => {
    for (const d of evaluate(trial).decisions) {
      if (d.key !== start[d.id] && !seen.has(d.id)) {
        seen.add(d.id);
        out[d.id].push({ ...tip, headline: d.headline });
      }
    }
  };

  for (const def of NUMERIC) {
    const v0 = base[def.key];
    if (v0 === null) continue;
    for (const dir of [-1, 1]) {
      const seen = new Set<Id>();
      for (let v = round(v0 + dir * def.step, def.step); v >= def.min - 1e-9 && v <= def.max + 1e-9; v = round(v + dir * def.step, def.step)) {
        const trial = { ...base, [def.key]: v };
        if (!valid(trial)) continue;
        const unit = def.unit.startsWith('×') ? '' : ` ${def.unit}`.replace(' /min', '/min').replace(' %', '%');
        record({ key: def.key, label: def.label, from: `${v0}${unit}`, to: `${v}${unit}`, value: v, distance: Math.abs(v - v0) / (def.max - def.min) }, trial, seen);
        if (seen.size === Object.keys(start).length) break;
      }
    }
  }

  for (const t of TOGGLES) {
    const trial = { ...base, [t.key]: !base[t.key] };
    record({ key: t.key, label: t.label, from: base[t.key] ? 'Yes' : 'No', to: base[t.key] ? 'No' : 'Yes', value: !base[t.key], distance: 0.5 }, trial, new Set());
  }

  const ci = CONSCIOUSNESS.findIndex(([c]) => c === base.consciousness);
  CONSCIOUSNESS.forEach(([c, label], j) => {
    if (j === ci) return;
    record({ key: 'consciousness', label: 'Consciousness', from: CONSCIOUSNESS[ci][1], to: label, value: c, distance: 0.25 * Math.abs(j - ci) }, { ...base, consciousness: c }, new Set());
  });

  for (const id of Object.keys(out) as Id[]) {
    // nearest change per input first, then the closest inputs
    const best = new Map<string, Tip>();
    for (const tip of out[id].sort((a, b) => a.distance - b.distance)) if (!best.has(tip.key)) best.set(tip.key, tip);
    out[id] = [...best.values()].sort((a, b) => a.distance - b.distance);
  }
  return out;
}
