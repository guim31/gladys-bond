# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-14

### Added

- Control of the devices of a Bond Bridge, Bond Bridge Pro or Smart by Bond
  device over the Bond Local API v2, on the local network: ceiling fans (on/off,
  speed, direction, breeze mode, light, brightness, up and down lights), shades
  (open, close, stop, position), lights (on/off, brightness, color temperature)
  and generic devices (on/off). Up to three bridges.
- Fireplaces hidden by default, or shown read-only: never controlled from
  Gladys.
- Live state through the push of the bridge (BPUP), and a reading every 30 s
  when the push is silent.
- Dashboard widget "Ceiling fan": speed, fan and light state, direction, and
  slower / faster / light / on-off buttons.
- Scene triggers "Bond bridge unreachable" and "Bond bridge back".
- Scene action and configuration action "Correct the Bond state", to fix what
  Bond believes about a device without sending any signal.
- Configuration actions "Find the bridges" (mDNS), "Get the local token" and
  "Test the connection".
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-bond/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-bond/releases/tag/v1.0.1
