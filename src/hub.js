// -----------------------------------------------------------------------------
// The Bond hub: one record per configured bridge, its devices and what the
// bridge believes about them, kept fresh by two paths:
//
//   - push (BPUP, src/bond/bpup.js): the bridge sends each state change as it
//     happens — commands from Gladys, the Bond app, and on a Bond Bridge Pro
//     or a Smart by Bond device, the remotes it hears;
//   - reading (GET /state): every 30 s while the push is silent, every
//     10 minutes while it works, as a safety net.
//
// The timer is the container's own (GladysAssistant/Gladys#3198: the core
// does not reliably poll external devices). Gladys' onPoll stays a fallback
// that reads a device only when the timer has not done it recently.
//
// Only the devices the user added to Gladys are read and published: Gladys
// drops the states of a device it does not know.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { BondClient, BondError, ERROR_KINDS } from './bond/client.js';
import { BPUP_PORT, KEEP_ALIVE_MS, openBpup, stateUpdateOf } from './bond/bpup.js';
import {
  BELIEFS,
  CommandError,
  KINDS,
  beliefPatch,
  commandFor,
  describe,
  featureValues,
  normalizeDevice,
} from './bond/model.js';
import { addressOf, normalizeConfig } from './config.js';
import { buildDevice, deviceIds, displayName, parseExternalId, publishable } from './devices.js';
import { createIssueLog } from './issues.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  FIND_TEXT,
  REPORT_TEXT,
  TOKEN_TEXT,
  commandErrorText,
  inEveryLanguage,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'bond-hub' });

export const WIDGET_KEY = 'ceiling_fan';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  UNREACHABLE: 'bridge_unreachable',
  RECOVERED: 'bridge_recovered',
});

export const HUB_TIMINGS = {
  // Reading period while the push is silent (and the timer period).
  pollMs: 30_000,
  // The push counts as working while a datagram came this recently. The
  // bridge answers each keep-alive (sent every 60 s): 70 s, as bond-async.
  pushAliveMs: 70_000,
  // Even while the push works, every added device is read this often.
  safetyReadMs: 10 * 60_000,
  // An action returns before the bridge updated its belief: read it after.
  afterActionMs: 400,
  // An unchanged value is published again this often (Gladys shows "no
  // recent value" past 48 h).
  heartbeatMs: 6 * 60 * 60_000,
  // Failed cycles in a row before a bridge counts as down (scene event).
  downAfterFailures: 2,
};

const delay = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : null);

const signature = (bridge) => JSON.stringify([bridge.host, bridge.port, bridge.token]);

/** A user-facing error: the message is shown in Gladys, `text` has every language. */
export class UserError extends Error {
  constructor(text, language) {
    super(pick(text, language));
    this.name = 'UserError';
    this.text = text;
  }
}

export class BondHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {Function} [options.request] HTTP seam of the client
   * @param {Function} [options.openPush] BPUP seam (openBpup)
   * @param {(bridge: object) => number} [options.pushPort] BPUP port of a bridge
   * @param {boolean} [options.timers] periodic timer (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({
    gladys,
    request,
    openPush = openBpup,
    pushPort = () => BPUP_PORT,
    timers = true,
    timings,
    now,
  }) {
    this.gladys = gladys;
    this.request = request;
    this.openPush = openPush;
    this.pushPort = pushPort;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = normalizeConfig();
    /** @type {Map<number, object>} bridge records, by slot */
    this.records = new Map();
    this.transports = new Map();
    this.connection = null;
    this.timer = null;
    this.stopped = false;
    this.issues = createIssueLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const wanted = new Map(config.bridges.map((bridge) => [bridge.slot, bridge]));
    for (const [slot, record] of this.records) {
      const bridge = wanted.get(slot);
      if (!bridge || record.signature !== signature(bridge)) {
        this.dropRecord(record);
        this.records.delete(slot);
      }
    }
    const fresh = [];
    for (const bridge of config.bridges) {
      if (!this.records.has(bridge.slot)) {
        const record = this.newRecord(bridge);
        this.records.set(bridge.slot, record);
        fresh.push(record);
      }
    }
    // A new fireplace mode or language: every device is described again.
    await Promise.all(fresh.map((record) => this.connect(record)));
    await this.publishDevices();
    await this.publishAllStates();
    await this.afterChanges();
    this.schedule();
  }

  newRecord(bridge) {
    const record = {
      slot: bridge.slot,
      bridge,
      signature: signature(bridge),
      client: new BondClient({
        host: bridge.host,
        port: bridge.port,
        token: bridge.token,
        request: this.request,
      }),
      bondId: null,
      version: null,
      name: null,
      /** @type {Map<string, { device: object, state: object, readAt: number }>} */
      devices: new Map(),
      connected: false,
      error: null,
      failures: 0,
      down: false,
      downSince: null,
      lastFullReadAt: 0,
      push: { channel: null, lastMessageAt: null, lastKeepAliveAt: 0, alive: false },
      queue: Promise.resolve(),
      dropped: false,
    };
    this.openPushChannel(record);
    return record;
  }

  dropRecord(record) {
    record.dropped = true;
    record.push.channel?.close();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    for (const record of this.records.values()) {
      this.dropRecord(record);
    }
  }

  /** Run `fn` after the work in progress on the same bridge: one at a time. */
  exclusive(record, fn) {
    const run = record.queue.then(() => (record.dropped ? undefined : fn()));
    record.queue = run.catch(() => {});
    return run;
  }

  label(record) {
    const name = record.name ?? record.bondId;
    const address = addressOf(record.bridge);
    return name ? `Bond ${name} (${address})` : `Bond bridge ${address}`;
  }

  // --- Timer -----------------------------------------------------------------

  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.cycle();
        this.issues.ok('cycle', 'Reading cycle works again');
      } catch (err) {
        this.issues.fail('cycle', `Reading cycle failed: ${err.message}`);
      } finally {
        this.schedule();
      }
    }, this.timings.pollMs);
  }

  /**
   * One timer cycle: keep-alive of the push channels, then every bridge read
   * as needed (never thrown: failures are recorded per bridge).
   */
  async cycle() {
    await Promise.all([...this.records.values()].map((record) => this.cycleRecord(record)));
    await this.afterChanges();
  }

  async cycleRecord(record) {
    const now = this.now();
    if (now - record.push.lastKeepAliveAt >= KEEP_ALIVE_MS) {
      record.push.lastKeepAliveAt = now;
      record.push.channel?.keepAlive();
    }
    this.watchPush(record);
    if (!record.connected) {
      // Never reached yet (off at startup, wrong token...): try again.
      await this.connect(record);
      if (record.connected) {
        await this.publishDevices();
        await this.publishRecordStates(record);
      }
      return;
    }
    const pushWorks = this.pushAlive(record);
    if (
      record.error ||
      !pushWorks ||
      this.now() - record.lastFullReadAt >= this.timings.safetyReadMs
    ) {
      await this.readStates(record, this.createdDeviceIds(record), { full: true });
    } else {
      // Nothing to read: only the heartbeat of the unchanged values.
      await this.publishRecordStates(record);
    }
  }

  pushAlive(record) {
    const last = record.push.lastMessageAt;
    return last !== null && this.now() - last < this.timings.pushAliveMs;
  }

  /** Log the push channel starting and stopping (lifecycle, not each message). */
  watchPush(record) {
    const alive = this.pushAlive(record);
    if (alive === record.push.alive) {
      return;
    }
    record.push.alive = alive;
    if (alive) {
      logger.info(`${this.label(record)}: live updates (BPUP) received`);
    } else {
      logger.info(`${this.label(record)}: live updates silent, reading every 30 s`);
    }
  }

  // --- Push --------------------------------------------------------------------

  openPushChannel(record) {
    try {
      record.push.channel = this.openPush({
        host: record.bridge.host,
        port: this.pushPort(record.bridge),
        onMessage: (message) => this.onPushMessage(record, message),
        onError: (err) =>
          this.issues.fail(
            `push:${record.slot}`,
            `${this.label(record)}: live updates: ${err.message}`,
          ),
      });
      record.push.lastKeepAliveAt = this.now();
    } catch (err) {
      this.issues.fail(
        `push:${record.slot}`,
        `${this.label(record)}: live updates: ${err.message}`,
      );
    }
  }

  onPushMessage(record, message) {
    if (record.dropped) {
      return;
    }
    record.push.lastMessageAt = this.now();
    this.issues.ok(`push:${record.slot}`, `${this.label(record)}: live updates work again`);
    this.watchPush(record);
    const update = stateUpdateOf(message);
    if (!update) {
      return;
    }
    const entry = record.devices.get(update.deviceId);
    if (!entry) {
      logger.debug(`${this.label(record)}: push for unknown device ${update.deviceId}`);
      return;
    }
    logger.debug(`${this.label(record)}: push ${update.deviceId} ${JSON.stringify(update.state)}`);
    this.applyState(record, entry, update.state).catch((err) =>
      this.issues.fail('push-apply', `Applying a live update failed: ${err.message}`),
    );
  }

  // --- Reading the bridges ----------------------------------------------------------

  /**
   * Read the identity and the devices of a bridge. Errors are recorded on
   * the record (never thrown).
   */
  connect(record) {
    return this.exclusive(record, async () => {
      try {
        const version = await record.client.version();
        if (typeof version.bondid !== 'string' || !version.bondid) {
          throw new BondError(ERROR_KINDS.NOT_BOND, `${this.label(record)}: no Bond ID`);
        }
        record.version = version;
        record.bondId = version.bondid;
        if (!record.bridge.token) {
          // Not a refusal of the bridge: ERROR_TEXT.no_token tells what to do.
          throw new BondError('no_token', `${this.label(record)}: no local token configured`);
        }
        const ids = await record.client.deviceIds();
        const entries = await Promise.all(
          ids.map(async (id) => {
            const [info, props, state] = await Promise.all([
              record.client.device(id),
              record.client.properties(id).catch(() => ({})),
              record.client.state(id),
            ]);
            return { device: normalizeDevice(id, info, props), state, readAt: this.now() };
          }),
        );
        // Smart by Bond devices are no bridge: no /v2/bridge, their own name.
        const bridgeInfo = await record.client.bridge().catch(() => null);
        record.name =
          (typeof bridgeInfo?.name === 'string' && bridgeInfo.name.trim()) ||
          (entries.length === 1 && !isBridgeId(record.bondId) ? entries[0].device.name : null) ||
          record.bondId;
        const previous = record.devices;
        record.devices = new Map(entries.map((entry) => [entry.device.id, entry]));
        record.lastFullReadAt = this.now();
        const first = !record.connected;
        record.connected = true;
        this.recordSuccess(record, { first });
        if (first || previous.size !== record.devices.size) {
          logger.info(
            `${this.label(record)}: connected, ${record.version.model ?? 'model unknown'} ` +
              `${record.version.fw_ver ?? ''}, ${record.devices.size} device(s)`.trim(),
          );
        }
      } catch (err) {
        if (!(err instanceof BondError)) {
          throw err;
        }
        await this.recordFailure(record, err);
      }
    });
  }

  /** Re-read the device list of every bridge (the "Search" of the Discovery tab). */
  async rediscover() {
    await Promise.all([...this.records.values()].map((record) => this.connect(record)));
    await this.publishDevices();
    await this.publishAllStates();
    await this.afterChanges();
  }

  /** The device ids of a bridge the user added to Gladys. */
  createdDeviceIds(record) {
    if (!record.bondId) {
      return [];
    }
    const created = new Set((this.gladys.devices ?? []).map((device) => device.external_id));
    return [...record.devices.keys()].filter((id) =>
      created.has(deviceIds(this.gladys, record.bondId, id).device),
    );
  }

  isCreated(record, id) {
    const externalId = deviceIds(this.gladys, record.bondId, id).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /**
   * Read the state of some devices of a bridge and publish what changed.
   * @param {boolean} [options.full] every added device: the timer's reading
   */
  readStates(record, ids, { full = false } = {}) {
    return this.exclusive(record, async () => {
      try {
        // No device added yet: still check that the bridge answers.
        const states =
          ids.length === 0
            ? await record.client.version().then(() => [])
            : await Promise.all(ids.map((id) => record.client.state(id)));
        if (full) {
          record.lastFullReadAt = this.now();
        }
        this.recordSuccess(record);
        for (const [index, id] of ids.entries()) {
          const entry = record.devices.get(id);
          if (entry) {
            entry.readAt = this.now();
            await this.applyState(record, entry, states[index], { replace: true });
          }
        }
      } catch (err) {
        if (!(err instanceof BondError)) {
          throw err;
        }
        await this.recordFailure(record, err);
      }
    });
  }

  recordSuccess(record, { first = false } = {}) {
    if (record.down) {
      const downMinutes = Math.round((this.now() - record.downSince) / 60_000);
      logger.info(`${this.label(record)} answers again after ${downMinutes} min`);
      this.fire(TRIGGERS.RECOVERED, record, { down_minutes: downMinutes });
    } else if (record.error && !first) {
      logger.info(`${this.label(record)}: connection restored`);
    }
    record.failures = 0;
    record.down = false;
    record.downSince = null;
    record.error = null;
  }

  async recordFailure(record, err) {
    const kind = err.kind;
    const previous = record.error?.kind;
    record.error = { kind, message: err.message };
    // One warning when the problem starts (or changes), not one per cycle.
    if (previous !== kind) {
      logger.warn(err.message);
    } else {
      logger.debug(`${err.message} (again)`);
    }
    // Only silence counts as down: a refused token is a configuration problem,
    // reported by the connection status.
    if (kind !== ERROR_KINDS.UNREACHABLE) {
      record.failures = 0;
      return;
    }
    record.failures += 1;
    if (record.failures === 1) {
      record.downSince = this.now();
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      await this.fire(TRIGGERS.UNREACHABLE, record, {});
    }
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, {
        bridge: bridgeName(record),
        bond_id: record.bondId,
        ...data,
      });
      this.issues.ok('scene-event', 'Scene events accepted again');
    } catch (err) {
      this.issues.fail('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- States ----------------------------------------------------------------------------

  /**
   * A new state for a device (read, pushed, or after a command): remember
   * it, publish what changed when the device is in Gladys.
   */
  async applyState(record, entry, state, { replace = false } = {}) {
    if (!state || typeof state !== 'object') {
      return;
    }
    const before = JSON.stringify(stateWithoutHash(entry.state));
    entry.state = replace ? { ...state } : { ...entry.state, ...state };
    if (!record.bondId || !this.isCreated(record, entry.device.id)) {
      return;
    }
    await this.publishEntry(record, entry);
    const kind = describe(entry.device, this.config).kind;
    if (kind === KINDS.FAN && before !== JSON.stringify(stateWithoutHash(entry.state))) {
      // The widget shows non-live rows (power, direction): re-pull it.
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishEntry(record, entry) {
    const { features } = describe(entry.device, this.config);
    const ids = deviceIds(this.gladys, record.bondId, entry.device.id);
    const states = featureValues(
      features.map((feature) => feature.key),
      entry.state,
    )
      .filter(({ value }) => value !== null)
      .map(({ key, value }) => ({ device_feature_external_id: ids.feature(key), state: value }));
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.issues.ok('states', 'Gladys accepts the states again');
    } catch (err) {
      this.issues.fail('states', `States of ${displayName(entry.device)} refused: ${err.message}`);
    }
  }

  /** Publish (changes and heartbeats only) every added device of a bridge. */
  async publishRecordStates(record) {
    for (const id of this.createdDeviceIds(record)) {
      await this.publishEntry(record, record.devices.get(id));
    }
  }

  async publishAllStates() {
    for (const record of this.records.values()) {
      await this.publishRecordStates(record);
    }
  }

  // --- Devices ---------------------------------------------------------------------------

  buildDevices() {
    const devices = [];
    for (const record of this.records.values()) {
      if (!record.bondId) {
        continue;
      }
      for (const { device } of record.devices.values()) {
        const built = buildDevice(this.gladys, record.bondId, device, this.config);
        if (built) {
          devices.push(publishable(built));
        }
      }
    }
    return devices;
  }

  async publishDevices() {
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
      this.issues.ok('devices', 'Gladys accepts the devices again');
    } catch (err) {
      this.issues.fail('devices', `Publishing the devices failed: ${err.message}`);
    }
  }

  /** The bridge record and the entry of a device external id (or feature id). */
  find(externalId) {
    const parsed = parseExternalId(this.gladys, externalId);
    if (!parsed) {
      return null;
    }
    for (const record of this.records.values()) {
      if (record.bondId === parsed.bondId) {
        const entry = record.devices.get(parsed.deviceId);
        return entry ? { record, entry, featureKey: parsed.featureKey } : null;
      }
    }
    return null;
  }

  /** Like find(), but a user-facing error when the device is unknown. */
  locate(externalId) {
    if (this.records.size === 0) {
      throw new UserError(ACTION_TEXT.noBridge, this.config.language);
    }
    const found = this.find(externalId);
    if (!found) {
      throw new UserError(ACTION_TEXT.unknownDevice, this.config.language);
    }
    return found;
  }

  /** The user added (or updated) a device: send its states now. */
  async onDeviceCreated(device) {
    const found = this.find(device.external_id);
    if (!found) {
      return;
    }
    await this.publishEntry(found.record, found.entry);
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys' onPoll (fallback): read the device unless the timer just did. */
  async pollDevice(device) {
    const found = this.find(device.external_id);
    if (!found) {
      return;
    }
    const { record, entry } = found;
    const age = this.now() - entry.readAt;
    const fresh = this.pushAlive(record)
      ? age < this.timings.safetyReadMs
      : age < this.timings.pollMs * 0.9;
    if (fresh && !record.error) {
      logger.debug(`onPoll ${device.external_id}: read ${age} ms ago, skipped`);
      return;
    }
    await this.readStates(record, [entry.device.id]);
    await this.afterChanges();
  }

  // --- Commands ----------------------------------------------------------------------------

  /** A device feature changed in Gladys (dashboard, scene, voice). */
  async setValue(device, feature, value) {
    const { record, entry, featureKey } = this.locate(feature.external_id ?? device.external_id);
    await this.command(record, entry, featureKey, value);
  }

  /**
   * Apply a Gladys value to a feature of a Bond device: the action(s), then
   * the state read back.
   */
  async command(record, entry, featureKey, value) {
    let steps;
    try {
      steps = commandFor(entry.device, featureKey, value, entry.state);
    } catch (err) {
      if (err instanceof CommandError) {
        logger.warn(`${displayName(entry.device)}: ${err.message}`);
        throw new UserError(commandErrorText(err.code), this.config.language);
      }
      throw err;
    }
    const what = steps.length
      ? steps
          .map((s) => (s.argument === undefined ? s.action : `${s.action}(${s.argument})`))
          .join(', ')
      : 'nothing to do';
    logger.info(`${displayName(entry.device)}: ${featureKey} = ${value} → ${what}`);
    for (const { action, argument } of steps) {
      try {
        await record.client.action(entry.device.id, action, argument);
      } catch (err) {
        if (err instanceof BondError) {
          await this.recordFailure(record, err);
          await this.afterChanges();
        }
        throw err;
      }
    }
    await this.readBack(record, entry);
  }

  /** After a command: the new belief of the bridge, published now. */
  async readBack(record, entry) {
    await delay(this.timings.afterActionMs);
    await this.readStates(record, [entry.device.id]);
    await this.afterChanges();
  }

  /**
   * "Tell state": correct what the bridge believes, without any signal — for
   * a device used with its own remote, which Bond cannot hear (except a Bond
   * Bridge Pro for some remotes).
   * @param {string} deviceExternalId
   * @param {string} belief a key of BELIEFS
   */
  async tellState(deviceExternalId, belief) {
    const { record, entry } = this.locate(deviceExternalId);
    if (!BELIEFS[belief]) {
      throw new UserError(ACTION_TEXT.unsupported, this.config.language);
    }
    let patch;
    try {
      patch = beliefPatch(entry.device, belief, entry.state);
    } catch (err) {
      if (err instanceof CommandError) {
        throw new UserError(commandErrorText(err.code), this.config.language);
      }
      throw err;
    }
    logger.info(`${displayName(entry.device)}: state corrected (${belief}), no signal sent`);
    await record.client.tellState(entry.device.id, patch);
    await this.readBack(record, entry);
    return ACTION_TEXT.stateTold;
  }

  // --- Status in Gladys -------------------------------------------------------------------------

  async afterChanges() {
    await this.publishTransports();
    await this.publishConnectionStatus();
  }

  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (!record.bondId) {
        continue;
      }
      const transport = record.error ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
      for (const id of this.createdDeviceIds(record)) {
        const externalId = deviceIds(this.gladys, record.bondId, id).device;
        if (this.transports.get(externalId) !== transport) {
          entries.push({ external_id: externalId, transport });
        }
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.issues.ok('transports', 'Gladys accepts the transports again');
    } catch (err) {
      this.issues.fail('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name: connected while a bridge answers. */
  connectionStatus() {
    const { bridges, invalidSlots } = this.config;
    if (bridges.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalidHost : CONNECTION_TEXT.noBridge,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.error);
    if (failing.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = inEveryLanguage((language) => {
      const parts = failing.map((record) =>
        labelled(
          bridgeName(record),
          pick(ERROR_TEXT[record.error.kind] ?? ERROR_TEXT.http, language),
          language,
        ),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalidHost, language));
      }
      return parts.join(' · ').slice(0, 200);
    });
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection-status', 'Gladys accepts the connection status again');
    } catch (err) {
      this.issues.fail('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Configuration actions ---------------------------------------------------------------

  /** "Test the connection": read every bridge now, one line each. */
  async testConnection() {
    logger.info('Action: test the connection');
    await this.rediscover();
    if (this.records.size === 0) {
      return this.connectionStatus().message;
    }
    return inEveryLanguage((language) => {
      const text = REPORT_TEXT[language];
      const lines = [...this.records.values()].map((record) => {
        const name = bridgeName(record);
        if (record.error) {
          return labelled(
            name,
            pick(ERROR_TEXT[record.error.kind] ?? ERROR_TEXT.http, language),
            language,
          );
        }
        const published = [...record.devices.values()].filter(
          ({ device }) => describe(device, this.config).features.length > 0,
        ).length;
        const parts = [text.ok, record.version?.fw_ver, text.devices(published)].filter(Boolean);
        if (published < record.devices.size) {
          parts.push(text.skipped(record.devices.size - published));
        }
        parts.push(this.pushAlive(record) ? text.push : text.noPush);
        return labelled(name, parts.join(', '), language);
      });
      if (this.config.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalidHost, language));
      }
      return lines.join('\n');
    });
  }

  /**
   * "Get the local token": for each bridge whose token is missing or
   * refused, ask the bridge (it gives it during 10 minutes after a power
   * cycle) and save it in the configuration.
   */
  async fetchToken() {
    logger.info('Action: get the local token');
    if (this.records.size === 0) {
      return this.connectionStatus().message;
    }
    const results = [];
    const saved = {};
    for (const record of this.records.values()) {
      const name = () => bridgeName(record);
      if (record.connected && !record.error) {
        results.push({ name: name(), text: 'working' });
        continue;
      }
      try {
        const status = await record.client.tokenStatus();
        if (status.locked === 0 && typeof status.token === 'string' && status.token) {
          saved[`bridge_${record.slot}_token`] = status.token;
          results.push({ name: name(), text: 'saved' });
          logger.info(`${this.label(record)}: local token saved`);
        } else {
          results.push({ name: name(), text: 'locked' });
        }
      } catch (err) {
        if (!(err instanceof BondError)) {
          throw err;
        }
        results.push({ name: name(), error: err.kind });
      }
    }
    if (Object.keys(saved).length > 0) {
      await this.gladys.setConfig(saved);
      await this.reconfigure(normalizeConfig({ ...(await this.gladys.getConfig()), ...saved }));
    }
    return inEveryLanguage((language) =>
      results
        .map(({ name, text, error }) =>
          labelled(
            name,
            error
              ? pick(ERROR_TEXT[error] ?? ERROR_TEXT.http, language)
              : TOKEN_TEXT[language][text],
            language,
          ),
        )
        .join('\n'),
    );
  }

  /**
   * "Find the bridges": an mDNS browse of `_bond._tcp` by the Gladys core
   * (the container cannot see multicast), the new bridges written into the
   * free slots of the configuration.
   */
  async findBridges() {
    logger.info('Action: find the bridges');
    const services = await this.gladys.scanNetwork('mdns', { timeoutSeconds: 5 });
    const found = parseBondServices(services);
    if (found.length === 0) {
      return FIND_TEXT_NONE;
    }
    const raw = (await this.gladys.getConfig()) ?? {};
    const taken = new Set(
      [1, 2, 3].filter(
        (slot) =>
          typeof raw[`bridge_${slot}_host`] === 'string' && raw[`bridge_${slot}_host`].trim(),
      ),
    );
    const update = {};
    const lines = found.map((bridge) => {
      const known = [...this.records.values()].find(
        (record) => record.bondId === bridge.bondId || record.bridge.host === bridge.address,
      );
      if (known) {
        return { bridge, status: 'configured' };
      }
      const slot = [1, 2, 3].find((candidate) => !taken.has(candidate));
      if (!slot) {
        return { bridge, status: 'noSlot' };
      }
      taken.add(slot);
      update[`bridge_${slot}_host`] = bridge.address;
      return { bridge, status: 'added', slot };
    });
    if (Object.keys(update).length > 0) {
      await this.gladys.setConfig(update);
      await this.reconfigure(normalizeConfig({ ...raw, ...update }));
    }
    return inEveryLanguage((language) => {
      const text = FIND_TEXT[language];
      const body = lines.map(({ bridge, status, slot }) => {
        const detail = status === 'added' ? text.added(slot) : text[status];
        return `${bridge.bondId} (${bridge.address}): ${detail}`;
      });
      const next = lines.some((line) => line.status === 'added') ? [text.next] : [];
      return [text.found(found.length), ...body, ...next].join('\n');
    });
  }
}

const FIND_TEXT_NONE = inEveryLanguage((language) => FIND_TEXT[language].none);

/** A Bond ID of a bridge, as opposed to a Smart by Bond device (bond-async's BondType). */
export const isBridgeId = (bondId) => /^([A-C]\w*|Z(Z|X|P)\w*)$/.test(bondId ?? '');

/** The bridge as named to the user: its Bond name, its Bond ID, its address. */
const bridgeName = (record) => record.name ?? record.bondId ?? addressOf(record.bridge);

const stateWithoutHash = (state) => {
  const { _: _hash, ...rest } = state ?? {};
  return rest;
};

/**
 * The Bond bridges among the raw mDNS results: the instance name is the Bond
 * ID (`ZZBL12345._bond._tcp.local`), the address the first IPv4.
 */
export function parseBondServices(services) {
  const bridges = new Map();
  for (const service of Array.isArray(services) ? services : []) {
    const bondId = String(service?.name ?? '')
      .split('.')[0]
      .trim();
    const addresses = Array.isArray(service?.addresses) ? service.addresses : [];
    const address = addresses.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a)) ?? addresses[0];
    if (bondId && address && !bridges.has(bondId)) {
      bridges.set(bondId, { bondId, address });
    }
  }
  return [...bridges.values()];
}
