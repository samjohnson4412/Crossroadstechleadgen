# Connecting Blue Iris

## Needed from the site

1. **Blue Iris server address** — IP and web server port (Blue Iris → Settings → Web server), e.g. `http://192.168.1.50:81`.
   Must be reachable from the console server (test: open that address in a browser *on the console server*).
2. **A dedicated Blue Iris user** for the console (Settings → Users): username + password. Doesn't need admin;
   it needs permission to view all cameras. Name it something like `sentinel`.
3. **Blue Iris version** (Help → About) — the JSON API this uses is Blue Iris 5.
4. **Where each camera is** — for each camera: its *short name* (Camera properties → General) and which room/hall
   it's in and which way it faces. Easiest: place them yourself in ✎ Edit map once connected (the Blue Iris camera
   box lists every camera Blue Iris reports).
5. **Load check** — the console streams through Blue Iris (MJPEG), which costs CPU on the Blue Iris box per open
   tile. How many cameras, and are sub-streams configured? (Sub-streams keep this light.)
6. **Optional, for automatic "possible sighting" suggestions** — is AI detection (CodeProject.AI) enabled on the
   cameras? If so, add an alert action on those cameras:
   *Alerts → On alert → Web request or MQTT* → POST to
   `http://<console-server>:3100/api/integrations/cameras/webhook?token=<WEBHOOK_TOKEN>`
   with body `{"camera":"&CAM","memo":"&MEMO","type":"&TYPE"}` and content type `application/json`.

## Then, on the console server

Add to `.env.local` and restart:

```
BLUEIRIS_URL=http://<blue-iris-ip>:<port>
BLUEIRIS_USER=sentinel
BLUEIRIS_PASSWORD=...
WEBHOOK_TOKEN=<any long random string>   # only needed for step 6
```

Check: the top-bar status pill → Blue Iris should say **ok**. `http://localhost:3100/api/integrations/cameras/devices`
lists the cameras Blue Iris reports.

## A second Blue Iris server

Fill in `BLUEIRIS2_URL`, `BLUEIRIS2_USER`, `BLUEIRIS2_PASSWORD` in `.env.local` and restart. Until then it shows
as "not set up" in the integrations window (it is not simulated). Its cameras then appear in **All cameras** and in
Edit map's "not on the map yet" list alongside the first server's.

## Sending AI detections to the console (Detections queue)

For each camera with AI (CodeProject.AI) turned on, in Blue Iris:

1. Camera properties → **Alerts** → **On alert…** → **+** → **Web request or MQTT**.
2. URL (server 1): `http://192.168.1.142:3100/api/integrations/cameras/webhook`
   URL (server 2): `http://192.168.1.142:3100/api/integrations/cameras2/webhook`
   (add `?token=<WEBHOOK_TOKEN>` if you set one)
3. Method **POST**, content type **application/json**, body:
   `{"camera":"&CAM","memo":"&MEMO","type":"&TYPE"}`
4. Make sure the alert only fires on AI-confirmed objects (Trigger → Artificial Intelligence → "To confirm":
   `person,car,...` plus any weapon labels your model provides).

&MEMO carries labels like `person:87%`. Each one becomes a detection with a saved snapshot, checked against the
rules in **Detections → Rules** (weapon, person after hours, loitering, restricted areas). Use **Detections → Test**
to try a rule without waiting for a real alert.
