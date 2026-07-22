import { Component, effect, input, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { ReviewsStoreService, deriveReviewStatus } from '../../services/reviews-store.service';
import { AnalyzeResponse } from '../../models/analyze-response.model';
import { TraceDiagram } from '../trace-diagram/trace-diagram';
import { ResultPanel } from '../result-panel/result-panel';

type AgentState = 'idle' | 'loading' | 'revealing' | 'done' | 'error';

@Component({
  selector: 'app-agent-review',
  imports: [TraceDiagram, ResultPanel],
  templateUrl: './agent-review.html',
  styleUrl: './agent-review.css',
})
export class AgentReview {
  readonly filename = input.required<string>();

  protected readonly state = signal<AgentState>('idle');
  protected readonly response = signal<AnalyzeResponse | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly recordError = signal<string | null>(null);

  constructor(private api: ApiService, private reviewsStore: ReviewsStoreService) {
    effect(() => {
      this.filename();
      this.state.set('idle');
      this.response.set(null);
      this.errorMessage.set(null);
      this.recordError.set(null);
    });
  }

  protected runAgentReview(): void {
    this.state.set('loading');
    this.response.set(null);
    this.errorMessage.set(null);
    this.recordError.set(null);

    this.api.analyzeContract(this.filename()).subscribe({
      next: (res) => {
        this.response.set(res);
        this.state.set('revealing');
      },
      error: (err) => {
        this.errorMessage.set(
          err?.error?.detail ?? 'Could not reach Agent Service (localhost:8003).'
        );
        this.state.set('error');
      },
    });
  }

  protected async onTraceRevealed(): Promise<void> {
    this.state.set('done');
    const res = this.response();
    if (!res) return;

    try {
      await this.reviewsStore.recordReview({
        filename: this.filename(),
        review_type: 'agent',
        status: deriveReviewStatus(res.risk_level),
        risk_level: res.risk_level,
      });
    } catch {
      this.recordError.set('Result computed, but could not save it to Agent Service\'s review log (localhost:8003).');
    }
  }

  protected reset(): void {
    this.state.set('idle');
    this.response.set(null);
    this.errorMessage.set(null);
    this.recordError.set(null);
  }
}
