/**
 * Deterministic force-directed layout. No randomness: every node starts at a
 * position derived from a hash of its id, so the same trail is always drawn
 * the same way, in any order. Repulsion only acts within CUTOFF, which keeps
 * each iteration close to linear in the number of nodes.
 */

export interface Point {
  x: number;
  y: number;
}

export interface LayoutNode {
  id: string;
  /** Heavier nodes push others further away. Default 1. */
  weight?: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
  /** Preferred distance between the two nodes. Default 90. */
  length?: number;
}

export interface LayoutOptions {
  /** Positions from an earlier layout. Known nodes start there and move little. */
  initial?: ReadonlyMap<string, Point>;
  iterations?: number;
}

const REPULSION = 9000;
const SPRING = 0.06;
const GRAVITY = 0.012;
const CUTOFF = 420;
const DAMPING = 0.82;
const DEFAULT_LENGTH = 90;

/** FNV-1a, 32 bit. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seedPoint(id: string, spread: number): Point {
  const hash = hashString(id);
  const angle = ((hash & 0xffff) / 0x10000) * Math.PI * 2;
  const radius = (40 + ((hash >>> 16) / 0x10000) * 260) * spread;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export function forceLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions = {},
): Map<string, Point> {
  const count = nodes.length;
  const result = new Map<string, Point>();
  if (!count) return result;

  // Sorting makes the result independent of the order nodes were passed in.
  const sorted = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const position = new Map(sorted.map((node, i) => [node.id, i]));
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const vx = new Float64Array(count);
  const vy = new Float64Array(count);
  const weight = Float64Array.from(sorted, (node) => node.weight ?? 1);

  const springs: Array<[number, number, number]> = [];
  const neighbours: number[][] = sorted.map(() => []);
  for (const edge of edges) {
    const a = position.get(edge.source);
    const b = position.get(edge.target);
    if (a === undefined || b === undefined || a === b) continue;
    springs.push([a, b, edge.length ?? DEFAULT_LENGTH]);
    neighbours[a].push(b);
    neighbours[b].push(a);
  }

  const initial = options.initial;
  const known = sorted.map((node) => initial?.get(node.id));
  const warm = known.some(Boolean);
  const spread = Math.max(1, Math.sqrt(count / 40));
  sorted.forEach((node, i) => {
    const previous = known[i];
    if (previous) {
      xs[i] = previous.x;
      ys[i] = previous.y;
      return;
    }
    const placed = neighbours[i].map((j) => known[j]).filter((point): point is Point => Boolean(point));
    const seed = seedPoint(node.id, warm ? 0.12 : spread);
    if (placed.length) {
      xs[i] = placed.reduce((sum, point) => sum + point.x, 0) / placed.length + seed.x;
      ys[i] = placed.reduce((sum, point) => sum + point.y, 0) / placed.length + seed.y;
    } else {
      const far = warm ? seedPoint(node.id, spread) : seed;
      xs[i] = far.x;
      ys[i] = far.y;
    }
  });

  const iterations = options.iterations ?? (warm ? 160 : 320);
  const startAlpha = warm ? 0.35 : 1;
  const cutoff2 = CUTOFF * CUTOFF;
  const grid = new Map<number, number[]>();
  const cellKey = (cx: number, cy: number) => cx * 92821 + cy;

  for (let step = 0; step < iterations; step += 1) {
    const alpha = startAlpha * (1 - step / iterations) + 0.02;

    grid.clear();
    for (let i = 0; i < count; i += 1) {
      const key = cellKey(Math.floor(xs[i] / CUTOFF), Math.floor(ys[i] / CUTOFF));
      const cell = grid.get(key);
      if (cell) cell.push(i);
      else grid.set(key, [i]);
    }

    for (let i = 0; i < count; i += 1) {
      const cx = Math.floor(xs[i] / CUTOFF);
      const cy = Math.floor(ys[i] / CUTOFF);
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const cell = grid.get(cellKey(cx + ox, cy + oy));
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            let dx = xs[i] - xs[j];
            let dy = ys[i] - ys[j];
            let d2 = dx * dx + dy * dy;
            if (d2 > cutoff2) continue;
            if (d2 < 0.01) {
              // Two nodes on the same spot: separate them in a fixed direction.
              const angle = ((i * 7 + j * 13) % 360) * (Math.PI / 180);
              dx = Math.cos(angle);
              dy = Math.sin(angle);
              d2 = 1;
            }
            const d = Math.sqrt(d2);
            const force = ((REPULSION * weight[i] * weight[j]) / Math.max(d2, 64)) * alpha;
            const fx = (dx / d) * force;
            const fy = (dy / d) * force;
            vx[i] += fx;
            vy[i] += fy;
            vx[j] -= fx;
            vy[j] -= fy;
          }
        }
      }
    }

    for (const [a, b, length] of springs) {
      const dx = xs[b] - xs[a];
      const dy = ys[b] - ys[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const k = (SPRING * (d - length) * alpha) / d;
      vx[a] += dx * k;
      vy[a] += dy * k;
      vx[b] -= dx * k;
      vy[b] -= dy * k;
    }

    const maxStep = 40 * alpha + 2;
    for (let i = 0; i < count; i += 1) {
      vx[i] -= xs[i] * GRAVITY * alpha;
      vy[i] -= ys[i] * GRAVITY * alpha;
      const speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      if (speed > maxStep) {
        vx[i] *= maxStep / speed;
        vy[i] *= maxStep / speed;
      }
      xs[i] += vx[i];
      ys[i] += vy[i];
      vx[i] *= DAMPING;
      vy[i] *= DAMPING;
    }
  }

  // Centre a fresh layout; keep a warm one where it was so the picture does not jump.
  let offsetX = 0;
  let offsetY = 0;
  if (!warm) {
    for (let i = 0; i < count; i += 1) {
      offsetX += xs[i];
      offsetY += ys[i];
    }
    offsetX /= count;
    offsetY /= count;
  }
  sorted.forEach((node, i) => {
    result.set(node.id, { x: Math.round((xs[i] - offsetX) * 100) / 100, y: Math.round((ys[i] - offsetY) * 100) / 100 });
  });
  return result;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Iterable<Point>): Bounds | undefined {
  let bounds: Bounds | undefined;
  for (const { x, y } of points) {
    if (!bounds) bounds = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  return bounds;
}
