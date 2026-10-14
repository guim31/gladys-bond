// -----------------------------------------------------------------------------
// Gladys devices built from the Bond devices of a bridge.
//
// Identity: `ext:<selector>:bond:<bondid>_<device id>`. The Bond ID is the
// serial of the bridge (ZZBL12345), the device id the one the bridge gave the
// device when it was added in the Bond app: both survive an IP change, a
// renaming and a firmware update. Feature keys are the FEATURES of the model.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { describe } from './bond/model.js';
import { NAMES } from './texts.js';

export const ID_TYPE = 'bond';

// The container reads the devices itself (src/hub.js); Gladys may poll them
// too, every 30 s, as a fallback (GladysAssistant/Gladys#3198).
export const POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_30_SECONDS;

/** External ids of one Bond device. */
export const deviceIds = (gladys, bondId, deviceId) =>
  gladys.externalIds(ID_TYPE, `${bondId}_${deviceId}`);

/**
 * Bond id and device id of an external id of this integration (device or
 * feature), or null.
 */
export function parseExternalId(gladys, externalId) {
  const prefix = gladys.externalId(`${ID_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const [platformId, featureKey = null] = externalId.slice(prefix.length).split(':');
  const separator = platformId.indexOf('_');
  if (separator <= 0 || separator === platformId.length - 1) {
    return null;
  }
  return {
    bondId: platformId.slice(0, separator),
    deviceId: platformId.slice(separator + 1),
    featureKey,
  };
}

/**
 * The name shown in Gladys: the Bond name, after the Bond location when the
 * name does not already say it ("Bedroom" + "Fan" → "Bedroom Fan").
 */
export function displayName(device) {
  const { name, location } = device;
  if (!location || name.toLowerCase().includes(location.toLowerCase())) {
    return name;
  }
  return `${location} ${name}`;
}

/**
 * The Gladys device of one Bond device, or null when Gladys has nothing to
 * show for it (unsupported type, hidden fireplace, remote without a known
 * action).
 * @param {object} gladys
 * @param {string} bondId
 * @param {object} device normalized Bond device (model.normalizeDevice)
 * @param {{ language: string, fireplaces: string }} config
 */
export function buildDevice(gladys, bondId, device, config) {
  const { kind, features } = describe(device, config);
  if (features.length === 0) {
    return null;
  }
  const ids = deviceIds(gladys, bondId, device.id);
  const names = NAMES[config.language] ?? NAMES.en;
  return {
    name: displayName(device),
    external_id: ids.device,
    should_poll: true,
    poll_frequency: POLL_FREQUENCY,
    params: [
      { name: 'BOND_ID', value: bondId },
      { name: 'BOND_DEVICE_ID', value: device.id },
      { name: 'BOND_TYPE', value: device.type },
    ],
    features: features.map((feature) => ({
      name: names[feature.key],
      external_id: ids.feature(feature.key),
      category: feature.category,
      type: feature.type,
      min: feature.min,
      max: feature.max,
      ...(feature.unit ? { unit: feature.unit } : {}),
      read_only: feature.read_only,
      // Bond only knows what it believes: no feedback from an RF remote.
      has_feedback: false,
      keep_history: true,
    })),
    kind,
  };
}

/** The device as published (without the `kind` the hub keeps for itself). */
export const publishable = ({ kind: _kind, ...device }) => device;
