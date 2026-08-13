import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AgentReview } from './agent-review';
import { ApiService } from '../../services/api.service';
import { ReviewsStoreService, deriveReviewStatus } from '../../services/reviews-store.service';
import { AnalyzeResponse } from '../../models/analyze-response.model';

function buildResponse(overrides: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    filename: 'contract.pdf',
    risk_level: 'Low',
    issues: [],
    recommendations: '',
    confidence: 0.9,
    key_obligations: [],
    trace: [],
    ...overrides,
  };
}

describe('AgentReview.onTraceRevealed', () => {
  let recordReview: ReturnType<typeof vi.fn>;
  let component: AgentReview;

  beforeEach(() => {
    recordReview = vi.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { analyzeContract: vi.fn() } },
        { provide: ReviewsStoreService, useValue: { recordReview } },
      ],
    });

    const fixture = TestBed.createComponent(AgentReview);
    fixture.componentRef.setInput('filename', 'contract.pdf');
    component = fixture.componentInstance;
  });

  // This is the assumption the previous version of this test got wrong: confidence
  // is never a field on the recordReview payload, it only feeds deriveReviewStatus().
  // So we can't assert `payload.confidence` — we assert the *status* recordReview
  // received matches what deriveReviewStatus(risk_level, confidence) actually
  // produces for these inputs, which fails if the call site ever regresses to
  // passing risk_level alone.
  it('derives status from both risk_level and confidence, not risk_level alone', async () => {
    const response = buildResponse({ risk_level: 'Low', confidence: 0.5 }); // below threshold
    (component as any).response.set(response);

    await (component as any).onTraceRevealed();

    expect(recordReview).toHaveBeenCalledTimes(1);
    const payload = recordReview.mock.calls[0][0];

    expect(payload.status).toBe(deriveReviewStatus(response.risk_level, response.confidence));
    expect(payload.status).toBe('escalated');
    // Sanity check that this case actually exercises the regression this test guards
    // against: risk_level alone (Low, no confidence) would have said 'cleared'.
    expect(deriveReviewStatus(response.risk_level)).toBe('cleared');
  });

  it('clears when risk is Low and confidence is above the threshold', async () => {
    const response = buildResponse({ risk_level: 'Low', confidence: 0.95 });
    (component as any).response.set(response);

    await (component as any).onTraceRevealed();

    const payload = recordReview.mock.calls[0][0];
    expect(payload.status).toBe(deriveReviewStatus(response.risk_level, response.confidence));
    expect(payload.status).toBe('cleared');
  });

  it('surfaces a save error without throwing when recordReview rejects', async () => {
    recordReview.mockRejectedValueOnce(new Error('network down'));
    const response = buildResponse({ risk_level: 'Low', confidence: 0.95 });
    (component as any).response.set(response);

    await (component as any).onTraceRevealed();

    expect((component as any).recordError()).toContain('could not save it');
  });
});
