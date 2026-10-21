// -----------------------------------------------------------------------------
// An in-memory Nightscout site for the tests, started from the real answers of
// Nightscout 15.0.8 in Docker (test/fixtures/nightscout): three hours of
// 5-minute values ending with a fast fall (150 → 56 mg/dL, DoubleDown), an
// uploader battery at 76 %, thresholds 55 / 80 / 180 / 260, mg/dL.
//
// Access as configured on a real site with AUTH_DEFAULT_ROLES=denied: a
// readable token (`?token=`) or the API_SECRET hashed in `api-secret`; 401
// otherwise, the body of the real 401. `public = true` opens it.
// The tests change it (`add(sgv, direction, time)`, `down = true`,
// `statuses['/api/v1/status.json'] = 500`) and read it through `request`, the
// HTTP seam of the client.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { hashSecret } from '../../src/nightscout/client.js';

export const BASE = 'http://192.0.2.10:1337';
export const TOKEN = 'gladys-0123456789abcdef';
export const API_SECRET = 'not-a-real-secret-123';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/nightscout/${name}`, import.meta.url), 'utf8'));

const ENTRIES = fixture('entries-window.json');
// The time of the fixtures: one minute after the newest value.
export const LAST_VALUE_TIME = ENTRIES[0].date;
export const FIXTURE_TIME = LAST_VALUE_TIME + 60_000;

export class FakeNightscout {
  constructor() {
    this.status = fixture('status.json');
    this.entries = structuredClone(ENTRIES);
    this.devicestatus = fixture('devicestatus.json');
    this.public = false;
    this.down = false;
    /** @type {Record<string, number>} forced HTTP statuses, by path prefix */
    this.statuses = {};
    this.calls = [];
    this.request = this.request.bind(this);
  }

  /** Switch to the mmol/L site of the fixtures (public, thresholds converted). */
  useMmolSite() {
    this.status = fixture('status-mmol-public.json');
    this.public = true;
  }

  /** A new value, as an uploader posts it. */
  add(sgv, direction, date) {
    this.entries.unshift({
      _id: `fake${date}`,
      type: 'sgv',
      sgv,
      direction,
      date,
      dateString: new Date(date).toISOString(),
      device: 'xDrip-DexcomG6',
    });
  }

  authorized(url, headers) {
    if (this.public) {
      return true;
    }
    const token = new URL(url).searchParams.get('token');
    return token === TOKEN || headers['api-secret'] === hashSecret(API_SECRET);
  }

  async request(url, { headers = {} } = {}) {
    this.calls.push({ url, headers });
    if (this.down || !url.startsWith(`${BASE}/`)) {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    const parsed = new URL(url);
    const path = parsed.pathname;
    for (const [prefix, status] of Object.entries(this.statuses)) {
      if (path.startsWith(prefix)) {
        return { status, body: '{"status":500,"message":"error"}' };
      }
    }
    if (!path.startsWith('/api/v1/')) {
      return { status: 404, body: 'Cannot GET' };
    }
    if (!this.authorized(url, headers)) {
      return { status: 401, body: JSON.stringify(fixture('unauthorized.json')) };
    }
    const count = Number(parsed.searchParams.get('count') ?? 10);
    if (path === '/api/v1/status.json') {
      return { status: 200, body: JSON.stringify(this.status) };
    }
    if (path === '/api/v1/entries/sgv.json') {
      const since = Number(parsed.searchParams.get('find[date][$gte]') ?? 0);
      const list = this.entries.filter((entry) => entry.date >= since).slice(0, count);
      return { status: 200, body: JSON.stringify(list) };
    }
    if (path === '/api/v1/devicestatus.json') {
      return { status: 200, body: JSON.stringify(this.devicestatus.slice(0, count)) };
    }
    return { status: 404, body: 'Cannot GET' };
  }
}
