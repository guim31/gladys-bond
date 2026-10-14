// -----------------------------------------------------------------------------
// End to end: the SDK's fake Gladys, the integration, fake Bond bridges on
// real HTTP and UDP sockets. Discovery, states, commands, push, reading
// without push, a bridge lost and back, the configuration actions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER } from '../src/bond/model.js';
import { TRIGGERS } from '../src/hub.js';
import {
  BEDROOM_FAN,
  FAN,
  FIREPLACE,
  FakeBond,
  GARAGE,
  GENERIC,
  LIGHT,
  SHADES,
  TOKEN,
  createDevices,
  createWorld,
  discovered,
  ids,
  settle,
  until,
} from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.stop());
  return w;
}

const feature = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));

/** Run a command the way Gladys does: the device, the feature, the value. */
async function set(w, deviceId, key, value) {
  const device = discovered(w, deviceId);
  return w.fake.setValue(device, feature(device, key), value);
}

test('discovery: one Gladys device per supported Bond device, named after its room', async (t) => {
  const w = await world(t);
  const names = w.fake.discoveredDevices.map((device) => device.name);
  assert.deepEqual(names, [
    'Living Room Fan',
    'Bedroom Fan',
    'Patio Shades',
    'Kitchen Light',
    'Garden Pool Pump',
  ]);
  // The fireplace is hidden by default; the garage door is never published.
  assert.equal(discovered(w, FIREPLACE), undefined);
  assert.equal(discovered(w, GARAGE), undefined);
  const fan = discovered(w, FAN);
  assert.equal(fan.external_id, 'ext:test-integration:bond:ZZBL12345_79135791');
  assert.deepEqual(fan.params, [
    { name: 'BOND_ID', value: 'ZZBL12345' },
    { name: 'BOND_DEVICE_ID', value: FAN },
    { name: 'BOND_TYPE', value: 'CF' },
  ]);
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('no state is published before the device is added; all of them right after', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.states.length, 0);
  await createDevices(w, [FAN]);
  assert.equal(w.fake.lastState(ids(w, FAN).feature('power')), 1);
  assert.equal(w.fake.lastState(ids(w, FAN).feature('speed')), 3);
  assert.equal(w.fake.lastState(ids(w, FAN).feature('brightness')), 75);
  assert.equal(w.fake.lastState(ids(w, SHADES).feature('position')), undefined);
  assert.ok(w.fake.widgetRefreshes.includes('ceiling_fan'));
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: ids(w, FAN).device,
    transport: 'local',
  });
});

test('a speed from Gladys becomes SetSpeed, and the new belief is published', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const ack = await set(w, FAN, 'speed', 5);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.bridge.actions, [{ id: FAN, action: 'SetSpeed', argument: 5 }]);
  assert.equal(w.fake.lastState(ids(w, FAN).feature('speed')), 5);

  await set(w, FAN, 'speed', 0);
  assert.deepEqual(w.bridge.actions.at(-1), { id: FAN, action: 'TurnOff', argument: undefined });
  assert.equal(w.fake.lastState(ids(w, FAN).feature('power')), 0);
  assert.equal(w.fake.lastState(ids(w, FAN).feature('speed')), 0);
});

test('shades: Gladys open/close/position, with the position inverted for Bond', async (t) => {
  const w = await world(t);
  await createDevices(w);
  await set(w, SHADES, 'cover', COVER.OPEN);
  assert.equal(w.fake.lastState(ids(w, SHADES).feature('cover')), COVER.OPEN);
  assert.equal(w.fake.lastState(ids(w, SHADES).feature('position')), 100);
  await set(w, SHADES, 'position', 30);
  assert.deepEqual(w.bridge.actions.at(-1), { id: SHADES, action: 'SetPosition', argument: 70 });
  assert.equal(w.fake.lastState(ids(w, SHADES).feature('position')), 30);
  await set(w, SHADES, 'cover', COVER.STOP);
  assert.equal(w.bridge.actions.at(-1).action, 'Hold');
});

test('a toggle-only remote is toggled only when needed', async (t) => {
  const w = await world(t);
  await createDevices(w);
  await set(w, BEDROOM_FAN, 'power', 0); // already off
  assert.deepEqual(w.bridge.actions, []);
  await set(w, BEDROOM_FAN, 'power', 1);
  assert.deepEqual(
    w.bridge.actions.map((a) => a.action),
    ['TogglePower'],
  );
  assert.equal(w.fake.lastState(ids(w, BEDROOM_FAN).feature('speed')), 2);
});

test('a command the remote cannot do is refused with a readable error', async (t) => {
  const w = await world(t, {
    config: (b) => ({
      bridge_1_host: b[0].address,
      bridge_1_token: TOKEN,
      fireplaces: 'read_only',
      language: 'fr',
    }),
  });
  await createDevices(w);
  const ack = await set(w, FIREPLACE, 'power', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /lecture seule/);
  assert.deepEqual(w.bridge.actions, []);
});

test('a change made elsewhere arrives by push, without any reading', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const reads = () => w.bridge.requests.filter((r) => r.path.endsWith('/state')).length;
  const before = reads();
  w.bridge.setState(FAN, { light: 0, speed: 6 }); // the Bond app, a remote heard by a Pro
  await until(() => w.fake.lastState(ids(w, FAN).feature('light')) === 0, 'the pushed light');
  assert.equal(w.fake.lastState(ids(w, FAN).feature('speed')), 6);
  assert.equal(reads(), before, 'no GET /state');
  // While the push works, a cycle reads nothing.
  w.clock.advance(30_000);
  await w.hub.cycle();
  assert.equal(reads(), before);
});

test('without push, every cycle reads the added devices', async (t) => {
  const bridge = new FakeBond('bridge-zermatt', { push: false });
  const w = await world(t, { bridges: [bridge] });
  await createDevices(w, [FAN]);
  bridge.setState(FAN, { speed: 1 }, { notify: false });
  w.clock.advance(30_000);
  await w.hub.cycle();
  assert.equal(w.fake.lastState(ids(w, FAN).feature('speed')), 1);
  const paths = bridge.requests.slice(-1).map((r) => r.path);
  assert.deepEqual(paths, [`/v2/devices/${FAN}/state`], 'only the added device is read');
});

test('with push, a safety reading still happens every 10 minutes', async (t) => {
  const w = await world(t);
  await createDevices(w, [FAN]);
  w.bridge.setState(FAN, { speed: 2 }, { notify: false }); // a lost datagram
  for (let i = 0; i < 19; i += 1) {
    w.clock.advance(30_000);
    w.hub.records.get(1).push.lastMessageAt = w.clock.now(); // the push stays alive
    await w.hub.cycle();
  }
  assert.equal(w.fake.lastState(ids(w, FAN).feature('speed')), 3, 'not read yet');
  w.clock.advance(30_000);
  w.hub.records.get(1).push.lastMessageAt = w.clock.now();
  await w.hub.cycle();
  assert.equal(w.fake.lastState(ids(w, FAN).feature('speed')), 2);
});

test('an unchanged value is published again after the heartbeat period', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 14) });
  const w = await world(t, { timings: { heartbeatMs: 60 * 60_000 } });
  await createDevices(w, [GENERIC]);
  const count = () =>
    w.fake.states.filter((s) => s.device_feature_external_id === ids(w, GENERIC).feature('power'))
      .length;
  const first = count();
  await w.hub.publishAllStates();
  assert.equal(count(), first, 'nothing new');
  t.mock.timers.tick(60 * 60_000);
  await w.hub.publishAllStates();
  assert.equal(count(), first + 1);
});

test('a bridge lost and back: one trigger each, devices unreachable meanwhile', async (t) => {
  const w = await world(t);
  await createDevices(w, [FAN]);
  w.bridge.online = false;
  for (let i = 0; i < 3; i += 1) {
    w.clock.advance(30_000);
    w.hub.records.get(1).push.lastMessageAt = null; // the push stops too
    await w.hub.cycle();
  }
  const lost = w.fake.sceneEvents.filter((e) => e.key === TRIGGERS.UNREACHABLE);
  assert.equal(lost.length, 1);
  assert.deepEqual(lost[0].data, { bridge: 'Living room bridge', bond_id: 'ZZBL12345' });
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Living room bridge: does not answer/);

  w.bridge.online = true;
  w.clock.advance(4 * 60_000);
  await w.hub.cycle();
  const back = w.fake.sceneEvents.filter((e) => e.key === TRIGGERS.RECOVERED);
  assert.equal(back.length, 1);
  assert.equal(back[0].data.down_minutes, 5);
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('a bridge off at startup is found later, without restarting', async (t) => {
  const bridge = await new FakeBond().start();
  bridge.online = false;
  const w = await world(t, { bridges: [bridge] });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  bridge.online = true;
  w.clock.advance(30_000);
  await w.hub.cycle();
  assert.equal(w.fake.discoveredDevices.length, 5);
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('a wrong token: no device, a status that says so, no "unreachable" trigger', async (t) => {
  const w = await world(t, {
    config: (b) => ({ bridge_1_host: b[0].address, bridge_1_token: 'wrong', language: 'en' }),
  });
  for (let i = 0; i < 3; i += 1) {
    w.clock.advance(30_000);
    await w.hub.cycle();
  }
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.match(w.fake.connectionStatus.message.en, /local token refused/);
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('no token yet: the status points to the "Get the local token" button', async (t) => {
  const w = await world(t, {
    config: (b) => ({ bridge_1_host: b[0].address, language: 'en' }),
  });
  assert.match(w.fake.connectionStatus.message.fr, /Récupérer le jeton local/);
  assert.ok(
    w.bridge.requests.every((r) => r.path === '/v2/sys/version'),
    'nothing asked with an empty token',
  );
});

test('"Get the local token": locked bridge explains, unlocked one saves it', async (t) => {
  const w = await world(t, {
    config: (b) => ({ bridge_1_host: b[0].address, language: 'en' }),
  });
  let ack = await w.fake.action('fetch_token', {});
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.en, /locked: unplug the bridge/);
  assert.equal(w.fake.config.bridge_1_token, undefined);

  w.bridge.tokenInfo = { locked: 0, token: TOKEN };
  ack = await w.fake.action('fetch_token', {});
  assert.match(ack.data.message.en, /^ZZBL12345: token saved$/);
  assert.equal(w.fake.config.bridge_1_token, TOKEN);
  assert.equal(w.fake.discoveredDevices.length, 5, 'connected with the new token');
  ack = await w.fake.action('fetch_token', {});
  assert.match(ack.data.message.en, /the saved token works/);
});

test('"Find the bridges": the mDNS answer fills the first free slot', async (t) => {
  const bridge = await new FakeBond().start();
  const w = await world(t, {
    bridges: [bridge],
    config: { language: 'en' },
    scanResults: {
      mdns: [
        {
          name: 'ZZBL12345._bond._tcp.local',
          host: 'ZZBL12345.local',
          addresses: ['fe80::1', '127.0.0.1'],
          port: 80,
          txt: [],
        },
      ],
    },
  });
  assert.equal(w.fake.connectionStatus.connected, false);
  const ack = await w.fake.action('find_bridges', {});
  assert.equal(ack.success, true, ack.error);
  assert.match(
    ack.data.message.en,
    /1 Bond bridge\(s\) found:\nZZBL12345 \(127\.0\.0\.1\): added as bridge 1/,
  );
  assert.equal(w.fake.config.bridge_1_host, '127.0.0.1');
  assert.deepEqual(w.fake.scans.at(-1).type, 'mdns');

  w.fake.scanResults.mdns = [];
  const none = await w.fake.action('find_bridges', {});
  assert.match(none.data.message.fr, /Aucun bridge Bond/);
});

test('"Correct the Bond state": a PATCH, no signal, the new belief published', async (t) => {
  const w = await world(t);
  await createDevices(w, [FAN]);
  const ack = await w.fake.action('tell_state', { device: ids(w, FAN).device, state: 'power_off' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.message, {
    en: 'State corrected, no signal sent.',
    fr: 'État corrigé, aucun signal envoyé.',
    de: 'Zustand korrigiert, kein Signal gesendet.',
    es: 'Estado corregido, no se ha enviado ninguna señal.',
  });
  assert.deepEqual(w.bridge.actions, [], 'no RF action');
  assert.equal(w.fake.lastState(ids(w, FAN).feature('power')), 0);

  const scene = await w.fake.sceneAction('tell_state', {
    device: ids(w, FAN).device,
    state: 'light_off',
  });
  assert.equal(scene.success, true, scene.error);
  assert.equal(w.fake.lastState(ids(w, FAN).feature('light')), 0);

  const wrong = await w.fake.sceneAction('tell_state', {
    device: ids(w, FAN).device,
    state: 'open',
  });
  assert.equal(wrong.success, false);
  const unknown = await w.fake.action('tell_state', {
    device: 'ext:test-integration:bond:OTHER_1',
    state: 'power_off',
  });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /not on a configured Bond bridge/);
});

test('"Test the connection" reports each bridge in four languages', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message.en,
    'Living room bridge: OK, v3.10.27, 5 device(s) for Gladys, 2 not supported or hidden, live updates on',
  );
  assert.match(ack.data.message.fr, /^Living room bridge : OK/);
});

test('a Smart by Bond fan is its own bridge, named after the fan', async (t) => {
  const sbb = new FakeBond('smart-by-bond-fan');
  const w = await world(t, { bridges: [sbb] });
  const [device] = w.fake.discoveredDevices;
  assert.equal(device.name, 'Office Fan');
  assert.equal(device.external_id, 'ext:test-integration:bond:KSMJWCE12345_a1b2c3d4');
  assert.equal(w.hub.records.get(1).name, 'Office Fan');
});

test('two bridges: their devices side by side, one down leaves the other working', async (t) => {
  const first = new FakeBond();
  const second = new FakeBond('smart-by-bond-fan');
  const w = await world(t, {
    bridges: [first, second],
    config: (b) => ({
      bridge_1_host: b[0].address,
      bridge_1_token: TOKEN,
      bridge_3_host: b[1].address,
      bridge_3_token: TOKEN,
      language: 'en',
    }),
  });
  assert.equal(w.fake.discoveredDevices.length, 6);
  second.online = false;
  w.clock.advance(30_000);
  w.hub.records.get(3).push.lastMessageAt = null;
  await w.hub.cycle();
  await createDevices(w, [FAN]);
  assert.equal(w.fake.connectionStatus.connected, true, 'one bridge still answers');
  assert.match(w.fake.connectionStatus.message.en, /Office Fan: does not answer/);
});

test('the onPoll of Gladys is a fallback: skipped right after a reading', async (t) => {
  const bridge = new FakeBond('bridge-zermatt', { push: false });
  const w = await world(t, { bridges: [bridge] });
  await createDevices(w, [FAN]);
  const reads = () => bridge.requests.filter((r) => r.path.endsWith('/state')).length;
  const before = reads();
  await w.fake.poll(discovered(w, FAN));
  assert.equal(reads(), before, 'read moments ago: skipped');
  w.clock.advance(30_000);
  bridge.setState(FAN, { speed: 4 }, { notify: false });
  const ack = await w.fake.poll(discovered(w, FAN));
  assert.equal(ack.success, true);
  assert.equal(reads(), before + 1);
  assert.equal(w.fake.lastState(ids(w, FAN).feature('speed')), 4);
});

test('a new configuration: new language for new devices, fireplace shown read-only', async (t) => {
  const w = await world(t);
  const config = { ...w.fake.config, language: 'de', fireplaces: 'read_only' };
  await w.fake.configUpdated(config);
  const fireplace = discovered(w, FIREPLACE);
  assert.deepEqual(
    fireplace.features.map((f) => [f.name, f.read_only]),
    [
      ['Ein / Aus', true],
      ['Flamme', true],
    ],
  );
  assert.equal(feature(discovered(w, LIGHT), 'brightness').name, 'Helligkeit');
  // The same token and address: the bridge is not read again from scratch.
  assert.equal(w.hub.records.size, 1);
});

test('"Search" in the Discovery tab reads the device list again', async (t) => {
  const w = await world(t);
  w.bridge.devices.delete(GENERIC);
  await w.fake.scanRequest();
  assert.equal(discovered(w, GENERIC), undefined);
  assert.equal(w.fake.discoveredDevices.length, 4);
});

test('a reconnection to Gladys sends the states again', async (t) => {
  const w = await world(t);
  await createDevices(w, [GENERIC]);
  const count = () => w.fake.states.length;
  const before = count();
  await w.gladys.disconnect();
  await w.gladys.connect();
  await settle();
  assert.ok(count() > before);
});
