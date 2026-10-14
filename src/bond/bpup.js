// -----------------------------------------------------------------------------
// BPUP, the Bond Push UDP Protocol: the bridge sends every state change of
// its devices to the clients that registered with a keep-alive datagram.
//
//   client → bridge:30007   "\n" (keep-alive), again every 60 s
//   bridge → client         {"B":"ZZBL12345","t":"devices/aabbccdd/state","s":200,"b":{...}}
//
// The bridge answers the keep-alive itself, so a silent socket means the
// push is not working (old firmware, a firewall, the NAT of Docker dropped
// the flow): the hub then polls every 30 s, as without push.
//
// Why it works from the bridge network of the Gladys sandbox (no broadcast
// there): BPUP is unicast both ways. The keep-alive leaves through the NAT,
// the answers come back on the same flow, and the keep-alive every 60 s keeps
// that flow open (Linux keeps an answered UDP flow 120 s by default).
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';

export const BPUP_PORT = 30007;
export const KEEP_ALIVE_MS = 60_000;
const KEEP_ALIVE = Buffer.from('\n');

/**
 * Parse one BPUP datagram. Some firmwares prefix the JSON with a few bytes:
 * the object starts at the first `{`.
 * @param {Buffer|string} data
 * @returns {object|null}
 */
export function parseBpup(data) {
  const text = data.toString('utf8');
  const start = text.indexOf('{');
  if (start === -1) {
    return null;
  }
  try {
    const message = JSON.parse(text.slice(start).trim());
    return message && typeof message === 'object' && !Array.isArray(message) ? message : null;
  } catch {
    return null;
  }
}

/**
 * The state update a BPUP message carries, if any.
 * @param {object} message parsed datagram
 * @returns {{ deviceId: string, state: object } | null}
 */
export function stateUpdateOf(message) {
  const topic = typeof message?.t === 'string' ? message.t.split('/') : [];
  if (
    message?.s !== 200 ||
    topic.length !== 3 ||
    topic[0] !== 'devices' ||
    topic[2] !== 'state' ||
    !message.b ||
    typeof message.b !== 'object'
  ) {
    return null;
  }
  return { deviceId: topic[1], state: message.b };
}

/**
 * Open the push channel of one bridge.
 * @param {object} options
 * @param {string} options.host
 * @param {number} [options.port]
 * @param {(message: object) => void} options.onMessage every valid datagram
 * @param {(err: Error) => void} [options.onError]
 * @returns {{ keepAlive: () => void, close: () => void }} the caller sends the
 *   keep-alive every KEEP_ALIVE_MS (one timer for the whole hub)
 */
export function openBpup({ host, port = BPUP_PORT, onMessage, onError = () => {} }) {
  const socket = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
  let closed = false;
  let bound = false;

  socket.on('message', (data, remote) => {
    // Only the bridge itself: anything else on this port is not BPUP.
    if (remote.port !== port) {
      return;
    }
    const message = parseBpup(data);
    if (message) {
      onMessage(message);
    }
  });
  // An unreachable bridge answers with ICMP: ECONNREFUSED on the socket,
  // reported, never fatal — the next keep-alive tries again.
  socket.on('error', (err) => onError(err));

  const keepAlive = () => {
    if (closed || !bound) {
      return;
    }
    socket.send(KEEP_ALIVE, port, host, (err) => {
      if (err && !closed) {
        onError(err);
      }
    });
  };

  socket.bind(0, () => {
    bound = true;
    keepAlive();
  });
  // Never keeps the process alive on its own.
  socket.unref();

  return {
    keepAlive,
    close() {
      if (closed) {
        return;
      }
      closed = true;
      try {
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}
