# Bond fixtures

What a Bond bridge answers on its local API v2, one file per bridge:
`version` (`GET /v2/sys/version`), `bridge` (`GET /v2/bridge`, `null` on a Smart by Bond device, which
answers 404), `token` (`GET /v2/token`), and per device id the answers of `GET /v2/devices/{id}`,
`/properties` and `/state`. `test/helpers/fakeBond.js` serves them over real HTTP and UDP.

- `bridge-zermatt.json`: a Bond Bridge with two ceiling fans (one with dedicated actions and a dimmable light,
  one with a toggle-only remote, breeze mode and up/down lights), motorized shades, a color-temperature
  light, a fireplace, a generic device and a garage door.
- `smart-by-bond-fan.json`: a Smart by Bond ceiling fan, its own bridge, unlocked token.

Provenance: the field names, types, action names and value conventions come from the Bond Local API v2
documentation (docs-local.appbond.com, not reachable from the development session), the `bond-async` library
(MIT) and the tests of the Home Assistant `bond` integration (Apache-2.0). They are reconstructed, not
captured from a real bridge: the Bond IDs (`ZZBL12345`, `KSMJWCE12345` — the latter from the `bond-async`
tests), device ids, hashes, RF codes and the token are invented. `scripts/probe.mjs` checks them against a
real bridge.
