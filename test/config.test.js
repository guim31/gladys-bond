import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, addressOf, normalizeConfig, parseHost } from '../src/config.js';

test('an address is an IP, a name, with a port or a pasted URL', () => {
  assert.deepEqual(parseHost('192.0.2.20'), { host: '192.0.2.20', port: 80 });
  assert.deepEqual(parseHost(' bond-zzbl12345.local '), { host: 'bond-zzbl12345.local', port: 80 });
  assert.deepEqual(parseHost('http://192.0.2.20/'), { host: '192.0.2.20', port: 80 });
  assert.deepEqual(parseHost('192.0.2.20:8080'), { host: '192.0.2.20', port: 8080 });
  assert.equal(addressOf({ host: '192.0.2.20', port: 8080 }), '192.0.2.20:8080');
  assert.equal(addressOf({ host: '192.0.2.20', port: 80 }), '192.0.2.20');
});

test('an address that cannot be the local API is refused', () => {
  for (const raw of [
    '',
    '   ',
    'https://192.0.2.20',
    'http://user:pass@192.0.2.20',
    'ht tp://x',
    42,
  ]) {
    assert.equal(parseHost(raw), null, String(raw));
  }
});

test('the defaults: no bridge, fireplaces hidden, French names', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config, { bridges: [], invalidSlots: [], fireplaces: 'hidden', language: 'fr' });
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), config);
  assert.deepEqual(normalizeConfig(null), config);
});

test('three slots, each with its token; a bad address is reported, not dropped silently', () => {
  const config = normalizeConfig({
    bridge_1_host: '192.0.2.20',
    bridge_1_token: ' 0123456789abcdef ',
    bridge_2_host: 'https://nope',
    bridge_3_host: '192.0.2.22',
    fireplaces: 'read_only',
    language: 'de',
  });
  assert.deepEqual(config.bridges, [
    { slot: 1, host: '192.0.2.20', port: 80, token: '0123456789abcdef' },
    { slot: 3, host: '192.0.2.22', port: 80, token: '' },
  ]);
  assert.deepEqual(config.invalidSlots, [2]);
  assert.equal(config.fireplaces, 'read_only');
  assert.equal(config.language, 'de');
  assert.equal(normalizeConfig({ fireplaces: 'control', language: 'it' }).fireplaces, 'hidden');
});
