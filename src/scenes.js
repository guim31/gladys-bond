// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`), registered per key by src/app.js.
//
// tell_state — "Correct the Bond state": tell the bridge what a device really
// is, without sending any signal. Bond only knows what it sent: a fan turned
// off with its own wall remote still shows "on". Typical scene: every night,
// a scene that knows the fans are off (the bedroom switch cut them) tells
// Bond so, and the next "on" from Gladys does not toggle them off.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  tell_state: async (hub, { fields }) => {
    await hub.tellState(fields.device, fields.state);
    return undefined;
  },
};
