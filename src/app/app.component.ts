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
import {
  KestrelDataSnapshot,
  KestrelService,
} from './shared/services/kestrel-bluetooth.service';

interface ReportRequest {
  type: 'recent' | 'rifle' | 'venue' | 'dateRange';
  rifleId: string | null;
  venueId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  limit: number;
}

interface LastSettingsResult {
  rifleName: string;
  venueName: string;
  sessionDate: string;
  distanceM: number | null;
  elevationMil: number | null;
  windageMil: number | null;
  environment: {
    temperatureC: number | null;
    pressureInHg: number | null;
    humidityPercent: number | null;
    windSpeedMps: number | null;
    windDirectionClock: number | null;
  } | null;
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

  currentTab: 'menu' | 'sessions' | 'rifles' | 'venues' | 'history' | 'loadDev' =
    'menu';

  activeRifleName: string | null = null;
  activeVenueName: string | null = null;
  recentSessionsCount = 0;
  recentLoadDevCount = 0;

  /** Cached sessions so Reports doesn't have to keep hitting DataService. */
  private allSessions: any[] = [];

  onBackFromWindEffect(): void {
    // Close the full-screen wind tool and go back to the normal menu
    this.selectedTool = null;
    this.currentTab = 'menu';
  }

  // REPORTS STATE
  showReportsForm = false;
  reportRequest: ReportRequest = {
    type: 'recent',
    rifleId: null,
    venueId: null,
    dateFrom: null,
    dateTo: null,
    limit: 10,
  };

  // NEW: distance + result + error bound in HTML
  reportDistanceM: number | null = null;
  lastSettingsResult: LastSettingsResult | null = null;
  lastSettingsError: string | null = null;

  riflesOptions: any[] = [];
  venuesOptions: any[] = [];

  // TOOLS / KESTREL / CONVERTER
  showTools = false;
  selectedTool: 'kestrel' | 'converter' | 'windEffect' | null = null;

  kestrelData: KestrelDataSnapshot | null = null;

  converterMode: 'milToMoa' | 'moaToMil' | 'clicksToMil' | 'clicksToMoa' =
    'milToMoa';
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

      this.allSessions = sessions || [];

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
    // Opening reports hides tools so they don't overlap visually
    this.showTools = false;
    this.showReportsForm = !this.showReportsForm;
  }

  /**
   * MAIN REPORT ACTION
   *
   * Scenario: when we arrive at a venue, we want to know what our settings were
   * last time there: windage, elevation & conditions at a chosen distance.
   */
  submitReportRequest(): void {
    // Clear previous state
    this.lastSettingsResult = null;
    this.lastSettingsError = null;

    try {
      const rifleId = this.reportRequest.rifleId;
      const venueId = this.reportRequest.venueId;
      const distanceM = this.reportDistanceM;

      if (!rifleId || !venueId || distanceM == null) {
        this.lastSettingsError = 'Please select rifle, venue and distance first.';
        return;
      }

      const sessions =
        (this.allSessions && this.allSessions.length
          ? this.allSessions
          : this.dataService.getSessions?.() ?? []) || [];

      if (!sessions.length) {
        this.lastSettingsError = 'No sessions found in History yet.';
        return;
      }

      // Filter by rifle + venue
      const matching = sessions.filter((s: any) => {
        const sRifleId = s.rifleId || s.rifle?.id || s.rifleKey || null;
        const sVenueId = s.venueId || s.venue?.id || s.venueKey || null;
        return sRifleId === rifleId && sVenueId === venueId;
      });

      if (!matching.length) {
        this.lastSettingsError = 'No previous sessions for this rifle @ venue.';
        return;
      }

      // Latest matching session
      const lastSession = matching[matching.length - 1];

      // Find the DOPE row closest to requested distance
      const dope = this.findDopeForDistance(lastSession, distanceM);

      // Rifle / venue names
      const rifleNameFromSession =
        lastSession.rifleName ||
        lastSession.rifle?.name ||
        lastSession.rifleLabel;
      const venueNameFromSession =
        lastSession.venueName ||
        lastSession.venue?.name ||
        lastSession.venueLabel;

      const rifleName =
        rifleNameFromSession ||
        this.findNameById(this.riflesOptions, rifleId) ||
        'Unknown rifle';

      const venueName =
        venueNameFromSession ||
        this.findNameById(this.venuesOptions, venueId) ||
        'Unknown venue';

      // Date
      const rawDate =
        lastSession.sessionDate ||
        lastSession.date ||
        lastSession.startTime ||
        lastSession.startedAt ||
        lastSession.createdAt ||
        lastSession.timestamp;

      const dateStr = rawDate
        ? new Date(rawDate).toISOString().slice(0, 10)
        : 'unknown date';

      const resolvedDistanceM =
        dope && (dope.distanceM ?? dope.distance ?? null);

      const elevationMil =
        dope && (dope.elevationMil ?? dope.elevation ?? null);
      const windageMil =
        dope && (dope.windageMil ?? dope.windage ?? null);

      // Environment
      const env =
        lastSession.environment ||
        lastSession.env ||
        lastSession.conditions ||
        null;

      const temp =
        env?.temperatureC ??
        env?.tempC ??
        env?.temperature ??
        null;
      const pressure =
        env?.pressureInHg ??
        env?.pressureHpa ??
        env?.pressure ??
        null;
      const humidity =
        env?.humidityPercent ??
        env?.humidity ??
        null;
      const windSpeed =
        env?.windSpeedMps ??
        env?.windSpeed ??
        null;
      const windDirClock =
        env?.windDirectionClock ??
        env?.windDirClock ??
        env?.windClock ??
        null;

      this.lastSettingsResult = {
        rifleName,
        venueName,
        sessionDate: dateStr,
        distanceM: resolvedDistanceM ?? distanceM,
        elevationMil: elevationMil ?? null,
        windageMil: windageMil ?? null,
        environment: {
          temperatureC: temp ?? null,
          pressureInHg: pressure ?? null,
          humidityPercent: humidity ?? null,
          windSpeedMps: windSpeed ?? null,
          windDirectionClock: windDirClock ?? null,
        },
      };
    } catch (err) {
      console.error('Error running report:', err);
      this.lastSettingsError = 'Error running report – see console for details.';
    }
  }

  /**
   * Find the DOPE entry closest to the requested distance.
   */
  private findDopeForDistance(session: any, distanceM: number): any | null {
  const candidates: any[] = [];

  const pushArray = (arr: any) => {
    if (Array.isArray(arr)) {
      candidates.push(...arr);
    }
  };

  // Top-level arrays
  pushArray(session.distanceDopes);
  pushArray(session.distances);
  pushArray(session.distanceDope);
  pushArray(session.dopes);

  // Some structures keep all DOPE in a single "dope" array or map
  if (Array.isArray(session.dope)) {
    pushArray(session.dope);
  }
  if (session.dopeMap && typeof session.dopeMap === 'object') {
    pushArray(Object.values(session.dopeMap));
  }

  // Sub-ranges
  if (Array.isArray(session.subRanges)) {
    for (const sr of session.subRanges) {
      pushArray(sr.distanceDopes);
      pushArray(sr.distances);
      pushArray(sr.distanceDope);
      if (Array.isArray(sr.dope)) {
        pushArray(sr.dope);
      }
      if (sr.dopeMap && typeof sr.dopeMap === 'object') {
        pushArray(Object.values(sr.dopeMap));
      }
    }
  }

  if (!candidates.length) {
    return null;
  }

  // Try to find the entry closest to requested distance
  let best: any | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const c of candidates) {
    const d =
      typeof c?.distanceM === 'number'
        ? c.distanceM
        : typeof c?.distance === 'number'
        ? c.distance
        : null;

    if (d == null) continue;

    const delta = Math.abs(d - distanceM);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = c;
    }
  }

  return best;
}

  /**
   * (Older helper, not used by the current UI but kept in case we need it later.)
   * Look in various likely places on the session for distance DOPE arrays and
   * pick a single entry (middle distance).
   */
  private findSomeDopeEntry(session: any): any | null {
    const candidates: any[] = [];

    const pushArray = (arr: any) => {
      if (Array.isArray(arr)) {
        candidates.push(...arr);
      }
    };

    pushArray(session.distanceDopes);
    pushArray(session.distances);
    pushArray(session.distanceDope);
    pushArray(session.dopes);

    if (Array.isArray(session.subRanges)) {
      for (const sr of session.subRanges) {
        pushArray(sr.distanceDopes);
        pushArray(sr.distances);
        pushArray(sr.distanceDope);
      }
    }

    if (!candidates.length) {
      return null;
    }

    const withDistance = candidates.filter(
      (c) =>
        typeof c?.distanceM === 'number' || typeof c?.distance === 'number'
    );

    if (!withDistance.length) {
      return candidates[0];
    }

    const distances = withDistance.map((c) =>
      typeof c.distanceM === 'number' ? c.distanceM : c.distance
    );
    const min = Math.min(...distances);
    const max = Math.max(...distances);
    const target = (min + max) / 2;

    let best: any = withDistance[0];
    let bestDelta = Number.POSITIVE_INFINITY;

    for (const c of withDistance) {
      const d =
        typeof c.distanceM === 'number' ? c.distanceM : (c.distance as number);
      const delta = Math.abs(d - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = c;
      }
    }

    return best;
  }

  private findNameById(list: any[], id: string | null | undefined): string | null {
    if (!id || !Array.isArray(list)) {
      return null;
    }
    const match = list.find((x) => x.id === id);
    return match?.name ?? null;
  }

  openTools(): void {
    this.showTools = !this.showTools;
    if (!this.showTools) {
      this.selectedTool = null;
    }
    this.showReportsForm = false;
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

    if (this.converterMode === 'milToMoa') {
      return Math.round(value * 3.43775 * 100) / 100;
    }

    if (this.converterMode === 'moaToMil') {
      return Math.round((value / 3.43775) * 1000) / 1000;
    }

    // Simple assumptions for clicks conversions – adjust later if needed
    if (this.converterMode === 'clicksToMil') {
      const mil = value / 10; // 0.1 mil per click example
      return Math.round(mil * 1000) / 1000;
    }

    if (this.converterMode === 'clicksToMoa') {
      const moa = value / 4; // ¼ MOA per click example
      return Math.round(moa * 1000) / 1000;
    }

    return null;
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
