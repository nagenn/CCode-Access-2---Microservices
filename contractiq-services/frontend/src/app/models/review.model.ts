export type ReviewType = 'manual' | 'agent';
export type ReviewStatus = 'cleared' | 'escalated';

export interface Review {
  id: number;
  filename: string;
  review_type: ReviewType;
  status: ReviewStatus;
  reviewer: string | null;
  risk_level: string | null;
  notes: string | null;
  timestamp: string;
}

export interface ReviewCreate {
  filename: string;
  review_type: ReviewType;
  status: ReviewStatus;
  reviewer?: string | null;
  risk_level?: string | null;
  notes?: string | null;
}
