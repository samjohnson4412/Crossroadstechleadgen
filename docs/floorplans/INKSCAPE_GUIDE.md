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
  automatically. Make it about as long as the door is wide (or draw it across the wall — both work);
  double doors = one line. The console reads each line as a door between the rooms on either side.
- **Door type = line color** (optional — you can also set it per door in the console's Edit map).
  Select the line → `Shift+Ctrl+F` (Fill & Stroke) → **Stroke paint**:

  | Color | Door type |
  |---|---|
  | red or black | not recorded yet |
  | **blue** | access control (badge reader) |
  | **orange / yellow** | keypad lock |
  | **purple** | locked with a key |
  | **green** | unlocked / no lock |

- Don't rotate or rescale the page once rooms are drawn.

## Put it on the security map

1. Console → **Edit map** → pick the level → **⇪ Import floor plan**.
2. Choose the .svg, and whether it's a **new building** or **replaces** one already on that level
   (replacing removes the old rooms and drawing).
3. Line it up: drag it into place, drag the round corner handle to size it, ⟲/⟳ to turn it 90°.
   Untick **Keep shape** to stretch it if the scan wasn't to scale. Then **OK — add to map**.
4. Check it over, then **Save map**.

Every enclosed area becomes a room named by its label, and every door line a door. Then place
cameras and link badge doors yourself in Edit map. Cameras, badge doors and stairs that pointed at
replaced rooms move to the new room in the same spot. To take a drawing off, use **Remove drawing**
under "Floor plans on this level" in Edit map (its rooms stay).

## After a renovation

Open the file → move/delete walls with `S` or `N` → fix the label if the room changed → **Save**.
Then import it again (above) so the security map matches.

## Printing

**File → Save a Copy…** → choose PDF. Hide the Scan and Dividers layers first (eye icon) for a clean print.
