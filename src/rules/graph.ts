/**
 * The wiring of the cockpit: inputs feed criteria, criteria feed scores, scores feed decisions.
 * A wire is lit when the thing it carries is active, so a lit path from an input to a decision is
 * the reason for that decision.
 */
import type { Decision, Group, Result } from './engine';
import type { Inputs } from './inputs';

export interface Wire {
  from: string;
  to: string;
  lit: boolean;
}

const GROUPS: Group[] = ['news2', 'curb65', 'redflag', 'kidney'];
const DIRECT: Record<string, keyof Inputs> = { allergy: 'penicillinAllergy', oral: 'cannotTakeOral', boluses: 'boluses', hypercapnic: 'hypercapnicRisk' };

/** What each decision can depend on, whichever branch fires. Lighting follows the branch; wiring does not. */
const DEPENDS: Record<Decision['id'], { groups: Group[]; direct: string[]; decisions?: Decision['id'][] }> = {
  escalation: { groups: ['news2', 'redflag'], direct: ['boluses'] },
  sepsis: { groups: ['redflag', 'news2'], direct: [] },
  antibiotics: { groups: ['curb65', 'redflag'], direct: ['allergy', 'oral'] },
  fluids: { groups: ['redflag'], direct: ['boluses'] },
  oxygen: { groups: ['news2'], direct: ['hypercapnic'] },
  safety: { groups: ['kidney', 'news2'], direct: ['oral'], decisions: ['antibiotics'] },
};

const groupOf = (f: string) => GROUPS.find((x) => f === x || f.startsWith(`${x}.`));

export function wires(r: Result, i: Inputs): Wire[] {
  const out: Wire[] = [];
  for (const c of r.criteria) {
    for (const k of c.inputs) out.push({ from: `in:${k}`, to: c.id, lit: c.fired });
    out.push({ from: c.id, to: `score:${c.group}`, lit: c.fired });
  }
  for (const d of r.decisions) {
    const dep = DEPENDS[d.id];
    const used = new Set(d.from.map(groupOf).filter(Boolean));
    for (const g of dep.groups) {
      const s = r.scores.find((x) => x.id === g)!;
      out.push({ from: `score:${g}`, to: `dec:${d.id}`, lit: d.level > 0 && used.has(g) && s.tone !== 'none' });
    }
    for (const f of dep.direct) {
      const v = i[DIRECT[f]];
      out.push({ from: `in:${DIRECT[f]}`, to: `dec:${d.id}`, lit: d.from.includes(f) && (typeof v === 'number' ? v > 0 : !!v) });
    }
    for (const other of dep.decisions ?? []) out.push({ from: `dec:${other}`, to: `dec:${d.id}`, lit: d.from.includes(other) });
  }
  return out;
}

/** Everything upstream and downstream of a node: what it depends on and what depends on it. */
export function connected(ws: Wire[], id: string): Set<string> {
  const out = new Set([id]);
  for (const dir of ['up', 'down'] as const) {
    const queue = [id];
    const seen = new Set([id]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const w of ws) {
        const [here, there] = dir === 'up' ? [w.to, w.from] : [w.from, w.to];
        if (here === cur && !seen.has(there)) {
          seen.add(there);
          out.add(there);
          queue.push(there);
        }
      }
    }
  }
  return out;
}
