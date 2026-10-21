// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is the glucose above 180?" is already a scene condition on the device
// feature. The action is about what a condition cannot do: put the glucose,
// its trend and its age in a message ("Glucose 142 mg/dL → +3, 4 min ago")
// for a Telegram message or a spoken announcement, from the device added to
// Gladys or not. It reads Nightscout again when the last read is older than
// 30 seconds.
// -----------------------------------------------------------------------------

import { TREND_ARROWS, UNIT_LABELS, inUnit } from './glucose.js';
import { DATA_TEXT, pick } from './texts.js';

async function readable(hub) {
  // An error of the last reading is not final: read again first.
  if (!hub.client) {
    hub.assertReadable();
  }
  if (hub.error) {
    await hub.pollNow();
  } else {
    await hub.refreshIfStale();
  }
  hub.assertReadable();
}

export const SCENE_ACTIONS = {
  async get_glucose(hub) {
    await readable(hub);
    const language = hub.config.language;
    const view = hub.view();
    if (!view.reading) {
      throw new Error(pick(DATA_TEXT.none, language));
    }
    const { reading, unit } = view;
    return {
      glucose: inUnit(reading.sgv, unit),
      unit: UNIT_LABELS[unit],
      trend: reading.trend,
      trend_arrow: TREND_ARROWS[reading.trend],
      delta: view.delta === null ? 0 : inUnit(view.delta, unit),
      age_minutes: view.ageMinutes,
      current: view.fresh,
      out_of_range: view.outOfRange === true,
      measured_at: new Date(reading.date).toISOString(),
      sentence: hub.sentence(language),
    };
  },
};
