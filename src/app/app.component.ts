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
interface DistanceHistoryEntry {
  sessionDate: string;
  distanceM: number;
  elevationMil: number | null;
  windageMil: number | null;
}

interface DistanceHistoryGroup {
  distanceM: number;
  entries: DistanceHistoryEntry[];
}

interface MultiDistanceDopeSummary {
  distanceM: number;
  elevationMil: number | null;
  windageMil: number | null;
  sessionDate: string | null;
}

interface WindTrendSummary {
  distanceM: number;
  avgWindageMil: number | null;
  sampleCount: number;
  directionLabel: string;
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

  // Distance + result + error
  reportDistanceM: number | null = null;
  lastSettingsResult: LastSettingsResult | null = null;
  lastSettingsError: string | null = null;

  // 🔴 NEW: multi-distance + wind trend
  readonly REPORT_DISTANCES: number[] = [300, 600, 800, 900];
  multiDistanceSummary: MultiDistanceDopeSummary[] = [];
  windTrendSummary: WindTrendSummary | null = null;

  riflesOptions: any[] = [];
  venuesOptions: any[] = [];

  // 🔴 NEW: full history grouped by distance
  distanceHistoryGroups: DistanceHistoryGroup[] = [];
  expandedDistanceM: number | null = null;

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
  this.multiDistanceSummary = [];
  this.windTrendSummary = null;
  

  
// 🔴 NEW:
  this.distanceHistoryGroups = [];
  this.expandedDistanceM = null;
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

    // 🔑 EXACT distance only – no nearest match
    const dope = this.findDopeForExactDistance(lastSession, distanceM);

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

    // If no DOPE row at this exact distance, tell the user clearly
    if (!dope) {
      this.lastSettingsError =
        `No DOPE saved at ${distanceM} m for this rifle @ venue.`;
    }

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

    // 🔁 Build multi-distance view & wind trend (using all matching sessions)
    this.multiDistanceSummary = this.buildMultiDistanceSummary(
      matching,
      this.REPORT_DISTANCES
    );
    this.windTrendSummary = this.buildWindTrendSummary(
      matching,
      distanceM
    );
        // 🔁 Build full distance history groups for this rifle @ venue
    this.distanceHistoryGroups = this.buildDistanceHistoryGroups(matching);

  } catch (err) {
    console.error('Error running report:', err);
    this.lastSettingsError = 'Error running report – see console for details.';
  }
}
private buildDistanceHistoryGroups(
  sessions: any[]
): DistanceHistoryGroup[] {
  const byDistance = new Map<number, DistanceHistoryEntry[]>();

  for (const s of sessions) {
    const rawDate =
      s.sessionDate ||
      s.date ||
      s.startTime ||
      s.startedAt ||
      s.createdAt ||
      s.timestamp;

    const dateStr = rawDate
      ? new Date(rawDate).toISOString().slice(0, 10)
      : 'unknown date';

    const dopes: any[] = [];

    const pushArray = (arr: any) => {
      if (Array.isArray(arr)) {
        dopes.push(...arr);
      }
    };

    // Same places we search for DOPE elsewhere
    pushArray(s.distanceDopes);
    pushArray(s.distances);
    pushArray(s.distanceDope);
    pushArray(s.dopes);
    if (Array.isArray(s.dope)) {
      pushArray(s.dope);
    }
    if (s.dopeMap && typeof s.dopeMap === 'object') {
      pushArray(Object.values(s.dopeMap));
    }

    if (Array.isArray(s.subRanges)) {
      for (const sr of s.subRanges) {
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

    // For each DOPE entry, group by distance
    for (const d of dopes) {
      const dist =
        typeof d?.distanceM === 'number'
          ? d.distanceM
          : typeof d?.distance === 'number'
          ? d.distance
          : null;

      if (dist == null) continue;

      // Round to whole meters so 599.9 vs 600.0 don't create separate groups
      const distKey = Math.round(dist);

      const elevationMil =
        typeof d.elevationMil === 'number'
          ? d.elevationMil
          : typeof d.elevation === 'number'
          ? d.elevation
          : null;

      const windageMil =
        typeof d.windageMil === 'number'
          ? d.windageMil
          : typeof d.windage === 'number'
          ? d.windage
          : null;

      const entry: DistanceHistoryEntry = {
        sessionDate: dateStr,
        distanceM: distKey,
        elevationMil,
        windageMil,
      };

      const list = byDistance.get(distKey) || [];
      list.push(entry);
      byDistance.set(distKey, list);
    }
  }

  // Build sorted groups (distance ascending, entries newest-first)
  const groups: DistanceHistoryGroup[] = [];

  const distances = Array.from(byDistance.keys()).sort((a, b) => a - b);

  for (const d of distances) {
    const entries = byDistance.get(d) || [];
    // Newest first by date string (ISO-like format we used)
    const sorted = entries.slice().sort((a, b) =>
      b.sessionDate.localeCompare(a.sessionDate)
    );
    groups.push({
      distanceM: d,
      entries: sorted,
    });
  }

  return groups;
}



  /**
   * Find the DOPE entry closest to the requested distance.
   */
 /**
 * Find the DOPE entry for this session at the exact requested distance.
 * If no exact entry exists, returns null (we do NOT guess).
 */
private findDopeForExactDistance(session: any, distanceM: number): any | null {
  const candidates: any[] = [];

  const pushArray = (arr: any) => {
    if (Array.isArray(arr)) {
      candidates.push(...arr);
    }
  };

  // Top-level arrays where DOPE is often stored
  pushArray(session.distanceDopes);
  pushArray(session.distances);
  pushArray(session.distanceDope);
  pushArray(session.dopes);

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

  // EXact-match only – optional small tolerance for float noise
  const TOL = 0.01; // 1 cm tolerance just in case of float rounding

  const match = candidates.find((c) => {
    const d =
      typeof c?.distanceM === 'number'
        ? c.distanceM
        : typeof c?.distance === 'number'
        ? c.distance
        : null;

    if (d == null) return false;
    return Math.abs(d - distanceM) <= TOL;
  });

  return match || null;
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
private buildMultiDistanceSummary(
  sessions: any[],
  distances: number[]
): MultiDistanceDopeSummary[] {
  const result: MultiDistanceDopeSummary[] = [];

  // Go newest → oldest for each distance and stop on first hit
  for (const d of distances) {
    let found: MultiDistanceDopeSummary | null = null;

    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i];
      const dope = this.findDopeForExactDistance(s, d);
      if (!dope) continue;

      const rawDate =
        s.sessionDate ||
        s.date ||
        s.startTime ||
        s.startedAt ||
        s.createdAt ||
        s.timestamp;

      const dateStr = rawDate
        ? new Date(rawDate).toISOString().slice(0, 10)
        : null;

      const elevationMil =
        dope.elevationMil ?? dope.elevation ?? null;
      const windageMil =
        dope.windageMil ?? dope.windage ?? null;

      found = {
        distanceM: d,
        elevationMil,
        windageMil,
        sessionDate: dateStr,
      };
      break;
    }

    if (found) {
      result.push(found);
    }
  }

  return result;
}
private buildWindTrendSummary(
  sessions: any[],
  distanceM: number
): WindTrendSummary | null {
  let sum = 0;
  let count = 0;

  for (const s of sessions) {
    const dope = this.findDopeForExactDistance(s, distanceM);
    if (!dope) continue;

    const w =
      typeof dope.windageMil === 'number'
        ? dope.windageMil
        : typeof dope.windage === 'number'
        ? dope.windage
        : null;

    if (typeof w === 'number' && !Number.isNaN(w)) {
      sum += w;
      count++;
    }
  }

  if (!count) {
    return null;
  }

  const avg = sum / count;
  const absAvg = Math.abs(avg);

  let directionLabel = 'No clear bias';

  if (absAvg < 0.05) {
    directionLabel = 'No clear left/right trend';
  } else if (avg > 0) {
    directionLabel = `Left → Right (avg +${avg.toFixed(2)} mil)`;
  } else if (avg < 0) {
    directionLabel = `Right → Left (avg ${avg.toFixed(2)} mil)`;
  }

  return {
    distanceM,
    avgWindageMil: avg,
    sampleCount: count,
    directionLabel,
  };
}
useLastSettingsInNewSession(): void {
  if (!this.lastSettingsResult) {
    this.lastSettingsError = 'Run a report first before using settings.';
    return;
  }

  // For now: just jump to Sessions tab.
  // Later we can pre-fill the session form via a shared service/localStorage.
  this.setTab('sessions');
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
