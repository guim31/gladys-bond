// -----------------------------------------------------------------------------
// BPUP, the push of the bridge: parsing the datagrams, and the keep-alive /
// answer exchange over a real UDP socket with the fake bridge.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBpup, parseBpup, stateUpdateOf } from '../src/bond/bpup.js';
import { FakeBond } from './helpers/fakeBond.js';
import { until } from './helpers/world.js';

test('a datagram is JSON, possibly after a prefix, possibly with a newline', () => {
  assert.deepEqual(parseBpup('{"B":"ZZBL12345","d":0}\n'), { B: 'ZZBL12345', d: 0 });
  assert.deepEqual(parseBpup(Buffer.from('\u0001\u0002{"s":200}')), { s: 200 });
  assert.equal(parseBpup('not json'), null);
  assert.equal(parseBpup('{broken'), null);
  assert.equal(parseBpup('[1,2]'), null);
});

test('only a 200 on devices/<id>/state is a state update', () => {
  const message = { B: 'ZZBL12345', t: 'devices/79135791/state', s: 200, b: { power: 1 } };
  assert.deepEqual(stateUpdateOf(message), { deviceId: '79135791', state: { power: 1 } });
  assert.equal(stateUpdateOf({ ...message, s: 500 }), null);
  assert.equal(stateUpdateOf({ ...message, t: 'devices/79135791/properties' }), null);
  assert.equal(stateUpdateOf({ ...message, t: 'bridge' }), null);
  assert.equal(stateUpdateOf({ B: 'ZZBL12345', d: 0, v: 'v3.10.27' }), null);
  assert.equal(stateUpdateOf({ ...message, b: null }), null);
});

test('the keep-alive gets an answer, then the changes are pushed', async (t) => {
  const fake = await new FakeBond().start();
  t.after(() => fake.stop());
  const messages = [];
  const channel = openBpup({
    host: '127.0.0.1',
    port: fake.udpPort,
    onMessage: (message) => messages.push(message),
  });
  t.after(() => channel.close());
  await until(() => messages.length === 1, 'the keep-alive answer');
  assert.equal(messages[0].B, 'ZZBL12345');

  fake.setState('79135791', { light: 0 });
  await until(() => messages.length === 2, 'the pushed state');
  assert.deepEqual(stateUpdateOf(messages[1]).state.light, 0);

  channel.keepAlive();
  await until(() => messages.length === 3, 'a second keep-alive answer');
  channel.close();
  channel.close(); // twice is harmless
  channel.keepAlive(); // after close: nothing
});

test('a bridge without push leaves the channel silent', async (t) => {
  const fake = await new FakeBond('bridge-zermatt', { push: false }).start();
  t.after(() => fake.stop());
  const messages = [];
  const channel = openBpup({
    host: '127.0.0.1',
    port: fake.udpPort,
    onMessage: (message) => messages.push(message),
  });
  t.after(() => channel.close());
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(messages, []);
});
