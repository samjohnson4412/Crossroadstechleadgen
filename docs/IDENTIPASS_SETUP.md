# IDentiPASS → console (door events)

The console reads IDentiPASS's **transaction printer** output: one line per badge swipe / door alarm.
It never sends anything to IDentiPASS or its panels.

```
IDentiPASS client ──"print" each transaction──▶ Windows printer "IDentiPASS Feed"
   (Tools → Transaction Printer Setup → LPT2)        (Generic / Text Only, Standard TCP/IP port)
                                                   ──raw TCP 9100──▶ Campus Sentinel console
```

## Plan A — run an IDentiPASS client on the console server (recommended to try first)

You have 3 client licenses and use 1, so a second client on the console server (Windows 11) costs nothing
and keeps the Windows 98 PC untouched.

1. Install / copy the IDentiPASS client (`IdClient.exe` and its folder) onto the console server and confirm
   it logs in and shows live transactions. (It's 32-bit software from 2000; it usually runs on Windows 11.
   If the old installer refuses, copy the program folder from the Windows 98 PC.)
2. **Create the feed printer** (on the console server):
   Settings → Printers & scanners → Add a printer → *The printer I want isn't listed* →
   *Add a printer using an IP address* → Device type **TCP/IP Device**, address **127.0.0.1**, untick
   "query the printer" → *Custom* → Settings → Protocol **Raw**, port **9100** → driver **Generic → Generic / Text Only**
   → name it **IDentiPASS Feed** → share it as **IDentiPASSFeed**.
3. Map LPT2 to it (Command Prompt as administrator):
   `net use LPT2: \\localhost\IDentiPASSFeed /persistent:yes`
4. In IDentiPASS (on that client): **Tools → Transaction Printer Setup** → Port **LPT2**, Filter *No Filter*.
   Recommended wider columns so names aren't cut off:

   | | Date | Time | Card Number | Card Holder | Panel | Point | Action |
   |---|---|---|---|---|---|---|---|
   | Tab stop | 0 | 12 | 22 | 32 | 62 | 78 | 108 |
   | Width | 12 | 10 | 10 | 30 | 16 | 30 | 25 |

   Then in the console: ⚙ Settings → IDentiPASS → *Printer columns* =
   `0/12 12/10 22/10 32/30 62/16 78/30 108/25` → Save. (If you keep IDentiPASS's defaults, leave it blank.)
5. Swipe a badge. Within a few seconds the event should appear in the console's Activity list and the
   IDentiPASS card on the Settings page should say *Receiving events*.

**If events arrive late or only in bunches**, Windows is holding the "print job" open. Tell me what you see;
the fix depends on how IDentiPASS writes to the port.

## Plan B — print straight from the Windows 98 PC

Windows 98 can send LPT output to a shared printer on another PC (Printer → Properties → Capture Printer Port),
but Windows 11 no longer speaks the old file-sharing protocol Windows 98 needs (SMB1). Only use this if Plan A
fails, and then only with SMB1 limited to that one PC.

## Door names

Doors on the map are matched to IDentiPASS **Point** names (without the "(3)" number), e.g. `WC West Lobby`.
If you rename or add a door point in IDentiPASS, use the same name for the door in ✎ Edit map →
door → *Access-controlled* → door ID.
