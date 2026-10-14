// -----------------------------------------------------------------------------
// What a Bond device is, in Gladys terms — pure functions, no I/O.
//
//   describe(device)        Bond type + actions + properties → Gladys features
//   featureValues(...)      Bond state → one value per feature
//   commandFor(...)         a Gladys value → the Bond action(s) to run
//
// Bond conventions this file translates (Bond Local API v2, bond-async,
// Home Assistant `bond`):
//   - a device lists the `actions` its remote supports: a feature exists only
//     when its action does (no speed without SetSpeed, no light without
//     TurnLightOn/TurnLightOff/ToggleLight);
//   - fan direction: 1 forward, -1 reverse;
//   - shade position: 0 open, 100 closed (Gladys: 0 closed, 100 open);
//   - `breeze` is [mode, mean, variability], mode 0 or 1;
//   - the state is what the bridge BELIEVES: an RF remote gives no feedback.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';

// Bond device types (`type` of /v2/devices/{id}).
export const BOND_TYPES = Object.freeze({
  CEILING_FAN: 'CF',
  MOTORIZED_SHADES: 'MS',
  FIREPLACE: 'FP',
  LIGHT: 'LT',
  GENERIC: 'GX',
  AIR_CONDITIONER: 'AC',
  GARAGE_DOOR: 'GD',
  BIDET: 'BD',
});

// What Gladys gets from each Bond type. AC, GD and BD are left out: an air
// conditioner remote has no state Bond tracks well, and a garage door opened
// by mistake (a scene, a voice assistant) is a security problem.
export const KINDS = Object.freeze({
  FAN: 'fan',
  SHADE: 'shade',
  LIGHT: 'light',
  FIREPLACE: 'fireplace',
  GENERIC: 'generic',
});

const KIND_BY_TYPE = {
  [BOND_TYPES.CEILING_FAN]: KINDS.FAN,
  [BOND_TYPES.MOTORIZED_SHADES]: KINDS.SHADE,
  [BOND_TYPES.LIGHT]: KINDS.LIGHT,
  [BOND_TYPES.FIREPLACE]: KINDS.FIREPLACE,
  [BOND_TYPES.GENERIC]: KINDS.GENERIC,
};

// Feature keys: part of the external ids, permanent once published.
export const FEATURES = Object.freeze({
  POWER: 'power',
  SPEED: 'speed',
  DIRECTION: 'direction',
  BREEZE: 'breeze',
  LIGHT: 'light',
  BRIGHTNESS: 'brightness',
  COLOR_TEMP: 'color_temp',
  UP_LIGHT: 'up_light',
  DOWN_LIGHT: 'down_light',
  COVER: 'cover',
  POSITION: 'position',
  FLAME: 'flame',
});

// Gladys values of the shutter state (COVER_STATE of the core).
export const COVER = Object.freeze({ OPEN: 1, STOP: 0, CLOSE: -1 });

// Gladys values of the airflow direction (FAN_AIRFLOW_DIRECTION of the core).
export const AIRFLOW = Object.freeze({ FORWARD: 0, REVERSE: 1 });

// Bond's own default when a fan does not say how many speeds it has.
export const DEFAULT_MAX_SPEED = 3;
const DEFAULT_COLOR_TEMP = { min: 2700, max: 6500 };

const has = (device, ...actions) => actions.some((action) => device.actions.has(action));

const binary = (key, category, type, readOnly = false) => ({
  key,
  category,
  type,
  min: 0,
  max: 1,
  read_only: readOnly,
});

/**
 * Normalize what the API returned for one device.
 * @param {object} info `/v2/devices/{id}`
 * @param {object} [props] `/v2/devices/{id}/properties`
 */
export function normalizeDevice(id, info = {}, props = {}) {
  return {
    id,
    name: typeof info.name === 'string' && info.name.trim() ? info.name.trim() : id,
    location: typeof info.location === 'string' ? info.location.trim() : '',
    type: typeof info.type === 'string' ? info.type : '',
    template: typeof info.template === 'string' ? info.template : '',
    actions: new Set(Array.isArray(info.actions) ? info.actions : []),
    props: props && typeof props === 'object' ? props : {},
  };
}

/** The Gladys kind of a Bond device, or null when it is not supported. */
export const kindOf = (device) => KIND_BY_TYPE[device.type] ?? null;

function lightFeatures(device) {
  const features = [];
  const { props } = device;
  if (props.feature_light !== false && has(device, 'TurnLightOn', 'TurnLightOff', 'ToggleLight')) {
    features.push(binary(FEATURES.LIGHT, CATEGORIES.LIGHT, TYPES.LIGHT.BINARY));
  }
  if (props.feature_brightness !== false && has(device, 'SetBrightness')) {
    features.push({
      key: FEATURES.BRIGHTNESS,
      category: CATEGORIES.LIGHT,
      type: TYPES.LIGHT.BRIGHTNESS,
      min: 0,
      max: 100,
      unit: UNITS.PERCENT,
      read_only: false,
    });
  }
  if (has(device, 'SetColorTemp')) {
    const min = Number.isInteger(props.min_color_temp)
      ? props.min_color_temp
      : DEFAULT_COLOR_TEMP.min;
    const max = Number.isInteger(props.max_color_temp)
      ? props.max_color_temp
      : DEFAULT_COLOR_TEMP.max;
    features.push({
      key: FEATURES.COLOR_TEMP,
      category: CATEGORIES.LIGHT,
      type: TYPES.LIGHT.TEMPERATURE,
      min: Math.min(min, max),
      max: Math.max(min, max),
      unit: UNITS.KELVIN,
      read_only: false,
    });
  }
  // Separate up and down lights: switches, not light/binary — the dashboard
  // merges every light/binary of a device into one light panel.
  if (
    props.feature_up_down_light !== false &&
    has(device, 'TurnUpLightOn', 'TurnUpLightOff', 'ToggleUpLight')
  ) {
    features.push(binary(FEATURES.UP_LIGHT, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY));
  }
  if (
    props.feature_up_down_light !== false &&
    has(device, 'TurnDownLightOn', 'TurnDownLightOff', 'ToggleDownLight')
  ) {
    features.push(binary(FEATURES.DOWN_LIGHT, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY));
  }
  return features;
}

/** Maximum speed of a fan (1..max_speed). */
export const maxSpeedOf = (device) =>
  Number.isInteger(device.props.max_speed) && device.props.max_speed > 0
    ? device.props.max_speed
    : DEFAULT_MAX_SPEED;

/**
 * The Gladys features of a Bond device. Empty: nothing Gladys can show.
 * @param {ReturnType<typeof normalizeDevice>} device
 * @param {{ fireplaces?: string }} [options]
 */
export function describe(device, { fireplaces = 'hidden' } = {}) {
  const kind = kindOf(device);
  const features = [];
  switch (kind) {
    case KINDS.FAN:
      if (has(device, 'TurnOn', 'TurnOff', 'TogglePower')) {
        features.push(binary(FEATURES.POWER, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY));
      }
      if (has(device, 'SetSpeed')) {
        // 0 is "off": the slider turns the fan off at its bottom.
        features.push({
          key: FEATURES.SPEED,
          category: CATEGORIES.FAN,
          type: TYPES.FAN.SPEED,
          min: 0,
          max: maxSpeedOf(device),
          read_only: false,
        });
      }
      if (has(device, 'SetDirection', 'ToggleDirection')) {
        features.push({
          key: FEATURES.DIRECTION,
          category: CATEGORIES.FAN,
          type: TYPES.FAN.AIRFLOW_DIRECTION,
          min: AIRFLOW.FORWARD,
          max: AIRFLOW.REVERSE,
          read_only: false,
        });
      }
      if (has(device, 'BreezeOn')) {
        features.push(binary(FEATURES.BREEZE, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY));
      }
      features.push(...lightFeatures(device));
      break;
    case KINDS.LIGHT:
      features.push(...lightFeatures(device));
      break;
    case KINDS.SHADE:
      if (has(device, 'Open', 'Close', 'ToggleOpen')) {
        features.push({
          key: FEATURES.COVER,
          category: CATEGORIES.SHUTTER,
          type: TYPES.SHUTTER.STATE,
          min: COVER.CLOSE,
          max: COVER.OPEN,
          read_only: false,
        });
      }
      if (has(device, 'SetPosition')) {
        features.push({
          key: FEATURES.POSITION,
          category: CATEGORIES.SHUTTER,
          type: TYPES.SHUTTER.POSITION,
          min: 0,
          max: 100,
          unit: UNITS.PERCENT,
          read_only: false,
        });
      }
      break;
    case KINDS.FIREPLACE:
      // Never controllable from Gladys: see CLAUDE.md, "Fireplaces".
      if (fireplaces !== 'read_only') {
        return { kind, features: [] };
      }
      if (has(device, 'TurnOn', 'TurnOff', 'TogglePower')) {
        features.push(binary(FEATURES.POWER, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY, true));
      }
      if (has(device, 'SetFlame')) {
        features.push({
          key: FEATURES.FLAME,
          category: CATEGORIES.SWITCH,
          type: TYPES.SWITCH.DIMMER,
          min: 0,
          max: 100,
          unit: UNITS.PERCENT,
          read_only: true,
        });
      }
      break;
    case KINDS.GENERIC:
      if (has(device, 'TurnOn', 'TurnOff', 'TogglePower')) {
        features.push(binary(FEATURES.POWER, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY));
      }
      break;
    default:
      return { kind: null, features: [] };
  }
  return { kind, features };
}

const flag = (value) => (value === undefined || value === null ? null : value ? 1 : 0);
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * One Gladys value per feature, from the state the bridge believes. A value
 * the state does not carry is null (nothing published).
 * @param {string[]} keys the feature keys of the device (describe())
 * @param {object} state `/v2/devices/{id}/state` or a BPUP body
 * @returns {Array<{ key: string, value: number|null }>}
 */
export function featureValues(keys, state = {}) {
  return keys.map((key) => ({ key, value: valueOf(key, state) }));
}

function valueOf(key, state) {
  switch (key) {
    case FEATURES.POWER:
      return flag(state.power);
    case FEATURES.SPEED: {
      const speed = number(state.speed);
      // The bridge keeps the last speed while the fan is off: Gladys shows 0.
      return speed === null ? null : state.power === 0 ? 0 : speed;
    }
    case FEATURES.DIRECTION:
      return state.direction === -1
        ? AIRFLOW.REVERSE
        : state.direction === 1
          ? AIRFLOW.FORWARD
          : null;
    case FEATURES.BREEZE:
      return Array.isArray(state.breeze) ? flag(state.breeze[0]) : null;
    case FEATURES.LIGHT:
      return flag(state.light);
    case FEATURES.BRIGHTNESS:
      return number(state.brightness);
    case FEATURES.COLOR_TEMP:
      return number(state.color_temp) === null ? null : Math.round(state.color_temp);
    case FEATURES.UP_LIGHT:
      // On only when the main light is on too (Home Assistant does the same).
      return state.up_light === undefined ? null : state.up_light && state.light !== 0 ? 1 : 0;
    case FEATURES.DOWN_LIGHT:
      return state.down_light === undefined ? null : state.down_light && state.light !== 0 ? 1 : 0;
    case FEATURES.COVER:
      return state.open === undefined || state.open === null
        ? null
        : state.open
          ? COVER.OPEN
          : COVER.CLOSE;
    case FEATURES.POSITION:
      return number(state.position) === null ? null : 100 - state.position;
    case FEATURES.FLAME:
      return number(state.flame);
    default:
      return null;
  }
}

/** A command that cannot be run: the message says why, in English (logs). */
export class CommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
  }
}

const step = (action, argument) => (argument === undefined ? { action } : { action, argument });

/**
 * On/off through the dedicated actions, or the toggle when the remote only
 * has that one — sent only when the believed state differs.
 */
function onOff(device, wanted, current, { on, off, toggle }) {
  const action = wanted ? on : off;
  if (device.actions.has(action)) {
    return [step(action)];
  }
  if (device.actions.has(toggle)) {
    return current === (wanted ? 1 : 0) ? [] : [step(toggle)];
  }
  throw new CommandError('unsupported', `${device.name} has no ${action} nor ${toggle} action`);
}

const POWER = { on: 'TurnOn', off: 'TurnOff', toggle: 'TogglePower' };
const LIGHT = { on: 'TurnLightOn', off: 'TurnLightOff', toggle: 'ToggleLight' };
const UP_LIGHT = { on: 'TurnUpLightOn', off: 'TurnUpLightOff', toggle: 'ToggleUpLight' };
const DOWN_LIGHT = { on: 'TurnDownLightOn', off: 'TurnDownLightOff', toggle: 'ToggleDownLight' };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Turning a fan off: leave the breeze mode first, as the Bond app does. */
function fanOff(device, state) {
  const steps = [];
  if (Array.isArray(state.breeze) && state.breeze[0] && device.actions.has('BreezeOff')) {
    steps.push(step('BreezeOff'));
  }
  return [...steps, ...onOff(device, false, state.power, POWER)];
}

/**
 * The Bond actions that apply a Gladys value to a feature.
 * @param {ReturnType<typeof normalizeDevice>} device
 * @param {string} key feature key
 * @param {number} raw the Gladys value
 * @param {object} state the believed state (for the toggles)
 * @returns {Array<{ action: string, argument?: number }>} empty: nothing to do
 */
export function commandFor(device, key, raw, state = {}) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new CommandError('invalid', `invalid value ${raw}`);
  }
  const kind = kindOf(device);
  if (kind === KINDS.FIREPLACE) {
    throw new CommandError('read_only', 'fireplaces are read-only in Gladys');
  }
  switch (key) {
    case FEATURES.POWER:
      return value ? onOff(device, true, state.power, POWER) : fanOff(device, state);
    case FEATURES.SPEED: {
      const speed = Math.round(value);
      if (speed <= 0) {
        return fanOff(device, state);
      }
      return [step('SetSpeed', clamp(speed, 1, maxSpeedOf(device)))];
    }
    case FEATURES.DIRECTION: {
      const direction = value === AIRFLOW.REVERSE ? -1 : 1;
      if (device.actions.has('SetDirection')) {
        return [step('SetDirection', direction)];
      }
      return state.direction === direction ? [] : [step('ToggleDirection')];
    }
    case FEATURES.BREEZE:
      if (value) {
        return [step('BreezeOn')];
      }
      if (device.actions.has('BreezeOff')) {
        return [step('BreezeOff')];
      }
      throw new CommandError('unsupported', `${device.name} has no BreezeOff action`);
    case FEATURES.LIGHT:
      return onOff(device, Boolean(value), state.light, LIGHT);
    case FEATURES.BRIGHTNESS: {
      const brightness = Math.round(value);
      if (brightness <= 0) {
        return onOff(device, false, state.light, LIGHT);
      }
      return [step('SetBrightness', clamp(brightness, 1, 100))];
    }
    case FEATURES.COLOR_TEMP:
      // The API resolution is 100 K.
      return [step('SetColorTemp', Math.round(value / 100) * 100)];
    case FEATURES.UP_LIGHT:
      return onOff(device, Boolean(value), state.up_light, UP_LIGHT);
    case FEATURES.DOWN_LIGHT:
      return onOff(device, Boolean(value), state.down_light, DOWN_LIGHT);
    case FEATURES.COVER:
      return coverCommand(device, value, state);
    case FEATURES.POSITION:
      return [step('SetPosition', 100 - clamp(Math.round(value), 0, 100))];
    default:
      throw new CommandError('unsupported', `unknown feature ${key}`);
  }
}

function coverCommand(device, value, state) {
  if (value === COVER.STOP) {
    if (device.actions.has('Hold')) {
      return [step('Hold')];
    }
    throw new CommandError('unsupported', `${device.name} has no Hold action`);
  }
  const open = value > 0;
  const action = open ? 'Open' : 'Close';
  if (device.actions.has(action)) {
    return [step(action)];
  }
  if (device.actions.has('ToggleOpen')) {
    return state.open === (open ? 1 : 0) ? [] : [step('ToggleOpen')];
  }
  throw new CommandError('unsupported', `${device.name} has no ${action} action`);
}

// "Tell state" corrections offered by the action and the scene action: the
// key, and the state field it writes, with the value.
export const BELIEFS = Object.freeze({
  power_on: { field: 'power', value: 1 },
  power_off: { field: 'power', value: 0 },
  light_on: { field: 'light', value: 1 },
  light_off: { field: 'light', value: 0 },
  open: { field: 'open', value: 1 },
  closed: { field: 'open', value: 0 },
});

/**
 * The state patch of a "tell state" correction, checked against the device:
 * a belief the device does not track is refused.
 * @returns {Record<string, number>}
 */
export function beliefPatch(device, belief, state = {}) {
  const entry = BELIEFS[belief];
  if (!entry) {
    throw new CommandError('invalid', `unknown state ${belief}`);
  }
  if (!(entry.field in state)) {
    throw new CommandError('unsupported', `${device.name} has no "${entry.field}" state`);
  }
  return { [entry.field]: entry.value };
}
