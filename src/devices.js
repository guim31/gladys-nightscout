// -----------------------------------------------------------------------------
// The Gladys device of the Nightscout site, proposed in the Discovery tab (the
// user adds it, nothing is created on their behalf). One site, one device,
// identified by a digest of its address (src/config.js: siteIdOf):
//
//   glucose_mgdl | glucose_mmol   unknown/unknown   the glucose, in the unit of
//                                                   the configuration
//   delta_mgdl | delta_mmol       unknown/unknown   change over 5 minutes
//   trend                         unknown/unknown   1 ↑↑ … 4 → … 7 ↓↓ (Dexcom's)
//   trend_arrow                   text/text         ↑↑ ↑ ↗ → ↘ ↓ ↓↓
//   measurement_age               duration/integer  minutes since the value
//   out_of_range                  input/binary      1 out of the target range
//   uploader_battery              battery/integer   %, when an uploader reports it
//
// The names and units match guim31/gladys-dexcom and gladys-librelinkup. The
// core has neither a glucose category nor a glucose unit: the glucose is an
// `unknown` feature, its unit in its name and in its key, so a change of the
// unit setting adds a feature in the new unit and never mixes two units in one
// history. A device published again never loses a feature it was created
// with: "Update" in Discovery would drop its history.
//
// Health data: no history by default (each feature can be switched on in
// Gladys), never in the logs. Published with should_poll: false: the
// integration reads Nightscout on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { TREND_ARROWS, inUnit } from './glucose.js';

export const DEVICE_TYPE = 'site';
export const MODEL = 'Nightscout';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  GLUCOSE_MGDL: 'glucose_mgdl',
  GLUCOSE_MMOL: 'glucose_mmol',
  DELTA_MGDL: 'delta_mgdl',
  DELTA_MMOL: 'delta_mmol',
  TREND: 'trend',
  TREND_ARROW: 'trend_arrow',
  AGE: 'measurement_age',
  OUT_OF_RANGE: 'out_of_range',
  BATTERY: 'uploader_battery',
});

export const glucoseKey = (unit) =>
  unit === 'mmol' ? FEATURE_KEYS.GLUCOSE_MMOL : FEATURE_KEYS.GLUCOSE_MGDL;
export const deltaKey = (unit) =>
  unit === 'mmol' ? FEATURE_KEYS.DELTA_MMOL : FEATURE_KEYS.DELTA_MGDL;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.GLUCOSE_MGDL]: 'Glucose (mg/dL)',
    [FEATURE_KEYS.GLUCOSE_MMOL]: 'Glucose (mmol/L)',
    [FEATURE_KEYS.DELTA_MGDL]: 'Change over 5 min (mg/dL)',
    [FEATURE_KEYS.DELTA_MMOL]: 'Change over 5 min (mmol/L)',
    [FEATURE_KEYS.TREND]: 'Trend (1 ↑↑, 4 →, 7 ↓↓)',
    [FEATURE_KEYS.TREND_ARROW]: 'Trend arrow',
    [FEATURE_KEYS.AGE]: 'Measurement age',
    [FEATURE_KEYS.OUT_OF_RANGE]: 'Out of target range',
    [FEATURE_KEYS.BATTERY]: 'Uploader battery',
  },
  fr: {
    [FEATURE_KEYS.GLUCOSE_MGDL]: 'Glycémie (mg/dL)',
    [FEATURE_KEYS.GLUCOSE_MMOL]: 'Glycémie (mmol/L)',
    [FEATURE_KEYS.DELTA_MGDL]: 'Variation sur 5 min (mg/dL)',
    [FEATURE_KEYS.DELTA_MMOL]: 'Variation sur 5 min (mmol/L)',
    [FEATURE_KEYS.TREND]: 'Tendance (1 ↑↑, 4 →, 7 ↓↓)',
    [FEATURE_KEYS.TREND_ARROW]: 'Flèche de tendance',
    [FEATURE_KEYS.AGE]: 'Âge de la mesure',
    [FEATURE_KEYS.OUT_OF_RANGE]: 'Hors de la cible',
    [FEATURE_KEYS.BATTERY]: "Batterie de l'uploader",
  },
  de: {
    [FEATURE_KEYS.GLUCOSE_MGDL]: 'Glukose (mg/dL)',
    [FEATURE_KEYS.GLUCOSE_MMOL]: 'Glukose (mmol/L)',
    [FEATURE_KEYS.DELTA_MGDL]: 'Änderung in 5 Min. (mg/dL)',
    [FEATURE_KEYS.DELTA_MMOL]: 'Änderung in 5 Min. (mmol/L)',
    [FEATURE_KEYS.TREND]: 'Trend (1 ↑↑, 4 →, 7 ↓↓)',
    [FEATURE_KEYS.TREND_ARROW]: 'Trendpfeil',
    [FEATURE_KEYS.AGE]: 'Alter des Messwerts',
    [FEATURE_KEYS.OUT_OF_RANGE]: 'Außerhalb des Zielbereichs',
    [FEATURE_KEYS.BATTERY]: 'Akku des Uploaders',
  },
  es: {
    [FEATURE_KEYS.GLUCOSE_MGDL]: 'Glucosa (mg/dL)',
    [FEATURE_KEYS.GLUCOSE_MMOL]: 'Glucosa (mmol/L)',
    [FEATURE_KEYS.DELTA_MGDL]: 'Variación en 5 min (mg/dL)',
    [FEATURE_KEYS.DELTA_MMOL]: 'Variación en 5 min (mmol/L)',
    [FEATURE_KEYS.TREND]: 'Tendencia (1 ↑↑, 4 →, 7 ↓↓)',
    [FEATURE_KEYS.TREND_ARROW]: 'Flecha de tendencia',
    [FEATURE_KEYS.AGE]: 'Antigüedad de la medición',
    [FEATURE_KEYS.OUT_OF_RANGE]: 'Fuera del rango objetivo',
    [FEATURE_KEYS.BATTERY]: 'Batería del uploader',
  },
};

// Display bounds (the core never applies them on write). The delta is signed:
// symmetric bounds.
export const BOUNDS = Object.freeze({
  [FEATURE_KEYS.GLUCOSE_MGDL]: [0, 1000],
  [FEATURE_KEYS.GLUCOSE_MMOL]: [0, 60],
  [FEATURE_KEYS.DELTA_MGDL]: [-200, 200],
  [FEATURE_KEYS.DELTA_MMOL]: [-12, 12],
  [FEATURE_KEYS.TREND]: [0, 9],
  [FEATURE_KEYS.AGE]: [0, 1_000_000],
});

export const siteIds = (gladys, siteId) => gladys.externalIds(DEVICE_TYPE, siteId);

/** Health data: no history by default (the user may turn it on per feature). */
const feature = (ids, key, language, spec) => ({
  name: (NAMES[language] ?? NAMES.en)[key],
  external_id: ids.feature(key),
  read_only: true,
  has_feedback: false,
  keep_history: false,
  ...spec,
});

const number = (ids, key, language) =>
  feature(ids, key, language, {
    category: C.UNKNOWN,
    type: T.UNKNOWN.UNKNOWN,
    min: BOUNDS[key][0],
    max: BOUNDS[key][1],
  });

/** The features of the created device the blueprint lacks, appended (never fewer). */
export function withCreatedFeatures(device, created) {
  if (!created) {
    return device;
  }
  const known = new Set(device.features.map((f) => f.external_id));
  const extra = (created.features ?? []).filter(
    (f) => f && typeof f.external_id === 'string' && !known.has(f.external_id),
  );
  return extra.length === 0 ? device : { ...device, features: [...device.features, ...extra] };
}

/**
 * The discovery payload of the site.
 * @param {object} gladys
 * @param {object} site { id, title, unit ('mgdl'|'mmol'), battery (number|null) }
 * @param {string} language of the feature names
 * @param {object} [created] the device as created in Gladys, if it is
 */
export function buildDevice(gladys, site, language = 'en', created = null) {
  const ids = siteIds(gladys, site.id);
  const features = [
    number(ids, glucoseKey(site.unit), language),
    number(ids, deltaKey(site.unit), language),
    number(ids, FEATURE_KEYS.TREND, language),
    feature(ids, FEATURE_KEYS.TREND_ARROW, language, {
      category: C.TEXT,
      type: T.TEXT.TEXT,
      min: 0,
      max: 0,
    }),
    feature(ids, FEATURE_KEYS.AGE, language, {
      category: C.DURATION,
      type: T.DURATION.INTEGER,
      unit: U.MINUTES,
      min: BOUNDS[FEATURE_KEYS.AGE][0],
      max: BOUNDS[FEATURE_KEYS.AGE][1],
    }),
    feature(ids, FEATURE_KEYS.OUT_OF_RANGE, language, {
      category: C.INPUT,
      type: T.SENSOR.BINARY,
      min: 0,
      max: 1,
    }),
  ];
  if (site.battery !== null && site.battery !== undefined) {
    features.push(
      feature(ids, FEATURE_KEYS.BATTERY, language, {
        category: C.BATTERY,
        type: T.BATTERY.INTEGER,
        unit: U.PERCENT,
        min: 0,
        max: 100,
      }),
    );
  }
  return withCreatedFeatures(
    {
      name: site.title || MODEL,
      external_id: ids.device,
      model: MODEL,
      should_poll: false,
      params: [],
      features,
    },
    created,
  );
}

/**
 * The value of every feature that has one now: `{ key, device_feature_external_id, state|text }`,
 * for both units (the hub keeps those of the created device).
 * @param {object} view the hub's view: reading, delta, fresh, outOfRange, battery
 * @param {number} now
 */
export function deviceValues(gladys, siteId, view, now) {
  const ids = siteIds(gladys, siteId);
  const values = [];
  const { reading } = view;
  if (reading && view.fresh) {
    for (const unit of ['mgdl', 'mmol']) {
      values.push({ key: glucoseKey(unit), state: inUnit(reading.sgv, unit) });
      if (view.delta !== null) {
        const [min, max] = BOUNDS[deltaKey(unit)];
        const delta = Math.min(max, Math.max(min, inUnit(view.delta, unit)));
        // -0 would be published as a change of sign.
        values.push({ key: deltaKey(unit), state: delta === 0 ? 0 : delta });
      }
    }
    values.push({ key: FEATURE_KEYS.TREND, state: reading.trend });
    values.push({ key: FEATURE_KEYS.TREND_ARROW, text: TREND_ARROWS[reading.trend] });
    values.push({ key: FEATURE_KEYS.OUT_OF_RANGE, state: view.outOfRange ? 1 : 0 });
  }
  if (reading) {
    const minutes = Math.max(0, Math.floor((now - reading.date) / 60_000));
    values.push({ key: FEATURE_KEYS.AGE, state: Math.min(minutes, BOUNDS[FEATURE_KEYS.AGE][1]) });
  }
  if (view.battery !== null && view.battery !== undefined) {
    values.push({ key: FEATURE_KEYS.BATTERY, state: view.battery });
  }
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}
