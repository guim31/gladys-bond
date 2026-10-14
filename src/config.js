// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three Bond bridges (or Smart by Bond devices), each in its own slot
// (address, local token). The device identity comes from the Bond ID the
// bridge reports, never from the slot: moving a bridge to another slot, or
// changing its IP address, keeps its devices and their history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

// What the integration does with the fireplaces of the bridge:
//   hidden    — not published at all (default);
//   read_only — published with read-only features (lit or not, flame level).
// There is deliberately no "control" mode: see CLAUDE.md, "Fireplaces".
export const FIREPLACE_MODES = ['hidden', 'read_only'];

export const DEFAULT_CONFIG = {
  bridge_1_host: '',
  bridge_1_token: '',
  bridge_2_host: '',
  bridge_2_token: '',
  bridge_3_host: '',
  bridge_3_token: '',
  fireplaces: 'hidden',
  language: 'fr',
};

// The Bond local API listens on HTTP port 80.
export const DEFAULT_HTTP_PORT = 80;

/**
 * Parse the address typed by the user: an IP or a host name, optionally with
 * a port, or the URL copied from a browser (`http://192.0.2.10/`).
 * @param {unknown} raw
 * @returns {{ host: string, port: number } | null} null when unusable
 */
export function parseHost(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // The local API is plain HTTP; credentials in the address would end up in
  // the logs.
  if (url.protocol !== 'http:' || !url.hostname || url.username || url.password) {
    return null;
  }
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: url.port ? Number(url.port) : DEFAULT_HTTP_PORT,
  };
}

/** The address as shown to the user: `host`, or `host:port` when not 80. */
export const addressOf = ({ host, port }) =>
  port === DEFAULT_HTTP_PORT ? host : `${host.includes(':') ? `[${host}]` : host}:${port}`;

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');

  const bridges = [];
  const invalidSlots = [];
  for (const slot of SLOTS) {
    const typed = text(`bridge_${slot}_host`);
    if (!typed) {
      continue;
    }
    const address = parseHost(typed);
    if (!address) {
      invalidSlots.push(slot);
      continue;
    }
    bridges.push({
      slot,
      ...address,
      // A token is 16 hexadecimal characters: blanks around it are copy noise.
      token: text(`bridge_${slot}_token`),
    });
  }

  return {
    bridges,
    invalidSlots,
    fireplaces: FIREPLACE_MODES.includes(source.fireplaces)
      ? source.fireplaces
      : DEFAULT_CONFIG.fireplaces,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
