# Campus Sentinel

A single security console for a whole campus: a live building map where every
camera, door and display sits where it really is — and the ability to tag a
suspect and **follow them from camera to camera** through the building.

First client: **CCC** (UniFi Access doors, Blue Iris cameras, SaferWatch, SMART Boards).

## What works today

- **Campus map** — floors, rooms, hallways, cameras (with view cones), doors, SMART Boards.
- **Click an area** → its live cameras. **Click a camera** → live feed + nearby cameras.
- **Click a door** → live lock/position state; unlock, hold unlocked, hold locked, return to schedule.
- **Lockdown** — one button holds every controlled door locked (uses UniFi Access's native emergency lockdown).
- **Message SMART Boards** — all or selected rooms, info/warning/emergency.
- **Raise / receive alerts** — SaferWatch alerts arrive by webhook and show as a banner.
- **Suspect tracking**
  - Tag a person from any camera (clothing colors, features, badge id if known).
  - **Follow view**: the camera they were last on, large, plus every camera they could walk
    into next, ordered by how soon they'd get there. One click — "Seen here" — moves the track.
  - **Possible sightings**: camera analytics hits that match their appearance *and* are physically
    reachable in the elapsed time are offered for one-click confirm/reject.
  - Badge swipes by a linked credential update the track automatically.
  - Trail and "where they can go next" drawn on the map.
- **Audit log** of every operator action (who, what, when) in `data/audit.jsonl`.
- **Simulator** — any integration without credentials runs on a simulated building with people
  walking around, so everything above can be demoed with no hardware.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000 — simulator mode, no login
npm test               # graph + tracker unit tests
```

Production (on a machine on the campus network, so it can reach Blue Iris / UniFi):

```bash
cp .env.example .env.local   # fill in credentials + CONSOLE_USERS
npm run build && npm start
```

## Hooking up CCC for real

1. Fill in `BLUEIRIS_*` and `UNIFI_ACCESS_*` in `.env.local`.
2. `GET /api/integrations/cameras/devices` and `/api/integrations/doors/devices` list what each
   system reports; put those ids into `config/sites/ccc.ts` (Blue Iris short names, UniFi door ids).
3. Replace the placeholder layout in `config/sites/ccc.ts` with CCC's real floor plans.
4. Point Blue Iris alert actions and UniFi Access webhooks at
   `/api/integrations/<id>/webhook?token=$WEBHOOK_TOKEN`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how integrations work and the roadmap.
