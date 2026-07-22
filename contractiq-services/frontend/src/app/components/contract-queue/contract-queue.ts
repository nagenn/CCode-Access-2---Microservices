import { Component, OnInit, computed, input, output, signal } from '@angular/core';
import { Contract } from '../../models/contract.model';
import { ApiService } from '../../services/api.service';
import { ReviewsStoreService } from '../../services/reviews-store.service';

type BadgeStatus = 'pending' | 'cleared' | 'escalated';

interface QueueRow {
  filename: string;
  displayName: string;
  status: BadgeStatus;
  statusLabel: string;
  reviewType: 'manual' | 'agent' | null;
  reviewer: string | null;
}

@Component({
  selector: 'app-contract-queue',
  imports: [],
  templateUrl: './contract-queue.html',
  styleUrl: './contract-queue.css',
})
export class ContractQueue implements OnInit {
  readonly selectedFilename = input<string | null>(null);
  readonly select = output<string>();

  protected readonly contracts = signal<Contract[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly resetting = signal(false);

  protected readonly rows = computed<QueueRow[]>(() => {
    const latest = this.reviewsStore.latestByFilename();
    return this.contracts().map((c) => {
      const review = latest.get(c.filename);
      const status: BadgeStatus = review ? review.status : 'pending';
      return {
        filename: c.filename,
        displayName: c.filename.replace(/\.pdf$/i, ''),
        status,
        statusLabel: status === 'pending' ? 'Pending Review' : status === 'cleared' ? 'Cleared' : 'Escalated',
        reviewType: review?.review_type ?? null,
        reviewer: review?.reviewer ?? null,
      };
    });
  });

  protected readonly stats = computed(() => {
    const rows = this.rows();
    return {
      total: rows.length,
      pending: rows.filter((r) => r.status === 'pending').length,
      cleared: rows.filter((r) => r.status === 'cleared').length,
      escalated: rows.filter((r) => r.status === 'escalated').length,
    };
  });

  constructor(private api: ApiService, protected reviewsStore: ReviewsStoreService) {}

  ngOnInit(): void {
    this.loadContracts();
  }

  protected loadContracts(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getContracts().subscribe({
      next: (contracts) => {
        this.contracts.set(contracts);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('Could not reach Ingestion Service (localhost:8001). Is it running?');
        this.loading.set(false);
      },
    });
    this.reviewsStore.refresh().catch(() => {
      // Non-fatal: queue still renders with "Pending Review" everywhere.
    });
  }

  protected onRowClick(filename: string): void {
    this.select.emit(filename);
  }

  protected async resetAllContracts(): Promise<void> {
    const confirmed = confirm('Reset all contracts to "Pending Review"? This clears every recorded review outcome and cannot be undone.');
    if (!confirmed) return;

    this.resetting.set(true);
    try {
      await this.reviewsStore.resetAll();
    } catch {
      this.loadError.set('Could not reach Agent Service (localhost:8003) to reset reviews.');
    } finally {
      this.resetting.set(false);
    }
  }
}
