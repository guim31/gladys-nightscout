// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Nightscout site: its address, an access token or the API_SECRET (or
// nothing for a public site), the glucose unit, how often it is read, and
// after how many minutes a measurement no longer counts as current.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// `auto`: the unit of the Nightscout site (its DISPLAY_UNITS).
export const UNITS = ['auto', 'mgdl', 'mmol'];

// Refresh intervals offered in the configuration, in seconds. A CGM sends a
// value every 1 to 5 minutes.
export const POLL_INTERVALS = ['60', '120', '300'];

// Minutes after which the last measurement is no longer current: its glucose
// and trend are not published, and no glucose trigger fires from it.
export const STALE_AFTER = ['10', '15', '20', '30', '60'];

export const DEFAULT_CONFIG = {
  url: '',
  access_token: '',
  api_secret: '',
  glucose_unit: 'auto',
  poll_interval: '60',
  stale_after: '15',
  language: 'fr',
};

// Pages of the Nightscout interface and API paths: a URL copied from the
// browser or from an app setting points at one of them, the site is the root.
const INTERFACE_PATH = /\/(api(\/.*)?|report|profile|food|admin|clock(\/.*)?)$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host
 * (`my-site.example.org`), or a URL copied from the browser or an uploader app
 * (`https://my-site.example.org/api/v1`). HTTPS by default for a bare host
 * with a dot that is not an IP address (hosted sites), HTTP otherwise.
 * A `?token=` of the address is returned apart (`token`), never kept in the URL.
 * @param {unknown} raw
 * @returns {{ url: string, token: string }|null} null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  let withScheme = text;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const host = text.split(/[/:?]/)[0];
    const local = /^[\d.]+$/.test(host) || !host.includes('.') || isPrivateHost(host);
    withScheme = `${local ? 'http' : 'https'}://${text}`;
  }
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const token = url.searchParams.get('token')?.trim() ?? '';
  const path = url.pathname.replace(/\/+$/, '').replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return { url: `${url.origin}${path}`, token };
}

/** Whether a host name is on the local network (the transport badge). */
export function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.includes(':')) {
    // IPv6: loopback, unique local (fc00::/7), link-local.
    return host === '::1' || /^f[cd]/.test(host) || host.startsWith('fe80');
  }
  if (!host.includes('.') || /\.(local|lan|home|internal|home\.arpa)$/.test(host)) {
    return true;
  }
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT, Tailscale
  );
}

/** Host part shown to the user and in the logs (no scheme, no path). */
export const hostOf = (url) => new URL(url).host;

/**
 * The platform id of the site: a digest of its host and path (the scheme may
 * change from http to https without creating another device).
 */
export const siteIdOf = (url) =>
  createHash('sha256')
    .update(`gladys-nightscout:${url.replace(/^https?:\/\//, '').toLowerCase()}`)
    .digest('hex')
    .slice(0, 16);

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const choice = (key, options) =>
    options.includes(String(source[key])) ? String(source[key]) : DEFAULT_CONFIG[key];
  const typed = text('url');
  const parsed = typed ? parseServerUrl(typed) : null;
  return {
    // Empty: not configured yet; null: typed but not understood.
    url: typed ? (parsed?.url ?? null) : '',
    // The token field wins over a ?token= pasted in the address.
    token: text('access_token') || parsed?.token || '',
    apiSecret: text('api_secret'),
    unit: choice('glucose_unit', UNITS),
    pollIntervalMs: Number(choice('poll_interval', POLL_INTERVALS)) * 1000,
    staleMs: Number(choice('stale_after', STALE_AFTER)) * 60_000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
