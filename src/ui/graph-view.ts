import { buildGraph, layoutGraph, type GraphModel } from '../core/graph';
import { boundsOf, type Bounds, type Point } from '../core/layout';
import { STATUS_LABELS, typeLabel, type Entry } from '../core/model';
import { entryMatches, hasFilters, parseQuery, type WorkspaceIndex } from '../core/query';
import { escapeHtml, plural, truncate } from './format';
import { icon } from './icons';
import { inspectorHtml } from './inspector';

export interface GraphTransform {
  x: number;
  y: number;
  k: number;
}

export interface GraphViewState {
  search: string;
  selectedId?: string;
}

export interface RenderedGraph {
  html: string;
  model: GraphModel;
  bounds?: Bounds;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const LABEL_ZOOM = 1.6;
const RING = 15;

/** One layout per workspace version; the previous one seeds the next so the picture stays put. */
interface Layout {
  positions: Map<string, Point>;
  labels: Map<string, LabelSpot>;
  bounds?: Bounds;
}
const layouts = new WeakMap<object, Layout>();
let previousLayout: Map<string, Point> | undefined;

function layoutFor(index: WorkspaceIndex, model: GraphModel): Layout {
  const cached = layouts.get(index.workspace);
  if (cached) return cached;
  const positions = layoutGraph(model, previousLayout);
  const labels = placeLabels(model, positions);
  const bounds = graphBounds(model, positions, labels);
  const layout: Layout = { positions, labels, ...(bounds ? { bounds } : {}) };
  layouts.set(index.workspace, layout);
  previousLayout = positions;
  return layout;
}

const fixed = (value: number) => Math.round(value * 10) / 10;

function curve(a: Point, b: Point, bend: number): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return `M${fixed(a.x)} ${fixed(a.y)}Q${fixed(mx - dy * bend)} ${fixed(my + dx * bend)} ${fixed(b.x)} ${fixed(b.y)}`;
}

export function renderGraph(index: WorkspaceIndex, state: GraphViewState): RenderedGraph {
  const model = buildGraph(index);
  const selected = state.selectedId ? index.byId.get(state.selectedId) : undefined;
  const inspector = `<aside class="inspector" aria-label="Details">${inspectorHtml(index, selected, {
    empty: 'Select a node to see its details. Drag the background to move around, scroll to zoom.',
  })}</aside>`;
  const links = model.edges.filter((edge) => edge.kind !== 'replaces').length;
  const replacements = model.edges.length - links;
  const head = `<header class="view-head">
    <h1 id="view-title">Graph</h1>
    <p class="view-summary">${plural(model.nodes.length, 'entry', 'entries')}<span class="sep">·</span>${plural(links, 'connection')}<span class="sep">·</span>${plural(replacements, 'replaced decision')}</p>
  </header>`;

  if (!model.nodes.length) {
    return {
      model,
      html: `<section class="view view-graph" aria-labelledby="view-title">${head}<div class="graph-layout"><div class="graph-canvas is-empty"><div class="empty-state"><div class="empty-icon">${icon('graph', 34)}</div><h2>Nothing to draw yet</h2><p>Capture entries and connect them to decisions to see the graph.</p></div></div>${inspector}</div></section>`,
    };
  }

  const { positions, labels: spots, bounds } = layoutFor(index, model);
  const query = parseQuery(state.search);
  const matches = hasFilters(query)
    ? new Set(model.nodes.filter((node) => entryMatches(index, node, query)).map((node) => node.id))
    : undefined;
  const focusId = selected && model.neighbours.has(selected.id) ? selected.id : undefined;
  const focus = focusId ? new Set([focusId, ...(model.neighbours.get(focusId) ?? [])]) : undefined;
  const dimmed = (id: string) => (focus ? !focus.has(id) : matches ? !matches.has(id) : false);
  const at = (id: string) => positions.get(id) ?? { x: 0, y: 0 };

  const edges = model.edges
    .map((edge) => {
      const a = at(edge.from);
      const b = at(edge.to);
      const dim = focus ? edge.from !== focusId && edge.to !== focusId : matches ? !matches.has(edge.from) && !matches.has(edge.to) : false;
      const classes = `g-edge kind-${edge.kind}${dim ? ' is-dim' : ''}`;
      if (edge.kind === 'replaces') {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        const tip = { x: b.x - (dx / length) * (RING + 5), y: b.y - (dy / length) * (RING + 5) };
        return `<path class="${classes}" data-from="${edge.from}" data-to="${edge.to}" d="${curve(a, tip, -0.18)}" marker-end="url(#tb-arrow)" vector-effect="non-scaling-stroke"/>`;
      }
      return `<path class="${classes}" data-from="${edge.from}" data-to="${edge.to}" d="${curve(a, b, 0.12)}" vector-effect="non-scaling-stroke"/>`;
    })
    .join('');

  const nodes = model.nodes.map((node) => nodeHtml(node, at(node.id), { dim: dimmed(node.id), selected: node.id === focusId })).join('');
  const labels = model.nodes
    .map((node) => {
      const classes = ['g-label'];
      if (node.type !== 'decision') classes.push('is-evidence');
      if (node.status === 'superseded') classes.push('is-replaced');
      if (dimmed(node.id)) classes.push('is-dim');
      if (focus?.has(node.id)) classes.push('is-focus');
      if (matches?.has(node.id)) classes.push('is-match');
      const spot = spots.get(node.id) ?? { ...at(node.id), anchor: 'middle' as const };
      return `<text class="${classes.join(' ')}" data-label="${node.id}" x="${fixed(spot.x)}" y="${fixed(spot.y)}" text-anchor="${spot.anchor}">${escapeHtml(truncate(node.title, LABEL_LENGTH))}</text>`;
    })
    .join('');

  const description = `Graph of ${plural(model.nodes.length, 'entry', 'entries')} and ${plural(links, 'connection')}. The trace map lists the same information as rows.`;
  const html = `<section class="view view-graph" aria-labelledby="view-title">${head}
    <div class="graph-layout">
      <div class="graph-canvas">
        <svg class="graph" role="group" aria-label="${description}">
          <defs><marker id="tb-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>
          <g class="graph-viewport"><g class="g-edges">${edges}</g><g class="g-nodes">${nodes}</g><g class="g-labels">${labels}</g></g>
        </svg>
        <div class="graph-legend" aria-hidden="true"><span><svg class="lg-glyph" width="14" height="14" viewBox="0 0 14 14"><circle class="lg-ring" cx="7" cy="7" r="5"/></svg>decision</span><span><svg class="lg-glyph" width="14" height="14" viewBox="0 0 14 14"><circle class="lg-dot" cx="7" cy="7" r="4"/></svg>evidence</span><span><i class="lg-support"></i>supports</span><span><i class="lg-challenge"></i>challenges</span><span><i class="lg-replace"></i>replaced by</span><span class="lg-hint">drag to move · scroll to zoom</span></div>
        <div class="graph-zoom"><button type="button" data-action="zoom-in" aria-label="Zoom in" title="Zoom in (+)">${icon('plus', 15)}</button><button type="button" data-action="zoom-out" aria-label="Zoom out" title="Zoom out (−)"><span aria-hidden="true">−</span></button><button type="button" data-action="zoom-fit" aria-label="Fit the graph to the window" title="Fit the graph to the window (0)">FIT</button></div>
      </div>
      ${inspector}
    </div>
  </section>`;
  return { html, model, ...(bounds ? { bounds } : {}) };
}

/**
 * Decision labels sit under the ring. Evidence labels sit on the side facing
 * away from the decisions they connect to, so the labels around one decision
 * point outwards instead of piling up on it.
 */
export interface LabelSpot {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const LABEL_LENGTH = 34;

function labelMetrics(node: Entry): { width: number; size: number } {
  const decision = node.type === 'decision';
  const size = decision ? 12 : 10.5;
  return { size, width: truncate(node.title, LABEL_LENGTH).length * size * (decision ? 0.6 : 0.56) };
}

/** Bounds of every node and every label, so "fit" never cuts a label off at the edge. */
export function graphBounds(model: GraphModel, positions: ReadonlyMap<string, Point>, spots: ReadonlyMap<string, LabelSpot>): Bounds | undefined {
  const points: Point[] = [];
  for (const node of model.nodes) {
    const p = positions.get(node.id);
    if (p) points.push({ x: p.x - 17, y: p.y - 17 }, { x: p.x + 17, y: p.y + 17 });
    const spot = spots.get(node.id);
    if (!spot || node.type !== 'decision') continue;
    const { width, size } = labelMetrics(node);
    const box = labelBox(spot, width, size);
    points.push({ x: box.x1, y: box.y1 }, { x: box.x2, y: box.y2 });
  }
  return boundsOf(points);
}

function labelBox(spot: LabelSpot, width: number, size: number): Box {
  const x1 = spot.anchor === 'start' ? spot.x : spot.anchor === 'end' ? spot.x - width : spot.x - width / 2;
  return { x1, y1: spot.y - size * 0.8, x2: x1 + width, y2: spot.y + size * 0.3 };
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The four places a label can go, best first: away from the node's neighbours. */
function candidates(node: Entry, p: Point, around: Point[]): LabelSpot[] {
  const decision = node.type === 'decision';
  const gap = decision ? 22 : 13;
  const options: Array<{ dir: [number, number]; spot: LabelSpot }> = [
    { dir: [0, 1], spot: { x: p.x, y: p.y + (decision ? 33 : 23), anchor: 'middle' } },
    { dir: [0, -1], spot: { x: p.x, y: p.y - (decision ? 24 : 14), anchor: 'middle' } },
    { dir: [1, 0], spot: { x: p.x + gap, y: p.y + 4, anchor: 'start' } },
    { dir: [-1, 0], spot: { x: p.x - gap, y: p.y + 4, anchor: 'end' } },
  ];
  let away: [number, number] = [0, 1];
  if (around.length) {
    const dx = p.x - around.reduce((sum, q) => sum + q.x, 0) / around.length;
    const dy = p.y - around.reduce((sum, q) => sum + q.y, 0) / around.length;
    const length = Math.hypot(dx, dy);
    if (length > 0.01) away = [dx / length, dy / length];
  }
  // Decision labels are wide: put them under or over the ring unless both spots are taken.
  const toward = (dir: [number, number]) => dir[0] * away[0] + dir[1] * away[1];
  const score = ({ dir }: { dir: [number, number] }) =>
    decision ? (dir[1] > 0 ? 1 : dir[1] < 0 ? 0.75 : 0.35) + 0.25 * toward(dir) : toward(dir);
  return options.sort((a, b) => score(b) - score(a)).map(({ spot }) => spot);
}

/**
 * Places labels greedily: decisions first, then the best-connected evidence.
 * Each label takes the first of its four spots that does not overlap a label
 * placed earlier or another node, or else the spot that overlaps least.
 */
export function placeLabels(model: GraphModel, positions: ReadonlyMap<string, Point>): Map<string, LabelSpot> {
  const at = (id: string) => positions.get(id) ?? { x: 0, y: 0 };
  const nodeBoxes = model.nodes.map((node) => {
    const p = at(node.id);
    const r = node.type === 'decision' ? 17 : 9;
    return { id: node.id, box: { x1: p.x - r, y1: p.y - r, x2: p.x + r, y2: p.y + r } };
  });
  const degree = (id: string) => model.neighbours.get(id)?.size ?? 0;
  const order = [...model.nodes].sort(
    (a, b) => Number(b.type === 'decision') - Number(a.type === 'decision') || degree(b.id) - degree(a.id) || (a.id < b.id ? -1 : 1),
  );
  const crowded = model.nodes.length > 400;
  const placed: Box[] = [];
  const result = new Map<string, LabelSpot>();
  for (const node of order) {
    const { width, size } = labelMetrics(node);
    const spots = candidates(node, at(node.id), [...(model.neighbours.get(node.id) ?? [])].map(at));
    let best = spots[0];
    if (!crowded) {
      let bestScore = Number.POSITIVE_INFINITY;
      for (const spot of spots) {
        const box = labelBox(spot, width, size);
        let score = 0;
        for (const other of placed) score += overlap(box, other);
        for (const other of nodeBoxes) if (other.id !== node.id) score += overlap(box, other.box) * 0.5;
        if (score < bestScore) {
          best = spot;
          bestScore = score;
          if (!score) break;
        }
      }
    }
    placed.push(labelBox(best, width, size));
    result.set(node.id, best);
  }
  return result;
}

function nodeHtml(node: Entry, p: Point, flags: { dim: boolean; selected: boolean }): string {
  const classes = ['g-node', `type-${node.type}`];
  if (node.status) classes.push(`status-${node.status}`);
  if (flags.dim) classes.push('is-dim');
  if (flags.selected) classes.push('is-selected');
  const label = `${typeLabel(node.type)}${node.status ? ` (${STATUS_LABELS[node.status].toLowerCase()})` : ''}: ${node.title}`;
  const shape =
    node.type === 'decision'
      ? `${flags.selected ? '<circle class="halo" r="27"/>' : ''}<circle class="ring" r="${RING}"/><circle class="core" r="5.5"/>`
      : `${flags.selected ? '<circle class="halo" r="17"/>' : ''}<circle class="dot" r="7.5"/>`;
  return `<g class="${classes.join(' ')}" data-action="select" data-id="${node.id}" data-node="${node.id}" data-focus="node:${node.id}" transform="translate(${fixed(p.x)} ${fixed(p.y)})" tabindex="0" role="button" aria-label="${escapeHtml(label)}"><title>${escapeHtml(node.title)}</title>${shape}</g>`;
}

export interface GraphController {
  zoomBy(factor: number): void;
  fit(): void;
}

export interface AttachOptions {
  neighbours: GraphModel['neighbours'];
  bounds?: Bounds;
  transform?: GraphTransform;
  onTransform(transform: GraphTransform): void;
  onBackgroundClick(): void;
}

/** Wires panning, zooming and hover highlighting onto a freshly rendered graph. */
export function attachGraph(root: ParentNode, options: AttachOptions): GraphController | undefined {
  const svg = root.querySelector<SVGSVGElement>('svg.graph');
  const viewport = svg?.querySelector<SVGGElement>('.graph-viewport');
  if (!svg || !viewport) return undefined;

  const size = () => {
    const rect = svg.getBoundingClientRect();
    return { width: rect.width || 800, height: rect.height || 560 };
  };
  const fitted = (): GraphTransform => {
    const { width, height } = size();
    const b = options.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const padX = 40;
    const padY = 40;
    const k = Math.min(Math.max(Math.min(width / (b.maxX - b.minX + padX * 2), height / (b.maxY - b.minY + padY * 2)), 0.25), 1.35);
    return { k, x: width / 2 - ((b.minX + b.maxX) / 2) * k, y: height / 2 - ((b.minY + b.maxY) / 2) * k };
  };
  let transform = options.transform ?? fitted();
  const apply = (next: GraphTransform) => {
    transform = next;
    viewport.setAttribute('transform', `translate(${fixed(next.x)} ${fixed(next.y)}) scale(${Math.round(next.k * 1000) / 1000})`);
    svg.classList.toggle('is-zoomed', next.k >= LABEL_ZOOM);
    // Below 0.85× labels grow inside the zoom, so they stay about 10 px or larger on screen.
    svg.style.setProperty('--label-boost', String(Math.round(Math.max(1, 0.85 / next.k) * 1000) / 1000));
    options.onTransform(next);
  };
  const zoomAround = (factor: number, px: number, py: number) => {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.k * factor));
    const ratio = k / transform.k;
    apply({ k, x: px - (px - transform.x) * ratio, y: py - (py - transform.y) * ratio });
  };
  apply(transform);

  let drag: { id: number; x: number; y: number; start: GraphTransform; moved: boolean } | undefined;
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('.g-node')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: transform, moved: false };
    svg.setPointerCapture?.(event.pointerId);
    svg.classList.add('is-panning');
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    apply({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy });
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const clicked = !drag.moved;
    drag = undefined;
    svg.classList.remove('is-panning');
    if (clicked && event.type === 'pointerup') options.onBackgroundClick();
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const scale = event.deltaMode === 1 ? 0.05 : 0.0015;
      zoomAround(Math.exp(-event.deltaY * scale), event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false },
  );

  const clearNear = () => {
    svg.classList.remove('is-hovering');
    svg.querySelectorAll('.is-near').forEach((element) => element.classList.remove('is-near'));
  };
  const highlight = (id: string) => {
    clearNear();
    const near = new Set([id, ...(options.neighbours.get(id) ?? [])]);
    svg.classList.add('is-hovering');
    svg.querySelectorAll<SVGElement>('[data-node], [data-label]').forEach((element) => {
      if (near.has(element.getAttribute('data-node') ?? element.getAttribute('data-label') ?? '')) element.classList.add('is-near');
    });
    svg.querySelectorAll<SVGElement>('.g-edge').forEach((element) => {
      if (element.getAttribute('data-from') === id || element.getAttribute('data-to') === id) element.classList.add('is-near');
    });
  };
  const nodeOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<SVGElement>('[data-node]') : null);
  svg.addEventListener('pointerover', (event) => {
    const id = nodeOf(event.target)?.getAttribute('data-node');
    if (id) highlight(id);
  });
  svg.addEventListener('pointerout', (event) => {
    if (nodeOf(event.target) && !nodeOf(event.relatedTarget)) clearNear();
  });
  svg.addEventListener('focusin', (event) => {
    const id = nodeOf(event.target)?.getAttribute('data-node');
    if (id) highlight(id);
  });
  svg.addEventListener('focusout', clearNear);

  return {
    zoomBy(factor) {
      const { width, height } = size();
      zoomAround(factor, width / 2, height / 2);
    },
    fit() {
      apply(fitted());
    },
  };
}
