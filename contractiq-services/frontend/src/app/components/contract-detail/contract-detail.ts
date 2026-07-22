import { Component, computed, effect, input, signal } from '@angular/core';
import { ManualReview } from '../manual-review/manual-review';
import { AgentReview } from '../agent-review/agent-review';

type TabName = 'manual' | 'agent';

@Component({
  selector: 'app-contract-detail',
  imports: [ManualReview, AgentReview],
  templateUrl: './contract-detail.html',
  styleUrl: './contract-detail.css',
})
export class ContractDetail {
  readonly filename = input<string | null>(null);

  protected readonly activeTab = signal<TabName>('manual');

  protected readonly displayName = computed(() => {
    const f = this.filename();
    return f ? f.replace(/\.pdf$/i, '') : '';
  });

  constructor() {
    // New contract selected -> always land back on the Manual Review tab.
    effect(() => {
      this.filename();
      this.activeTab.set('manual');
    });
  }

  protected setTab(tab: TabName): void {
    this.activeTab.set(tab);
  }
}
