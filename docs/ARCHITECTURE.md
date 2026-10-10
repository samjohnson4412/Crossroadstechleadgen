# Architecture

## Principle: integrate with anything

Nothing outside `lib/integrations/` knows what brand a device is. The platform is built from
four layers:

```
 config/sites/ccc.ts      Site model: buildings → floors → zones, and where each camera/door/display sits.
        │                 Each device points at an integration + that vendor's device id (a DeviceRef).
        ▼
 lib/core/graph.ts        The building as a graph (zones = nodes, doors/passages = edges).
                          Answers "which cameras show this area", "where can they get to next", "how long".
        ▼
 lib/core/runtime.ts      Starts integrations, normalizes their events onto the map, keeps door state,
                          runs the tracker, audits operator actions, streams everything to consoles (SSE).
        ▲
 lib/integrations/*       Drivers. Each exposes capabilities: cameras, access-control, alerts, messaging.
```

### Adding a vendor

Implement `IntegrationDriver` (see `lib/integrations/types.ts`) and register it in
`lib/integrations/registry.ts`. A driver:

- declares its `capabilities` and `requiredSettings` (missing settings → simulator stands in);
- implements the capability interfaces (e.g. `access.unlock`, `cameras.streamInfo`);
- emits normalized `RawEvent`s (`access.granted`, `door.forced`, `person.detected`, `alert.raised`, ...)
  using the vendor's own device ids — the runtime maps them onto the site;
- optionally handles inbound webhooks at `/api/integrations/<id>/webhook`.

Moving CCC from Blue Iris to UniFi Protect cameras = write a `unifi-protect` driver, change the
`cameras` integration's `driver`, update camera `externalId`s. Map, tracking and UI don't change.

### Current drivers

| Driver | Status |
| --- | --- |
| `blueiris` | JSON API login/camlist, MJPEG + snapshot proxy (credentials stay server-side), AI alert webhook. Needs testing against CCC's server. |
| `unifi-access` | Developer API: door list/state polling, unlock, keep-locked/keep-unlocked/reset, emergency lockdown, webhook events. Needs testing against CCC's controller version. |
| `saferwatch` | Inbound webhook (shared secret) → critical alerts; optional outbound POST. **Real API mapping pending SaferWatch partner docs.** |
| `smart-displays` | POSTs messages to a configurable endpoint. **Pending how CCC's SMART Boards are managed** (SMART Remote Management or a relay). |
| `simulator` | Stands in for any of the above. |

## Floor plans

Detailed plans are drawn in Inkscape on `docs/floorplans/floorplan-template.svg` and imported
from the map editor (`lib/floorplan/`): `svg.ts` reads the Walls / Dividers / Doors / Labels
layers, `rooms.ts` turns enclosed areas into rooms and door lines into connections, and
`importPlan.ts` fits the plan onto the map (quarter turns + stretch, from room numbers shared with
the old rooms), keeps matched room ids, moves cameras/doors/passages over, and places cameras by
name. The walls are stored with the floor (`Floor.drawings`) and drawn over the background.
Doors carry a `lockType` (badge / keypad / key / unlocked).

## Tracking: how "follow a suspect" works

The thing other products miss is that cameras aren't related to each other. Here, the
**building graph** relates them: every camera covers zones, zones connect through doors and
passages, and each connection has a walking time. So for any last-known location we know exactly
which cameras the person can appear on next, and in what order.

A `Track` (`lib/tracking/tracker.ts`) is a timeline of sightings from three sources:

1. **Operator** — "Seen here" on a camera tile. Always trusted. This alone makes following someone
   fast: the follow view always shows the next possible cameras.
2. **Access control** — swipes by a credential linked to the track.
3. **Analytics** — `person.detected` events. Scored on *physical reachability* (graph distance vs.
   elapsed time, allowing for running) and *appearance* (clothing colors/tags), and offered as
   suggestions for the operator to confirm. Never auto-confirmed.

### Roadmap toward automatic tracking

| Phase | What | Needs |
| --- | --- | --- |
| **1 (done)** | Map, live cameras, door control, operator-driven follow view, reachability-scored suggestions | — |
| 2 | Real person analytics feeding suggestions: Blue Iris + CodeProject.AI alerts now; UniFi Protect smart detections once cameras move to Protect | Webhook setup at CCC |
| 3 | Appearance attributes from video: run a person detector + attribute model (clothing color, bag, hat) on the follow-view streams | GPU box or Protect AI Key on site |
| 4 | Re-identification embeddings: compare the tagged person's crop against detections across all cameras; auto-advance the track above a confidence threshold, still operator-reviewable | Phase 3 + re-ID model |
| 5 | Rules & response: "if tracked person approaches door X, hold it locked", auto-message nearby rooms' SMART Boards | — |

## Other next steps

- Floor-plan editor in the UI (upload plan image, drag cameras/doors onto it) instead of editing `ccc.ts`.
- Low-latency video (WebRTC via go2rtc) instead of MJPEG.
- Persistence (tracks, events, audit) in a database; currently tracks/events are in memory, audit is on disk.
- Real accounts / SSO with roles (viewer vs. door-control vs. admin) instead of Basic auth.
- Mobile layout for officers on the move.
