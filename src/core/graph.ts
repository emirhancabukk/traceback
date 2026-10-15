import { forceLayout, type Point } from './layout';
import type { Entry, LinkKind } from './model';
import type { WorkspaceIndex } from './query';

export type GraphEdgeKind = LinkKind | 'replaces';

export interface GraphEdge {
  id: string;
  /** Evidence for links; the replaced decision for `replaces` edges. */
  from: string;
  /** The decision for links; the replacement for `replaces` edges. */
  to: string;
  kind: GraphEdgeKind;
}

export interface GraphModel {
  nodes: Entry[];
  edges: GraphEdge[];
  neighbours: ReadonlyMap<string, ReadonlySet<string>>;
}

export function buildGraph(index: WorkspaceIndex): GraphModel {
  const nodes = [...index.workspace.entries];
  const edges: GraphEdge[] = index.workspace.links.map((link) => ({
    id: `link:${link.decisionId}>${link.evidenceId}`,
    from: link.evidenceId,
    to: link.decisionId,
    kind: link.kind,
  }));
  for (const entry of nodes) {
    if (entry.type === 'decision' && entry.supersededBy && index.byId.has(entry.supersededBy)) {
      edges.push({ id: `replaces:${entry.id}>${entry.supersededBy}`, from: entry.id, to: entry.supersededBy, kind: 'replaces' });
    }
  }
  const neighbours = new Map<string, Set<string>>(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    neighbours.get(edge.from)?.add(edge.to);
    neighbours.get(edge.to)?.add(edge.from);
  }
  return { nodes, edges, neighbours };
}

/** Lays the graph out. Pass the previous positions to keep the picture stable while the trail grows. */
export function layoutGraph(model: GraphModel, previous?: ReadonlyMap<string, Point>): Map<string, Point> {
  return forceLayout(
    model.nodes.map((node) => ({ id: node.id, weight: node.type === 'decision' ? 1.8 : 1 })),
    model.edges.map((edge) => ({ source: edge.from, target: edge.to, length: edge.kind === 'replaces' ? 150 : 90 })),
    previous ? { initial: previous } : {},
  );
}
