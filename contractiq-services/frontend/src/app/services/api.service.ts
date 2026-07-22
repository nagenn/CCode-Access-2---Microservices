import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AnalyzeResponse } from '../models/analyze-response.model';
import { Contract } from '../models/contract.model';
import { Review, ReviewCreate } from '../models/review.model';

const INGESTION_URL = 'http://localhost:8001';
const AGENT_URL = 'http://localhost:8003';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  getContracts(): Observable<Contract[]> {
    return this.http.get<Contract[]>(`${INGESTION_URL}/contracts`);
  }

  analyzeContract(filename: string): Observable<AnalyzeResponse> {
    return this.http.post<AnalyzeResponse>(`${AGENT_URL}/analyze`, { filename });
  }

  getReviews(): Observable<Review[]> {
    return this.http.get<Review[]>(`${AGENT_URL}/reviews`);
  }

  createReview(payload: ReviewCreate): Observable<Review> {
    return this.http.post<Review>(`${AGENT_URL}/reviews`, payload);
  }

  resetAllReviews(): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`${AGENT_URL}/reviews`);
  }
}
