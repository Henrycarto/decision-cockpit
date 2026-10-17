import { describe, expect, it } from 'vitest';
import { byId } from '../record/record';
import { at } from '../record/time';
import { evaluate, type Decision } from './engine';
import { MOMENTS, inputsAt, type Inputs } from './inputs';
import { tippingPoints } from './tipping';

const moment = (id: string) => {
  const m = MOMENTS.find((x) => x.id === id)!;
  return inputsAt(m.t, m).inputs;
};
const decide = (i: Inputs) => Object.fromEntries(evaluate(i).decisions.map((d) => [d.id, d])) as Record<Decision['id'], Decision>;

const well: Inputs = {
  respRate: 16, spo2: 97, onOxygen: false, systolic: 128, diastolic: 76, pulse: 72, consciousness: 'alert', temp: 36.9,
  lactate: 1.0, urea: 5, creatinine: 70, boluses: 0, cannotTakeOral: false, penicillinAllergy: false, hypercapnicRisk: false,
  age: 50, sex: 'F', onStatin: false, onAntihypertensive: false,
};

describe('inputs come from the record', () => {
  it('at 01:10 uses the 01:00 observations and the 00:30 bloods, with one bolus given', () => {
    const { inputs, measured } = inputsAt(at(2, '01:10'), { cannotTakeOral: true });
    expect(inputs).toMatchObject({ respRate: 28, spo2: 91, onOxygen: true, systolic: 94, diastolic: 58, pulse: 124, consciousness: 'new-confusion', lactate: 3.1, urea: 8.1, creatinine: 108, boluses: 1 });
    expect(measured.obs).toBe(at(2, '01:00'));
  });

  it('treats a lactate older than 12 hours as not measured, and keeps it for display', () => {
    const { inputs, measured } = inputsAt(at(1, '23:35'));
    expect(inputs.lactate).toBeNull();
    expect(measured.staleLactate).toBe(1.5);
  });

  it('points every moment at a real note', () => {
    for (const m of MOMENTS) expect(byId.has(m.noteId), m.noteId).toBe(true);
  });
});

describe('the rules reproduce what the team decided at each moment', () => {
  it('emergency department: low severity, oral amoxicillin, no escalation', () => {
    const d = decide(moment('ed'));
    expect(d.antibiotics.headline).toBe('Amoxicillin 500 mg oral, three times a day');
    expect(d.escalation.key).toBe('routine');
    expect(d.sepsis.key).toBe('not-indicated');
  });

  it('NEWS2 6 after vomiting: urgent review, possible sepsis, and the lost dose given intravenously', () => {
    const d = decide(moment('news6'));
    expect(d.escalation.key).toBe('urgent');
    expect(d.sepsis.key).toBe('possible');
    expect(d.antibiotics.key).toBe('low-iv');
    expect(d.safety.key).toBe('oral');
  });

  it('sepsis screen: red flag sepsis, emergency response, measure lactate, high-severity antibiotics', () => {
    const r = evaluate(moment('sepsis'));
    const d = decide(moment('sepsis'));
    expect(r.redFlags).toBe(2);
    expect(r.curb.total).toBe(1);
    expect(d.sepsis.key).toBe('red-flag');
    expect(d.escalation.key).toBe('emergency');
    expect(d.fluids.key).toBe('measure');
    expect(d.antibiotics.key).toBe('high'); // red flag sepsis overrides a low CURB-65
  });

  it('registrar at 01:10: CURB-65 4, co-amoxiclav and clarithromycin, second bolus, discuss with critical care, hold statin and amlodipine', () => {
    const r = evaluate(moment('registrar'));
    const d = decide(moment('registrar'));
    expect(r.news2.total).toBe(17);
    expect(r.curb.total).toBe(4);
    expect(r.redFlags).toBe(4);
    expect(Math.round(r.egfr!)).toBe(47);
    expect(d.escalation.key).toBe('emergency');
    expect(d.antibiotics.headline).toBe('Co-amoxiclav 1.2 g IV and clarithromycin 500 mg IV');
    expect(d.fluids.headline).toBe('Second 500 mL bolus, then reassess');
    expect(d.safety.key).toBe('statin+bp+oral');
  });
});

describe('criterion margins', () => {
  it('count to the first value that fires, including the strict urea threshold', () => {
    const margin = (i: Inputs, id: string) => evaluate(i).criteria.find((c) => c.id === id)!.margin;
    expect(margin({ ...well, urea: 7 }, 'curb65.urea')).toBe('0.1 to go');
    expect(margin({ ...well, respRate: 28 }, 'curb65.rr')).toBe('2 to go');
    expect(margin({ ...well, pulse: 124 }, 'redflag.hr')).toBe('7 to go');
    expect(margin({ ...well, systolic: 94 }, 'redflag.sbp')).toBe('4 mmHg to go');
  });
});

describe('escalation', () => {
  it('follows the NEWS2 bands, including a single parameter scoring 3', () => {
    expect(decide(well).escalation.key).toBe('routine');
    expect(decide({ ...well, pulse: 135 }).escalation.key).toBe('urgent');
    expect(decide({ ...well, respRate: 22, spo2: 94, temp: 38.5 }).escalation.key).toBe('routine'); // 2 + 1 + 1 = 4
    expect(decide({ ...well, respRate: 22, spo2: 93, temp: 38.5 }).escalation.key).toBe('urgent'); // 2 + 2 + 1 = 5
    expect(decide({ ...well, respRate: 25, spo2: 91, pulse: 112 }).escalation.key).toBe('emergency');
  });

  it('refers to critical care for lactate 4, low pressure after fluids, or a falling level of consciousness', () => {
    expect(decide({ ...well, lactate: 3.9 }).escalation.key).not.toBe('critical-care');
    expect(decide({ ...well, lactate: 4.0 }).escalation.key).toBe('critical-care');
    expect(decide({ ...well, systolic: 85, boluses: 0 }).escalation.key).not.toBe('critical-care');
    expect(decide({ ...well, systolic: 85, boluses: 1 }).escalation.key).toBe('critical-care');
    expect(decide({ ...well, consciousness: 'new-confusion' }).escalation.key).not.toBe('critical-care');
    expect(decide({ ...well, consciousness: 'voice' }).escalation.key).toBe('critical-care');
  });
});

describe('sepsis red flags', () => {
  it('fire at each threshold and not one step before', () => {
    const flags = (i: Inputs) => evaluate(i).redFlags;
    expect([flags({ ...well, respRate: 24 }), flags({ ...well, respRate: 25 })]).toEqual([0, 1]);
    expect([flags({ ...well, pulse: 130 }), flags({ ...well, pulse: 131 })]).toEqual([0, 1]);
    expect([flags({ ...well, systolic: 91 }), flags({ ...well, systolic: 90 })]).toEqual([0, 1]);
    expect([flags({ ...well, lactate: 1.9 }), flags({ ...well, lactate: 2 })]).toEqual([0, 1]);
    expect([flags({ ...well, spo2: 92 }), flags({ ...well, spo2: 91 }), flags({ ...well, onOxygen: true })]).toEqual([0, 1, 1]);
    expect(flags({ ...well, consciousness: 'new-confusion' })).toBe(1);
  });

  it('use 88% as the oxygen floor with a risk of hypercapnic failure', () => {
    expect(evaluate({ ...well, spo2: 89, hypercapnicRisk: true }).redFlags).toBe(0);
    expect(evaluate({ ...well, spo2: 87, hypercapnicRisk: true }).redFlags).toBe(1);
  });
});

describe('antibiotics', () => {
  it('step up with severity', () => {
    expect(decide(well).antibiotics.key).toBe('low');
    expect(decide({ ...well, age: 70, urea: 8 }).antibiotics.key).toBe('moderate');
    expect(decide({ ...well, age: 70, urea: 8, respRate: 30 }).antibiotics.key).toBe('high');
  });

  it('switch to the penicillin-allergy alternative at every severity', () => {
    expect(decide({ ...well, penicillinAllergy: true }).antibiotics.key).toBe('low-allergy');
    expect(decide({ ...well, age: 70, urea: 8, penicillinAllergy: true }).antibiotics.key).toBe('moderate-allergy');
    expect(decide({ ...well, age: 70, urea: 8, respRate: 30, penicillinAllergy: true }).antibiotics.headline).toBe('Levofloxacin, intravenous');
  });

  it('go intravenous when oral medicines cannot be taken', () => {
    expect(decide({ ...well, cannotTakeOral: true }).antibiotics.key).toBe('low-iv');
    expect(decide({ ...well, age: 70, urea: 8, cannotTakeOral: true }).antibiotics.key).toBe('moderate-iv');
  });
});

describe('fluids', () => {
  it('give a bolus for low pressure or high lactate, count the boluses, and stop at three', () => {
    expect(decide(well).fluids.key).toBe('none');
    expect(decide({ ...well, lactate: 2.5 }).fluids.headline).toBe('500 mL crystalloid over 15 minutes');
    expect(decide({ ...well, systolic: 88, boluses: 2 }).fluids.headline).toBe('Third 500 mL bolus, then reassess');
    expect(decide({ ...well, systolic: 88, boluses: 3 }).fluids.key).toBe('refractory');
  });

  it('ask for a lactate when sepsis is flagged and none is recent', () => {
    expect(decide({ ...well, lactate: null, respRate: 26 }).fluids.key).toBe('measure');
    expect(decide({ ...well, lactate: null }).fluids.key).toBe('measure-routine');
  });
});

describe('oxygen', () => {
  it('titrates to 94 to 98%, or 88 to 92% with a risk of hypercapnic failure', () => {
    expect(decide({ ...well, spo2: 93 }).oxygen.key).toBe('start');
    expect(decide({ ...well, spo2: 99, onOxygen: true }).oxygen.key).toBe('reduce');
    expect(decide({ ...well, spo2: 95, onOxygen: true }).oxygen.key).toBe('continue');
    expect(decide({ ...well, spo2: 95, onOxygen: true, hypercapnicRisk: true }).oxygen.headline).toBe('Reduce oxygen, target 88 to 92%');
    expect(decide({ ...well, spo2: 90, hypercapnicRisk: true }).oxygen.key).toBe('air');
  });
});

describe('medicine safety', () => {
  it('holds the statin only when clarithromycin is recommended', () => {
    expect(decide({ ...well, onStatin: true }).safety.key).toBe('clear');
    expect(decide({ ...well, onStatin: true, age: 70, urea: 8, respRate: 30 }).safety.key).toBe('statin');
    expect(decide({ ...well, onStatin: true, age: 70, urea: 8, respRate: 30, penicillinAllergy: true }).safety.key).toBe('clear');
  });

  it('flags low blood pressure on an antihypertensive and kidney function below 30', () => {
    expect(decide({ ...well, onAntihypertensive: true, systolic: 99 }).safety.key).toBe('bp');
    expect(decide({ ...well, onAntihypertensive: true, systolic: 100 }).safety.key).toBe('clear');
    expect(decide({ ...well, creatinine: 250, age: 70 }).safety.key).toBe('renal');
  });
});

describe('every decision explains itself', () => {
  it('names a source, a headline and at least one reason, at every moment', () => {
    for (const m of MOMENTS) {
      for (const d of evaluate(inputsAt(m.t, m).inputs).decisions) {
        expect(d.source.length).toBeGreaterThan(5);
        expect(d.headline.length).toBeGreaterThan(5);
        expect(d.detail.length).toBeGreaterThan(0);
        expect(d.detail.join(' ')).not.toMatch(/\u2014/);
      }
    }
  });
});

describe('tipping points', () => {
  const tips = tippingPoints(moment('registrar'));

  it('at 01:10 escalation is 5 mmHg of systolic or 0.9 of lactate away from critical care', () => {
    const esc = tips.escalation;
    expect(esc[0]).toMatchObject({ key: 'systolic', to: '89 mmHg', headline: 'Refer to critical care now' });
    expect(esc.find((t) => t.key === 'lactate')).toMatchObject({ to: '4 mmol/L' });
  });

  it('are the smallest change: one step less does not change the decision', () => {
    const base = moment('registrar');
    for (const [id, list] of Object.entries(tips)) {
      for (const t of list.filter((x) => typeof x.value === 'number')) {
        const flipped = decide({ ...base, [t.key]: t.value }) as Record<string, Decision>;
        expect(flipped[id].key, `${id} ${t.key}`).not.toBe(decide(base)[id as Decision['id']].key);
        const v = t.value as number;
        const step = t.key === 'lactate' || t.key === 'urea' || t.key === 'temp' ? 0.1 : 1;
        const toward = (base[t.key as keyof Inputs] as number) < v ? -step : step;
        const nearer = Math.round((v + toward) * 10) / 10;
        if (nearer !== base[t.key as keyof Inputs]) {
          const notYet = decide({ ...base, [t.key]: nearer }) as Record<string, Decision>;
          expect(notYet[id].key, `${id} ${t.key} at ${nearer}`).toBe(decide(base)[id as Decision['id']].key);
        }
      }
    }
  });

  it('include toggles and the level of consciousness', () => {
    expect(tips.antibiotics.map((t) => t.key)).toContain('penicillinAllergy');
    expect(tips.escalation.map((t) => t.key)).toContain('consciousness');
  });

  it('never propose a diastolic within 10 of the systolic', () => {
    const base = moment('registrar');
    for (const list of Object.values(tips)) {
      for (const t of list) {
        const trial = { ...base, [t.key]: t.value } as Inputs;
        expect(trial.diastolic).toBeLessThanOrEqual(trial.systolic - 10);
      }
    }
  });
});
