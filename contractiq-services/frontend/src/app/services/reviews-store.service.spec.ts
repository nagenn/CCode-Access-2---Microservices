import { describe, expect, it } from 'vitest';
import { CONFIDENCE_ESCALATION_THRESHOLD, deriveReviewStatus } from './reviews-store.service';

describe('deriveReviewStatus', () => {
  it('clears Low risk when confidence is not provided (manual review path)', () => {
    expect(deriveReviewStatus('Low')).toBe('cleared');
  });

  it('escalates High or Medium risk when confidence is not provided (manual review path)', () => {
    expect(deriveReviewStatus('High')).toBe('escalated');
    expect(deriveReviewStatus('Medium')).toBe('escalated');
  });

  it('clears Low risk when confidence is comfortably above the threshold', () => {
    expect(deriveReviewStatus('Low', 0.9)).toBe('cleared');
  });

  it('escalates Low risk when confidence is below the threshold, overriding risk', () => {
    expect(deriveReviewStatus('Low', 0.74)).toBe('escalated');
  });

  it('clears Low risk exactly at the threshold (strict less-than, not less-or-equal)', () => {
    expect(deriveReviewStatus('Low', CONFIDENCE_ESCALATION_THRESHOLD)).toBe('cleared');
  });

  it('escalates Low risk on the zero-confidence fallback (unparseable/empty LLM response)', () => {
    expect(deriveReviewStatus('Low', 0.0)).toBe('escalated');
  });

  it('escalates High risk when confidence is also below the threshold', () => {
    expect(deriveReviewStatus('High', 0.5)).toBe('escalated');
  });
});
