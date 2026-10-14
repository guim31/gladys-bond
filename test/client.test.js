// -----------------------------------------------------------------------------
// The Bond HTTP client against the fake bridge, over real sockets: the token
// header, the error kinds, the request queue, and never the token in a message.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { BondClient, BondError, ERROR_KINDS, collectionIds } from '../src/bond/client.js';
import { FakeBond, TOKEN } from './helpers/fakeBond.js';

async function bridge(t, name, options) {
  const fake = await new FakeBond(name, options).start();
  t.after(() => fake.stop());
  return fake;
}

const clientOf = (fake, token = TOKEN, options = {}) =>
  new BondClient({ host: '127.0.0.1', port: fake.port, token, ...options });

test('reads the version without a token, the devices with it', async (t) => {
  const fake = await bridge(t);
  const client = clientOf(fake);
  assert.equal((await client.version()).bondid, 'ZZBL12345');
  assert.equal(fake.requests.at(-1).token, undefined, 'no token sent to /v2/sys/version');
  const ids = await client.deviceIds();
  assert.equal(ids.length, 7);
  assert.ok(!ids.includes('_'));
  assert.equal(fake.requests.at(-1).token, TOKEN);
  assert.equal((await client.device(ids[0])).type, 'CF');
  assert.equal((await client.state('79135791')).speed, 3);
});

test('an action and a "tell state" are a PUT and a PATCH with a JSON body', async (t) => {
  const fake = await bridge(t);
  const client = clientOf(fake);
  await client.action('79135791', 'SetSpeed', 2);
  await client.action('79135791', 'TurnLightOff');
  await client.tellState('79135791', { power: 0 });
  assert.deepEqual(
    fake.requests.slice(-3).map(({ method, path, body }) => [method, path, body]),
    [
      ['PUT', '/v2/devices/79135791/actions/SetSpeed', { argument: 2 }],
      ['PUT', '/v2/devices/79135791/actions/TurnLightOff', {}],
      ['PATCH', '/v2/devices/79135791/state', { power: 0 }],
    ],
  );
  assert.equal(fake.state('79135791').power, 0);
});

test('a wrong token is an AUTH error that never repeats the token', async (t) => {
  const fake = await bridge(t);
  const client = clientOf(fake, 'fedcba9876543210');
  await assert.rejects(client.deviceIds(), (err) => {
    assert.ok(err instanceof BondError);
    assert.equal(err.kind, ERROR_KINDS.AUTH);
    assert.equal(err.status, 401);
    assert.ok(!err.message.includes('fedcba9876543210'));
    return true;
  });
});

test('a bridge that stops answering is UNREACHABLE', async (t) => {
  const fake = await bridge(t);
  fake.online = false;
  await assert.rejects(clientOf(fake).version(), { kind: ERROR_KINDS.UNREACHABLE });
  // A closed port too.
  const closed = new BondClient({ host: '127.0.0.1', port: 1, token: TOKEN });
  await assert.rejects(closed.version(), { kind: ERROR_KINDS.UNREACHABLE });
});

test('a bridge that accepts the connection but never answers times out', async (t) => {
  const server = createServer(() => {}); // never answers
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const client = new BondClient({
    host: '127.0.0.1',
    port: server.address().port,
    token: TOKEN,
    timeoutMs: 50,
  });
  await assert.rejects(client.version(), { kind: ERROR_KINDS.UNREACHABLE });
});

test('something else than a Bond bridge is NOT_BOND', async () => {
  const answer = (status, body) => async () => ({ status, body });
  const notFound = new BondClient({ host: 'x', port: 80, token: '', request: answer(404, '') });
  await assert.rejects(notFound.version(), { kind: ERROR_KINDS.NOT_BOND });
  const html = new BondClient({ host: 'x', port: 80, token: '', request: answer(200, '<html>') });
  await assert.rejects(html.version(), { kind: ERROR_KINDS.NOT_BOND });
  const refused = new BondClient({ host: 'x', port: 80, token: '', request: answer(500, '') });
  await assert.rejects(refused.state('a'), { kind: ERROR_KINDS.HTTP, status: 500 });
});

test('no more than two requests at a time reach a bridge', async () => {
  let active = 0;
  let peak = 0;
  const request = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { status: 200, body: '{"power":1}' };
  };
  const client = new BondClient({ host: 'x', port: 80, token: TOKEN, request });
  await Promise.all(Array.from({ length: 10 }, (_, i) => client.state(String(i))));
  assert.equal(peak, 2);
});

test('the keys of a collection skip its hash', () => {
  assert.deepEqual(collectionIds({ _: 'hash', a: { _: '1' }, b: { _: '2' }, __x: {}, c: 3 }), [
    'a',
    'b',
  ]);
  assert.deepEqual(collectionIds(null), []);
});
