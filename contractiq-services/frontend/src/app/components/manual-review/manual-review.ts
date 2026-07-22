import { Component, effect, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReviewsStoreService, deriveReviewStatus } from '../../services/reviews-store.service';

interface ChecklistItem {
  key: string;
  label: string;
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  { key: 'liability', label: 'Limitation of Liability clause present' },
  { key: 'indemnification', label: 'Indemnification clause present' },
  { key: 'termination', label: 'Termination rights defined' },
  { key: 'dataprot', label: 'Data Protection / Privacy clause present' },
  { key: 'ip', label: 'Intellectual Property ownership defined' },
  { key: 'payment', label: 'Payment terms within Net 30 days' },
  { key: 'prohibited', label: 'No prohibited terms found' },
];

@Component({
  selector: 'app-manual-review',
  imports: [FormsModule],
  templateUrl: './manual-review.html',
  styleUrl: './manual-review.css',
})
export class ManualReview {
  readonly filename = input.required<string>();

  protected readonly checklistItems = CHECKLIST_ITEMS;
  protected readonly checked = signal<Record<string, boolean>>({});
  protected readonly reviewerName = signal('');
  protected readonly riskLevel = signal('');
  protected readonly notes = signal('');

  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly submittedSummary = signal<{ reviewer: string; risk: string; status: string; notes: string } | null>(null);

  constructor(protected reviewsStore: ReviewsStoreService) {
    effect(() => {
      this.filename();
      this.resetForm();
    });
  }

  protected toggle(key: string): void {
    this.checked.update((c) => ({ ...c, [key]: !c[key] }));
  }

  protected isChecked(key: string): boolean {
    return !!this.checked()[key];
  }

  protected resetForm(): void {
    this.checked.set({});
    this.reviewerName.set('');
    this.riskLevel.set('');
    this.notes.set('');
    this.submitError.set(null);
    this.submittedSummary.set(null);
  }

  protected async submit(): Promise<void> {
    const reviewer = this.reviewerName().trim();
    const risk = this.riskLevel();

    if (!reviewer) {
      this.submitError.set('Please enter reviewer name.');
      return;
    }
    if (!risk) {
      this.submitError.set('Please select a risk level.');
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    const status = deriveReviewStatus(risk);

    try {
      await this.reviewsStore.recordReview({
        filename: this.filename(),
        review_type: 'manual',
        status,
        reviewer,
        risk_level: risk,
        notes: this.notes() || null,
      });
      this.submittedSummary.set({ reviewer, risk, status, notes: this.notes() });
    } catch {
      this.submitError.set('Could not reach Agent Service (localhost:8003) to record this review.');
    } finally {
      this.submitting.set(false);
    }
  }
}
