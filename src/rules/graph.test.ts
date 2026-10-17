import { describe, expect, it } from 'vitest';
import { evaluate } from './engine';
import { MOMENTS, inputsAt } from './inputs';
import { connected, wires } from './graph';

const at0110 = () => {
  const m = MOMENTS.find((x) => x.id === 'registrar')!;
  return inputsAt(m.t, m).inputs;
};

describe('wiring', () => {
  const i = at0110();
  const r = evaluate(i);
  const ws = wires(r, i);

  it('connects every criterion to its inputs and its score, lit when it is met', () => {
    const rr = ws.filter((w) => w.from === 'in:respRate').map((w) => [w.to, w.lit]);
    expect(rr).toEqual(expect.arrayContaining([['news2.respRate', true], ['curb65.rr', false], ['redflag.rr', true]]));
    expect(ws).toContainEqual({ from: 'curb65.urea', to: 'score:curb65', lit: true });
    expect(ws).toContainEqual({ from: 'redflag.hr', to: 'score:redflag', lit: false });
  });

  it('feeds decisions from scores and from the context switches', () => {
    expect(ws).toContainEqual({ from: 'score:curb65', to: 'dec:antibiotics', lit: true });
    expect(ws).toContainEqual({ from: 'in:boluses', to: 'dec:fluids', lit: true });
    expect(ws).toContainEqual({ from: 'in:cannotTakeOral', to: 'dec:safety', lit: true });
  });

  it('never wires to a node that does not exist', () => {
    const ids = new Set([...r.criteria.map((c) => c.id), ...r.scores.map((s) => `score:${s.id}`), ...r.decisions.map((d) => `dec:${d.id}`)]);
    for (const w of ws) {
      if (!w.from.startsWith('in:')) expect(ids.has(w.from), w.from).toBe(true);
      expect(ids.has(w.to), w.to).toBe(true);
    }
  });

  it('traces a decision back to the inputs that feed it', () => {
    const up = connected(ws, 'dec:antibiotics');
    for (const id of ['score:curb65', 'curb65.urea', 'in:urea', 'in:respRate', 'in:penicillinAllergy']) expect(up.has(id), id).toBe(true);
    expect(up.has('in:creatinine')).toBe(false);
  });

  it('traces an input forward to every decision it can change', () => {
    const down = connected(ws, 'in:creatinine');
    expect(down.has('dec:safety')).toBe(true);
    expect(down.has('dec:antibiotics')).toBe(false);
  });
});
