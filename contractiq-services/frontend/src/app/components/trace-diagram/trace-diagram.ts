import { Component, computed, effect, input, output, signal } from '@angular/core';
import { TraceEntry, TraceNode } from '../../models/trace.model';
import { buildTraceTree, flattenForReveal } from '../../util/trace-tree';

const SERVICE_LABELS: Record<string, string> = {
  'ingestion-service': 'Ingestion',
  'rules-service': 'Rules',
  'agent-service': 'Agent',
};

function serviceLabel(service: string): string {
  return SERVICE_LABELS[service] ?? service;
}

interface RenderNode {
  node: TraceNode;
  from: string;
  to: string;
  text: string;
  durationMs: number;
  isChild: boolean;
  revealIndex: number;
}

const REVEAL_STEP_MS = 400;

@Component({
  selector: 'app-trace-diagram',
  imports: [],
  templateUrl: './trace-diagram.html',
  styleUrl: './trace-diagram.css',
})
export class TraceDiagram {
  readonly trace = input<TraceEntry[] | null>(null);
  readonly inFlight = input<boolean>(false);
  readonly revealed = output<void>();

  protected readonly revealedCount = signal(0);

  private readonly tree = computed(() => {
    const entries = this.trace();
    return entries ? buildTraceTree(entries) : null;
  });

  protected readonly renderNodes = computed<RenderNode[]>(() => {
    const tree = this.tree();
    if (!tree) return [];

    const sequence = flattenForReveal(tree);
    const indexOf = new Map(sequence.map((n, i) => [n, i]));
    const rows: RenderNode[] = [];

    for (const top of tree.topLevel) {
      rows.push(this.toRenderNode(top, 'Agent', false, indexOf.get(top)!));
      for (const child of top.children) {
        rows.push(this.toRenderNode(child, serviceLabel(top.entry.service), true, indexOf.get(child)!));
      }
    }
    if (tree.root) {
      rows.push(this.toRenderNode(tree.root, 'Agent', false, indexOf.get(tree.root)!));
    }
    return rows;
  });

  protected readonly totalSteps = computed(() => this.renderNodes().length);

  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    effect(() => {
      // Re-run whenever a new trace array arrives.
      const entries = this.trace();
      this.clearTimers();
      this.revealedCount.set(0);

      if (!entries || entries.length === 0) return;

      const steps = this.renderNodes().length;
      for (let i = 0; i < steps; i++) {
        this.timers.push(
          setTimeout(() => this.revealedCount.set(i + 1), i * REVEAL_STEP_MS)
        );
      }
      this.timers.push(
        setTimeout(() => this.revealed.emit(), steps * REVEAL_STEP_MS + 150)
      );
    });
  }

  protected isVisible(revealIndex: number): boolean {
    return revealIndex < this.revealedCount();
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private toRenderNode(node: TraceNode, parentLabel: string, isChild: boolean, revealIndex: number): RenderNode {
    if (node.kind === 'root') {
      return {
        node, from: 'Agent', to: 'Agent',
        text: 'Analysis complete',
        durationMs: node.entry.duration_ms, isChild, revealIndex,
      };
    }
    if (node.kind === 'annotation') {
      return {
        node, from: 'Agent', to: '',
        text: node.entry.action.replace(/^fallback:\s*/, ''),
        durationMs: node.entry.duration_ms, isChild, revealIndex,
      };
    }
    if (node.kind === 'failed-hop') {
      const target = node.entry.calls[0] ? serviceLabel(node.entry.calls[0]) : 'Rules';
      return {
        node, from: parentLabel, to: target,
        text: node.entry.action.replace(' (FAILED)', ''),
        durationMs: node.entry.duration_ms, isChild, revealIndex,
      };
    }
    return {
      node, from: parentLabel, to: serviceLabel(node.entry.service),
      text: node.entry.action,
      durationMs: node.entry.duration_ms, isChild, revealIndex,
    };
  }
}
