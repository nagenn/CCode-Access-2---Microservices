import { Component, signal } from '@angular/core';
import { ContractQueue } from './components/contract-queue/contract-queue';
import { ContractDetail } from './components/contract-detail/contract-detail';

@Component({
  selector: 'app-root',
  imports: [ContractQueue, ContractDetail],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly selectedFilename = signal<string | null>(null);
  protected readonly headerTime = signal(App.formatTime());

  constructor() {
    setInterval(() => this.headerTime.set(App.formatTime()), 10000);
  }

  private static formatTime(): string {
    const now = new Date();
    const date = now.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' });
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `${date}  ${time}`;
  }

  protected onSelect(filename: string): void {
    this.selectedFilename.set(filename);
  }
}
