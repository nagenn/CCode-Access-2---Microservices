import { Injectable, computed, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Review, ReviewCreate, ReviewStatus } from '../models/review.model';
import { ApiService } from './api.service';

/** Mirrors escalation_rules.confidence_below in compliance_rules.json. */
export const CONFIDENCE_ESCALATION_THRESHOLD = 0.75;

/**
 * Low risk clears a contract; Medium/High escalates it. Confidence below
 * CONFIDENCE_ESCALATION_THRESHOLD forces escalation regardless of risk —
 * manual reviews have no LLM confidence, so pass confidence only when one
 * actually exists.
 */
export function deriveReviewStatus(riskLevel: string, confidence?: number): ReviewStatus {
  if (confidence !== undefined && confidence < CONFIDENCE_ESCALATION_THRESHOLD) {
    return 'escalated';
  }
  return riskLevel === 'Low' ? 'cleared' : 'escalated';
}

@Injectable({ providedIn: 'root' })
export class ReviewsStoreService {
  private readonly reviewsSignal = signal<Review[]>([]);
  readonly reviews = this.reviewsSignal.asReadonly();

  /** Latest review per filename, keyed by filename. */
  readonly latestByFilename = computed(() => {
    const map = new Map<string, Review>();
    for (const review of this.reviewsSignal()) {
      const existing = map.get(review.filename);
      if (!existing || review.timestamp > existing.timestamp) {
        map.set(review.filename, review);
      }
    }
    return map;
  });

  constructor(private api: ApiService) {}

  async refresh(): Promise<void> {
    const reviews = await firstValueFrom(this.api.getReviews());
    this.reviewsSignal.set(reviews);
  }

  async recordReview(payload: ReviewCreate): Promise<Review> {
    const created = await firstValueFrom(this.api.createReview(payload));
    await this.refresh();
    return created;
  }

  async resetAll(): Promise<void> {
    await firstValueFrom(this.api.resetAllReviews());
    await this.refresh();
  }
}
