// -----------------------------------------------------------------------------
// The Bond model, pure: which features a device gets from its type, actions
// and properties, which value each feature takes from the believed state,
// and which Bond action(s) a Gladys value turns into.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRFLOW,
  COVER,
  CommandError,
  FEATURES,
  KINDS,
  beliefPatch,
  commandFor,
  describe,
  featureValues,
  normalizeDevice,
} from '../src/bond/model.js';
import { fixture } from './helpers/fakeBond.js';

const bridge = fixture('bridge-zermatt');
const sbb = fixture('smart-by-bond-fan');

/** A normalized device of a fixture, with its state. */
function load(id, source = bridge) {
  const entry = source.devices[id];
  return { device: normalizeDevice(id, entry.device, entry.properties), state: entry.state };
}

const keysOf = (device, options) => describe(device, options).features.map((f) => f.key);

const valuesOf = (device, state, options) =>
  Object.fromEntries(
    featureValues(keysOf(device, options), state).map(({ key, value }) => [key, value]),
  );

test('a ceiling fan with dedicated actions: power, 6 speeds, direction, dimmable light', () => {
  const { device, state } = load('79135791');
  const { kind, features } = describe(device);
  assert.equal(kind, KINDS.FAN);
  assert.deepEqual(
    features.map((f) => f.key),
    ['power', 'speed', 'direction', 'light', 'brightness'],
  );
  const speed = features.find((f) => f.key === 'speed');
  assert.deepEqual([speed.category, speed.type, speed.min, speed.max], ['fan', 'speed', 0, 6]);
  assert.deepEqual(valuesOf(device, state), {
    power: 1,
    speed: 3,
    direction: AIRFLOW.FORWARD,
    light: 1,
    brightness: 75,
  });
});

test('a toggle-only fan remote: breeze, up and down lights as switches', () => {
  const { device, state } = load('2f00c3e1');
  const features = describe(device).features;
  assert.deepEqual(
    features.map((f) => `${f.key}:${f.category}/${f.type}`),
    [
      'power:switch/binary',
      'speed:fan/speed',
      'direction:fan/airflow-direction',
      'breeze:switch/binary',
      'light:light/binary',
      'up_light:switch/binary',
      'down_light:switch/binary',
    ],
  );
  // Off: the speed shows 0 although the bridge keeps 2; the up/down lights
  // follow the main light.
  assert.deepEqual(valuesOf(device, state), {
    power: 0,
    speed: 0,
    direction: AIRFLOW.REVERSE,
    breeze: 0,
    light: 0,
    up_light: 0,
    down_light: 0,
  });
});

test('a fan without max_speed gets the 3 speeds Bond assumes', () => {
  const device = normalizeDevice('x', { type: 'CF', actions: ['SetSpeed'] }, {});
  assert.equal(describe(device).features[0].max, 3);
});

test('a property set to false hides the light of a fan remote that has one', () => {
  const device = normalizeDevice(
    'x',
    { type: 'CF', actions: ['TurnOn', 'TurnLightOn', 'TurnLightOff', 'SetBrightness'] },
    { feature_light: false, feature_brightness: false },
  );
  assert.deepEqual(keysOf(device), ['power']);
});

test('shades: Gladys position is the opposite of Bond (100 open in Gladys, 0 open in Bond)', () => {
  const { device, state } = load('3a2c9e44');
  assert.deepEqual(keysOf(device), ['cover', 'position']);
  assert.deepEqual(valuesOf(device, state), { cover: COVER.CLOSE, position: 0 });
  assert.deepEqual(valuesOf(device, { open: 1, position: 25 }), {
    cover: COVER.OPEN,
    position: 75,
  });
  assert.deepEqual(commandFor(device, FEATURES.POSITION, 75, state), [
    { action: 'SetPosition', argument: 25 },
  ]);
  assert.deepEqual(commandFor(device, FEATURES.COVER, COVER.OPEN, state), [{ action: 'Open' }]);
  assert.deepEqual(commandFor(device, FEATURES.COVER, COVER.CLOSE, state), [{ action: 'Close' }]);
  assert.deepEqual(commandFor(device, FEATURES.COVER, COVER.STOP, state), [{ action: 'Hold' }]);
});

test('a light with color temperature, in kelvin, within its own range', () => {
  const { device, state } = load('6c1d2e3f');
  const temperature = describe(device).features.find((f) => f.key === 'color_temp');
  assert.deepEqual(
    [temperature.category, temperature.type, temperature.unit, temperature.min, temperature.max],
    ['light', 'temperature', 'kelvin', 2700, 5000],
  );
  assert.equal(valuesOf(device, state).color_temp, 3000);
  // The API resolution is 100 K.
  assert.deepEqual(commandFor(device, FEATURES.COLOR_TEMP, 4321, state), [
    { action: 'SetColorTemp', argument: 4300 },
  ]);
});

test('fireplaces: hidden by default, read-only when shown, never commanded', () => {
  const { device, state } = load('5e4d3c2b');
  assert.deepEqual(describe(device), { kind: KINDS.FIREPLACE, features: [] });
  const shown = describe(device, { fireplaces: 'read_only' }).features;
  assert.deepEqual(
    shown.map((f) => [f.key, f.read_only]),
    [
      ['power', true],
      ['flame', true],
    ],
  );
  assert.deepEqual(valuesOf(device, state, { fireplaces: 'read_only' }), { power: 0, flame: 50 });
  for (const key of [FEATURES.POWER, FEATURES.FLAME]) {
    assert.throws(
      () => commandFor(device, key, 1, state),
      (err) => err instanceof CommandError && err.code === 'read_only',
    );
  }
});

test('a generic device is a switch; a garage door, an air conditioner and a bidet are left out', () => {
  assert.deepEqual(keysOf(load('7a6b5c4d').device), ['power']);
  assert.deepEqual(describe(load('1b2c3d4e').device), { kind: null, features: [] });
  for (const type of ['AC', 'BD', 'XX', '']) {
    const device = normalizeDevice('x', { type, actions: ['TurnOn', 'TurnOff'] });
    assert.deepEqual(describe(device).features, [], type);
  }
});

test('fan commands: speed 0 turns off, a speed turns on, clamped to max_speed', () => {
  const { device, state } = load('79135791');
  assert.deepEqual(commandFor(device, FEATURES.SPEED, 0, state), [{ action: 'TurnOff' }]);
  assert.deepEqual(commandFor(device, FEATURES.SPEED, 4, state), [
    { action: 'SetSpeed', argument: 4 },
  ]);
  assert.deepEqual(commandFor(device, FEATURES.SPEED, 99, state), [
    { action: 'SetSpeed', argument: 6 },
  ]);
  assert.deepEqual(commandFor(device, FEATURES.POWER, 1, state), [{ action: 'TurnOn' }]);
  assert.deepEqual(commandFor(device, FEATURES.DIRECTION, AIRFLOW.REVERSE, state), [
    { action: 'SetDirection', argument: -1 },
  ]);
  assert.deepEqual(commandFor(device, FEATURES.BRIGHTNESS, 0, state), [{ action: 'TurnLightOff' }]);
  assert.deepEqual(commandFor(device, FEATURES.BRIGHTNESS, 40, state), [
    { action: 'SetBrightness', argument: 40 },
  ]);
});

test('toggle-only remote: the toggle is sent only when the believed state differs', () => {
  const { device, state } = load('2f00c3e1'); // power 0, light 0, direction -1
  assert.deepEqual(commandFor(device, FEATURES.POWER, 1, state), [{ action: 'TogglePower' }]);
  assert.deepEqual(commandFor(device, FEATURES.POWER, 0, state), []);
  assert.deepEqual(commandFor(device, FEATURES.LIGHT, 0, state), []);
  assert.deepEqual(commandFor(device, FEATURES.LIGHT, 1, state), [{ action: 'ToggleLight' }]);
  assert.deepEqual(commandFor(device, FEATURES.DIRECTION, AIRFLOW.REVERSE, state), []);
  assert.deepEqual(commandFor(device, FEATURES.DIRECTION, AIRFLOW.FORWARD, state), [
    { action: 'ToggleDirection' },
  ]);
  assert.deepEqual(commandFor(device, FEATURES.UP_LIGHT, 1, { up_light: 0 }), [
    { action: 'ToggleUpLight' },
  ]);
});

test('turning a fan off in breeze mode leaves the breeze first', () => {
  const { device } = load('a1b2c3d4', sbb);
  const state = { power: 1, speed: 2, breeze: [1, 50, 50] };
  assert.deepEqual(commandFor(device, FEATURES.POWER, 0, state), [
    { action: 'BreezeOff' },
    { action: 'TurnOff' },
  ]);
  assert.deepEqual(commandFor(device, FEATURES.BREEZE, 1, state), [{ action: 'BreezeOn' }]);
  assert.deepEqual(commandFor(device, FEATURES.BREEZE, 0, state), [{ action: 'BreezeOff' }]);
});

test('an action the remote does not have is refused, an invalid value too', () => {
  const device = normalizeDevice('x', { name: 'Fan', type: 'CF', actions: ['SetSpeed'] });
  assert.throws(() => commandFor(device, FEATURES.LIGHT, 1, {}), CommandError);
  assert.throws(() => commandFor(device, FEATURES.SPEED, 'fast', {}), CommandError);
  assert.throws(() => commandFor(device, 'nope', 1, {}), CommandError);
});

test('"tell state" patches only a state the device tracks', () => {
  const fan = load('79135791');
  assert.deepEqual(beliefPatch(fan.device, 'power_off', fan.state), { power: 0 });
  assert.deepEqual(beliefPatch(fan.device, 'light_on', fan.state), { light: 1 });
  assert.throws(() => beliefPatch(fan.device, 'open', fan.state), CommandError);
  const shades = load('3a2c9e44');
  assert.deepEqual(beliefPatch(shades.device, 'closed', shades.state), { open: 0 });
  assert.throws(() => beliefPatch(shades.device, 'unknown', shades.state), CommandError);
});

test('a missing state value publishes nothing for that feature', () => {
  const { device } = load('79135791');
  assert.deepEqual(valuesOf(device, {}), {
    power: null,
    speed: null,
    direction: null,
    light: null,
    brightness: null,
  });
});
