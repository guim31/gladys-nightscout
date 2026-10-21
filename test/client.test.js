// -----------------------------------------------------------------------------
// The Nightscout client and the pure helpers, on the real answers of
// Nightscout 15.0.8 (test/fixtures/nightscout): status, entries, devicestatus,
// address parsing, units, trend, delta, the trigger state machine.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyAlarmState, evaluate, loadAlarmState, TRIGGERS } from '../src/alarms.js';
import { isPrivateHost, normalizeConfig, parseServerUrl, siteIdOf } from '../src/config.js';
import { deltaOf, formatDelta, formatGlucose, inUnit, rangeOf, trendOf } from '../src/glucose.js';
import {
  DEFAULT_THRESHOLDS,
  ERROR_KINDS,
  NightscoutClient,
  batteryOf,
  hashSecret,
  normalizeEntries,
  normalizeStatus,
} from '../src/nightscout/client.js';
import { API_SECRET, BASE, FakeNightscout, TOKEN } from './helpers/fakeNightscout.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/nightscout/${name}`, import.meta.url), 'utf8'));

test('status: unit, thresholds in mg/dL even on a mmol/L site, title, version', () => {
  assert.deepEqual(normalizeStatus(fixture('status.json')), {
    unit: 'mgdl',
    thresholds: { bgHigh: 260, bgTargetTop: 180, bgTargetBottom: 80, bgLow: 55 },
    title: 'Nightscout',
    version: '15.0.8',
  });
  // BG_TARGET_TOP=10 on a mmol/L site: Nightscout converts to 180 mg/dL.
  const mmol = normalizeStatus(fixture('status-mmol-public.json'));
  assert.equal(mmol.unit, 'mmol');
  assert.deepEqual(mmol.thresholds, {
    bgHigh: 252,
    bgTargetTop: 180,
    bgTargetBottom: 70,
    bgLow: 54,
  });
  // Missing or inverted thresholds: Nightscout's defaults.
  assert.deepEqual(normalizeStatus({ settings: {} }).thresholds, DEFAULT_THRESHOLDS);
  const inverted = { settings: { thresholds: { ...DEFAULT_THRESHOLDS, bgTargetBottom: 200 } } };
  assert.deepEqual(normalizeStatus(inverted).thresholds, DEFAULT_THRESHOLDS);
});

test('entries: valid sgv only, newest first, one per date', () => {
  const entries = normalizeEntries(fixture('entries-window.json'));
  assert.equal(entries.length, 37);
  assert.deepEqual(entries[0], { date: 1792569038293, sgv: 56, direction: 'DoubleDown' });
  const mixed = normalizeEntries([
    { type: 'sgv', sgv: 5, date: 3 }, // a sensor error code
    { type: 'mbg', mbg: 120, date: 4 }, // a finger stick
    { type: 'sgv', sgv: 39, date: 1, direction: 'NONE' }, // Dexcom's LOW
    { sgv: '120', date: 2 },
    { sgv: 121, date: 2 },
  ]);
  assert.deepEqual(
    mixed.map((entry) => entry.sgv),
    [120, 39],
  );
});

test('devicestatus: the newest uploader battery, null without one', () => {
  assert.equal(batteryOf(fixture('devicestatus.json')), 76);
  assert.equal(batteryOf([{ pump: {} }, { uploaderBattery: 41 }]), 41);
  assert.equal(batteryOf([{ openaps: {} }]), null);
  assert.equal(batteryOf([{ uploader: { battery: 140 } }]), null);
});

test('authentication: the token in the query, else the hashed secret, else nothing', async () => {
  const nightscout = new FakeNightscout();
  const withToken = new NightscoutClient({
    url: BASE,
    token: TOKEN,
    apiSecret: API_SECRET,
    request: nightscout.request,
  });
  await withToken.status();
  assert.match(nightscout.calls.at(-1).url, /\?token=gladys-0123456789abcdef$/);
  assert.equal(nightscout.calls.at(-1).headers['api-secret'], undefined);

  const withSecret = new NightscoutClient({
    url: BASE,
    apiSecret: API_SECRET,
    request: nightscout.request,
  });
  await withSecret.entries(0);
  assert.equal(nightscout.calls.at(-1).headers['api-secret'], hashSecret(API_SECRET));
  assert.ok(!nightscout.calls.at(-1).url.includes('token'));

  const none = new NightscoutClient({ url: BASE, request: nightscout.request });
  await assert.rejects(none.status(), { kind: ERROR_KINDS.AUTH });
  const wrong = new NightscoutClient({
    url: BASE,
    token: 'gladys-ffffffffffffffff',
    request: nightscout.request,
  });
  await assert.rejects(wrong.status(), { kind: ERROR_KINDS.AUTH });
  nightscout.public = true;
  assert.equal((await none.status()).unit, 'mgdl');
});

test('errors by kind, never with the token', async () => {
  const nightscout = new FakeNightscout();
  const client = new NightscoutClient({ url: BASE, token: TOKEN, request: nightscout.request });
  nightscout.statuses['/api/v1/status.json'] = 503;
  await assert.rejects(client.status(), { kind: ERROR_KINDS.SERVER });
  nightscout.statuses = {};
  const elsewhere = new NightscoutClient({
    url: `${BASE}/other`,
    token: TOKEN,
    request: nightscout.request,
  });
  await assert.rejects(elsewhere.status(), { kind: ERROR_KINDS.NOT_NIGHTSCOUT });
  nightscout.down = true;
  await assert.rejects(client.status(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.UNREACHABLE);
    assert.ok(!err.message.includes(TOKEN));
    return true;
  });
  const redirect = new NightscoutClient({
    url: BASE,
    request: async () => ({ status: 301, body: '' }),
  });
  await assert.rejects(redirect.status(), { kind: ERROR_KINDS.REDIRECT });
  const tls = new NightscoutClient({
    url: BASE,
    request: async () => {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } });
    },
  });
  await assert.rejects(tls.status(), { kind: ERROR_KINDS.TLS });
  const html = new NightscoutClient({
    url: BASE,
    request: async () => ({ status: 200, body: '<html>' }),
  });
  await assert.rejects(html.status(), { kind: ERROR_KINDS.NOT_NIGHTSCOUT });
});

test('addresses: bare hosts, copied URLs, pasted tokens', () => {
  assert.deepEqual(parseServerUrl('my-site.example.org'), {
    url: 'https://my-site.example.org',
    token: '',
  });
  assert.deepEqual(parseServerUrl('192.0.2.10:1337'), { url: 'http://192.0.2.10:1337', token: '' });
  assert.deepEqual(parseServerUrl('nightscout:1337'), { url: 'http://nightscout:1337', token: '' });
  assert.deepEqual(parseServerUrl('https://my-site.example.org/api/v1/?token=gladys-1234'), {
    url: 'https://my-site.example.org',
    token: 'gladys-1234',
  });
  assert.deepEqual(parseServerUrl('https://example.org/ns/report'), {
    url: 'https://example.org/ns',
    token: '',
  });
  assert.equal(parseServerUrl('ftp://example.org'), null);
  assert.equal(parseServerUrl('https://user:pass@example.org'), null);
  const config = normalizeConfig({
    url: 'https://my-site.example.org?token=gladys-1234',
    access_token: '',
  });
  assert.equal(config.token, 'gladys-1234');
  assert.equal(normalizeConfig({ url: 'x', access_token: ' gladys-9 ' }).token, 'gladys-9');
  assert.equal(normalizeConfig({ url: 'ftp://x' }).url, null);
  assert.equal(normalizeConfig({}).url, '');
  // The device survives http -> https.
  assert.equal(siteIdOf('http://example.org/ns'), siteIdOf('https://example.org/ns'));
});

test('local or cloud, by the host', () => {
  for (const host of [
    '192.168.1.2',
    '10.0.0.5',
    '172.20.0.1',
    'nightscout',
    'ns.local',
    'fd00::1',
    '100.64.1.1',
  ]) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ['my-site.example.org', '198.51.100.7', '2001:db8::1']) {
    assert.equal(isPrivateHost(host), false, host);
  }
});

test('units, trend, delta, range', () => {
  assert.equal(inUnit(142, 'mgdl'), 142);
  assert.equal(inUnit(142, 'mmol'), 7.9);
  assert.equal(formatGlucose(7.9, 'mmol', 'fr'), '7,9');
  assert.equal(formatGlucose(8, 'mmol', 'en'), '8.0');
  assert.equal(formatDelta(-0.4, 'mmol', 'de'), '-0,4');
  assert.equal(formatDelta(0, 'mgdl', 'en'), '±0');
  assert.equal(trendOf('DoubleDown'), 7);
  assert.equal(trendOf('NOT COMPUTABLE'), 8);
  assert.equal(trendOf(undefined), 0);
  const t0 = 10_000_000;
  // 1-minute values: the delta is still per 5 minutes.
  assert.equal(
    deltaOf([
      { date: t0, sgv: 120 },
      { date: t0 - 60_000, sgv: 119 },
      { date: t0 - 120_000, sgv: 118 },
    ]),
    5,
  );
  assert.equal(
    deltaOf([
      { date: t0, sgv: 120 },
      { date: t0 - 40 * 60_000, sgv: 100 },
    ]),
    null,
  );
  assert.equal(rangeOf(50, DEFAULT_THRESHOLDS), 'urgent_low');
  assert.equal(rangeOf(150, DEFAULT_THRESHOLDS), 'in_range');
  assert.equal(rangeOf(200, DEFAULT_THRESHOLDS), 'high');
});

test('triggers: once per crossing, hysteresis, gap, baseline, stale', () => {
  const thresholds = DEFAULT_THRESHOLDS;
  const staleMs = 15 * 60_000;
  const minute = 60_000;
  let state = emptyAlarmState();
  const step = (sgv, trend, at) => {
    const result = evaluate(state, {
      reading: { date: at, sgv, trend },
      thresholds,
      now: at,
      staleMs,
    });
    state = result.state;
    return result.events.map(([key, level]) => `${key}:${Object.values(level).join('')}`);
  };
  // Baseline: a high going on is recorded, not announced.
  assert.deepEqual(step(200, 4, 0), []);
  assert.deepEqual(step(150, 4, 5 * minute), [TRIGGERS.IN_RANGE + ':']);
  assert.deepEqual(step(75, 6, 10 * minute), [
    'glucose_low:nightscout',
    'glucose_low:80',
    'glucose_falling_fast:1',
  ]);
  // Up 3 mg/dL, still under 80 + 5: no new event (hysteresis).
  assert.deepEqual(step(78, 5, 15 * minute), []);
  assert.deepEqual(step(68, 7, 20 * minute), ['glucose_low:70', 'glucose_falling_fast:2']);
  // A gap longer than the delay: still low, announced again.
  assert.deepEqual(step(72, 4, 60 * minute), ['glucose_low:nightscout', 'glucose_low:80']);
  // Back up 5 mg/dL over 80, then down again: once more.
  assert.deepEqual(step(90, 4, 65 * minute), [TRIGGERS.IN_RANGE + ':']);
  assert.deepEqual(step(78, 4, 70 * minute), ['glucose_low:nightscout', 'glucose_low:80']);
  // Silence: one event per stale threshold, the next value arms them again.
  const silent = evaluate(state, {
    reading: null,
    thresholds,
    now: 70 * minute + 31 * minute,
    staleMs,
  });
  assert.deepEqual(
    silent.events.map(([key, level]) => `${key}:${level.minutes}`),
    ['measurement_stale:15', 'measurement_stale:30'],
  );
  assert.deepEqual(
    evaluate(silent.state, { reading: null, thresholds, now: 70 * minute + 32 * minute, staleMs })
      .events,
    [],
  );
  // A saved state survives the file, a damaged one never stops the triggers.
  assert.deepEqual(loadAlarmState(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(
    loadAlarmState({ reached: { glucose_low: ['999', 'nightscout'] }, lastDate: 'x' }).reached
      .glucose_low,
    ['nightscout'],
  );
});

test('triggers: an old value arriving late fires nothing but arms the stale ones again', () => {
  const thresholds = DEFAULT_THRESHOLDS;
  const staleMs = 15 * 60_000;
  let state = evaluate(emptyAlarmState(), {
    reading: { date: 0, sgv: 120, trend: 4 },
    thresholds,
    now: 0,
    staleMs,
  }).state;
  const result = evaluate(state, {
    reading: { date: 60 * 60_000, sgv: 40, trend: 7 },
    thresholds,
    now: 90 * 60_000,
    staleMs,
  });
  assert.deepEqual(
    result.events.map(([key, level]) => `${key}:${level.minutes}`),
    ['measurement_stale:15', 'measurement_stale:30'],
  );
  state = result.state;
  assert.equal(state.lastDate, 60 * 60_000);
});

test('triggers: no flood on the edge of the target, nor from a late uploader, nor after an outage', () => {
  const thresholds = DEFAULT_THRESHOLDS;
  const staleMs = 15 * 60_000;
  const minute = 60_000;
  let state = evaluate(emptyAlarmState(), {
    reading: { date: 0, sgv: 120, trend: 4 },
    thresholds,
    now: 0,
    staleMs,
  }).state;
  const fired = [];
  const step = (sgv, at, { now = at, previousDate = null } = {}) => {
    const result = evaluate(state, {
      reading: { date: at, sgv, trend: 4 },
      previousDate,
      thresholds,
      now,
      staleMs,
    });
    state = result.state;
    fired.push(...result.events.map(([key, level]) => `${key}:${Object.values(level).join('')}`));
  };
  // Hovering on the low target: one low, no "back in range" until 85.
  for (const [index, sgv] of [79, 81, 79, 81, 79, 81].entries()) {
    step(sgv, (index + 1) * 5 * minute);
  }
  assert.deepEqual(fired, ['glucose_low:nightscout', 'glucose_low:80']);
  step(90, 35 * minute);
  assert.deepEqual(fired.slice(2), ['glucose_in_range:']);

  // An uploader 20 minutes late: "too old" (15) once, not at every value.
  fired.length = 0;
  for (let i = 0; i < 4; i += 1) {
    const at = (40 + i * 5) * minute;
    step(120, at, { now: at + 20 * minute, previousDate: at - 5 * minute });
  }
  assert.deepEqual(fired, ['measurement_stale:15']);

  // Nightscout down 30 minutes while the sensor kept sending every 5 minutes:
  // still low afterwards, but no gap in the data, so no new event.
  fired.length = 0;
  step(70, 80 * minute, { previousDate: 75 * minute });
  assert.deepEqual(fired, ['glucose_low:nightscout', 'glucose_low:80']);
  fired.length = 0;
  step(68, 115 * minute, { previousDate: 110 * minute });
  assert.deepEqual(fired, ['glucose_low:70']);
});

test('triggers without thresholds (nothing read since a restart): "too old" only', () => {
  const saved = { ...emptyAlarmState(), lastDate: 0 };
  const result = evaluate(saved, {
    reading: null,
    thresholds: null,
    now: 31 * 60_000,
    staleMs: 15 * 60_000,
  });
  assert.deepEqual(
    result.events.map(([, level]) => level.minutes),
    ['15', '30'],
  );
});
