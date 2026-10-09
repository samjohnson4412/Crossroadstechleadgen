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
