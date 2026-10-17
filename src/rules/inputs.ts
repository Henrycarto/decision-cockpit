/**
 * What the rules read: the patient's values at a decision moment, taken from her record,
 * and the ranges the what-if controls allow.
 */
import type { Consciousness } from '../clinical/news2';
import { EVENTS, PATIENT } from '../record/record';
import { at } from '../record/time';
import { obsAtOrBefore } from '../record/vitals';

export interface Inputs {
  respRate: number;
  spo2: number;
  onOxygen: boolean;
  systolic: number;
  diastolic: number;
  pulse: number;
  consciousness: Consciousness;
  temp: number;
  lactate: number | null;
  urea: number | null;
  creatinine: number | null;
  boluses: number; // 500 mL fluid boluses already given
  cannotTakeOral: boolean;
  penicillinAllergy: boolean;
  hypercapnicRisk: boolean;
  age: number;
  sex: 'F' | 'M';
  onStatin: boolean;
  onAntihypertensive: boolean;
}

export type NumericKey = 'respRate' | 'spo2' | 'systolic' | 'diastolic' | 'pulse' | 'temp' | 'lactate' | 'urea' | 'creatinine' | 'boluses';
export type ToggleKey = 'onOxygen' | 'cannotTakeOral' | 'penicillinAllergy' | 'hypercapnicRisk';
export type InputKey = NumericKey | ToggleKey | 'consciousness';

export interface NumericDef {
  key: NumericKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  group: 'vitals' | 'labs' | 'care';
}

export const NUMERIC: NumericDef[] = [
  { key: 'respRate', label: 'Respiration', unit: '/min', min: 6, max: 40, step: 1, group: 'vitals' },
  { key: 'spo2', label: 'SpO₂', unit: '%', min: 80, max: 100, step: 1, group: 'vitals' },
  { key: 'systolic', label: 'Systolic BP', unit: 'mmHg', min: 60, max: 200, step: 1, group: 'vitals' },
  { key: 'diastolic', label: 'Diastolic BP', unit: 'mmHg', min: 30, max: 120, step: 1, group: 'vitals' },
  { key: 'pulse', label: 'Pulse', unit: '/min', min: 30, max: 180, step: 1, group: 'vitals' },
  { key: 'temp', label: 'Temperature', unit: '°C', min: 34, max: 41, step: 0.1, group: 'vitals' },
  { key: 'lactate', label: 'Lactate', unit: 'mmol/L', min: 0.5, max: 8, step: 0.1, group: 'labs' },
  { key: 'urea', label: 'Urea', unit: 'mmol/L', min: 1, max: 30, step: 0.1, group: 'labs' },
  { key: 'creatinine', label: 'Creatinine', unit: 'µmol/L', min: 40, max: 400, step: 1, group: 'labs' },
  { key: 'boluses', label: 'Fluid boluses given', unit: '× 500 mL', min: 0, max: 4, step: 1, group: 'care' },
];

export const TOGGLES: Array<{ key: ToggleKey; label: string }> = [
  { key: 'onOxygen', label: 'On oxygen' },
  { key: 'cannotTakeOral', label: 'Cannot take oral medicines' },
  { key: 'penicillinAllergy', label: 'Penicillin allergy' },
  { key: 'hypercapnicRisk', label: 'Risk of hypercapnic respiratory failure' },
];

export const CONSCIOUSNESS: Array<[Consciousness, string]> = [
  ['alert', 'Alert'],
  ['new-confusion', 'New confusion'],
  ['voice', 'Responds to voice'],
  ['pain', 'Responds to pain'],
  ['unresponsive', 'Unresponsive'],
];

/** The moments in her record when a decision was made, and the note that records it. */
export interface Moment {
  id: string;
  label: string;
  t: number;
  noteId: string;
  cannotTakeOral: boolean;
}

export const MOMENTS: Moment[] = [
  { id: 'ed', label: 'Mon 15:40, emergency department', t: at(0, '15:40'), noteId: 'ed-review', cannotTakeOral: false },
  { id: 'news6', label: 'Tue 23:35, NEWS2 6', t: at(1, '23:35'), noteId: 'news6', cannotTakeOral: true },
  { id: 'sepsis', label: 'Wed 00:05, sepsis screen', t: at(2, '00:05'), noteId: 'sepsis', cannotTakeOral: true },
  { id: 'registrar', label: 'Wed 01:10, registrar at the bedside', t: at(2, '01:10'), noteId: 'registrar', cannotTakeOral: true },
];

/** A lactate older than this no longer describes the patient; the rules treat it as not measured. */
export const LACTATE_FRESH = 12 * 60;

export interface Measured {
  staleLactate?: number; // the last value, when it is too old to use
  lactate?: number; // minute each lab value was taken
  urea?: number;
  creatinine?: number;
  obs?: number;
}

/** The values the team had in front of them at minute t, and when each was measured. */
export function inputsAt(t: number, m?: Pick<Moment, 'cannotTakeOral'>): { inputs: Inputs; measured: Measured } {
  const o = obsAtOrBefore(t);
  if (!o) throw new Error('no observations yet');
  const lab = (row: string) => EVENTS.filter((e) => e.row === row && e.t <= t).pop();
  const lactate = lab('lactate');
  const urea = lab('urea');
  const creatinine = lab('creatinine');
  const boluses = EVENTS.filter((e) => e.row === 'fluids' && e.kind === 'infusion' && e.t <= t).length;
  return {
    inputs: {
      respRate: o.v.respRate,
      spo2: o.v.spo2,
      onOxygen: o.v.onOxygen,
      systolic: o.v.systolic,
      diastolic: o.v.diastolic,
      pulse: o.v.pulse,
      consciousness: o.v.consciousness,
      temp: o.v.temp,
      lactate: lactate && t - lactate.t <= LACTATE_FRESH ? lactate.value! : null,
      urea: urea?.value ?? null,
      creatinine: creatinine?.value ?? null,
      boluses,
      cannotTakeOral: m?.cannotTakeOral ?? false,
      penicillinAllergy: false,
      hypercapnicRisk: false,
      age: PATIENT.age,
      sex: 'F',
      onStatin: true,
      onAntihypertensive: true,
    },
    measured: {
      lactate: lactate?.t,
      staleLactate: lactate && t - lactate.t > LACTATE_FRESH ? lactate.value : undefined,
      urea: urea?.t,
      creatinine: creatinine?.t,
      obs: o.t,
    },
  };
}
