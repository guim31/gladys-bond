// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal cycle writes nothing, a failure that repeats is logged once,
// and its end once. Never the local token, at any level.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAN, FakeBond, TOKEN, createDevices, createWorld, ids, until } from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  t.mock.method(console, 'info', record('out'));
  t.mock.method(console, 'debug', record('out'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.stop());
  return w;
}

test('a normal cycle writes nothing at info: readings, pushes, published states', async (t) => {
  const logs = captureLogs(t);
  const bridge = new FakeBond('bridge-zermatt', { push: false });
  const w = await world(t, { bridges: [bridge] });
  assert.ok(
    logs.texts().some((text) => /connected, BD-1000 v3\.10\.27, 7 device\(s\)/.test(text)),
    `the start is logged: ${logs.texts().join('\n')}`,
  );
  await createDevices(w);
  logs.clear();
  for (const speed of [1, 2, 3, 4, 5]) {
    bridge.setState(FAN, { speed }, { notify: false });
    w.clock.advance(30_000);
    await w.hub.cycle();
  }
  assert.equal(w.fake.lastState(ids(w, FAN).feature('speed')), 5);
  assert.deepEqual(logs.texts(), []);
});

test('pushed states write nothing at info either', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createDevices(w);
  logs.clear();
  for (const speed of [1, 2, 3]) {
    w.bridge.setState(FAN, { speed });
    await until(() => w.fake.lastState(ids(w, FAN).feature('speed')) === speed, 'push');
  }
  assert.deepEqual(logs.texts(), []);
});

test('a bridge that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const bridge = new FakeBond('bridge-zermatt', { push: false });
  const w = await world(t, { bridges: [bridge] });
  await createDevices(w);
  logs.clear();
  bridge.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(30_000);
    await w.hub.cycle();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  bridge.online = true;
  w.clock.advance(30_000);
  await w.hub.cycle();
  await w.hub.cycle();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again after 3 min/);
});

test('a user command is one info line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createDevices(w);
  logs.clear();
  const device = w.fake.discoveredDevices[0];
  await w.fake.setValue(
    device,
    device.features.find((f) => f.external_id.endsWith(':speed')),
    2,
  );
  await until(() => w.fake.lastState(ids(w, FAN).feature('speed')) === 2, 'state');
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /Living Room Fan: speed = 2 → SetSpeed\(2\)/);
});

test('a refused token is logged once; the token never appears, even in debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const bridge = new FakeBond('bridge-zermatt', { token: 'aaaabbbbccccdddd' });
  const w = await world(t, { bridges: [bridge] });
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(30_000);
    await w.hub.cycle();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(warnings[0].text, /local token refused/);

  // An unlocked bridge hands its token over: saved, never written.
  bridge.tokenInfo = { locked: 0, token: 'aaaabbbbccccdddd' };
  await w.fake.action('fetch_token', {});
  await createDevices(w);
  const text = logs.texts().join('\n');
  for (const secret of [TOKEN, 'aaaabbbbccccdddd']) {
    assert.ok(!text.includes(secret), `the token ${secret} is in the logs`);
  }
  assert.ok(w.fake.discoveredDevices.length > 0);
});
