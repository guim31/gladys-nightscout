// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake Nightscout (real answers of
// Nightscout 15.0.8): discovery, states, units, staleness, scene events and
// their persistence across restarts, errors, the scene action, the widget,
// quiet logs, and the reading timer of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  API_SECRET,
  BASE,
  FakeNightscout,
  TOKEN,
  createClock,
  createDevices,
  createWorld,
  idsOf,
} from './helpers/world.js';

const MINUTE = 60_000;
const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const featureKeys = (device) =>
  device.features.map((feature) => feature.external_id.split(':').pop());

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

/** A new value `minutes` later, then a read. */
async function next(world, sgv, direction, minutes = 5) {
  world.clock.advance(minutes * MINUTE);
  world.nightscout.add(sgv, direction, world.clock.now());
  await world.hub.pollNow();
}

test('one device for the site, in the unit of the site, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const [device] = world.fake.discoveredDevices;
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(device.external_id, idsOf(world).device);
  assert.equal(device.name, 'Nightscout');
  assert.equal(device.should_poll, false);
  assert.deepEqual(featureKeys(device), [
    FEATURE_KEYS.GLUCOSE_MGDL,
    FEATURE_KEYS.DELTA_MGDL,
    FEATURE_KEYS.TREND,
    FEATURE_KEYS.TREND_ARROW,
    FEATURE_KEYS.AGE,
    FEATURE_KEYS.OUT_OF_RANGE,
    FEATURE_KEYS.BATTERY,
  ]);
  // Health data: no history unless the user turns it on.
  assert.ok(device.features.every((feature) => feature.keep_history === false));
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('the states of the added device: the fast fall of the fixture', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  // Nothing published before the device is added: Gladys would drop it.
  assert.equal(world.fake.states.length, 0);
  await createDevices(world);
  const ids = idsOf(world);
  const state = (key) => world.fake.lastState(ids.feature(key));
  assert.equal(state(FEATURE_KEYS.GLUCOSE_MGDL), 56);
  assert.equal(state(FEATURE_KEYS.DELTA_MGDL), -12);
  assert.equal(state(FEATURE_KEYS.TREND), 7);
  assert.equal(state(FEATURE_KEYS.TREND_ARROW), '↓↓');
  assert.equal(state(FEATURE_KEYS.AGE), 1);
  assert.equal(state(FEATURE_KEYS.OUT_OF_RANGE), 1);
  assert.equal(state(FEATURE_KEYS.BATTERY), 76);
  // Only the features of the device: none in mmol/L.
  assert.equal(state(FEATURE_KEYS.GLUCOSE_MMOL), undefined);
  assert.deepEqual(world.fake.transports.at(-1), {
    device_external_id: ids.device,
    // 192.0.2.10 is not a private address: a hosted site.
    transport: 'cloud',
  });
  assert.deepEqual(world.fake.widgetRefreshes.at(-1), WIDGET_KEY);

  // A value in range: only what changed is sent.
  const before = world.fake.states.length;
  await next(world, 120, 'Flat');
  const sent = world.fake.states
    .slice(before)
    .map((s) => s.device_feature_external_id.split(':').pop());
  assert.ok(sent.includes(FEATURE_KEYS.GLUCOSE_MGDL));
  assert.ok(!sent.includes(FEATURE_KEYS.BATTERY));
  assert.equal(state(FEATURE_KEYS.OUT_OF_RANGE), 0);
  assert.equal(state(FEATURE_KEYS.AGE), 0);
});

test('mmol/L: a public site in mmol/L, then the unit changed to mg/dL', async (t) => {
  const nightscout = new FakeNightscout();
  nightscout.useMmolSite();
  const world = await createWorld({ nightscout, config: { url: BASE, language: 'fr' } });
  t.after(() => world.app.stop());
  const [device] = world.fake.discoveredDevices;
  assert.ok(featureKeys(device).includes(FEATURE_KEYS.GLUCOSE_MMOL));
  assert.equal(device.features[0].name, 'Glycémie (mmol/L)');
  await createDevices(world);
  const ids = idsOf(world);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.GLUCOSE_MMOL)), 3.1);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.DELTA_MMOL)), -0.7);

  // mg/dL chosen: the device offered keeps its mmol/L features and gets the mg/dL ones.
  await world.fake.configUpdated({ url: BASE, language: 'fr', glucose_unit: 'mgdl' });
  const keys = featureKeys(world.fake.discoveredDevices[0]);
  assert.ok(keys.includes(FEATURE_KEYS.GLUCOSE_MMOL) && keys.includes(FEATURE_KEYS.GLUCOSE_MGDL));
  await createDevices(world);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.GLUCOSE_MGDL)), 56);
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.GLUCOSE_MMOL)), 3.1);
});

test('the API_SECRET when there is no token; a refused access is said', async (t) => {
  const world = await createWorld({ config: { url: BASE, api_secret: API_SECRET } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.ok(world.nightscout.calls.every((call) => call.headers['api-secret']));

  const refused = await createWorld({ config: { url: BASE } });
  t.after(() => refused.app.stop());
  assert.equal(refused.fake.connectionStatus.connected, false);
  assert.match(refused.fake.connectionStatus.message.en, /access token or the API_SECRET/);
  assert.deepEqual(refused.fake.discoveredDevices, []);
});

test('a value older than the delay: glucose and trend no longer published, its age is', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const ids = idsOf(world);
  const before = world.fake.states.length;
  world.clock.advance(20 * MINUTE);
  await world.hub.pollNow();
  const sent = world.fake.states.slice(before);
  assert.deepEqual(
    sent.map((s) => s.device_feature_external_id.split(':').pop()),
    [FEATURE_KEYS.AGE],
  );
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.AGE)), 21);
  const ack = await world.fake.sceneAction('get_glucose', {});
  assert.equal(ack.data.outputs.current, false);
  assert.match(ack.data.outputs.sentence, /Last glucose 56 mg\/dL, 21 min ago \(not current\)/);
  // Nothing in the last three hours: the newest value tells the age anyway.
  world.clock.advance(5 * 60 * MINUTE);
  await world.hub.pollNow();
  assert.equal(world.fake.lastState(ids.feature(FEATURE_KEYS.AGE)), 321);
});

test('scene events: crossings once, not at the first reading, not again after a restart', async (t) => {
  const clock = createClock();
  const nightscout = new FakeNightscout();
  const world = await createWorld({ clock, nightscout });
  // The fall of the fixture is below every low threshold: the first reading
  // records it, it does not announce it.
  assert.deepEqual(world.fake.sceneEvents, []);
  await next(world, 50, 'DoubleDown');
  assert.deepEqual(
    world.fake.sceneEvents.map((e) => `${e.key}:${e.data.threshold}`),
    ['glucose_very_low:nightscout', 'glucose_very_low:54'],
  );
  const [veryLow] = world.fake.sceneEvents;
  assert.deepEqual(veryLow.data, {
    device: idsOf(world).device,
    threshold: 'nightscout',
    device_name: 'Nightscout',
    glucose: 50,
    unit: 'mg/dL',
    trend: 7,
    trend_arrow: '↓↓',
    delta: -5,
    measured_at: new Date(clock.now()).toISOString(),
  });
  await world.app.stop();

  // A restart of the integration: still low, nothing announced twice.
  const again = await createWorld({ clock, nightscout, dataDir: world.dataDir });
  t.after(() => again.app.stop());
  await next(again, 48, 'SingleDown');
  assert.deepEqual(again.fake.sceneEvents, []);
  // Back up, in the target range of the site.
  await next(again, 100, 'DoubleUp');
  assert.deepEqual(
    again.fake.sceneEvents.map((e) => e.key),
    [TRIGGERS.RISING, TRIGGERS.RISING, TRIGGERS.IN_RANGE],
  );
  const saved = JSON.parse(readFileSync(join(world.dataDir, 'nightscout-state.json'), 'utf8'));
  assert.equal(typeof saved.site, 'string');
  assert.ok(!JSON.stringify(saved).includes('100'), 'no glucose value in /data');
});

test('Nightscout down: unreachable badge and status, "too old" still fires, back again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.nightscout.down = true;
  world.clock.advance(16 * MINUTE);
  await world.hub.pollNow();
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(world.fake.connectionStatus.message.fr, 'Nightscout ne répond pas');
  assert.deepEqual(
    events(world, TRIGGERS.STALE).map((e) => e.data.minutes),
    ['15'],
  );
  assert.equal(events(world, TRIGGERS.STALE)[0].data.stale_for, 17);
  const widget = await world.fake.widgetGet(WIDGET_KEY, { language: 'en' });
  assert.ok(widget.data.content.components.some((c) => c.text === 'Nightscout does not answer'));
  world.nightscout.down = false;
  await next(world, 130, 'Flat');
  assert.equal(world.fake.transports.at(-1).transport, 'cloud');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a site on the local network gets the local badge', async (t) => {
  const nightscout = new FakeNightscout();
  const url = 'http://192.168.1.20:1337';
  const request = (target, options) => nightscout.request(target.replace(url, BASE), options);
  const world = await createWorld({ connect: false, config: { url, access_token: TOKEN } });
  world.hub.request = request;
  await world.gladys.connect();
  await world.app.ready;
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

test('the scene action: glucose, trend and a sentence in the language of the configuration', async (t) => {
  const world = await createWorld({ config: { url: BASE, access_token: TOKEN, language: 'fr' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_glucose', {});
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    glucose: 56,
    unit: 'mg/dL',
    trend: 7,
    trend_arrow: '↓↓',
    delta: -12,
    age_minutes: 1,
    current: true,
    out_of_range: true,
    measured_at: new Date(world.nightscout.entries[0].date).toISOString(),
    sentence: 'Glycémie 56 mg/dL ↓↓ -12, il y a 1 min',
  });
  world.nightscout.down = true;
  world.clock.advance(MINUTE);
  const failed = await world.fake.sceneAction('get_glucose', {});
  assert.equal(failed.success, false);
  assert.match(failed.error, /Nightscout ne répond pas/);
});

test('the widget: tiles, the 3-hour curve, a caption, within the budget', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { language });
    assert.equal(ack.success, true, ack.error);
    const content = ack.data.content;
    assert.deepEqual(validateWidgetContent(content), [], language);
    assert.ok(content.components.length <= 8);
    assert.ok(content.components.filter((c) => c.type === 'text').length <= 2);
    for (const tile of content.components.filter((c) => c.type === 'value')) {
      assert.ok(String(tile.value).length <= 12, `${language}: ${tile.value}`);
      assert.ok(tile.label.length <= 24, `${language}: ${tile.label}`);
    }
    const chart = content.components.find((c) => c.type === 'chart');
    // The values of the last three hours: 36 of the 37 of the fixture.
    assert.equal(chart.series[0].points.length, 36);
    assert.ok(chart.series[0].points[0].t < chart.series[0].points.at(-1).t, 'oldest first');
  }
  const en = (await world.fake.widgetGet(WIDGET_KEY, { language: 'en' })).data.content.components;
  assert.deepEqual(
    en.filter((c) => c.type === 'value').map((c) => [c.value, c.color]),
    [
      ['56', 'warning'],
      ['↓↓ -12', 'warning'],
      ['1 min ago', 'neutral'],
    ],
  );
  assert.equal(en[0].text, 'Not a medical device');
  const refreshed = await world.fake.widgetAction(WIDGET_KEY, 'refresh');
  assert.equal(refreshed.success, true);
  // Not configured: one sentence.
  const empty = await createWorld({ config: {} });
  t.after(() => empty.app.stop());
  const message = await empty.fake.widgetGet(WIDGET_KEY, { language: 'fr' });
  assert.match(message.data.content.components[0].text, /Saisissez l'adresse/);
});

test('"Test the connection" tells the version, the target and the last value', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection');
  assert.equal(
    ack.data.message.en,
    'Nightscout: Connected · v15.0.8, target 80–180 mg/dL · Glucose 56 mg/dL ↓↓ -12, 1 min ago',
  );
  assert.match(ack.data.message.fr, /^Nightscout : Connecté · v15\.0\.8, cible 80–180 mg\/dL/);
});

test('quiet logs: a normal reading writes nothing at info, no token nor glucose ever', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  // Still low and falling: no crossing, nothing to say.
  const lines = await captureLogs(t, 'info', () => next(world, 57, 'SingleDown'));
  assert.deepEqual(lines, []);
  const debug = await captureLogs(t, 'debug', async () => {
    await next(world, 60, 'DoubleDown');
    world.nightscout.down = true;
    await next(world, 61, 'Flat');
  });
  const all = debug.join('\n');
  assert.ok(!all.includes(TOKEN), 'no token in the logs');
  assert.ok(!/\b60 mg|"sgv"/.test(all), 'no glucose value in the logs');
});

test('the timer of the container reads Nightscout, without onPoll', async (t) => {
  const world = await createWorld({
    timers: true,
    config: { url: BASE, access_token: TOKEN, poll_interval: '60' },
  });
  t.after(() => world.app.stop());
  const calls = world.nightscout.calls.length;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  world.hub.schedulePoll(5);
  t.mock.timers.tick(10);
  t.mock.timers.reset();
  await new Promise((resolve) => setImmediate(resolve));
  await world.hub.polling;
  assert.ok(world.nightscout.calls.length > calls, 'read by the timer');
});
