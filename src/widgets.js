// -----------------------------------------------------------------------------
// Dashboard widget "Ceiling fan" (manifest `widgets`): one fan chosen in the
// widget settings, its speed as a live tile, its state, and four buttons —
// slower, faster, light, on/off — the controls a wall remote has.
//
// The content is built from the state the hub keeps (push or reading): no
// request to the bridge when Gladys pulls it. The buttons go through the same
// commands as the device features.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { AIRFLOW, FEATURES, KINDS, describe, featureValues, maxSpeedOf } from './bond/model.js';
import { deviceIds, displayName } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { inEveryLanguage } from './texts.js';

// Button action keys: one per button, never reused (the core drops a button
// whose key is already taken), permanent once published.
export const WIDGET_ACTIONS = Object.freeze({
  SLOWER: 'speed_down',
  FASTER: 'speed_up',
  LIGHT: 'light_toggle',
  POWER: 'power_toggle',
});

export const TEXT = {
  en: {
    speed: 'Speed',
    brightness: 'Light',
    fan: 'Fan',
    light: 'Light',
    direction: 'Direction',
    breeze: 'Breeze',
    on: 'On',
    off: 'Off',
    forward: 'Forward',
    reverse: 'Reverse',
    slower: 'Slower',
    faster: 'Faster',
    turnOn: 'Turn on',
    turnOff: 'Turn off',
    pick: 'Choose a ceiling fan in the settings of this widget.',
    notConfigured: 'Configure your Bond bridge in the integration first.',
    bridge: 'Bond bridge',
    offline: 'Unreachable',
    speedToast: (speed, max) => `Speed ${speed} / ${max}`,
    offToast: 'Fan off',
    onToast: 'Fan on',
    lightOnToast: 'Light on',
    lightOffToast: 'Light off',
    alreadyOff: 'The fan is already off',
  },
  fr: {
    speed: 'Vitesse',
    brightness: 'Lumière',
    fan: 'Ventilateur',
    light: 'Lumière',
    direction: 'Sens',
    breeze: 'Brise',
    on: 'Allumé',
    off: 'Éteint',
    forward: 'Normal',
    reverse: 'Inversé',
    slower: 'Moins vite',
    faster: 'Plus vite',
    turnOn: 'Allumer',
    turnOff: 'Éteindre',
    pick: 'Choisissez un ventilateur de plafond dans les réglages de ce widget.',
    notConfigured: "Configurez d'abord votre bridge Bond dans l'intégration.",
    bridge: 'Bridge Bond',
    offline: 'Injoignable',
    speedToast: (speed, max) => `Vitesse ${speed} / ${max}`,
    offToast: 'Ventilateur éteint',
    onToast: 'Ventilateur allumé',
    lightOnToast: 'Lumière allumée',
    lightOffToast: 'Lumière éteinte',
    alreadyOff: 'Le ventilateur est déjà éteint',
  },
  de: {
    speed: 'Stufe',
    brightness: 'Licht',
    fan: 'Ventilator',
    light: 'Licht',
    direction: 'Richtung',
    breeze: 'Brise',
    on: 'An',
    off: 'Aus',
    forward: 'Vorwärts',
    reverse: 'Rückwärts',
    slower: 'Langsamer',
    faster: 'Schneller',
    turnOn: 'Einschalten',
    turnOff: 'Ausschalten',
    pick: 'Wähle in den Einstellungen dieses Widgets einen Deckenventilator.',
    notConfigured: 'Konfiguriere zuerst deine Bond Bridge in der Integration.',
    bridge: 'Bond Bridge',
    offline: 'Nicht erreichbar',
    speedToast: (speed, max) => `Stufe ${speed} / ${max}`,
    offToast: 'Ventilator aus',
    onToast: 'Ventilator an',
    lightOnToast: 'Licht an',
    lightOffToast: 'Licht aus',
    alreadyOff: 'Der Ventilator ist schon aus',
  },
  es: {
    speed: 'Velocidad',
    brightness: 'Luz',
    fan: 'Ventilador',
    light: 'Luz',
    direction: 'Sentido',
    breeze: 'Brisa',
    on: 'Encendido',
    off: 'Apagado',
    forward: 'Normal',
    reverse: 'Inverso',
    slower: 'Más lento',
    faster: 'Más rápido',
    turnOn: 'Encender',
    turnOff: 'Apagar',
    pick: 'Elija un ventilador de techo en los ajustes de este widget.',
    notConfigured: 'Configure primero su Bond Bridge en la integración.',
    bridge: 'Bond Bridge',
    offline: 'Inaccesible',
    speedToast: (speed, max) => `Velocidad ${speed} / ${max}`,
    offToast: 'Ventilador apagado',
    onToast: 'Ventilador encendido',
    lightOnToast: 'Luz encendida',
    lightOffToast: 'Luz apagada',
    alreadyOff: 'El ventilador ya está apagado',
  },
};

const textsOf = (language) => TEXT[language] ?? TEXT.en;
const message = (text) => ({ type: 'text', variant: 'body', text });

/** The fan of the widget settings, or null. */
function fanOf(hub, settings) {
  const found = settings?.device ? hub.find(settings.device) : null;
  if (!found) {
    return null;
  }
  const { kind, features } = describe(found.entry.device, hub.config);
  if (kind !== KINDS.FAN || features.length === 0) {
    return null;
  }
  const keys = features.map((feature) => feature.key);
  const values = Object.fromEntries(
    featureValues(keys, found.entry.state).map(({ key, value }) => [key, value]),
  );
  return { ...found, keys, values };
}

/** Whether the fan turns, as far as Bond believes. */
const isOn = ({ values }) =>
  values[FEATURES.POWER] !== undefined && values[FEATURES.POWER] !== null
    ? values[FEATURES.POWER] === 1
    : (values[FEATURES.SPEED] ?? 0) > 0;

/**
 * The widget content (pure: the hub is only read).
 * @param {import('./hub.js').BondHub} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function buildFanContent(hub, { settings, language } = {}) {
  const text = textsOf(language);
  if (hub.config.bridges.length === 0) {
    return { ttl_seconds: 300, components: [message(text.notConfigured)] };
  }
  const fan = fanOf(hub, settings);
  if (!fan) {
    return { ttl_seconds: 300, components: [message(text.pick)] };
  }
  const { record, entry, keys, values } = fan;
  const ids = deviceIds(hub.gladys, record.bondId, entry.device.id);
  const has = (key) => keys.includes(key);
  const components = [
    { type: 'text', variant: 'heading', text: displayName(entry.device).slice(0, 40) },
  ];
  if (has(FEATURES.SPEED)) {
    components.push({
      type: 'value',
      label: text.speed,
      icon: 'wind',
      device_feature: ids.feature(FEATURES.SPEED),
    });
  }
  if (has(FEATURES.BRIGHTNESS)) {
    components.push({
      type: 'value',
      label: text.brightness,
      icon: 'sun',
      device_feature: ids.feature(FEATURES.BRIGHTNESS),
    });
  }

  const on = isOn(fan);
  const items = [
    {
      label: text.fan,
      value: on ? text.on : text.off,
      color: on ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (has(FEATURES.LIGHT) && values[FEATURES.LIGHT] !== null) {
    const lit = values[FEATURES.LIGHT] === 1;
    items.push({
      label: text.light,
      value: lit ? text.on : text.off,
      color: lit ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (has(FEATURES.DIRECTION) && values[FEATURES.DIRECTION] !== null) {
    items.push({
      label: text.direction,
      value: values[FEATURES.DIRECTION] === AIRFLOW.REVERSE ? text.reverse : text.forward,
      color: WIDGET_COLORS.INFO,
    });
  }
  if (has(FEATURES.BREEZE) && values[FEATURES.BREEZE] === 1) {
    items.push({ label: text.breeze, value: text.on, color: WIDGET_COLORS.INFO });
  }
  if (record.error) {
    items.unshift({ label: text.bridge, value: text.offline, color: WIDGET_COLORS.DANGER });
  }
  components.push({ type: 'status', items });

  if (has(FEATURES.SPEED)) {
    components.push(
      { type: 'button', label: text.slower, icon: 'minus', action: { key: WIDGET_ACTIONS.SLOWER } },
      { type: 'button', label: text.faster, icon: 'plus', action: { key: WIDGET_ACTIONS.FASTER } },
    );
  }
  if (has(FEATURES.LIGHT)) {
    components.push({
      type: 'button',
      label: text.light,
      // The current choice is told by the icon, never by the style (#3153).
      icon: values[FEATURES.LIGHT] === 1 ? 'check-circle' : 'sun',
      action: { key: WIDGET_ACTIONS.LIGHT },
    });
  }
  if (has(FEATURES.POWER) || has(FEATURES.SPEED)) {
    components.push({
      type: 'button',
      label: on ? text.turnOff : text.turnOn,
      icon: 'power',
      action: { key: WIDGET_ACTIONS.POWER },
    });
  }
  return { ttl_seconds: 60, components };
}

/**
 * A button of the widget: the same commands as the device features.
 * @returns {Promise<object>} the toast, in every language
 */
export async function runFanAction(hub, { actionKey, settings }) {
  const fan = fanOf(hub, settings);
  if (!fan) {
    throw new Error(TEXT.en.pick);
  }
  const { record, entry, keys, values } = fan;
  const max = maxSpeedOf(entry.device);
  const speed = values[FEATURES.SPEED] ?? 0;
  const on = isOn(fan);
  const run = (key, value) => hub.command(record, entry, key, value);
  const toast = (render) => inEveryLanguage((language) => render(textsOf(language)));

  switch (actionKey) {
    case WIDGET_ACTIONS.FASTER: {
      const next = Math.min(max, (on ? speed : 0) + 1);
      await run(FEATURES.SPEED, next);
      return toast((text) => text.speedToast(next, max));
    }
    case WIDGET_ACTIONS.SLOWER: {
      if (!on || speed <= 0) {
        return toast((text) => text.alreadyOff);
      }
      const next = speed - 1;
      await run(FEATURES.SPEED, next);
      return toast((text) => (next === 0 ? text.offToast : text.speedToast(next, max)));
    }
    case WIDGET_ACTIONS.LIGHT: {
      const lit = values[FEATURES.LIGHT] === 1;
      await run(FEATURES.LIGHT, lit ? 0 : 1);
      return toast((text) => (lit ? text.lightOffToast : text.lightOnToast));
    }
    case WIDGET_ACTIONS.POWER: {
      if (keys.includes(FEATURES.POWER)) {
        await run(FEATURES.POWER, on ? 0 : 1);
      } else {
        await run(FEATURES.SPEED, on ? 0 : 1);
      }
      return toast((text) => (on ? text.offToast : text.onToast));
    }
    default:
      throw new Error(`Unknown widget action ${actionKey}`);
  }
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get: async (hub, request) => buildFanContent(hub, request),
    action: (hub, request) => runFanAction(hub, request),
  },
};
