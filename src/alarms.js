// -----------------------------------------------------------------------------
// The scene triggers, as a pure function of the last measurement: which ones
// fire, once per crossing. Kept in /data by the hub (src/store.js), so a
// restart neither misses a crossing nor announces one twice.
//
// The core's scene filters only compare for equality: a trigger with a
// threshold field fires once per threshold crossed, with that threshold in
// its data, and the scene keeps the one it chose (as guim31/gladys-dexcom).
//
//   glucose_low / glucose_very_low   a current value below the threshold;
//                                    armed again 5 mg/dL above it
//   glucose_high                     a current value above the threshold;
//                                    armed again 5 mg/dL below it
//   glucose_in_range                 a current value back in the target range
//                                    of the site, after one out of it
//   glucose_rising_fast / _falling_  the trend reaches ↑ (or ↑↑ only); armed
//                                    again once it is steady or reversed
//   measurement_stale                no new value for N minutes; armed again
//                                    by the next value
//
// "Current": not older than the delay of the configuration. A value arriving
// after a gap longer than that arms every glucose trigger again: a low still
// there after hours without data is announced again. The first reading after
// an installation (no saved state) only records what is crossed: a high going
// on for an hour is not news.
// -----------------------------------------------------------------------------

import { isOutOfRange } from './glucose.js';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  LOW: 'glucose_low',
  VERY_LOW: 'glucose_very_low',
  HIGH: 'glucose_high',
  IN_RANGE: 'glucose_in_range',
  RISING: 'glucose_rising_fast',
  FALLING: 'glucose_falling_fast',
  STALE: 'measurement_stale',
});

// The options of the threshold fields (manifest), permanent once published.
// `nightscout`: the threshold set in the site (status.json).
export const LEVELS = Object.freeze({
  [TRIGGERS.LOW]: ['nightscout', '70', '80'],
  [TRIGGERS.VERY_LOW]: ['nightscout', '54'],
  [TRIGGERS.HIGH]: ['nightscout', 'nightscout_urgent', '180', '250', '300'],
  [TRIGGERS.RISING]: ['1', '2'],
  [TRIGGERS.FALLING]: ['1', '2'],
  [TRIGGERS.STALE]: ['15', '30', '60', '120', '240'],
});

// The field of the event data that holds the level, per trigger.
export const LEVEL_FIELDS = Object.freeze({
  [TRIGGERS.LOW]: 'threshold',
  [TRIGGERS.VERY_LOW]: 'threshold',
  [TRIGGERS.HIGH]: 'threshold',
  [TRIGGERS.RISING]: 'arrows',
  [TRIGGERS.FALLING]: 'arrows',
  [TRIGGERS.STALE]: 'minutes',
});

export const HYSTERESIS_MGDL = 5;

const GLUCOSE_TRIGGERS = [TRIGGERS.VERY_LOW, TRIGGERS.LOW, TRIGGERS.HIGH];
const TREND_TRIGGERS = [TRIGGERS.RISING, TRIGGERS.FALLING];

/** The threshold of a level, in mg/dL. */
export function thresholdOf(trigger, level, thresholds) {
  if (level === 'nightscout') {
    if (trigger === TRIGGERS.LOW) return thresholds.bgTargetBottom;
    if (trigger === TRIGGERS.VERY_LOW) return thresholds.bgLow;
    return thresholds.bgTargetTop;
  }
  if (level === 'nightscout_urgent') {
    return thresholds.bgHigh;
  }
  return Number(level);
}

/** Whether a trend number reaches a level: ↑ or ↑↑ for '1', ↑↑ only for '2'. */
function reaches(trigger, level, trend) {
  if (trigger === TRIGGERS.RISING) {
    return level === '2' ? trend === 1 : trend === 1 || trend === 2;
  }
  return level === '2' ? trend === 7 : trend === 6 || trend === 7;
}

/** Whether the trend is steady or reversed: the trigger is armed again. */
function rearms(trigger, trend) {
  return trigger === TRIGGERS.RISING ? trend >= 4 && trend <= 7 : trend >= 1 && trend <= 4;
}

export function emptyAlarmState() {
  return {
    lastDate: null,
    outOfRange: null,
    reached: Object.fromEntries(Object.keys(LEVELS).map((key) => [key, []])),
  };
}

/** A saved state, checked: a damaged file never stops the triggers. */
export function loadAlarmState(saved) {
  const state = emptyAlarmState();
  if (!saved || typeof saved !== 'object') {
    return state;
  }
  if (Number.isFinite(saved.lastDate)) {
    state.lastDate = saved.lastDate;
  }
  if (typeof saved.outOfRange === 'boolean') {
    state.outOfRange = saved.outOfRange;
  }
  for (const [key, levels] of Object.entries(LEVELS)) {
    const list = saved.reached?.[key];
    state.reached[key] = Array.isArray(list) ? list.filter((level) => levels.includes(level)) : [];
  }
  return state;
}

/**
 * Compare the newest measurement with the state; returns the new state and
 * the events to fire, `[trigger, { level field: level }]`.
 * @param {object} state from emptyAlarmState / loadAlarmState (not changed)
 * @param {object} options
 * @param {{ date: number, sgv: number, trend: number }|null} options.reading newest value
 * @param {object} options.thresholds of the site (mg/dL)
 * @param {number} options.now
 * @param {number} options.staleMs delay after which a value is not current
 */
export function evaluate(state, { reading, thresholds, now, staleMs }) {
  const next = structuredClone(state);
  const events = [];
  // Nothing saved: this first reading sets the state, without events.
  const baseline = state.lastDate === null;
  const fire = (trigger, level) => {
    next.reached[trigger].push(level);
    if (!baseline) {
      events.push([trigger, { [LEVEL_FIELDS[trigger]]: level }]);
    }
  };

  if (reading && (state.lastDate === null || reading.date > state.lastDate)) {
    next.reached[TRIGGERS.STALE] = [];
    if (state.lastDate !== null && reading.date - state.lastDate > staleMs) {
      // After a gap, what is still crossed is announced again.
      for (const trigger of [...GLUCOSE_TRIGGERS, ...TREND_TRIGGERS]) {
        next.reached[trigger] = [];
      }
    }
    next.lastDate = reading.date;
    if (now - reading.date <= staleMs) {
      const { sgv, trend } = reading;
      for (const trigger of GLUCOSE_TRIGGERS) {
        const below = trigger !== TRIGGERS.HIGH;
        for (const level of LEVELS[trigger]) {
          const limit = thresholdOf(trigger, level, thresholds);
          const reached = next.reached[trigger].includes(level);
          const crossed = below ? sgv < limit : sgv > limit;
          const back = below ? sgv >= limit + HYSTERESIS_MGDL : sgv <= limit - HYSTERESIS_MGDL;
          if (crossed && !reached) {
            fire(trigger, level);
          } else if (back && reached) {
            next.reached[trigger] = next.reached[trigger].filter((item) => item !== level);
          }
        }
      }
      for (const trigger of TREND_TRIGGERS) {
        for (const level of LEVELS[trigger]) {
          const reached = next.reached[trigger].includes(level);
          if (reaches(trigger, level, trend) && !reached) {
            fire(trigger, level);
          } else if (reached && rearms(trigger, trend)) {
            next.reached[trigger] = next.reached[trigger].filter((item) => item !== level);
          }
        }
      }
      const out = isOutOfRange(sgv, thresholds);
      if (state.outOfRange === true && !out && !baseline) {
        events.push([TRIGGERS.IN_RANGE, {}]);
      }
      next.outOfRange = out;
    }
  }

  if (next.lastDate !== null) {
    const age = now - next.lastDate;
    for (const level of LEVELS[TRIGGERS.STALE]) {
      if (age >= Number(level) * 60_000 && !next.reached[TRIGGERS.STALE].includes(level)) {
        fire(TRIGGERS.STALE, level);
      }
    }
  }
  return { state: next, events };
}
