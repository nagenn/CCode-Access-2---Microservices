import { TraceEntry } from './trace.model';

export interface Issue {
  type: 'missing_clause' | 'problematic_term';
  description: string;
}

export interface AnalyzeResponse {
  filename: string;
  risk_level: string;
  issues: Issue[];
  recommendations: string;
  confidence: number;
  key_obligations: string[];
  trace: TraceEntry[];
}
