export interface TraceEntry {
  service: string;
  action: string;
  duration_ms: number;
  calls: string[];
  error?: string;
}

export type TraceNodeKind = 'hop' | 'failed-hop' | 'annotation' | 'root';

export interface TraceNode {
  entry: TraceEntry;
  kind: TraceNodeKind;
  children: TraceNode[];
}

export interface TraceTree {
  topLevel: TraceNode[];
  root: TraceNode | null;
}
