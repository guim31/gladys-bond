// -----------------------------------------------------------------------------
// The "Ceiling fan" widget: a content the core renders as sent (budget,
// vocabulary), live tiles bound to features that exist, buttons that drive
// the fan like its remote, a readable sentence when there is nothing to show.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { TEXT, WIDGET_ACTIONS } from '../src/widgets.js';
import {
  BEDROOM_FAN,
  FAN,
  SHADES,
  TOKEN,
  createDevices,
  createWorld,
  ids,
} from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.stop());
  await createDevices(w);
  return w;
}

async function content(w, deviceId, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, {
    settings: { device: deviceId ? ids(w, deviceId).device : undefined },
    language,
  });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

const featureIds = (w) =>
  new Set(w.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)));

for (const [label, deviceId] of [
  ['dedicated actions, dimmable light', FAN],
  ['toggle-only remote, breeze', BEDROOM_FAN],
]) {
  test(`a fan (${label}): valid content, live tiles on real features`, async (t) => {
    const w = await world(t);
    for (const language of ['en', 'fr', 'de', 'es']) {
      const widget = await content(w, deviceId, language);
      assert.deepEqual(validateWidgetContent(widget), [], language);
      assert.ok(widget.components.length <= 8, 'the content budget');
      const known = featureIds(w);
      for (const component of widget.components.filter((c) => c.device_feature)) {
        assert.ok(known.has(component.device_feature), component.device_feature);
      }
      const keys = widget.components.filter((c) => c.action).map((c) => c.action.key);
      assert.equal(new Set(keys).size, keys.length, 'one key per button');
    }
  });
}

test('the status says what Bond believes, in the language of the dashboard', async (t) => {
  const w = await world(t);
  const widget = await content(w, FAN, 'fr');
  const status = widget.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Ventilateur', 'Allumé'],
      ['Lumière', 'Allumé'],
      ['Sens', 'Normal'],
    ],
  );
  const heading = widget.components.find((c) => c.variant === 'heading');
  assert.equal(heading.text, 'Living Room Fan');
});

test('the buttons: faster, slower down to off, light, power', async (t) => {
  const w = await world(t);
  const settings = { device: ids(w, FAN).device };
  const tap = async (key) => {
    const ack = await w.fake.widgetAction(WIDGET_KEY, key, {}, { settings });
    assert.equal(ack.success, true, ack.error);
    return ack.data?.message ?? ack.data;
  };
  const speed = () => w.fake.lastState(ids(w, FAN).feature('speed'));

  assert.deepEqual(await tap(WIDGET_ACTIONS.FASTER), {
    en: 'Speed 4 / 6',
    fr: 'Vitesse 4 / 6',
    de: 'Stufe 4 / 6',
    es: 'Velocidad 4 / 6',
  });
  assert.equal(speed(), 4);
  await tap(WIDGET_ACTIONS.SLOWER);
  assert.equal(speed(), 3);

  const light = await tap(WIDGET_ACTIONS.LIGHT);
  assert.equal(light.en, 'Light off');
  assert.equal(w.fake.lastState(ids(w, FAN).feature('light')), 0);

  const off = await tap(WIDGET_ACTIONS.POWER);
  assert.equal(off.en, 'Fan off');
  assert.equal(speed(), 0);
  assert.equal((await tap(WIDGET_ACTIONS.SLOWER)).en, 'The fan is already off');
  const on = await tap(WIDGET_ACTIONS.FASTER);
  assert.equal(on.en, 'Speed 1 / 6');
  assert.equal(speed(), 1);
});

test('a device that is no fan, or none: a sentence, no error', async (t) => {
  const w = await world(t);
  for (const deviceId of [SHADES, undefined]) {
    const widget = await content(w, deviceId);
    assert.deepEqual(widget.components, [{ type: 'text', variant: 'body', text: TEXT.en.pick }]);
  }
  const ack = await w.fake.widgetAction(
    WIDGET_KEY,
    WIDGET_ACTIONS.FASTER,
    {},
    { settings: { device: ids(w, SHADES).device } },
  );
  assert.equal(ack.success, false);
});

test('not configured: the widget says to configure the bridge', async (t) => {
  const w = await createWorld({ config: { language: 'en' } });
  t.after(() => w.stop());
  const widget = await content(w, undefined, 'es');
  assert.deepEqual(widget.components, [
    { type: 'text', variant: 'body', text: TEXT.es.notConfigured },
  ]);
});

test('a bridge that stopped answering shows in the status', async (t) => {
  const w = await world(t, {
    config: (b) => ({ bridge_1_host: b[0].address, bridge_1_token: TOKEN, language: 'en' }),
  });
  w.bridge.online = false;
  w.clock.advance(30_000);
  w.hub.records.get(1).push.lastMessageAt = null;
  await w.hub.cycle();
  const widget = await content(w, FAN);
  const status = widget.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items[0], {
    label: 'Bond bridge',
    value: 'Unreachable',
    color: 'danger',
  });
  assert.deepEqual(validateWidgetContent(widget), []);
});

test('a pushed change of a fan asks the widget to refresh', async (t) => {
  const w = await world(t);
  const before = w.fake.widgetRefreshes.length;
  await w.hub.applyState(w.hub.records.get(1), w.hub.records.get(1).devices.get(FAN), {
    power: 0,
  });
  assert.equal(w.fake.widgetRefreshes.length, before + 1);
  // The same state again: nothing to refresh.
  await w.hub.applyState(w.hub.records.get(1), w.hub.records.get(1).devices.get(FAN), {
    power: 0,
  });
  assert.equal(w.fake.widgetRefreshes.length, before + 1);
});
