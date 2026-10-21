// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `glucose`.
//
// The use case: a glance at the wall tablet or the phone tells the glucose of
// the person followed, where it goes and how fresh it is — the parent of a
// child with type 1 diabetes, at night. Three tiles (glucose colored by the
// range of the site, arrow and 5-minute change, age), the curve of the last
// three hours, a line when there is no current value, a Refresh button. A
// caption repeats that it is not a medical device.
//
// The figures are sent as values, not bound to device features: the widget
// works before the device is added, and without history in Gladys (health
// data: none by default).
//
// Budget (8 components, 2 texts, 1 focal): caption, three tiles, the chart,
// one body text when needed, the button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  TREND_ARROWS,
  UNIT_LABELS,
  formatDelta,
  formatGlucose,
  inUnit,
  rangeOf,
} from './glucose.js';
import { WIDGET_KEY } from './hub.js';
import { CONNECTION_TEXT, DATA_TEXT, ERROR_TEXT, ageText, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const TEXT = {
  pick: {
    en: 'Enter the address of your Nightscout site in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre site Nightscout dans la configuration de l'intégration.",
    de: 'Gib die Adresse deiner Nightscout-Seite in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su sitio Nightscout en la configuración de la integración.',
  },
  glucose: { en: 'Glucose', fr: 'Glycémie', de: 'Glukose', es: 'Glucosa' },
  trend: { en: 'Trend', fr: 'Tendance', de: 'Trend', es: 'Tendencia' },
  age: { en: 'Measured', fr: 'Mesurée il y a', de: 'Gemessen vor', es: 'Medida hace' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Nightscout read again.',
    fr: 'Nightscout relu.',
    de: 'Nightscout neu gelesen.',
    es: 'Nightscout leído de nuevo.',
  },
};

const RANGE_COLORS = {
  urgent_low: WIDGET_COLORS.DANGER,
  low: WIDGET_COLORS.WARNING,
  in_range: WIDGET_COLORS.SUCCESS,
  high: WIDGET_COLORS.WARNING,
  urgent_high: WIDGET_COLORS.DANGER,
};

// The chart admits 300 points: a 1-minute CGM sends 180 in three hours.
const MAX_POINTS = 300;

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The age tile: "4 min" with "Measured" in English ("4 min ago" is too long). */
const ageValue = (minutes, language) => {
  const text = ageText(minutes, language);
  return language === 'en' ? `${text} ago` : text;
};

async function get(hub, { language = 'en' }) {
  if (!hub.client) {
    return message(hub.config.url === null ? CONNECTION_TEXT.invalidUrl : TEXT.pick, language);
  }
  const view = hub.view();
  const { reading, unit } = view;
  const components = [
    { type: 'text', variant: 'caption', text: pick(DATA_TEXT.notMedical, language) },
  ];
  if (reading) {
    const value = inUnit(reading.sgv, unit);
    components.push({
      type: 'value',
      value: formatGlucose(value, unit, language),
      unit: UNIT_LABELS[unit],
      label: pick(TEXT.glucose, language),
      icon: 'droplet',
      color:
        view.fresh && view.thresholds
          ? RANGE_COLORS[rangeOf(reading.sgv, view.thresholds)]
          : WIDGET_COLORS.NEUTRAL,
    });
    if (view.fresh) {
      const delta =
        view.delta === null ? '' : formatDelta(inUnit(view.delta, unit), unit, language);
      components.push({
        type: 'value',
        value: `${TREND_ARROWS[reading.trend]} ${delta}`.trim(),
        label: pick(TEXT.trend, language),
        icon: 'trending-up',
        color: [1, 7].includes(reading.trend) ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({
      type: 'value',
      value: ageValue(view.ageMinutes, language),
      label: pick(TEXT.age, language),
      icon: 'clock',
      color: view.fresh ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.WARNING,
    });
  }
  const points = hub.entries
    .slice(0, MAX_POINTS)
    .reverse()
    .map((entry) => ({ t: new Date(entry.date).toISOString(), v: inUnit(entry.sgv, unit) }));
  if (points.length > 1 && view.fresh) {
    components.push({
      type: 'chart',
      chart_type: 'line',
      unit: UNIT_LABELS[unit],
      series: [{ name: pick(TEXT.glucose, language), points }],
    });
  }
  let body = null;
  if (hub.error) {
    body = ERROR_TEXT[hub.error.kind];
  } else if (!reading) {
    body = DATA_TEXT.none;
  } else if (!view.fresh) {
    body = DATA_TEXT.stale;
  }
  if (body) {
    components.push({ type: 'text', variant: 'body', text: pick(body, language) });
  }
  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });
  // Pulled again within a minute: the next value is never far.
  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  if (hub.error) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
