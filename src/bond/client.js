// -----------------------------------------------------------------------------
// Client of the Bond Local API v2 (HTTP, on the LAN, `BOND-Token` header).
//
// What the bridge is like, and why the client is shaped this way:
//   - it is a small embedded device: few simultaneous HTTP connections, so the
//     requests of one bridge go through a queue (MAX_CONCURRENT at a time);
//   - it closes idle connections quickly: no keep-alive pool, a fresh
//     connection per request (`Connection: close`), as bond-async learned;
//   - `/v2/sys/version` and `/v2/token` answer without a token, everything
//     else answers 401 to a missing or wrong one.
// The token is never part of an error message: only the host, the path and
// the HTTP status are.
// -----------------------------------------------------------------------------

import http from 'node:http';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: off, wrong address, timeout
  AUTH: 'auth', // 401: missing or wrong local token
  NOT_BOND: 'not_bond', // something answers, but not the Bond local API
  HTTP: 'http', // any other refusal
});

export class BondError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message never carries the token
   * @param {number} [status] HTTP status, when there was an answer
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'BondError';
    this.kind = kind;
    this.status = status;
  }
}

const MAX_CONCURRENT = 2;
export const REQUEST_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 256 * 1024;

/**
 * The real HTTP transport: one request, one connection. A seam for the
 * tests, which may swap it for an in-memory one.
 * @returns {Promise<{ status: number, body: string }>}
 */
export function httpRequest({ host, port, method, path, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port, method, path, headers, agent: false, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy(new Error('answer too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

/** The keys of a Bond collection (`/v2/devices`): `_` is the hash, not an entry. */
export const collectionIds = (json) =>
  Object.keys(json ?? {}).filter((key) => key && !key.startsWith('_') && isObject(json[key]));

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class BondClient {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} options.port
   * @param {string} options.token the local token ('' when unknown yet)
   * @param {Function} [options.request] transport seam (httpRequest)
   * @param {number} [options.timeoutMs]
   */
  constructor({ host, port, token, request = httpRequest, timeoutMs = REQUEST_TIMEOUT_MS }) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.active = 0;
    this.waiting = [];
  }

  get label() {
    return this.port === 80 ? this.host : `${this.host}:${this.port}`;
  }

  // --- Reading -----------------------------------------------------------------

  /** `{ bondid, fw_ver, model, make, target, api, ... }` — no token needed. */
  version() {
    return this.call('GET', '/v2/sys/version', { auth: false });
  }

  /** `{ locked, token? }` — the token is given only while the bridge is unlocked. */
  tokenStatus() {
    return this.call('GET', '/v2/token', { auth: false });
  }

  /** `{ name, location, bluelight }` — 404 on Smart by Bond devices, which are no bridge. */
  bridge() {
    return this.call('GET', '/v2/bridge');
  }

  async deviceIds() {
    return collectionIds(await this.call('GET', '/v2/devices'));
  }

  /** `{ name, type, location, template, actions: [...] }` */
  device(id) {
    return this.call('GET', `/v2/devices/${encodeURIComponent(id)}`);
  }

  /** `{ max_speed, trust_state, feature_light, ... }` */
  properties(id) {
    return this.call('GET', `/v2/devices/${encodeURIComponent(id)}/properties`);
  }

  /** `{ power, speed, light, open, position, ... }` — what the bridge believes. */
  state(id) {
    return this.call('GET', `/v2/devices/${encodeURIComponent(id)}/state`);
  }

  // --- Writing ------------------------------------------------------------------

  /**
   * Run an action (RF signal sent by the bridge, belief updated).
   * @param {string} id device id
   * @param {string} action e.g. 'SetSpeed'
   * @param {number} [argument]
   */
  action(id, action, argument) {
    return this.call(
      'PUT',
      `/v2/devices/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`,
      { body: argument === undefined ? {} : { argument } },
    );
  }

  /**
   * "Tell state": correct what the bridge believes WITHOUT sending any signal.
   * @param {string} id device id
   * @param {Record<string, number>} patch e.g. `{ power: 0 }`
   */
  tellState(id, patch) {
    return this.call('PATCH', `/v2/devices/${encodeURIComponent(id)}/state`, { body: patch });
  }

  // --- Transport ----------------------------------------------------------------

  async call(method, path, { auth = true, body } = {}) {
    await this.acquire();
    let response;
    try {
      const headers = { Connection: 'close', Accept: 'application/json' };
      if (auth) {
        headers['BOND-Token'] = this.token;
      }
      let payload;
      if (body !== undefined) {
        payload = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      response = await this.request({
        host: this.host,
        port: this.port,
        method,
        path,
        headers,
        body: payload,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw new BondError(
        ERROR_KINDS.UNREACHABLE,
        `${this.label} does not answer (${err.code ?? err.message})`,
      );
    } finally {
      this.release();
    }
    return this.parse(method, path, response);
  }

  parse(method, path, { status, body }) {
    if (status === 401) {
      throw new BondError(ERROR_KINDS.AUTH, `${this.label}: local token refused`, status);
    }
    if (status === 404 && path === '/v2/sys/version') {
      throw new BondError(ERROR_KINDS.NOT_BOND, `${this.label}: no Bond local API here`, status);
    }
    if (status < 200 || status >= 300) {
      throw new BondError(ERROR_KINDS.HTTP, `${this.label}: ${method} ${path} → ${status}`, status);
    }
    if (method !== 'GET') {
      return null;
    }
    try {
      const json = JSON.parse(body);
      if (isObject(json)) {
        return json;
      }
    } catch {
      // handled below
    }
    throw new BondError(
      ERROR_KINDS.NOT_BOND,
      `${this.label}: ${path} is not a Bond answer`,
      status,
    );
  }

  acquire() {
    if (this.active < MAX_CONCURRENT) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  release() {
    const next = this.waiting.shift();
    if (next) {
      next(); // the slot passes to the next request
    } else {
      this.active -= 1;
    }
  }
}
