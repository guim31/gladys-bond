// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Bond bridges on real
// local sockets (HTTP + BPUP), a manual clock, with the integration wired on
// top through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests drive `world.hub.cycle()` themselves.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { deviceIds } from '../../src/devices.js';
import { FakeBond, TOKEN } from './fakeBond.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export { FakeBond, TOKEN };

/** A manual clock for the hub. */
export function createClock(start = Date.UTC(2026, 9, 14, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** Let the sockets deliver (a UDP datagram, an HTTP answer). */
export async function settle(ms = 30) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until `check()` is true (sockets are asynchronous), 2 s at most. */
export async function until(check, message = 'condition') {
  for (let i = 0; i < 200; i += 1) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${message}`);
}

/**
 * @param {object} [options]
 * @param {FakeBond[]} [options.bridges] started by createWorld
 * @param {(bridges: FakeBond[]) => object} [options.config] raw config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  bridges = [new FakeBond()],
  config = (started) => ({
    bridge_1_host: started[0].address,
    bridge_1_token: TOKEN,
    language: 'en',
  }),
  devices = [],
  connect = true,
  timers = false,
  timings = {},
  scanResults,
} = {}) {
  for (const bridge of bridges) {
    if (!bridge.server) {
      await bridge.start();
    }
  }
  const byPort = new Map(bridges.map((bridge) => [bridge.port, bridge]));
  const gladys = createFakeGladys({
    config: typeof config === 'function' ? config(bridges) : config,
    devices,
    scanResults,
  });
  const app = registerHandlers(gladys, {
    timers,
    timings: { afterActionMs: 0, ...timings },
    now: clock.now,
    // Each fake bridge has its own BPUP port (the real one is 30007).
    pushPort: (bridge) => byPort.get(bridge.port)?.udpPort ?? 30007,
  });
  const world = {
    gladys,
    fake: gladys.fake,
    app,
    hub: app.hub,
    clock,
    bridges,
    bridge: bridges[0],
    async stop() {
      app.stop();
      await Promise.all(bridges.map((bridge) => bridge.stop()));
    },
  };
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return world;
}

/** External ids of a Bond device of a fake bridge. */
export const ids = (world, deviceId, bridge = world.bridge) =>
  deviceIds(world.gladys, bridge.bondId, deviceId);

/** The discovered device of a Bond device id. */
export const discovered = (world, deviceId, bridge = world.bridge) =>
  world.fake.discoveredDevices.find(
    (device) => device.external_id === ids(world, deviceId, bridge).device,
  );

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, deviceIdsToCreate) {
  const wanted = deviceIdsToCreate
    ? deviceIdsToCreate.map((id) => discovered(world, id))
    : world.fake.discoveredDevices;
  for (const device of wanted) {
    await world.fake.deviceCreated(device);
  }
}

// Device ids of test/fixtures/bond/bridge-zermatt.json.
export const FAN = '79135791';
export const BEDROOM_FAN = '2f00c3e1';
export const SHADES = '3a2c9e44';
export const LIGHT = '6c1d2e3f';
export const FIREPLACE = '5e4d3c2b';
export const GENERIC = '7a6b5c4d';
export const GARAGE = '1b2c3d4e';
