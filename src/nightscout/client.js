// -----------------------------------------------------------------------------
// Nightscout client: the REST API v1 of a Nightscout site (cgm-remote-monitor,
// AGPL-3.0, https://github.com/nightscout/cgm-remote-monitor), checked against
// Nightscout 15.0.8 in Docker (test/fixtures/nightscout):
//
//   GET /api/v1/status.json
//       `settings.units` ("mg/dl" or "mmol"), `settings.thresholds` (bgHigh,
//       bgTargetTop, bgTargetBottom, bgLow: ALWAYS in mg/dL, converted by
//       Nightscout when the site is set in mmol/L), `settings.customTitle`,
//       `version`
//   GET /api/v1/entries/sgv.json?find[date][$gte]=<ms>&count=<n>
//       the glucose values (`sgv`, mg/dL), newest first: `date` (ms),
//       `direction` (DoubleUp … DoubleDown, NONE, NOT COMPUTABLE…)
//   GET /api/v1/devicestatus.json?count=<n>
//       what the uploaders report: `uploader.battery` (xDrip+, AndroidAPS,
//       Loop), `uploaderBattery` (older uploaders)
//
// Authentication: an access token (`?token=`, a subject with the `readable`
// role, made in Nightscout's Admin tools), else the API_SECRET hashed in SHA-1
// in the `api-secret` header, else nothing (a public site,
// AUTH_DEFAULT_ROLES=readable). Redirects are not followed: the secret would
// go wherever the address points. Read only: nothing is ever written.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // 401/403: the token or the secret is missing or refused
  NOT_NIGHTSCOUT: 'not_nightscout', // something answers, not the Nightscout API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  SERVER: 'server', // 5xx: Nightscout or its database (MongoDB) in trouble
  HTTP: 'http', // any other HTTP error
});

export class NightscoutError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'NightscoutError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export const MAX_BODY_BYTES = 2 * 1024 * 1024;

// Nightscout's own defaults (lib/settings.js), when a site gives none.
export const DEFAULT_THRESHOLDS = Object.freeze({
  bgHigh: 260,
  bgTargetTop: 180,
  bgTargetBottom: 80,
  bgLow: 55,
});

// Below 39 mg/dL, a Nightscout `sgv` is an error code of the sensor (no
// antenna, warm-up…), never a glucose: Nightscout itself hides them. 39 and
// 40 are the "LOW" of Dexcom and Libre, kept.
export const MIN_SGV = 39;
export const MAX_SGV = 1000;

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory Nightscout
 * (test/helpers/fakeNightscout.js).
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(url, { headers = {}, timeoutMs = 15_000 } = {}) {
  const response = await fetch(url, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  const body = await response.text();
  if (body.length > MAX_BODY_BYTES) {
    throw new Error('Response too large');
  }
  return { status: response.status, body };
}

/** The `api-secret` header Nightscout expects: the SHA-1 of the API_SECRET. */
export const hashSecret = (secret) => createHash('sha1').update(secret, 'utf8').digest('hex');

const clean = (value, max) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** A threshold of the status, in mg/dL; null when unusable. */
function threshold(value) {
  return Number.isFinite(value) && value >= MIN_SGV && value <= 600 ? value : null;
}

/** The parts of `status.json` the integration uses. */
export function normalizeStatus(data) {
  const settings = data?.settings && typeof data.settings === 'object' ? data.settings : {};
  const raw =
    settings.thresholds && typeof settings.thresholds === 'object' ? settings.thresholds : {};
  const thresholds = {};
  for (const [key, fallback] of Object.entries(DEFAULT_THRESHOLDS)) {
    thresholds[key] = threshold(raw[key]) ?? fallback;
  }
  // An inverted target (a typo in the site variables) falls back as a whole.
  const ordered =
    thresholds.bgLow <= thresholds.bgTargetBottom &&
    thresholds.bgTargetBottom < thresholds.bgTargetTop &&
    thresholds.bgTargetTop <= thresholds.bgHigh;
  return {
    unit: /mmol/i.test(String(settings.units ?? '')) ? 'mmol' : 'mgdl',
    thresholds: ordered ? thresholds : { ...DEFAULT_THRESHOLDS },
    title: clean(settings.customTitle, 60),
    version: clean(data?.version, 30),
  };
}

/**
 * The glucose values of an `entries` answer: valid ones only, newest first,
 * one per date. `direction` is kept as Nightscout writes it.
 * @returns {{ date: number, sgv: number, direction: string }[]}
 */
export function normalizeEntries(data) {
  const seen = new Set();
  const entries = [];
  for (const entry of Array.isArray(data) ? data : []) {
    if (!entry || typeof entry !== 'object' || (entry.type && entry.type !== 'sgv')) {
      continue;
    }
    const sgv = Number(entry.sgv);
    const date = Number(entry.date);
    if (!Number.isFinite(sgv) || sgv < MIN_SGV || sgv > MAX_SGV || !Number.isFinite(date)) {
      continue;
    }
    if (date <= 0 || seen.has(date)) {
      continue;
    }
    seen.add(date);
    entries.push({ date, sgv: Math.round(sgv), direction: clean(entry.direction, 30) });
  }
  return entries.sort((a, b) => b.date - a.date);
}

/** The newest uploader battery of a `devicestatus` answer, null when none. */
export function batteryOf(data) {
  for (const status of Array.isArray(data) ? data : []) {
    const value = status?.uploader?.battery ?? status?.uploaderBattery;
    const battery = Number(value);
    if (value !== undefined && value !== null && Number.isFinite(battery)) {
      if (battery >= 0 && battery <= 100) {
        return Math.round(battery);
      }
    }
  }
  return null;
}

export class NightscoutClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.token] access token (readable role)
   * @param {string} [options.apiSecret] the API_SECRET, used when no token
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, token = '', apiSecret = '', request = httpRequest, timeoutMs = 15_000 }) {
    this.url = url;
    this.token = token;
    this.secretHash = !token && apiSecret ? hashSecret(apiSecret) : null;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  async call(path) {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this.url}${path}${this.token ? `${separator}token=${encodeURIComponent(this.token)}` : ''}`;
    try {
      return await this.request(url, {
        headers: {
          accept: 'application/json',
          ...(this.secretHash ? { 'api-secret': this.secretHash } : {}),
        },
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new NightscoutError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      // Never the URL: it may carry the token.
      throw new NightscoutError(ERROR_KINDS.UNREACHABLE, code ?? err.name ?? 'No answer');
    }
  }

  /** The parsed JSON of a GET. */
  async json(path) {
    const { status, body } = await this.call(path);
    if (status === 401 || status === 403) {
      throw new NightscoutError(ERROR_KINDS.AUTH, `Access refused (HTTP ${status})`, { status });
    }
    if (status >= 300 && status < 400) {
      throw new NightscoutError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new NightscoutError(ERROR_KINDS.NOT_NIGHTSCOUT, 'No Nightscout API here (HTTP 404)', {
        status,
      });
    }
    if (status >= 500) {
      throw new NightscoutError(ERROR_KINDS.SERVER, `Nightscout error (HTTP ${status})`, {
        status,
      });
    }
    if (status < 200 || status >= 300) {
      throw new NightscoutError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, {
        status,
      });
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new NightscoutError(ERROR_KINDS.NOT_NIGHTSCOUT, 'The answer is not JSON');
    }
  }

  /** Units, thresholds, title and version of the site. */
  async status() {
    const data = await this.json('/api/v1/status.json');
    if (!data || typeof data !== 'object' || !data.settings) {
      throw new NightscoutError(
        ERROR_KINDS.NOT_NIGHTSCOUT,
        'The answer is not a Nightscout status',
      );
    }
    return normalizeStatus(data);
  }

  /**
   * The glucose values since `since` (ms), newest first.
   * @param {number} since
   * @param {number} [count] at most this many (a 1-minute CGM sends 180 in 3 h)
   */
  async entries(since, count = 400) {
    const query = `find[date][$gte]=${Math.floor(since)}&count=${count}`;
    const data = await this.json(`/api/v1/entries/sgv.json?${query}`);
    if (!Array.isArray(data)) {
      throw new NightscoutError(ERROR_KINDS.NOT_NIGHTSCOUT, 'The answer is not a list of entries');
    }
    return normalizeEntries(data);
  }

  /** The newest one, whatever its age (a site silent for days); null if none. */
  async latest() {
    const data = await this.json('/api/v1/entries/sgv.json?count=1');
    return normalizeEntries(data)[0] ?? null;
  }

  /** The battery of the uploader (phone), null when not reported. */
  async battery() {
    return batteryOf(await this.json('/api/v1/devicestatus.json?count=10'));
  }
}
