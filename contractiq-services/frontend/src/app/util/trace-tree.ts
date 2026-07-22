import { TraceEntry, TraceNode, TraceNodeKind, TraceTree } from '../models/trace.model';

function kindOf(entry: TraceEntry): TraceNodeKind {
  if (entry.error) return 'failed-hop';
  if (entry.action.startsWith('fallback:')) return 'annotation';
  return 'hop';
}

/**
 * Reconstructs the hop graph from the flat trace array. There are no
 * parent/child IDs on the wire, so nesting is inferred structurally: the
 * last entry is always the root (agent-service's own summary). For every
 * other entry, nesting is decided by ADJACENCY, not by scanning the whole
 * array for a service-name match — a nested call's entries always sit
 * immediately before the entry of the service that made the nested call
 * (that's how `trace.extend(child.trace)` followed by `trace.append(own)`
 * assembles the array at each hop). Two entries can share the same
 * `service` value (e.g. ingestion-service appears once for Agent's direct
 * text call and again, nested, for Rules' exists check), so matching on
 * service name across the whole array would wrongly attach both to the
 * same parent — checking only the immediate next entry avoids that.
 */
export function buildTraceTree(trace: TraceEntry[]): TraceTree {
  if (trace.length === 0) {
    return { topLevel: [], root: null };
  }

  const rootEntry = trace[trace.length - 1];
  const rest = trace.slice(0, -1);

  const nodesByIndex = rest.map((entry): TraceNode => ({
    entry,
    kind: kindOf(entry),
    children: [],
  }));

  const topLevel: TraceNode[] = [];

  rest.forEach((entry, i) => {
    const node = nodesByIndex[i];
    const next = rest[i + 1];

    if (next && next.calls.includes(entry.service)) {
      nodesByIndex[i + 1].children.push(node);
    } else {
      topLevel.push(node);
    }
  });

  const root: TraceNode = {
    entry: rootEntry,
    kind: 'root',
    children: [],
  };

  return { topLevel, root };
}

/** Flattens the tree into reveal order: each top-level node, its children right after, then the root last. */
export function flattenForReveal(tree: TraceTree): TraceNode[] {
  const sequence: TraceNode[] = [];
  for (const node of tree.topLevel) {
    sequence.push(node);
    sequence.push(...node.children);
  }
  if (tree.root) sequence.push(tree.root);
  return sequence;
}
