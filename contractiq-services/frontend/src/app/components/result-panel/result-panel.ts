import { Component, computed, input } from '@angular/core';
import { AnalyzeResponse } from '../../models/analyze-response.model';

@Component({
  selector: 'app-result-panel',
  imports: [],
  templateUrl: './result-panel.html',
  styleUrl: './result-panel.css',
})
export class ResultPanel {
  readonly response = input.required<AnalyzeResponse>();

  protected readonly riskClass = computed(() => {
    const risk = this.response().risk_level;
    return risk === 'High' ? 'risk-high' : risk === 'Medium' ? 'risk-medium' : 'risk-low';
  });

  protected readonly missingClauses = computed(() =>
    this.response().issues.filter((i) => i.type === 'missing_clause')
  );
  protected readonly problematicTerms = computed(() =>
    this.response().issues.filter((i) => i.type === 'problematic_term')
  );

  protected readonly confidencePct = computed(() => Math.round((this.response().confidence ?? 0) * 100));
}
