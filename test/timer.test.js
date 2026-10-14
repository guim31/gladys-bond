// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys 5.2.x does not reliably poll
// external devices (GladysAssistant/Gladys#3198): the bridge must be read by
// the hub's own timer, with no onPoll at all.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAN, FakeBond, createDevices, createWorld, ids, settle, until } from './helpers/world.js';

test('the internal timer reads the bridge without any onPoll from Gladys', async (t) => {
  const bridge = new FakeBond('bridge-zermatt', { push: false });
  const w = await createWorld({
    bridges: [bridge],
    timers: true,
    timings: { pollMs: 40 },
    // The real clock: the timer is real too.
    clock: { now: () => Date.now(), advance: () => {} },
  });
  t.after(() => w.stop());
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createDevices(w, [FAN]);
  assert.equal(w.fake.discoveredDevices[0].should_poll, true);
  assert.equal(w.fake.discoveredDevices[0].poll_frequency, 30000);

  for (const speed of [1, 4, 6]) {
    bridge.setState(FAN, { speed }, { notify: false });
    await until(
      () => w.fake.lastState(ids(w, FAN).feature('speed')) === speed,
      `speed ${speed} read by the timer`,
    );
  }
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('the timer stops with the integration', async (t) => {
  const bridge = new FakeBond('bridge-zermatt', { push: false });
  const w = await createWorld({
    bridges: [bridge],
    timers: true,
    timings: { pollMs: 20 },
    clock: { now: () => Date.now(), advance: () => {} },
  });
  t.after(() => Promise.all(w.bridges.map((b) => b.stop())));
  await createDevices(w, [FAN]);
  w.app.stop();
  await settle(40);
  const before = bridge.requests.length;
  await settle(100);
  assert.equal(bridge.requests.length, before);
});
