import { describe, expect, it } from 'vitest';
import { EXAMPLE_WORKSPACE } from '../src/core/example';
import { buildGraph, layoutGraph } from '../src/core/graph';
import { boundsOf, forceLayout, hashString, type LayoutEdge, type LayoutNode, type Point } from '../src/core/layout';
import { indexWorkspace } from '../src/core/query';
import { placeLabels } from '../src/ui/graph-view';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function twoClusters() {
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  for (const cluster of ['a', 'b']) {
    nodes.push({ id: `${cluster}-hub`, weight: 1.8 });
    for (let i = 0; i < 6; i += 1) {
      nodes.push({ id: `${cluster}-${i}` });
      edges.push({ source: `${cluster}-${i}`, target: `${cluster}-hub` });
    }
  }
  return { nodes, edges };
}

describe('forceLayout', () => {
  it('uses the standard FNV-1a hash', () => {
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('')).toBe(0x811c9dc5);
  });

  it('handles empty and single-node graphs', () => {
    expect(forceLayout([], []).size).toBe(0);
    const single = forceLayout([{ id: 'only' }], []);
    expect(single.get('only')).toEqual({ x: 0, y: 0 });
  });

  it('is deterministic and independent of input order', () => {
    const { nodes, edges } = twoClusters();
    const first = forceLayout(nodes, edges);
    const again = forceLayout(nodes, edges);
    const shuffled = forceLayout([...nodes].reverse(), [...edges].reverse());
    expect([...again]).toEqual([...first]);
    expect([...shuffled.entries()].sort()).toEqual([...first.entries()].sort());
  });

  it('keeps linked nodes close and clusters apart', () => {
    const { nodes, edges } = twoClusters();
    const layout = forceLayout(nodes, edges);
    const within = edges.map((edge) => distance(layout.get(edge.source)!, layout.get(edge.target)!));
    const hubs = distance(layout.get('a-hub')!, layout.get('b-hub')!);
    expect(Math.max(...within)).toBeLessThan(160);
    expect(hubs).toBeGreaterThan(Math.max(...within));
    for (const point of layout.values()) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });

  it('moves existing nodes little when the graph grows', () => {
    const { nodes, edges } = twoClusters();
    const before = forceLayout(nodes, edges);
    const grown = forceLayout([...nodes, { id: 'a-new' }], [...edges, { source: 'a-new', target: 'a-hub' }], { initial: before });
    const shift = nodes.map((node) => distance(before.get(node.id)!, grown.get(node.id)!));
    expect(Math.max(...shift)).toBeLessThan(40);
    expect(distance(grown.get('a-new')!, grown.get('a-hub')!)).toBeLessThan(160);
  });

  it('lays out a large graph without blowing up', () => {
    const nodes: LayoutNode[] = Array.from({ length: 600 }, (_, i) => ({ id: `n${i}`, weight: i % 10 === 0 ? 1.8 : 1 }));
    const edges: LayoutEdge[] = nodes.filter((_, i) => i % 10).map((node, i) => ({ source: node.id, target: `n${Math.floor(i / 9) * 10}` }));
    const layout = forceLayout(nodes, edges);
    expect(layout.size).toBe(600);
    const bounds = boundsOf(layout.values())!;
    expect(Number.isFinite(bounds.maxX - bounds.minX)).toBe(true);
  });
});

describe('buildGraph', () => {
  it('places labels without overlapping each other on the example graph', () => {
    const index = indexWorkspace({ ...EXAMPLE_WORKSPACE, entries: [...EXAMPLE_WORKSPACE.entries], links: [...EXAMPLE_WORKSPACE.links] });
    const model = buildGraph(index);
    const positions = layoutGraph(model);
    const spots = placeLabels(model, positions);
    expect(spots.size).toBe(model.nodes.length);
    const decisions = model.nodes.filter((node) => node.type === 'decision');
    for (const node of decisions) expect(spots.get(node.id)!.y).not.toBe(positions.get(node.id)!.y);
  });

  it('turns links and replacements into edges with symmetric neighbours', () => {
    const index = indexWorkspace({ ...EXAMPLE_WORKSPACE, entries: [...EXAMPLE_WORKSPACE.entries], links: [...EXAMPLE_WORKSPACE.links] });
    const model = buildGraph(index);
    expect(model.nodes).toHaveLength(EXAMPLE_WORKSPACE.entries.length);
    expect(model.edges.filter((edge) => edge.kind === 'replaces')).toEqual([
      expect.objectContaining({ from: 'example-d-shared', to: 'example-d-host' }),
      expect.objectContaining({ from: 'example-d-own-form', to: 'example-d-checkout' }),
    ]);
    expect(model.neighbours.get('example-d-checkout')?.has('example-s-stripe')).toBe(true);
    expect(model.neighbours.get('example-s-stripe')?.has('example-d-checkout')).toBe(true);
    const positions = layoutGraph(model);
    expect(positions.size).toBe(model.nodes.length);
  });
});
