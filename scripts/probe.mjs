#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real Bond bridge with the integration's own client and
// model: what the bridge answers, what Gladys would get from it, whether the
// push (BPUP) answers. Sends no action, changes no state, never prints the
// token; the Bond ID and the device ids are shortened.
//
//   BOND_HOST=192.168.1.20 BOND_TOKEN=… node scripts/probe.mjs
//
// Optional: BOND_PUSH_SECONDS (default 10), how long to listen to the push —
// use the Bond app meanwhile to see changes arrive.
// -----------------------------------------------------------------------------

import { BondClient } from '../src/bond/client.js';
import { openBpup, stateUpdateOf } from '../src/bond/bpup.js';
import { describe, normalizeDevice } from '../src/bond/model.js';
import { parseHost } from '../src/config.js';

const address = parseHost(process.env.BOND_HOST ?? '');
if (!address) {
  console.error(
    'Set BOND_HOST to the IP address of the bridge (and BOND_TOKEN to its local token).',
  );
  process.exit(2);
}
const token = (process.env.BOND_TOKEN ?? '').trim();
const pushSeconds = Number(process.env.BOND_PUSH_SECONDS ?? 10);
const mask = (id) =>
  typeof id === 'string' && id.length > 4 ? `${id.slice(0, 2)}…${id.slice(-2)}` : '?';
const typeOf = (value) => (Array.isArray(value) ? `array(${value.length})` : typeof value);

const client = new BondClient({ ...address, token });

async function step(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.log(`${label}: FAILED (${err.kind ?? 'error'}: ${err.message})`);
    return null;
  }
}

const version = await step('version', () => client.version());
if (!version) {
  process.exit(1);
}
console.log('version:', {
  bondid: mask(version.bondid),
  model: version.model,
  target: version.target,
  make: version.make,
  fw_ver: version.fw_ver,
  api: version.api,
  keys: Object.keys(version).sort(),
});

const tokenStatus = await step('token status', () => client.tokenStatus());
if (tokenStatus) {
  console.log('token status:', {
    locked: tokenStatus.locked,
    token_given: typeof tokenStatus.token === 'string' && tokenStatus.token.length > 0,
  });
}

if (!token) {
  console.log('No BOND_TOKEN: stopping before the devices.');
  process.exit(0);
}

const bridge = await step('bridge', () => client.bridge());
if (bridge) {
  console.log('bridge:', { has_name: Boolean(bridge.name), keys: Object.keys(bridge).sort() });
}

const ids = (await step('devices', () => client.deviceIds())) ?? [];
console.log(`devices: ${ids.length}`);
for (const id of ids) {
  const info = await step(`device ${mask(id)}`, () => client.device(id));
  const props = (await step(`properties ${mask(id)}`, () => client.properties(id))) ?? {};
  const state = (await step(`state ${mask(id)}`, () => client.state(id))) ?? {};
  if (!info) {
    continue;
  }
  const device = normalizeDevice(id, info, props);
  const gladys = describe(device, { fireplaces: 'read_only' });
  console.log(`- ${mask(id)} type ${info.type}${info.subtype ? `/${info.subtype}` : ''}`);
  console.log('  actions:', [...device.actions].sort().join(', '));
  console.log(
    '  properties:',
    Object.fromEntries(
      Object.entries(props)
        .filter(([key]) => !['_', 'addr', 'freq', 'bps', 'zero_gap'].includes(key))
        .map(([key, value]) => [key, typeof value === 'object' ? typeOf(value) : value]),
    ),
  );
  console.log('  state:', Object.fromEntries(Object.entries(state).filter(([key]) => key !== '_')));
  console.log(
    '  in Gladys:',
    gladys.kind ?? 'not published',
    gladys.features.map((f) => `${f.key} ${f.category}/${f.type} [${f.min}..${f.max}]`).join(', '),
  );
}

console.log(`push: keep-alive sent, listening ${pushSeconds} s...`);
const messages = [];
const channel = openBpup({
  host: address.host,
  onMessage: (message) => messages.push(message),
  onError: (err) => console.log(`push error: ${err.message}`),
});
await new Promise((resolve) => setTimeout(resolve, pushSeconds * 1000));
channel.close();
console.log(`push: ${messages.length} datagram(s)`);
for (const message of messages) {
  const update = stateUpdateOf(message);
  console.log(
    update
      ? `  state of ${mask(update.deviceId)}: ${JSON.stringify(update.state)}`
      : `  other: keys ${Object.keys(message).sort().join(',')}, t=${message.t ?? '-'}, s=${message.s ?? '-'}`,
  );
}
