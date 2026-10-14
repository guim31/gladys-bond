# Bond Bridge for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that controls the devices of a
[Bond Bridge](https://bondhome.io/), a Bond Bridge Pro or a Smart by Bond device — ceiling fans, shades, lights —
through the official **Bond Local API v2**, over the local network. No cloud, no account.

> **Developed without the hardware: feedback welcome.** The integration is built and tested against a simulated
> bridge (real HTTP and UDP sockets) whose answers follow the Bond Local API documentation, the `bond-async`
> library and the tests of the Home Assistant `bond` integration — not against a real bridge. Please report what
> works and what does not in the [issues](https://github.com/guim31/gladys-bond/issues).

## Features

- **One Gladys device per Bond device**, with the features its remote really has:
  - **ceiling fans**: on/off, speed (1 to the fan's own number of speeds, 0 = off), direction (forward/reverse),
    breeze mode, light and brightness, separate up and down lights;
  - **shades** (and blinds, awnings): open, close, stop, position;
  - **lights**: on/off, brightness, color temperature (kelvin);
  - **generic devices**: on/off;
  - **fireplaces**: hidden by default, or shown **read-only** — never controlled from Gladys (see below).
- **Live state**: the bridge pushes every change over UDP (BPUP); without it, each added device is read every 30 s.
- **Dashboard widget** "Ceiling fan": the speed as a live tile, fan and light state, direction, and four buttons —
  slower, faster, light, on/off — like the wall remote.
- **Scene triggers**: _Bond bridge unreachable_ and _Bond bridge back_ (with the minutes it was away).
- **Scene action** and configuration action _Correct the Bond state_: tell Bond what a device really is after it
  was used with its own remote, without sending any signal.
- Configuration actions: **Find the bridges** (mDNS through the Gladys core), **Get the local token** (read from
  the bridge during the 10 minutes after it starts), **Test the connection**.
- Up to three bridges. Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- A Bond Bridge, Bond Bridge Pro or Smart by Bond device, set up in the Bond app, on the same network as Gladys,
  with a fixed IP address (DHCP reservation).
- Its **local token**: from the Bond app (the bridge → Settings → Advanced → Local token), or with the **Get the
  local token** button within 10 minutes of plugging the bridge back in.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the address of this repository:
   `https://github.com/guim31/gladys-bond` (or install **Bond Bridge** from the catalog once it is listed).
2. In **Configuration**, press **Find the bridges** (or type the IP address), then **Get the local token** (or
   paste it), and **Test the connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in [French](docs/fr.md), [German](docs/de.md) and
[Spanish](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- `GET /v2/sys/version` (no token) gives the Bond ID, the identity of the devices in Gladys
  (`ext:<selector>:bond:<bondid>_<device id>`): an IP change or a renaming keeps the devices and their history.
- `GET /v2/devices`, then for each device `GET /v2/devices/{id}`, `/properties` and `/state`, with the
  `BOND-Token` header. A device gets a feature only when its `actions` list the matching Bond action
  (`SetSpeed`, `TurnLightOn`, `SetPosition`…).
- A command is `PUT /v2/devices/{id}/actions/{Action}` with `{ "argument": … }`, followed by a reading of the
  state. A remote with toggle buttons only (`TogglePower`, `ToggleLight`) is toggled only when the believed state
  differs. _Correct the Bond state_ is `PATCH /v2/devices/{id}/state` ("tell state": no RF signal).
- **BPUP**: a keep-alive datagram to UDP port 30007 every 60 s; the bridge answers it and pushes each
  `devices/{id}/state` change. It is unicast both ways, so it crosses the bridge network of the Gladys sandbox
  (no broadcast needed). While the push answers, devices are read every 10 minutes as a safety net; when it is
  silent for 70 s, every 30 s. The timer is the container's own (Gladys#3198); Gladys' `onPoll` is a fallback that
  skips a device read moments ago.
- At most two requests at a time per bridge, a fresh connection each (`Connection: close`), 5 s timeout.
- Only the devices added to Gladys are read and published; only the values that changed are sent, and every
  value again every 6 hours (heartbeat), when a device is added, and when Gladys reconnects.
- A bridge is "unreachable" after two failed readings in a row (silence only; a refused token is a configuration
  problem shown in the connection status).
- Nothing is stored in `/data`; the tokens stay in the Gladys configuration and never reach the logs.

## Design choices

- **Fireplaces are never controllable**: a gas flame lit by mistake (a scene, a voice assistant, a child on the
  dashboard) is not harmless. They are hidden by default, or shown with read-only features.
- **Garage doors, air conditioners and bidets are not published**: a door opened by mistake is a security
  problem, and the two others have no state Bond tracks usefully.
- The **speed** feature goes from 0 to the fan's maximum: 0 means off, so the dashboard slider turns the fan off at
  its bottom; while the fan is off, Gladys shows 0 although the bridge keeps the last speed.
- Up and down lights are **switches**, not lights: the Gladys dashboard merges every light of a device into one
  light panel.
- The state in Gladys is **what Bond believes** (`has_feedback: false`): an RF remote gives no feedback.

## Checked, and not

- Checked by the tests (`node --test`): every discovered device against the category/type table of
  the core (`test/gladys-rules.test.js`), commands, push and readings end to end over real sockets with the SDK's
  fake Gladys, the timer without `onPoll`, the logs (nothing at info in a normal cycle, never the token), the
  widget content against the core vocabulary, the four languages.
- Not checked, for lack of hardware: a real bridge's answers (the fixtures are reconstructed, see
  [`test/fixtures/bond/README.md`](test/fixtures/bond/README.md)), BPUP through the Docker NAT of the Gladys
  sandbox, the mDNS instance name of a real bridge, a real Gladys. `scripts/probe.mjs` checks the first three
  against a real bridge, read-only:

  ```bash
  BOND_HOST=192.168.1.20 BOND_TOKEN=… node scripts/probe.mjs
  ```

## Limitations

- The state is what Bond believes, wrong after a use of the original remote (except what a Bond Bridge Pro hears).
- No tilt of shades, no timers, no Bond groups or Bond scenes, no fireplace control.
- Three bridges at most per Gladys.
- Names ending in `.local` do not resolve inside the integration container: use IP addresses (what **Find the
  bridges** writes).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`) and a fake Bond bridge on
real local sockets (`test/helpers/fakeBond.js`). See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Bond Local API v2](https://docs-local.appbond.com/) documentation by Olibra.
- [bond-async](https://github.com/bondhome/bond-async) by Eugene Prystupa and contributors (MIT): the action
  names, the device types, the Bond ID families and the BPUP keep-alive / answer protocol.
- Home Assistant's [`bond`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/bond)
  integration (Apache-2.0): the feature mapping (speed range, up/down lights, shade position inverted, breeze off
  before turning off), the push-or-poll scheme and its 70 s liveness window.
- [homebridge-bond](https://github.com/aarons22/homebridge-bond) by Aaron Sapp (MIT): the toggle-only remotes and
  the state fields.
- The architecture and the conformity tests follow [gladys-pihole](https://github.com/guim31/gladys-pihole),
  [gladys-wled](https://github.com/guim31/gladys-wled) and [gladys-subsonic](https://github.com/guim31/gladys-subsonic).

No code was copied from these projects: the integration is a re-implementation in JavaScript.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Bond or Olibra LLC. "Bond", "Bond Bridge" and "Smart
by Bond" are trademarks of their owners.

## License

Apache-2.0
