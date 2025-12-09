import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { RiflesTabComponent } from './rifles-tab/rifles-tab.component';
import { VenuesTabComponent } from './venues-tab/venues-tab.component';
import { SessionTabComponent } from './session-tab/session-tab.component';
import { HistoryTabComponent } from './history-tab/history-tab.component';
import { LoadDevTabComponent } from './load-dev-tab/load-dev-tab.component';
import { WindEffectToolComponent } from './wind-effect-tool.component';

import { DataService } from './data.service';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { KestrelDataSnapshot, KestrelService } from './shared/services/kestrel-bluetooth.service';


interface ReportRequest {
  type: 'recent' | 'rifle' | 'venue' | 'dateRange';
  rifleId: string | null;
  venueId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  limit: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  imports: [
    CommonModule,
    FormsModule,
    RiflesTabComponent,
    VenuesTabComponent,
    SessionTabComponent,
    HistoryTabComponent,
    LoadDevTabComponent,
    WindEffectToolComponent,
  ],
})
export class AppComponent implements OnInit {
  appTitle = 'Gunstuff Ballistic Dope Card';
  appSubtitle = 'Field log for rifles, venues & sessions';
  appVersion = '1.0.0';

  currentTab: 'menu' | 'sessions' | 'rifles' | 'venues' | 'history' | 'loadDev' = 'menu';

  activeRifleName: string | null = null;
  activeVenueName: string | null = null;
  recentSessionsCount = 0;
  recentLoadDevCount = 0;
onBackFromWindEffect(): void {
  // Close the full-screen wind tool and go back to the normal menu
  this.selectedTool = null;
  this.currentTab = 'menu';
}

  showReportsForm = false;
  reportRequest: ReportRequest = {
    type: 'recent',
    rifleId: null,
    venueId: null,
    dateFrom: null,
    dateTo: null,
    limit: 10,
  };

  riflesOptions: any[] = [];
  venuesOptions: any[] = [];

  showTools = false;
  selectedTool: 'kestrel' | 'converter' | 'windEffect' | null = null;

  kestrelData: KestrelDataSnapshot | null = null;

  converterMode: 'milToMoa' | 'moaToMil' = 'milToMoa';
  converterInput: number | null = null;

  private dataService: DataService = inject(DataService);
  kestrel: KestrelService = inject(KestrelService);

  ngOnInit(): void {
    this.loadCoreData();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private loadCoreData(): void {
    try {
      const rifles = this.dataService.getRifles();
      const venues = this.dataService.getVenues();
      const sessions = this.dataService.getSessions?.() ?? [];

      this.riflesOptions = rifles || [];
      this.venuesOptions = venues || [];

      this.recentSessionsCount = sessions.length;
      this.recentLoadDevCount = 0;

      this.activeRifleName = rifles?.length ? rifles[0].name : null;
      this.activeVenueName = venues?.length ? venues[0].name : null;
    } catch (err) {
      console.error('Error loading core data in AppComponent:', err);
    }
  }

  setTab(tab: 'menu' | 'sessions' | 'rifles' | 'venues' | 'history' | 'loadDev'): void {
    this.currentTab = tab;

    if (tab !== 'menu') {
      this.showReportsForm = false;
      this.showTools = false;
      this.selectedTool = null;
    }
  }

  goToSessionsTab(): void {
    this.setTab('sessions');
  }

  toggleReportsForm(): void {
    this.showReportsForm = !this.showReportsForm;
  }

  submitReportRequest(): void {
    console.log('Report request:', this.reportRequest);
    this.showReportsForm = false;
  }

  openTools(): void {
    this.showTools = !this.showTools;
    if (!this.showTools) {
      this.selectedTool = null;
    }
  }

  onConverterToolClick(): void {
    this.selectedTool = this.selectedTool === 'converter' ? null : 'converter';
  }

  onWindEffectToolClick(): void {
    this.selectedTool = this.selectedTool === 'windEffect' ? null : 'windEffect';
  }

  get converterOutput(): number | null {
    if (this.converterInput == null || Number.isNaN(this.converterInput)) {
      return null;
    }
    const value = this.converterInput;
    return this.converterMode === 'milToMoa'
      ? Math.round(value * 3.43775 * 100) / 100
      : Math.round((value / 3.43775) * 1000) / 1000;
  }

   async onKestrelButtonClick(): Promise<void> {
      if (this.selectedTool === 'kestrel') {
      this.selectedTool = null;
      return;
    }
     this.selectedTool = 'kestrel';
    await this.kestrel.connectKestrelBluetooth();
    this.kestrelData = this.kestrel.kestrelData$.getValue();

    
  }
}
