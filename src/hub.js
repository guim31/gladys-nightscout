// -----------------------------------------------------------------------------
// The Nightscout hub: the site read on a timer of the container (every 1 to 5
// minutes, as configured); the states of the device published when they
// change, the scene events fired on crossings (src/alarms.js), and the views
// the widget and the scene action read.
//
// Gladys never polls the device (should_poll: false): the timer of the
// container reads the site whether the device was added or not, so the scene
// triggers work either way (Gladys 5.2.0 never polls a device created without
// should_poll, GladysAssistant/Gladys#3198, and the triggers must not depend
// on it).
//
// One reading: status.json (unit, thresholds, title), the values of the last
// three hours (the widget's curve, the delta), and the uploader battery
// (optional: a failure there costs only the battery). The trigger state is
// kept in /data (src/store.js).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { TRIGGERS, emptyAlarmState, evaluate, loadAlarmState } from './alarms.js';
import { hostOf, isPrivateHost, normalizeConfig, siteIdOf } from './config.js';
import { buildDevice, deviceValues, siteIds } from './devices.js';
import {
  TREND_ARROWS,
  UNIT_LABELS,
  deltaOf,
  formatDelta,
  formatGlucose,
  inUnit,
  isOutOfRange,
  trendOf,
} from './glucose.js';
import { ERROR_KINDS, NightscoutClient, NightscoutError } from './nightscout/client.js';
import { ProblemLog } from './problems.js';
import {
  CONNECTION_TEXT,
  DATA_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  SENTENCE_TEXT,
  ageText,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'nightscout-hub' });

export const WIDGET_KEY = 'glucose';
export { TRIGGERS };

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads Nightscout again when the last read is older.
  freshMs: 30_000,
  // The window of values read: the widget's curve.
  windowMs: 3 * 3600_000,
};

// Variables of the scene triggers (manifest), per kind.
const GLUCOSE_VARIABLES = [
  'device_name',
  'glucose',
  'unit',
  'trend',
  'trend_arrow',
  'delta',
  'measured_at',
];
const STALE_VARIABLES = ['device_name', 'stale_for', 'measured_at'];

export class NightscoutHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/nightscout/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    this.siteId = null;
    this.resetData();
    this.saved = { site: null, alarms: emptyAlarmState() };
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.pollTimer = null;
    this.stopped = false;
    this.problems = new ProblemLog(logger);
  }

  resetData() {
    this.status = null;
    /** @type {{ date: number, sgv: number, direction: string }[]} newest first */
    this.entries = [];
    this.battery = null;
    this.readAt = 0;
    this.error = null;
    this.polling = null;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      site: typeof saved.site === 'string' ? saved.site : null,
      alarms: loadAlarmState(saved.alarms),
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const signature = JSON.stringify([config.url, config.token, config.apiSecret]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.siteId = config.url ? siteIdOf(config.url) : null;
      if (this.siteId && this.saved.site !== this.siteId) {
        // Another site: the trigger state of the previous one means nothing.
        this.saved = { site: this.siteId, alarms: emptyAlarmState() };
        this.store.save(this.saved);
      }
      this.client = config.url
        ? new NightscoutClient({
            url: config.url,
            token: config.token,
            apiSecret: config.apiSecret,
            request: this.request,
          })
        : null;
      this.resetData();
    }
    if (previous.language !== config.language || previous.unit !== config.unit) {
      this.discovered = null; // new names or a new unit for the Discovery tab
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  /** The next read by the timer, after `delayMs` (the refresh interval by default). */
  schedulePoll(delayMs = this.config.pollIntervalMs) {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Nightscout works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, delayMs);
  }

  // --- Reading Nightscout ----------------------------------------------------

  /** Read the site now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs` (scene action). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read the site and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let status;
    let entries;
    try {
      status = await client.status();
      entries = await client.entries(this.now() - this.timings.windowMs);
      if (entries.length === 0) {
        // Nothing in three hours: the newest value tells how old the data is.
        const latest = await client.latest();
        entries = latest ? [latest] : [];
      }
    } catch (err) {
      if (!(err instanceof NightscoutError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    let battery = this.battery;
    try {
      battery = await client.battery();
      this.problems.recover('battery', 'Uploader battery read again');
    } catch (err) {
      // Optional: an older site, or a proxy rule, costs only the battery.
      this.problems.fail('battery', `Uploader battery not read: ${err.message}`, 'debug');
    }
    if (client !== this.client) {
      return false;
    }
    return this.applySuccess(status, entries, battery);
  }

  async applySuccess(status, entries, battery) {
    const previousDate = this.entries[0]?.date ?? null;
    let widgetChanged =
      this.error !== null ||
      this.readAt === 0 ||
      entries[0]?.date !== previousDate ||
      JSON.stringify(status) !== JSON.stringify(this.status);
    if (this.error) {
      logger.info('Nightscout answers again');
    }
    if (this.readAt === 0) {
      logger.info(
        `Nightscout ${status.version || ''} (${hostOf(this.config.url)}): ${status.unit === 'mmol' ? 'mmol/L' : 'mg/dL'}`,
      );
    }
    this.error = null;
    this.readAt = this.now();
    this.status = status;
    this.entries = entries;
    this.battery = battery;
    await this.runAlarms();
    await this.publishStates();
    return widgetChanged;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Nightscout: ${err.message}`);
    }
    // No new value can be seen: "no measurement for N minutes" still counts.
    await this.runAlarms();
    return wasError !== err.kind;
  }

  // --- Views -----------------------------------------------------------------

  /** The unit values are shown and published in. */
  get unit() {
    if (this.config.unit !== 'auto') {
      return this.config.unit;
    }
    return this.status?.unit ?? 'mgdl';
  }

  /** The newest value with its trend number, null when none. */
  get reading() {
    const entry = this.entries[0];
    return entry ? { date: entry.date, sgv: entry.sgv, trend: trendOf(entry.direction) } : null;
  }

  /** Everything the device, the widget and the scene action show. */
  view() {
    const reading = this.reading;
    const now = this.now();
    const fresh = Boolean(reading) && now - reading.date <= this.config.staleMs;
    const thresholds = this.status?.thresholds ?? null;
    return {
      reading,
      fresh,
      delta: fresh ? deltaOf(this.entries) : null,
      outOfRange: reading && thresholds ? isOutOfRange(reading.sgv, thresholds) : null,
      ageMinutes: reading ? Math.max(0, Math.floor((now - reading.date) / 60_000)) : null,
      battery: this.battery,
      thresholds,
      unit: this.unit,
    };
  }

  /** "142 mg/dL" in the language. */
  glucoseText(sgv, language) {
    const unit = this.unit;
    return `${formatGlucose(inUnit(sgv, unit), unit, language)} ${UNIT_LABELS[unit]}`;
  }

  /** "Glucose 142 mg/dL → +3, 4 min ago", or why there is none. */
  sentence(language) {
    const view = this.view();
    if (!view.reading) {
      return pick(DATA_TEXT.none, language);
    }
    const text = SENTENCE_TEXT[language] ?? SENTENCE_TEXT.en;
    const glucose = this.glucoseText(view.reading.sgv, language);
    const ago = ageText(view.ageMinutes, language);
    if (!view.fresh) {
      return text.stale(glucose, ago);
    }
    const trend = [
      TREND_ARROWS[view.reading.trend],
      view.delta === null ? null : formatDelta(inUnit(view.delta, view.unit), view.unit, language),
    ]
      .filter(Boolean)
      .join(' ');
    return text.current(glucose, trend, ago);
  }

  // --- Scene events ------------------------------------------------------------

  async runAlarms() {
    const reading = this.reading;
    const thresholds = this.status?.thresholds;
    if (!this.siteId || !thresholds) {
      return;
    }
    const { state, events } = evaluate(this.saved.alarms, {
      reading,
      thresholds,
      now: this.now(),
      staleMs: this.config.staleMs,
    });
    if (JSON.stringify(state) !== JSON.stringify(this.saved.alarms)) {
      this.saved = { site: this.siteId, alarms: state };
      // Written on a change only: no wear of the SD card at every read.
      this.store.save(this.saved);
    }
    for (const [key, level] of events) {
      await this.fire(key, level);
    }
  }

  /** The data of a scene event: the declared fields and variables only. */
  eventData(key, level) {
    const view = this.view();
    const { reading } = view;
    const unit = view.unit;
    const all = {
      device: siteIds(this.gladys, this.siteId).device,
      device_name: this.deviceName(),
      glucose: reading ? inUnit(reading.sgv, unit) : 0,
      unit: UNIT_LABELS[unit],
      trend: reading?.trend ?? 0,
      trend_arrow: TREND_ARROWS[reading?.trend ?? 0],
      delta: view.delta === null ? 0 : inUnit(view.delta, unit),
      measured_at: reading ? new Date(reading.date).toISOString() : '',
      stale_for: view.ageMinutes ?? 0,
    };
    const keys = key === TRIGGERS.STALE ? STALE_VARIABLES : GLUCOSE_VARIABLES;
    return {
      device: all.device,
      ...level,
      ...Object.fromEntries(keys.map((name) => [name, all[name]])),
    };
  }

  async fire(key, level) {
    const data = this.eventData(key, level);
    logger.info(
      `Scene event ${key}${Object.values(level).length ? ` (${Object.values(level)})` : ''}`,
    );
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------

  deviceName() {
    return this.status?.title || 'Nightscout';
  }

  createdDevice() {
    if (!this.siteId) {
      return null;
    }
    const externalId = siteIds(this.gladys, this.siteId).device;
    return (this.gladys.devices ?? []).find((device) => device.external_id === externalId) ?? null;
  }

  discoveredDevices() {
    if (!this.client || this.readAt === 0 || this.error || !this.status) {
      return null; // nothing read: keep the list Gladys has
    }
    return [
      buildDevice(
        this.gladys,
        { id: this.siteId, title: this.status.title, unit: this.unit, battery: this.battery },
        this.config.language,
        this.createdDevice(),
      ),
    ];
  }

  /** Publish the Discovery list when it changed (the unit, the battery…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Nightscout, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) the device: its states sent before were
   * dropped by Gladys, and a device deleted then added again needs its badge.
   */
  async onDeviceCreated(device) {
    this.transports.delete(device.external_id);
    this.discovered = null;
    await this.publishStates();
    await this.publishTransports();
    await this.publishDevices();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the created device, its own features only (a state for a
   * feature it lacks is dropped by Gladys with a log line). The SDK skips the
   * values Gladys already has, and sends an unchanged one after `heartbeatMs`.
   */
  async publishStates() {
    const created = this.createdDevice();
    if (!created || this.readAt === 0 || this.error) {
      return;
    }
    const own = new Set((created.features ?? []).map((feature) => feature.external_id));
    const states = deviceValues(this.gladys, this.siteId, this.view(), this.now())
      .filter((value) => own.has(value.device_feature_external_id))
      .map(({ key: _key, ...state }) => state);
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the device: local or cloud by the address, or unreachable. */
  async publishTransports() {
    const created = this.createdDevice();
    if (!this.client || this.readAt === 0 || !created) {
      return;
    }
    let transport = DEVICE_TRANSPORTS.UNREACHABLE;
    if (!this.error) {
      transport = isPrivateHost(new URL(this.config.url).hostname)
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.CLOUD;
    }
    if (this.transports.get(created.external_id) === transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([{ external_id: created.external_id, transport }]);
      this.transports.set(created.external_id, transport);
      this.problems.recover('transports', 'Transports accepted again');
    } catch (err) {
      this.problems.fail('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (this.config.url === '') {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands ----------------------------------------------------------------

  /** Throws the reason Nightscout cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** "Test the connection": read Nightscout now, one line per language. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    const status = this.connectionStatus();
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const { bgTargetBottom, bgTargetTop } = this.status.thresholds;
      const unit = this.unit;
      const target = text.thresholds(
        formatGlucose(inUnit(bgTargetBottom, unit), unit, language),
        `${formatGlucose(inUnit(bgTargetTop, unit), unit, language)} ${UNIT_LABELS[unit]}`,
      );
      const parts = [
        text.ok,
        `${this.status.version ? `v${this.status.version}, ` : ''}${target}`,
        this.sentence(language),
      ];
      message[language] = labelled('Nightscout', parts.join(' · '), language);
    }
    return message;
  }
}

export { ERROR_KINDS };
