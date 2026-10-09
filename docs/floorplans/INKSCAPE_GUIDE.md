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
| `R` | **Rectangle** | Room outlines (most rooms). Drag from corner to corner. |
| `B` | **Pen** (again) | Odd-shaped rooms: click each corner, click the first point to close. |
| `T` | **Text** | Room number / name. Click **inside** the room and type. |
| `S` | **Select** | Click to pick, drag to move, `Delete` to remove. |
| `N` | **Node edit** | Move one corner of a wall or room. |

Before drawing, **click the layer** you want in the Layers panel (Walls, Doors, Rooms or Labels).
New shapes take that layer's style automatically.

**Snapping** (`%` toggles it): keeps corners exactly on other corners so walls meet cleanly.
Zoom: scroll with `Ctrl`, or press `5` to fit the page. Undo: `Ctrl+Z`.

## Rules that keep it useful for the security map

- **Every room gets an outline on the Rooms layer**, including hallways, lobbies and stairs.
- **Each room's label goes inside its outline.** First line = room number (E105); an optional second
  line = name or use. The console matches labels to rooms by position.
- **Walls on Walls, doors on Doors.** A door is a gap in the wall, optionally with a short arc.
- Don't rotate or rescale the page once rooms are drawn.

## After a renovation

Open the file → move/delete walls with `S` or `N` → fix the room outline and label → **Save**.
Then import it into the console so the security map matches (Import floor plan — coming next).

## Printing

**File → Save a Copy…** → choose PDF. Hide the Scan and Rooms layers first (eye icon) for a clean print.
