import type { Point } from "../core/site.ts";

/**
 * Reads a floor plan drawn in Inkscape from docs/floorplans/floorplan-template.svg:
 * the Walls, Dividers, Doors and Labels layers, in the drawing's own units with
 * every transform applied. Curves are flattened to straight pieces.
 */

export interface Segment {
  a: Point;
  b: Point;
}
export interface DoorLine extends Segment {
  /** Stroke color as drawn, e.g. "#e53935". Encodes the door type (see doorTypeFromColor). */
  color?: string;
}
export interface PlanLabel {
  /** Middle of the text. */
  at: Point;
  lines: string[];
}
export interface ParsedPlan {
  walls: Segment[];
  /** Wall paths as drawn, for display: each is a list of polylines. */
  wallLines: Point[][];
  dividers: Segment[];
  doors: DoorLine[];
  labels: PlanLabel[];
}

type Matrix = [number, number, number, number, number, number]; // a b c d e f
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

export function parseTransform(value: string | undefined): Matrix {
  let m = IDENTITY;
  if (!value) return m;
  for (const [, name, args] of value.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = (args.match(/-?[\d.]+(?:e-?\d+)?/gi) ?? []).map(Number);
    let t: Matrix = IDENTITY;
    if (name === "matrix" && v.length === 6) t = v as Matrix;
    else if (name === "translate") t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    else if (name === "scale") t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
    else if (name === "rotate") {
      const r = ((v[0] ?? 0) * Math.PI) / 180;
      const rot: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
      t = v.length >= 3 ? mul(mul([1, 0, 0, 1, v[1], v[2]], rot), [1, 0, 0, 1, -v[1], -v[2]]) : rot;
    } else if (name === "skewX") t = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (name === "skewY") t = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

/** Path data → polylines (one per subpath). Curves are sampled. */
export function parsePathData(d: string): Point[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const out: Point[][] = [];
  let cur: Point[] = [];
  let i = 0;
  let cmd = "";
  let p = { x: 0, y: 0 };
  let start = p;
  let lastCtrl: Point | null = null;
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
  const lineTo = (q: Point) => {
    if (!cur.length) cur.push(p);
    cur.push(q);
    p = q;
  };
  const flush = () => {
    if (cur.length > 1) out.push(cur);
    cur = [];
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const R = (x: number, y: number): Point => (rel ? { x: p.x + x, y: p.y + y } : { x, y });
    switch (cmd.toUpperCase()) {
      case "M": {
        flush();
        p = R(num(), num());
        start = p;
        cur = [p];
        cmd = rel ? "l" : "L"; // further pairs are line-tos
        lastCtrl = null;
        break;
      }
      case "L":
        lineTo(R(num(), num()));
        lastCtrl = null;
        break;
      case "H":
        lineTo({ x: rel ? p.x + num() : num(), y: p.y });
        lastCtrl = null;
        break;
      case "V":
        lineTo({ x: p.x, y: rel ? p.y + num() : num() });
        lastCtrl = null;
        break;
      case "Z":
        if (cur.length) lineTo(start);
        flush();
        cur = [start];
        lastCtrl = null;
        break;
      case "C":
      case "S":
      case "Q":
      case "T": {
        const u = cmd.toUpperCase();
        const from = p;
        let c1: Point;
        let c2: Point;
        let end: Point;
        if (u === "C") (c1 = R(num(), num())), (c2 = R(num(), num())), (end = R(num(), num()));
        else if (u === "S") (c1 = lastCtrl ? { x: 2 * from.x - lastCtrl.x, y: 2 * from.y - lastCtrl.y } : from), (c2 = R(num(), num())), (end = R(num(), num()));
        else {
          const q: Point = u === "Q" ? R(num(), num()) : lastCtrl ? { x: 2 * from.x - lastCtrl.x, y: 2 * from.y - lastCtrl.y } : from;
          end = R(num(), num());
          c1 = { x: from.x + (2 / 3) * (q.x - from.x), y: from.y + (2 / 3) * (q.y - from.y) };
          c2 = { x: end.x + (2 / 3) * (q.x - end.x), y: end.y + (2 / 3) * (q.y - end.y) };
          lastCtrl = q;
        }
        if (u === "C" || u === "S") lastCtrl = c2;
        for (let s = 1; s <= 6; s++) {
          const t = s / 6;
          const mt = 1 - t;
          lineTo({
            x: mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * end.x,
            y: mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * end.y,
          });
        }
        p = end;
        break;
      }
      case "A": {
        num(), num(), num(), num(), num(); // radii, rotation, flags: drawn as a straight line
        lineTo(R(num(), num()));
        lastCtrl = null;
        break;
      }
      default:
        i++;
    }
    while (isNum() && "ZzMm".includes(cmd)) i++; // stray numbers
  }
  flush();
  return out;
}

interface El {
  name: string;
  attrs: Record<string, string>;
  children: El[];
  text: string;
}

/** Tiny XML reader: enough for Inkscape's well-formed output. */
function parseXml(src: string): El {
  const root: El = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of src.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      while (stack.length > 1 && stack.pop()!.name !== m[1]);
    } else if (m[2]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[3] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? "");
      const el: El = { name: m[2], attrs, children: [], text: "" };
      top.children.push(el);
      if (!m[4]) stack.push(el);
    } else if (m[5]) top.text += decode(m[5]);
  }
  return root;
}
const decode = (s: string) =>
  s.replace(/&(#x?[\da-f]+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()],
  );

const styleOf = (el: El) => {
  const out: Record<string, string> = {};
  for (const part of (el.attrs.style ?? "").split(";")) {
    const [k, ...v] = part.split(":");
    if (k && v.length) out[k.trim()] = v.join(":").trim();
  }
  for (const k of ["stroke", "font-size", "text-anchor", "display"]) if (el.attrs[k] && !out[k]) out[k] = el.attrs[k];
  return out;
};

type Role = "walls" | "dividers" | "doors" | "labels" | "other";
function roleOf(el: El): Role | null {
  if (el.attrs["inkscape:groupmode"] !== "layer") return null;
  const name = `${el.attrs["inkscape:label"] ?? ""} ${el.attrs.id ?? ""}`.toLowerCase();
  // The label wins over the id: people rename layers (e.g. "Rooms" → "Dividers").
  const label = (el.attrs["inkscape:label"] ?? "").toLowerCase();
  for (const [role, word] of [["dividers", "divider"], ["walls", "wall"], ["doors", "door"], ["labels", "label"]] as const) if (label.includes(word)) return role;
  for (const [role, word] of [["dividers", "divider"], ["walls", "wall"], ["doors", "door"], ["labels", "label"]] as const) if (name.includes(word)) return role;
  return "other";
}

function shapeLines(el: El): Point[][] {
  const n = (k: string) => Number(el.attrs[k] ?? 0);
  switch (el.name) {
    case "path":
      return el.attrs.d ? parsePathData(el.attrs.d) : [];
    case "line":
      return [[{ x: n("x1"), y: n("y1") }, { x: n("x2"), y: n("y2") }]];
    case "rect": {
      const x = n("x"), y = n("y"), w = n("width"), h = n("height");
      return [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]];
    }
    case "polyline":
    case "polygon": {
      const v = (el.attrs.points?.match(/-?[\d.]+(?:e-?\d+)?/gi) ?? []).map(Number);
      const pts: Point[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push({ x: v[i], y: v[i + 1] });
      if (el.name === "polygon" && pts.length) pts.push(pts[0]);
      return [pts];
    }
    default:
      return [];
  }
}

export function parsePlanSvg(svg: string): ParsedPlan {
  const root = parseXml(svg);
  const plan: ParsedPlan = { walls: [], wallLines: [], dividers: [], doors: [], labels: [] };
  const segs = (lines: Point[][]) => lines.flatMap((l) => l.slice(1).map((b, i) => ({ a: l[i], b })));

  const walk = (el: El, m: Matrix, role: Role, inherited: Record<string, string>) => {
    if (el.name === "defs" || el.name === "metadata" || el.name.startsWith("sodipodi:") || el.name === "image") return;
    const style = { ...inherited, ...styleOf(el) };
    if (style.display === "none") return;
    const mm = mul(m, parseTransform(el.attrs.transform));
    const r = roleOf(el) ?? role;
    if (el.name === "text") {
      if (r === "labels" || r === "other") collectText(el, mm, style, plan);
      return;
    }
    const lines = shapeLines(el).map((l) => l.map((p) => apply(mm, p)));
    if (lines.length) {
      if (r === "walls") plan.walls.push(...segs(lines)), plan.wallLines.push(...lines);
      else if (r === "dividers") plan.dividers.push(...segs(lines));
      else if (r === "doors") plan.doors.push(...segs(lines).map((s) => ({ ...s, color: style.stroke })));
    }
    for (const c of el.children) walk(c, mm, r, style);
  };
  for (const c of root.children) walk(c, IDENTITY, "other", {});
  // Only texts on the Labels layer count, unless the drawing has no Labels layer at all.
  return plan;
}

function collectText(el: El, m: Matrix, style: Record<string, string>, plan: ParsedPlan) {
  const spans: { x: number; y: number; text: string; size: number; anchor: string }[] = [];
  const size0 = parseFloat(style["font-size"] ?? "16") || 16;
  const x0 = Number(el.attrs.x ?? 0), y0 = Number(el.attrs.y ?? 0);
  const visit = (e: El, inherited: Record<string, string>, x: number, y: number) => {
    const st = { ...inherited, ...styleOf(e) };
    const ex = e.attrs.x !== undefined ? Number(e.attrs.x.split(/[ ,]/)[0]) : x;
    const ey = e.attrs.y !== undefined ? Number(e.attrs.y.split(/[ ,]/)[0]) : y;
    const text = e.text.replace(/\s+/g, " ").trim();
    if (text) spans.push({ x: ex, y: ey, text, size: parseFloat(st["font-size"] ?? "") || size0, anchor: st["text-anchor"] ?? "start" });
    for (const c of e.children) visit(c, st, ex, ey);
  };
  visit(el, style, x0, y0);
  if (!spans.length) return;
  const centers = spans.map((s) => {
    const w = s.text.length * s.size * 0.58;
    const cx = s.anchor === "middle" ? s.x : s.anchor === "end" ? s.x - w / 2 : s.x + w / 2;
    return apply(m, { x: cx, y: s.y - s.size * 0.35 });
  });
  plan.labels.push({
    at: { x: centers.reduce((a, c) => a + c.x, 0) / centers.length, y: centers.reduce((a, c) => a + c.y, 0) / centers.length },
    lines: spans.map((s) => s.text),
  });
}

/** Door type from the color its line was drawn in (see INKSCAPE_GUIDE.md). */
export function doorTypeFromColor(color?: string): "access" | "keypad" | "key" | "none" | undefined {
  const rgb = parseColor(color);
  if (!rgb) return undefined;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.2) return undefined; // black / grey: type not set
  let h: number;
  if (max === r) h = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h *= 60;
  if (h < 15 || h >= 330) return undefined; // red: the template's default door color
  if (h < 65) return "keypad"; // orange / yellow
  if (h < 170) return "none"; // green: unlocked
  if (h < 255) return "access"; // blue
  return "key"; // purple
}

function parseColor(c?: string): [number, number, number] | null {
  if (!c) return null;
  c = c.trim().toLowerCase();
  const named: Record<string, string> = { red: "#ff0000", blue: "#0000ff", green: "#008000", orange: "#ffa500", purple: "#800080", yellow: "#ffff00", black: "#000000" };
  c = named[c] ?? c;
  let m = c.match(/^#([\da-f]{6})$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = c.match(/^#([\da-f]{3})$/);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  const rgb = c.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}
