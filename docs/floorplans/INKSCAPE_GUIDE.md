# Floor plans in Inkscape — cheat sheet

Inkscape is free: **inkscape.org** → Download (Windows). One file per building level, named like
`Education-Level1.svg`, saved in one shared folder.

## Start a plan (once per level)

1. Open **floorplan-template.svg** → **File → Save As…** with the building/level name.
2. Open the layers panel: **Layer → Layers and Objects** (`Ctrl+Shift+L`).
3. Click the **Scan** layer → **File → Import** (`Ctrl+I`) → pick the scanned PDF → OK.
   Drag a corner while holding `Ctrl` to scale it to fill the page. Then click the 🔒 next to the
   Scan layer to lock it.
4. Delete the **EXAMPLE** layer once you've looked at it.

## The 6 tools you need

| Key | Tool | Use it for |
|---|---|---|
| `B` | **Pen** | Walls. Click, click, click… hold `Ctrl` for straight/90° lines. `Enter` to finish a wall. |
| `B` | **Pen** (again) | Door lines and dividers: two clicks, `Enter`. |
| `T` | **Text** | Room number / name. Click **inside** the room and type. |
| `S` | **Select** | Click to pick, drag to move, `Delete` to remove. |
| `N` | **Node edit** | Move one corner of a wall or room. |

Before drawing, **click the layer** you want in the Layers panel (Walls, Doors, Dividers or Labels).
New shapes take that layer's style automatically.

**Snapping** (`%` toggles it): keeps corners exactly on other corners so walls meet cleanly.
Zoom: scroll with `Ctrl`, or press `5` to fit the page. Undo: `Ctrl+Z`.

## Rules that keep it useful for the security map

- **Every area closed in by walls is a room** — no outlines needed. So walls must really meet:
  keep snapping on (`%`) so corners click together. A tiny gap merges two rooms into one.
- **Open areas with no wall between them** (lobby flowing into a hallway, a big commons): draw a
  blue dashed line on the **Dividers** layer where you want them split. Not printed as a wall.
- **Each room's label goes inside it.** First line = room number (E105); an optional second
  line = name or use. The console matches labels to rooms by position.
- **Walls on Walls, doors on Doors.** Draw walls solid, straight through doorways — don't leave gaps.
  Then on the **Doors** layer, draw a **short line over the wall where the door is** (Pen `B`: click
  one side of the door opening, `Ctrl`+click the other side, `Enter`). It comes out thick and red
  automatically. Make it about as long as the door is wide; double doors = one longer line.
  The console reads each red line as a door connecting the two rooms on either side of it.
- Optional: put a door's name next to its red line on the **Labels** layer (e.g. "WC West Lobby")
  if it's a badge/controlled door, so it can be matched to IDentiPASS / UniFi Access.
- Don't rotate or rescale the page once rooms are drawn.

## After a renovation

Open the file → move/delete walls with `S` or `N` → fix the label if the room changed → **Save**.
Then import it into the console so the security map matches (Import floor plan — coming next).

## Printing

**File → Save a Copy…** → choose PDF. Hide the Scan and Dividers layers first (eye icon) for a clean print.
