// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { BondHub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'bond-app' });

// Configuration actions (manifest `actions`), by key: permanent once published.
export const ACTIONS = {
  test_connection: (hub) => hub.testConnection(),
  fetch_token: (hub) => hub.fetchToken(),
  find_bridges: (hub) => hub.findBridges(),
  tell_state: async (hub, fields) => hub.tellState(fields.device, fields.state),
};

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: request, openPush, pushPort, timers, timings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new BondHub({ gladys, ...options });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first read is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): send again what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The timer of the hub does the reading; this only serves a Gladys that
  // polls anyway, and skips a device read moments ago.
  gladys.onPoll(whenReady((device) => hub.pollDevice(device)));

  // Gladys dropped the states sent before the device existed: send them now.
  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(
      key,
      whenReady((fields = {}) => handler(hub, fields)),
    );
  }

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields = {}) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request = {}) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
