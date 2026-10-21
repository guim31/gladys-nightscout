// -----------------------------------------------------------------------------
// Glucose arithmetic, independent of Gladys: units, trend numbers and arrows,
// the 5-minute delta, the target range. The trend numbers and arrows are the
// ones of guim31/gladys-dexcom (pydexcom's): Nightscout writes the same
// direction names as Dexcom Share, so a scene reads them the same way.
// -----------------------------------------------------------------------------

/** mg/dL per mmol/L (molar mass of glucose, 180.156 g/mol). */
export const MG_PER_MMOL = 18.0156;

export const UNIT_LABELS = Object.freeze({ mgdl: 'mg/dL', mmol: 'mmol/L' });

/**
 * Nightscout directions and their numbers: 0 none, 1 rising quickly … 4
 * steady … 7 falling quickly, 8 not computable, 9 rate out of range.
 */
export const TREND_DIRECTIONS = Object.freeze({
  NONE: 0,
  DoubleUp: 1,
  SingleUp: 2,
  FortyFiveUp: 3,
  Flat: 4,
  FortyFiveDown: 5,
  SingleDown: 6,
  DoubleDown: 7,
  'NOT COMPUTABLE': 8,
  'RATE OUT OF RANGE': 9,
});

/** The arrow of each trend number; "-" when none. */
export const TREND_ARROWS = Object.freeze(['-', '↑↑', '↑', '↗', '→', '↘', '↓', '↓↓', '?', '-']);

/** The trend number of a Nightscout direction (0 when unknown or absent). */
export const trendOf = (direction) => TREND_DIRECTIONS[direction] ?? 0;

/** A value in mg/dL in the unit: whole mg/dL, or mmol/L to one decimal. */
export function inUnit(mgdl, unit) {
  return unit === 'mmol' ? Math.round((mgdl / MG_PER_MMOL) * 10) / 10 : Math.round(mgdl);
}

/** "142", "7,9" in French, German and Spanish. */
export function formatGlucose(value, unit, language) {
  const text = unit === 'mmol' ? value.toFixed(1) : String(value);
  return language === 'en' ? text : text.replace('.', ',');
}

/** "+8", "-0,4", "±0". */
export function formatDelta(value, unit, language) {
  if (value === 0) {
    return '±0';
  }
  return `${value > 0 ? '+' : '-'}${formatGlucose(Math.abs(value), unit, language)}`;
}

// The previous value a delta is computed from: 2 to 15 minutes older (a CGM
// sends every 1 to 5 minutes; beyond, a value is missing and the delta would
// say nothing).
const DELTA_MIN_GAP_MS = 2 * 60_000;
const DELTA_MAX_GAP_MS = 15 * 60_000;

/**
 * The change of the glucose over 5 minutes, in mg/dL, as Nightscout shows it
 * ("+8"): from the newest value 2 to 15 minutes older than the last, scaled
 * to 5 minutes. Null when there is none.
 * @param {{ date: number, sgv: number }[]} entries newest first
 */
export function deltaOf(entries) {
  const [last, ...older] = entries;
  if (!last) {
    return null;
  }
  const previous = older.find(
    (entry) =>
      last.date - entry.date >= DELTA_MIN_GAP_MS && last.date - entry.date <= DELTA_MAX_GAP_MS,
  );
  if (!previous) {
    return null;
  }
  return ((last.sgv - previous.sgv) * 5 * 60_000) / (last.date - previous.date);
}

/** Whether a value (mg/dL) is out of the target range of the site. */
export const isOutOfRange = (sgv, thresholds) =>
  sgv < thresholds.bgTargetBottom || sgv > thresholds.bgTargetTop;

/**
 * The range level of a value, for colors: 'urgent_low', 'low', 'in_range',
 * 'high', 'urgent_high' (Nightscout's thresholds).
 */
export function rangeOf(sgv, thresholds) {
  if (sgv < thresholds.bgLow) {
    return 'urgent_low';
  }
  if (sgv < thresholds.bgTargetBottom) {
    return 'low';
  }
  if (sgv > thresholds.bgHigh) {
    return 'urgent_high';
  }
  if (sgv > thresholds.bgTargetTop) {
    return 'high';
  }
  return 'in_range';
}
