// -----------------------------------------------------------------------------
// A fake Bond bridge on real sockets: an HTTP server answering the local API
// v2 from the fixtures (test/fixtures/bond/), and a UDP socket speaking BPUP.
// It behaves like the bridge where it matters to the integration: token
// checked except on /v2/sys/version and /v2/token, actions applied to the
// believed state, "tell state" without signal, state changes pushed to the
// clients that sent a keep-alive, a bridge that stops answering.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/bond/${name}.json`, import.meta.url), 'utf8'));

export const TOKEN = '0123456789abcdef';

const clone = (value) => structuredClone(value);

/** What an action does to the believed state (the RF part is the bridge's). */
function applyAction(state, action, argument) {
  const on = (key) => {
    state[key] = 1;
  };
  switch (action) {
    case 'TurnOn':
      on('power');
      break;
    case 'TurnOff':
      state.power = 0;
      break;
    case 'TogglePower':
      state.power = state.power ? 0 : 1;
      break;
    case 'SetSpeed':
      state.speed = argument;
      on('power');
      break;
    case 'SetDirection':
      state.direction = argument;
      break;
    case 'ToggleDirection':
      state.direction = state.direction === 1 ? -1 : 1;
      break;
    case 'BreezeOn':
      state.breeze = [1, ...(state.breeze ?? [0, 50, 50]).slice(1)];
      on('power');
      break;
    case 'BreezeOff':
      state.breeze = [0, ...(state.breeze ?? [0, 50, 50]).slice(1)];
      break;
    case 'TurnLightOn':
      on('light');
      break;
    case 'TurnLightOff':
      state.light = 0;
      break;
    case 'ToggleLight':
      state.light = state.light ? 0 : 1;
      break;
    case 'SetBrightness':
      state.brightness = argument;
      on('light');
      break;
    case 'SetColorTemp':
      state.color_temp = argument;
      on('light');
      break;
    case 'TurnUpLightOn':
    case 'TurnDownLightOn': {
      state[action === 'TurnUpLightOn' ? 'up_light' : 'down_light'] = 1;
      on('light');
      break;
    }
    case 'TurnUpLightOff':
      state.up_light = 0;
      break;
    case 'TurnDownLightOff':
      state.down_light = 0;
      break;
    case 'ToggleUpLight':
      state.up_light = state.up_light && state.light ? 0 : 1;
      if (state.up_light) on('light');
      break;
    case 'ToggleDownLight':
      state.down_light = state.down_light && state.light ? 0 : 1;
      if (state.down_light) on('light');
      break;
    case 'Open':
      state.open = 1;
      state.position = 0;
      break;
    case 'Close':
      state.open = 0;
      state.position = 100;
      break;
    case 'ToggleOpen':
      state.open = state.open ? 0 : 1;
      state.position = state.open ? 0 : 100;
      break;
    case 'Hold':
      break;
    case 'SetPosition':
      state.position = argument;
      state.open = argument < 100 ? 1 : 0;
      break;
    case 'SetFlame':
      state.flame = argument;
      on('power');
      break;
    default:
      break;
  }
}

export class FakeBond {
  /**
   * @param {string} [name] fixture name
   * @param {object} [options]
   * @param {string} [options.token] the bridge's local token
   * @param {boolean} [options.push] answers BPUP keep-alives and pushes changes
   */
  constructor(name = 'bridge-zermatt', { token = TOKEN, push = true } = {}) {
    const data = fixture(name);
    this.version = data.version;
    this.bridgeInfo = data.bridge;
    this.tokenInfo = data.token;
    this.token = token;
    this.devices = new Map(Object.entries(data.devices).map(([id, entry]) => [id, clone(entry)]));
    this.push = push;
    this.online = true;
    this.requests = [];
    this.actions = [];
    this.pushClients = new Map();
    this.server = null;
    this.udp = null;
  }

  get bondId() {
    return this.version.bondid;
  }

  async start() {
    this.server = createServer((req, res) => this.handle(req, res));
    this.server.keepAliveTimeout = 1;
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = this.server.address().port;
    this.udp = createSocket('udp4');
    this.udp.on('message', (data, remote) => this.onDatagram(data, remote));
    await new Promise((resolve) => this.udp.bind(0, '127.0.0.1', resolve));
    this.udpPort = this.udp.address().port;
    return this;
  }

  async stop() {
    await new Promise((resolve) => {
      this.server.closeAllConnections?.();
      this.server.close(() => resolve());
    });
    await new Promise((resolve) => this.udp.close(resolve));
  }

  /** The address typed in the configuration. */
  get address() {
    return `127.0.0.1:${this.port}`;
  }

  handle(req, res) {
    if (!this.online) {
      // Like a bridge gone from the network: the connection dies.
      req.socket.destroy();
      return;
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      this.requests.push({
        method: req.method,
        path: req.url,
        token: req.headers['bond-token'],
        body,
      });
      const { status, json } = this.route(req.method, req.url, req.headers['bond-token'], body);
      res.writeHead(status, json === undefined ? {} : { 'Content-Type': 'application/json' });
      res.end(json === undefined ? undefined : JSON.stringify(json));
    });
  }

  route(method, url, token, body) {
    if (method === 'GET' && url === '/v2/sys/version') {
      return { status: 200, json: this.version };
    }
    if (method === 'GET' && url === '/v2/token') {
      return { status: 200, json: this.tokenInfo };
    }
    if (token !== this.token) {
      return { status: 401, json: { _error_id: 2, _error_msg: 'Unauthorized' } };
    }
    if (method === 'GET' && url === '/v2/bridge') {
      return this.bridgeInfo
        ? { status: 200, json: this.bridgeInfo }
        : { status: 404, json: { _error_msg: 'Not found' } };
    }
    if (method === 'GET' && url === '/v2/devices') {
      const json = { _: 'a3f0b2c1' };
      for (const [id, entry] of this.devices) {
        json[id] = { _: entry.device._ };
      }
      return { status: 200, json };
    }
    const match = url.match(/^\/v2\/devices\/([^/]+)(?:\/(properties|state|actions\/([^/]+)))?$/);
    const entry = match && this.devices.get(decodeURIComponent(match[1]));
    if (!entry) {
      return { status: 404, json: { _error_msg: 'Not found' } };
    }
    const [, id, sub, action] = match;
    if (method === 'GET' && !sub) {
      return { status: 200, json: entry.device };
    }
    if (method === 'GET' && sub === 'properties') {
      return { status: 200, json: entry.properties };
    }
    if (method === 'GET' && sub === 'state') {
      return { status: 200, json: entry.state };
    }
    if (method === 'PATCH' && sub === 'state') {
      Object.assign(entry.state, body);
      this.pushState(id);
      return { status: 204 };
    }
    if (method === 'PUT' && action) {
      const name = decodeURIComponent(action);
      if (!entry.device.actions.includes(name)) {
        return { status: 400, json: { _error_msg: 'Action not supported' } };
      }
      this.actions.push({ id, action: name, argument: body?.argument });
      applyAction(entry.state, name, body?.argument);
      this.pushState(id);
      return { status: 204 };
    }
    return { status: 405, json: { _error_msg: 'Method not allowed' } };
  }

  /** Change a state from "elsewhere" (the Bond app, a remote heard by a Pro). */
  setState(id, patch, { notify = true } = {}) {
    Object.assign(this.devices.get(id).state, patch);
    if (notify) {
      this.pushState(id);
    }
  }

  state(id) {
    return this.devices.get(id).state;
  }

  onDatagram(data, remote) {
    if (!this.push || !this.online) {
      return;
    }
    this.pushClients.set(`${remote.address}:${remote.port}`, remote);
    // The bridge answers the keep-alive.
    this.send(remote, { B: this.bondId, d: 0, v: this.version.fw_ver });
  }

  pushState(id) {
    if (!this.push || !this.online) {
      return;
    }
    const { _: _hash, ...state } = this.devices.get(id).state;
    for (const remote of this.pushClients.values()) {
      this.send(remote, {
        B: this.bondId,
        d: 0,
        t: `devices/${id}/state`,
        i: '000000000000',
        s: 200,
        m: 0,
        f: 255,
        b: state,
      });
    }
  }

  send(remote, message) {
    this.udp.send(`${JSON.stringify(message)}\n`, remote.port, remote.address);
  }
}
