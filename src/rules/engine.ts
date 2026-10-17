/**
 * The rule engine. Inputs in; criteria, scores and decisions out, with every decision naming
 * the criteria and scores that produced it. Pure functions, so the same inputs always give the
 * same answer and every branch can be tested.
 *
 * Sources, simplified for a demonstration:
 * - NEWS2: Royal College of Physicians, 2017.
 * - CURB-65 and antibiotic choice by severity: BTS; NICE NG138 (pneumonia, community-acquired).
 * - Sepsis red flags and the Sepsis Six: UK Sepsis Trust.
 * - Oxygen targets: BTS oxygen guideline.
 * - eGFR: CKD-EPI 2021.
 */
import { curb65 } from '../clinical/curb65';
import { egfr } from '../clinical/egfr';
import { score, type Param, type Risk } from '../clinical/news2';
import type { InputKey, Inputs } from './inputs';

export type Group = 'news2' | 'curb65' | 'redflag' | 'kidney';
export type Tone = 'none' | 'amber' | 'red';

export interface Criterion {
  id: string;
  group: Group;
  label: string;
  inputs: InputKey[];
  fired: boolean;
  value: string;
  points?: number; // NEWS2 parameters
  margin?: string; // how far from firing, or from stopping, in the input's units
  tone: Tone;
}

export interface Score {
  id: Group;
  label: string;
  value: string;
  band: string;
  tone: Tone;
  from: string[]; // criteria that contribute
}

export type Level = 0 | 1 | 2 | 3;

export interface Decision {
  id: 'escalation' | 'sepsis' | 'antibiotics' | 'fluids' | 'oxygen' | 'safety';
  title: string;
  key: string; // which branch fired; a change of key is a change of decision
  headline: string;
  detail: string[];
  level: Level; // 0 routine, 1 urgent, 2 emergency, 3 critical care
  from: string[]; // criteria and scores that produced it
  source: string;
}

export interface Result {
  criteria: Criterion[];
  scores: Score[];
  decisions: Decision[];
  news2: ReturnType<typeof score>;
  curb: ReturnType<typeof curb65>;
  redFlags: number;
  egfr: number | null;
  severity: 'low' | 'moderate' | 'high';
}

const fmt = (n: number, d = 0) => (d ? n.toFixed(d) : String(Math.round(n)));

function marginText(v: number, threshold: number, fired: boolean, unit: string, d = 0): string {
  const gap = Math.abs(v - threshold);
  const s = `${fmt(gap, d)}${unit}`;
  return fired ? `${s} past the line` : `${s} to go`;
}

const NEWS_PARAMS: Array<[Param, string, InputKey[]]> = [
  ['respRate', 'Respiration', ['respRate']],
  ['spo2', 'SpO₂', ['spo2', 'hypercapnicRisk']],
  ['air', 'Air or oxygen', ['onOxygen']],
  ['systolic', 'Systolic BP', ['systolic']],
  ['pulse', 'Pulse', ['pulse']],
  ['consciousness', 'Consciousness', ['consciousness']],
  ['temp', 'Temperature', ['temp']],
];

export const SEVERITY_TEXT = { low: 'low', moderate: 'moderate', high: 'high' } as const;

export function evaluate(i: Inputs): Result {
  const obs = { respRate: i.respRate, spo2: i.spo2, onOxygen: i.onOxygen, systolic: i.systolic, pulse: i.pulse, consciousness: i.consciousness, temp: i.temp };
  const news2 = score(obs, i.hypercapnicRisk ? 2 : 1);
  const confused = i.consciousness !== 'alert';
  const curb = curb65({ confused, urea: i.urea, respRate: i.respRate, systolic: i.systolic, diastolic: i.diastolic, age: i.age });
  const gfr = i.creatinine === null ? null : egfr(i.creatinine, i.age, i.sex);
  const spo2Floor = i.hypercapnicRisk ? 88 : 92;

  const criteria: Criterion[] = [];
  const vtext: Record<Param, string> = {
    respRate: `${i.respRate}/min`,
    spo2: `${i.spo2}%`,
    air: i.onOxygen ? 'Oxygen' : 'Air',
    systolic: `${i.systolic} mmHg`,
    pulse: `${i.pulse}/min`,
    consciousness: confused ? (i.consciousness === 'new-confusion' ? 'New confusion' : i.consciousness === 'unresponsive' ? 'Unresponsive' : `Responds to ${i.consciousness}`) : 'Alert',
    temp: `${i.temp.toFixed(1)} °C`,
  };
  for (const [p, label, inputs] of NEWS_PARAMS) {
    const pts = news2.points[p];
    criteria.push({ id: `news2.${p}`, group: 'news2', label, inputs, fired: pts > 0, points: pts, value: vtext[p], tone: pts >= 3 ? 'red' : pts > 0 ? 'amber' : 'none' });
  }

  // CURB-65, each criterion with its distance from the threshold
  const bpFired = i.systolic < 90 || i.diastolic <= 60;
  criteria.push(
    { id: 'curb65.confusion', group: 'curb65', label: 'New confusion', inputs: ['consciousness'], fired: confused, value: vtext.consciousness, tone: confused ? 'red' : 'none' },
    {
      id: 'curb65.urea', group: 'curb65', label: 'Urea above 7', inputs: ['urea'], fired: i.urea !== null && i.urea > 7,
      value: i.urea === null ? 'Not measured' : `${i.urea} mmol/L`, margin: i.urea === null ? undefined : i.urea > 7 ? undefined : `${(7.1 - i.urea).toFixed(1)} to go`, // strictly above 7
      tone: i.urea !== null && i.urea > 7 ? 'red' : 'none',
    },
    { id: 'curb65.rr', group: 'curb65', label: 'Respiration 30 or more', inputs: ['respRate'], fired: i.respRate >= 30, value: vtext.respRate, margin: marginText(i.respRate, 30, i.respRate >= 30, ''), tone: i.respRate >= 30 ? 'red' : 'none' },
    {
      id: 'curb65.bp', group: 'curb65', label: 'Systolic below 90 or diastolic 60 or less', inputs: ['systolic', 'diastolic'], fired: bpFired,
      value: `${i.systolic}/${i.diastolic}`, margin: bpFired ? undefined : `${Math.min(i.systolic - 89, i.diastolic - 60)} mmHg to go`, tone: bpFired ? 'red' : 'none',
    },
    { id: 'curb65.age', group: 'curb65', label: 'Age 65 or over', inputs: [], fired: i.age >= 65, value: `${i.age}`, tone: i.age >= 65 ? 'red' : 'none' },
  );

  // sepsis red flags (UK Sepsis Trust), the ones a ward chart can show
  const needsO2 = i.onOxygen || i.spo2 < spo2Floor;
  const flags: Array<[string, string, InputKey[], boolean, string, string | undefined]> = [
    ['rr', 'Respiration 25 or more', ['respRate'], i.respRate >= 25, vtext.respRate, marginText(i.respRate, 25, i.respRate >= 25, '')],
    ['o2', `Needs oxygen to keep SpO₂ at ${spo2Floor}% or more`, ['onOxygen', 'spo2', 'hypercapnicRisk'], needsO2, `${i.spo2}% on ${i.onOxygen ? 'oxygen' : 'air'}`, undefined],
    ['hr', 'Pulse above 130', ['pulse'], i.pulse > 130, vtext.pulse, i.pulse > 130 ? undefined : `${131 - i.pulse} to go`],
    ['sbp', 'Systolic 90 or less', ['systolic'], i.systolic <= 90, vtext.systolic, i.systolic <= 90 ? undefined : `${i.systolic - 90} mmHg to go`],
    ['lactate', 'Lactate 2 or more', ['lactate'], i.lactate !== null && i.lactate >= 2, i.lactate === null ? 'Not measured recently' : `${i.lactate} mmol/L`, i.lactate === null ? undefined : marginText(i.lactate, 2, i.lactate >= 2, '', 1)],
    ['mental', 'New confusion or reduced consciousness', ['consciousness'], confused, vtext.consciousness, undefined],
  ];
  for (const [id, label, inputs, fired, value, margin] of flags) {
    criteria.push({ id: `redflag.${id}`, group: 'redflag', label, inputs, fired, value, margin, tone: fired ? 'red' : 'none' });
  }
  const redFlags = flags.filter((f) => f[3]).length;

  const gfrLow = gfr !== null && gfr < 30;
  criteria.push({
    id: 'kidney.egfr', group: 'kidney', label: 'eGFR below 30', inputs: ['creatinine'], fired: gfrLow,
    value: gfr === null ? 'Not measured' : `${Math.round(gfr)} mL/min/1.73 m²`, margin: gfr === null ? undefined : gfrLow ? undefined : `${Math.round(gfr - 30)} above`,
    tone: gfrLow ? 'red' : 'none',
  });

  const firedIds = (g: Group) => criteria.filter((c) => c.group === g && c.fired).map((c) => c.id);
  const riskTone = (r: Risk): Tone => (r === 'high' ? 'red' : r === 'low' ? 'none' : 'amber');
  const scores: Score[] = [
    { id: 'news2', label: 'NEWS2', value: String(news2.total), band: `${{ low: 'Low', 'low-medium': 'Low-medium', medium: 'Medium', high: 'High' }[news2.risk]} risk`, tone: riskTone(news2.risk), from: firedIds('news2') },
    { id: 'curb65', label: 'CURB-65', value: String(curb.total), band: `${curb.severity[0].toUpperCase()}${curb.severity.slice(1)} severity${curb.measuredUrea ? '' : ' (CRB-65)'}`, tone: curb.severity === 'high' ? 'red' : curb.severity === 'moderate' ? 'amber' : 'none', from: firedIds('curb65') },
    { id: 'redflag', label: 'Sepsis red flags', value: `${redFlags} of 6`, band: redFlags ? 'Red flag sepsis if infection' : 'None', tone: redFlags ? 'red' : 'none', from: firedIds('redflag') },
    { id: 'kidney', label: 'eGFR', value: gfr === null ? 'n/a' : String(Math.round(gfr)), band: gfr === null ? 'No creatinine' : gfrLow ? 'Below 30: adjust doses' : 'No dose adjustment', tone: gfrLow ? 'amber' : 'none', from: firedIds('kidney') },
  ];

  // NICE NG138: severity is CURB-65 plus clinical judgement. Red flag sepsis is treated as high severity.
  const severity = curb.severity === 'high' || redFlags > 0 ? 'high' : curb.severity;

  const decisions: Decision[] = [
    escalation(i, news2, redFlags),
    sepsis(redFlags, news2.total),
    antibiotics(i, severity, curb, redFlags),
    fluids(i, redFlags),
    oxygen(i),
  ];
  decisions.push(safety(i, decisions.find((d) => d.id === 'antibiotics')!, gfr));
  return { criteria, scores, decisions, news2, curb, redFlags, egfr: gfr, severity };
}

// ---- the decisions -----------------------------------------------------------

function escalation(i: Inputs, n: ReturnType<typeof score>, redFlags: number): Decision {
  const base = { id: 'escalation' as const, title: 'Escalation', source: 'NEWS2 response (RCP 2017); critical care referral criteria simplified' };
  const shock: string[] = [];
  if (i.lactate !== null && i.lactate >= 4) shock.push('lactate 4 or more');
  if (i.systolic < 90 && i.boluses >= 1) shock.push('systolic below 90 after fluids');
  if (i.consciousness === 'voice' || i.consciousness === 'pain' || i.consciousness === 'unresponsive') shock.push('responds only to voice or pain, or unresponsive');
  if (shock.length) {
    return { ...base, key: 'critical-care', level: 3, headline: 'Refer to critical care now', detail: [`Because of ${shock.join(', ')}.`, 'Continuous monitoring, and a senior decision about the right place of care.'], from: ['news2', 'redflag', 'redflag.lactate', 'redflag.sbp', 'redflag.mental'] };
  }
  if (n.risk === 'high') {
    return { ...base, key: 'emergency', level: 2, headline: 'Emergency response at the bedside', detail: [`NEWS2 ${n.total}: assessment now by a team with critical care skills, such as the outreach team.`, 'Discuss with critical care. Continuous monitoring.'], from: ['news2'] };
  }
  if (n.risk === 'medium' || n.risk === 'low-medium') {
    return { ...base, key: 'urgent', level: 1, headline: 'Urgent review by a clinician', detail: [`NEWS2 ${n.total}${n.risk === 'low-medium' ? ' with a single parameter scoring 3' : ''}: a clinician reviews now and decides whether to escalate.`, 'Observations at least hourly.'], from: ['news2'] };
  }
  return { ...base, key: 'routine', level: 0, headline: 'Ward-based care', detail: [`NEWS2 ${n.total}. ${n.frequency}.`, redFlags ? 'Red flags present: see sepsis.' : 'No trigger for escalation.'], from: ['news2'] };
}

function sepsis(redFlags: number, news: number): Decision {
  const base = { id: 'sepsis' as const, title: 'Sepsis', source: 'UK Sepsis Trust red flags and Sepsis Six' };
  if (redFlags > 0) {
    return {
      ...base, key: 'red-flag', level: 2, headline: 'Red flag sepsis: start the Sepsis Six now',
      detail: ['Within the hour: oxygen to target, blood cultures, lactate, intravenous fluids, intravenous antibiotics, urine output.', `${redFlags} red flag${redFlags === 1 ? '' : 's'} with a suspected chest infection.`],
      from: ['redflag'],
    };
  }
  if (news >= 5) {
    return { ...base, key: 'possible', level: 1, headline: 'Sepsis possible: clinician review within the hour', detail: ['No red flag yet. Look for amber flags, measure lactate, and repeat the screen if anything changes.'], from: ['news2', 'redflag'] };
  }
  return { ...base, key: 'not-indicated', level: 0, headline: 'No red flag for sepsis', detail: ['Repeat the screen if NEWS2 rises or the patient looks unwell.'], from: ['redflag'] };
}

function antibiotics(i: Inputs, severity: 'low' | 'moderate' | 'high', curb: ReturnType<typeof curb65>, redFlags: number): Decision {
  const base = { id: 'antibiotics' as const, title: 'Antibiotics', source: 'NICE NG138, community-acquired pneumonia (simplified)' };
  const why = severity === 'high' && curb.severity !== 'high' ? `CURB-65 ${curb.total}, treated as high severity because of red flag sepsis.` : `CURB-65 ${curb.total}: ${severity} severity.`;
  const iv = severity === 'high' || i.cannotTakeOral;
  const from = ['curb65', ...(redFlags ? ['redflag'] : [])];
  if (severity === 'high') {
    if (i.penicillinAllergy) {
      return { ...base, key: 'high-allergy', level: 2, headline: 'Levofloxacin, intravenous', detail: [why, 'Penicillin allergy: levofloxacin instead of co-amoxiclav with clarithromycin. Discuss with microbiology.'], from: [...from, 'allergy'] };
    }
    return { ...base, key: 'high', level: 2, headline: 'Co-amoxiclav 1.2 g IV and clarithromycin 500 mg IV', detail: [why, redFlags ? 'First dose within the hour.' : 'Give the first doses promptly.'], from };
  }
  if (severity === 'moderate') {
    if (i.penicillinAllergy) return { ...base, key: 'moderate-allergy', level: 1, headline: `Doxycycline or clarithromycin${iv ? ', intravenous route where available' : ', oral'}`, detail: [why, 'Penicillin allergy.'], from: [...from, 'allergy'] };
    return { ...base, key: iv ? 'moderate-iv' : 'moderate', level: 1, headline: `Amoxicillin ${iv ? 'IV' : 'oral'}, with clarithromycin if an atypical infection is suspected`, detail: [why, ...(i.cannotTakeOral ? ['Cannot take oral medicines: intravenous route.'] : [])], from: [...from, ...(i.cannotTakeOral ? ['oral'] : [])] };
  }
  if (i.penicillinAllergy) return { ...base, key: 'low-allergy', level: 0, headline: 'Doxycycline oral, or clarithromycin', detail: [why, 'Penicillin allergy.'], from: [...from, 'allergy'] };
  return {
    ...base, key: iv ? 'low-iv' : 'low', level: iv ? 1 : 0, headline: `Amoxicillin 500 mg ${iv ? 'IV' : 'oral'}, three times a day`,
    detail: [why, ...(i.cannotTakeOral ? ['Cannot take oral medicines: give it intravenously rather than wait for the next oral dose.'] : ['Five days in total if improving.'])],
    from: [...from, ...(i.cannotTakeOral ? ['oral'] : [])],
  };
}

function fluids(i: Inputs, redFlags: number): Decision {
  const base = { id: 'fluids' as const, title: 'Fluids', source: 'Sepsis Six; NICE NG51 (simplified)' };
  const low = i.systolic <= 90;
  const lactateHigh = i.lactate !== null && i.lactate >= 2;
  if (low || lactateHigh) {
    const reason = [low ? `systolic ${i.systolic}` : '', lactateHigh ? `lactate ${i.lactate}` : ''].filter(Boolean).join(' and ');
    const n = i.boluses;
    if (n >= 3) return { ...base, key: 'refractory', level: 3, headline: 'No response to fluids: critical care', detail: [`${n} boluses given and still ${reason}.`, 'Further fluid and vasopressors are a critical care decision.'], from: ['redflag.sbp', 'redflag.lactate', 'boluses'] };
    return {
      ...base, key: n === 0 ? 'bolus' : 'repeat', level: 2,
      headline: n === 0 ? '500 mL crystalloid over 15 minutes' : `${['Second', 'Third'][n - 1]} 500 mL bolus, then reassess`,
      detail: [`Because of ${reason}.`, n ? `${n} bolus${n === 1 ? '' : 'es'} given so far. Reassess blood pressure, lactate and urine output after each.` : 'Reassess after each bolus.'],
      from: ['redflag.sbp', 'redflag.lactate', ...(n ? ['boluses'] : [])],
    };
  }
  if (i.lactate === null && redFlags > 0) {
    return { ...base, key: 'measure', level: 1, headline: 'Measure lactate before deciding', detail: ['No lactate in the last 12 hours. A venous gas gives a result in minutes.'], from: ['redflag.lactate'] };
  }
  if (i.lactate === null) {
    return { ...base, key: 'measure-routine', level: 0, headline: 'No bolus indicated; consider a lactate', detail: ['Blood pressure is above 90 and there is no recent lactate.'], from: ['redflag.lactate'] };
  }
  return { ...base, key: 'none', level: 0, headline: 'No bolus indicated', detail: [`Systolic ${i.systolic}, lactate ${i.lactate}. Maintenance fluid if not drinking.`], from: ['redflag.sbp', 'redflag.lactate'] };
}

function oxygen(i: Inputs): Decision {
  const base = { id: 'oxygen' as const, title: 'Oxygen', source: 'BTS oxygen guideline' };
  const [lo, hi] = i.hypercapnicRisk ? [88, 92] : [94, 98];
  const target = `target ${lo} to ${hi}%`;
  const from = ['news2.spo2', 'news2.air', ...(i.hypercapnicRisk ? ['hypercapnic'] : [])];
  if (i.spo2 < lo) return { ...base, key: i.onOxygen ? 'increase' : 'start', level: i.spo2 < lo - 4 ? 2 : 1, headline: i.onOxygen ? `Increase oxygen, ${target}` : `Start oxygen, ${target}`, detail: [`SpO₂ ${i.spo2}% on ${i.onOxygen ? 'oxygen' : 'air'}.`, ...(i.hypercapnicRisk ? ['Controlled oxygen through a Venturi mask; check a blood gas.'] : [])], from };
  if (i.spo2 > hi && i.onOxygen) return { ...base, key: 'reduce', level: i.hypercapnicRisk ? 1 : 0, headline: `Reduce oxygen, ${target}`, detail: [`SpO₂ ${i.spo2}% is above target.${i.hypercapnicRisk ? ' Too much oxygen can raise carbon dioxide.' : ''}`], from };
  return { ...base, key: i.onOxygen ? 'continue' : 'air', level: 0, headline: i.onOxygen ? `Continue oxygen, ${target}` : `Air is enough, ${target}`, detail: [`SpO₂ ${i.spo2}%.`], from };
}

function safety(i: Inputs, abx: Decision, gfr: number | null): Decision {
  const base = { id: 'safety' as const, title: 'Medicine safety', source: 'BNF interactions and renal dosing (simplified)' };
  const notes: string[] = [];
  const from: string[] = [];
  let level: Level = 0;
  const keys: string[] = [];
  if (abx.key === 'high' && i.onStatin) {
    notes.push('Clarithromycin with atorvastatin raises statin levels and the risk of muscle damage. Hold atorvastatin while on clarithromycin.');
    keys.push('statin');
    from.push('antibiotics');
    level = 1;
  }
  if (i.onAntihypertensive && i.systolic < 100) {
    notes.push(`Systolic ${i.systolic}: hold amlodipine until blood pressure recovers.`);
    keys.push('bp');
    from.push('news2.systolic');
    level = 1;
  }
  if (gfr !== null && gfr < 30) {
    notes.push(`eGFR ${Math.round(gfr)}: check renal dosing for the antibiotics before the second dose.`);
    keys.push('renal');
    from.push('kidney');
    level = 1;
  }
  if (i.cannotTakeOral) {
    notes.push('Oral doses may not be absorbed: check for vomited doses and give time-critical medicines by another route.');
    keys.push('oral');
    from.push('oral');
    level = 1;
  }
  if (!notes.length) notes.push('No interaction or dose adjustment found for the medicines in play.');
  const ACTION: Record<string, string> = { statin: 'hold atorvastatin', bp: 'hold amlodipine', renal: 'check renal doses', oral: 'replace vomited doses' };
  const headline = keys.length ? keys.map((k) => ACTION[k]).join(', ') : 'Nothing to act on';
  return { ...base, key: keys.join('+') || 'clear', level, headline: headline[0].toUpperCase() + headline.slice(1), detail: notes, from };
}
