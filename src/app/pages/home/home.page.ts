import { Component, inject, OnInit, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FileOpener } from '@capacitor-community/file-opener';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { APP_VERSION } from '../../environments/version';

import { environment } from '../../environments/environment';
import { DataService } from '../../data.service';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { KestrelDataSnapshot, KestrelService } from '../../shared/services/kestrel-bluetooth.service';
import { HistoryTabComponent } from '../history-tab/history-tab.component';
import { LoadDevTabComponent } from '../load-dev-tab/load-dev-tab.component';
import { RiflesTabComponent } from '../rifles-tab/rifles-tab.component';
import { SessionTabComponent } from '../session-tab/session-tab.component';
import { VenuesTabComponent } from '../venues-tab/venues-tab.component';
import { WindEffectToolComponent } from '../wind-effect/wind-effect-tool.component';

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
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.page.html',

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
export class HomePage implements OnInit {
  appTitle = 'GS Dope App';
  appSubtitle = 'Field log for rifles, venues & sessions';
  appVersion = APP_VERSION;

  currentTab: 'menu' | 'sessions' | 'rifles' | 'venues' | 'history' | 'loadDev' = 'menu';
  // --- Export / Import UI ---
  showExportImportModal = false;
  exportImportInlineMessage: string | null = null;
  @ViewChild('importFileInput') importFileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('firstLaunchSloganEl') firstLaunchSloganEl?: ElementRef<HTMLElement>;
  exportMode: 'root' | 'export' = 'root';
  importBusy = false;
  // --- Export / Import DATA (selective share) ---
  showExportImportDataModal = false;
  showDataShareChooserModal = false;
  dataShareActionMode: 'export' | 'print' = 'export';

  // Master toggles
  dataShareIncludeRifles = true;
  dataShareIncludeVenues = false;

  // All vs selected
  dataShareAllRifles = true;
  dataShareAllVenues = true;

  // Rifle sub-options
  dataShareRifleData = true;
  dataShareRifleLoadDev = true;
  dataShareRifleSessions = true;
  dataShareRifleShots = true;

  // Venue sub-options
  dataShareVenueData = true;
  dataShareVenueSessions = true;
  dataShareVenueShots = true;

  // Selected IDs
  private dataShareRifleIds = new Set<number>();
  private dataShareVenueIds = new Set<number>();

  // bottom icon bar state (no logic tied yet, just to keep template happy)
  activeTab: 'start' | 'rifles' | 'venues' | 'tools' = 'start';
  // Bottom nav auto-hide on scroll (Step 4)
  showBottomNav = true;
  private lastScrollTop = 0;
  private navHidden = false;

  activeRifleName: string | null = null;
  activeVenueName: string | null = null;
  recentSessionsCount = 0;
  recentLoadDevCount = 0;

  /** Cached sessions so Reports doesn't have to keep hitting DataService. */
  private allSessions: any[] = [];

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

  // Multi-distance + wind trend
  readonly REPORT_DISTANCES: number[] = [300, 600, 800, 900];
  multiDistanceSummary: MultiDistanceDopeSummary[] = [];
  windTrendSummary: WindTrendSummary | null = null;

  riflesOptions: any[] = [];
  venuesOptions: any[] = [];
  // REPORTS: canonical pickers (venue + rifle)
  reportVenuePickerOpen = false;
  reportVenuePickerSearch = '';
  reportVenuePickerFiltered: any[] = [];

  reportRiflePickerOpen = false;
  reportRiflePickerSearch = '';
  reportRiflePickerFiltered: any[] = [];

  get reportVenueIdNum(): number | null {
    const n = this.reportRequest?.venueId != null ? Number(this.reportRequest.venueId) : null;
    return n != null && !Number.isNaN(n) ? n : null;
  }

  get reportRifleIdNum(): number | null {
    const n = this.reportRequest?.rifleId != null ? Number(this.reportRequest.rifleId) : null;
    return n != null && !Number.isNaN(n) ? n : null;
  }

  get reportSelectedVenueName(): string | null {
    const id = this.reportVenueIdNum;
    if (id == null) return null;
    const v = (this.venuesOptions || []).find((x: any) => Number(x?.id) === id);
    return v?.name ?? null;
  }

  get reportSelectedRifleName(): string | null {
    const id = this.reportRifleIdNum;
    if (id == null) return null;
    const r = (this.riflesOptions || []).find((x: any) => Number(x?.id) === id);
    return r?.name ?? null;
  }

  // Full distance history at this venue
  distanceHistoryGroups: DistanceHistoryGroup[] = [];
  expandedDistanceM: number | null = null;

  // TOOLS / KESTREL / CONVERTER

  showSetup = false;
  showTools = false;
  showFirstLaunchSlogan = false;
  firstLaunchSlogan = '';
  // First-launch slogan sizing (no wrap, no ellipsis)
  firstLaunchSloganFontPx = 12;
  private readonly firstLaunchSloganBaseFontPx = 13;
  private readonly firstLaunchSloganMinFontPx = 12;

  selectedTool:
    | 'converter'
    | 'windEffect'
    | 'kestrel'
    | 'targets'
    | 'preferences'
    | 'documents'
    | null = null;

  /** When this page is opened via /tools/* routes, we treat it as a panel host (Utilities/Settings). */
  isPanelRoute = false;
  panelTitle: string | null = null;
  private converterReturnState: {
    showTools: boolean;
    showSetup: boolean;
    showReportsForm: boolean;
    selectedTool: any;
  } | null = null;

  private readonly router = inject(Router);

  // Preferences (Units & Display v1)
  // (removed duplicate 'prefs' declaration; see below for the strongly typed version)

  // ---------------- Documents tool ----------------
  private readonly documentsKey = 'gs_documents_v1';
  documents: Array<{
    id: string;
    title: string;
    tags: string[];
    link?: string | null;
    createdAt: number;
  }> = [];

  documentsSearch: string = '';
  documentsSort: 'az' | 'za' | 'new' | 'old' = 'az';
  showAddDocumentForm = false;
  documentsListExpanded = false;

  newDocTitle = '';
  newDocTags = '';
  newDocLink = '';

  get filteredDocuments(): Array<{
    id: string;
    title: string;
    tags: string[];
    link?: string | null;
    createdAt: number;
  }> {
    const q = (this.documentsSearch || '').trim().toLowerCase();
    let items = [...(this.documents || [])];

    if (q) {
      items = items.filter((d) => {
        const t = (d.title || '').toLowerCase();
        const g = (d.tags || []).join(' ').toLowerCase();
        const l = (d.link || '').toLowerCase();
        return t.includes(q) || g.includes(q) || l.includes(q);
      });
    }

    items.sort((a, b) => {
      if (this.documentsSort === 'new') return (b.createdAt || 0) - (a.createdAt || 0);
      if (this.documentsSort === 'old') return (a.createdAt || 0) - (b.createdAt || 0);
      if (this.documentsSort === 'za') return (b.title || '').localeCompare(a.title || '');
      return (a.title || '').localeCompare(b.title || '');
    });

    return items;
  }
  get documentsHasSearch(): boolean {
    return (this.documentsSearch || '').trim().length > 0;
  }

  // ---------- first-launch slogan ----------

  private readonly firstLaunchSloganKey = 'gs_first_launch_slogan_done_v2';
  private readonly firstLaunchSloganCycleKey = 'gs_first_launch_slogan_cycle_v1';

  private firstLaunchSloganCycleRemaining: Record<string, string[]> = {};
  private firstLaunchSloganCycleSig = '';

  private getFirstLaunchSloganSignature(): string {
    // Lightweight stable hash so if the slogan list changes, we reset the cycle safely.
    const all = this.FIRST_LAUNCH_SLOGANS || [];
    let h = 5381;

    for (const s of all) {
      const str = String(s || '');
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i); // djb2-ish XOR variant
      }
      // separator
      h = ((h << 5) + h) ^ 124; // '|'
    }

    // include count to reduce collision chance
    return `${all.length}:${(h >>> 0).toString(16)}`;
  }

  private loadFirstLaunchSloganCycle(): void {
    try {
      const sig = this.getFirstLaunchSloganSignature();
      const raw = localStorage.getItem(this.firstLaunchSloganCycleKey);
      if (!raw) {
        this.firstLaunchSloganCycleRemaining = {};
        this.firstLaunchSloganCycleSig = sig;
        return;
      }

      const parsed = JSON.parse(raw || '{}') as any;
      const storedSig = String(parsed?.sig || '');
      const storedRemaining = parsed?.remaining;

      if (storedSig !== sig || !storedRemaining || typeof storedRemaining !== 'object') {
        // Slogan list changed (or storage corrupted) → reset cycle
        this.firstLaunchSloganCycleRemaining = {};
        this.firstLaunchSloganCycleSig = sig;
        this.saveFirstLaunchSloganCycle();
        return;
      }

      this.firstLaunchSloganCycleRemaining = storedRemaining as Record<string, string[]>;
      this.firstLaunchSloganCycleSig = storedSig;
    } catch {
      // If storage is blocked/corrupt, fall back to fresh cycle in-memory
      this.firstLaunchSloganCycleRemaining = {};
      this.firstLaunchSloganCycleSig = this.getFirstLaunchSloganSignature();
    }
  }

  private saveFirstLaunchSloganCycle(): void {
    try {
      const sig = this.firstLaunchSloganCycleSig || this.getFirstLaunchSloganSignature();
      localStorage.setItem(
        this.firstLaunchSloganCycleKey,
        JSON.stringify({ sig, remaining: this.firstLaunchSloganCycleRemaining || {} }),
      );
    } catch {
      // ignore storage failure
    }
  }

  private readonly FIRST_LAUNCH_SLOGANS: string[] = [
    'PRECISION IS A DECISION',
    'DATA BEATS GUESSWORK',
    'DISCIPLINE OVER DISTANCE',
    'PROCESS OVER PRIDE',
    'CONTROL THE VARIABLES',
    'ZERO IS SACRED',
    'CALM BREATH CLEAN BREAK',
    'CALL THE SHOT',
    'TRACK EVERYTHING',
    'DETAILS DECIDE',
    'SLOW IS SMOOTH',
    'SMOOTH IS FAST',
    'NO RUSH ONLY RESULTS',
    'STABILITY BEFORE SPEED',
    'NATURAL POINT OF AIM',
    'BREAK CLEAN FOLLOW THROUGH',
    '**** HOM OP DIE DAK',
    'HIT IS THE ONLY TRUTH',
    'STEEL DOES NOT LIE',
    'FOCUS THEN FIRE',
    'SHOT PLAN SHOT EXECUTION',
    'BUILD THE POSITION',
    'TRUST YOUR DOPE',
    'VERIFY THEN SEND',
    'THE WIND IS ALWAYS TALKING',
    'READ MIRAGE',
    'WATCH THE GRASS',
    'WATCH THE DUST',
    'WATCH THE TREES',
    'CALL YOUR WIND',
    'WIND IS THE REAL BOSS',
    'WIND FIRST EGO LAST',
    'HOLD WITH PURPOSE',
    'DIAL WITH CONFIDENCE',
    'CLICK BY CLICK',
    'MIL BY MIL',
    'MOA BY MOA',
    'RANGE IS EARNED',
    'DISTANCE AMPLIFIES ERROR',
    'SMALL MISS BIG LESSON',
    'BUILD A SOLUTION',
    'SOLVE THE PROBLEM',
    'DOPE IS KING',
    'TEMPERATURE MATTERS',
    'DENSITY ALTITUDE MATTERS',
    'CORIOLIS IS REAL',
    'SPIN DRIFT IS REAL',
    'ANGLE CHANGES EVERYTHING',
    'CENTER PUNCH CULTURE',
    'FIRST ROUND IMPACT',
    'MAKE THE FIRST ONE COUNT',
    'SEND IT WITH INTENT',
    'FIND YOUR LIMITS',
    'PUSH THE DISTANCE',
    'STRETCH THE LEGS',
    'FROM MUZZLE TO MILE',
    'ELR IS A SYSTEM',
    'ELR REWARDS PATIENCE',
    'LONG RANGE SHORT MARGINS',
    'ONE MIL OFF IS A MISS',
    'ONE CLICK MATTERS',
    'OWN THE FUNDAMENTALS',
    'FUNDAMENTALS WIN MATCHES',
    'POSITION IS EVERYTHING',
    'RECOIL MANAGEMENT WINS',
    'SEE YOUR TRACE',
    'SPOT YOUR IMPACT',
    'SPOT YOUR MISS',
    'FOLLOW THE SPLASH',
    'TRACE TELLS THE STORY',
    'SPLASH IS FEEDBACK',
    'MAKE CORRECTIONS FAST',
    'MAKE CORRECTIONS SMART',
    'REPEATABLE INPUTS',
    'REPEATABLE RESULTS',
    'HEY! JY SKIET SOOS N DOOS',
    'BUILD YOUR BASELINE',
    'CONFIRM YOUR ZERO',
    'CONFIRM YOUR VELOCITY',
    'CHRONO OR CHAOS',
    'TRUE YOUR DOPE',
    'TRUE AT DISTANCE',
    'VERIFY AT RANGE',
    'WRITE IT DOWN',
    'LOG THE CONDITIONS',
    'LOG THE RESULTS',
    'NO DATA NO CONFIDENCE',
    'RIFLE AMMO SHOOTER SYSTEM',
    'GEAR SUPPORTS SKILL',
    'SKILL BEATS GEAR',
    'TRAIN WITH PURPOSE',
    'PRACTICE WITH INTENT',
    'MAKE EVERY ROUND COUNT',
    'QUALITY OVER QUANTITY',
    'PERFECT PRACTICE ONLY',
    'PRESSURE REVEALS PROCESS',
    'MAAK DIE WIND JOU BITCH',
    'PRESSURE REVEALS PROCESS',
    'STAY IN THE GLASS',
    'STAY BEHIND THE GUN',
    'BUILD THE BIPOD LOAD',
    'LOAD CONSISTENTLY',
    'NPA THEN BREAK',
    'DON’T CHASE MISSES',
    'MEASURE THEN ADJUST',
    'ADJUST THEN CONFIRM',
    'CONFIRM THEN COMMIT',
    'KEEP IT BORING',
    'BORING IS CONSISTENT',
    'CONSISTENT IS ACCURATE',
    'ACCURATE IS DEADLY',
    'TIGHT GROUPS TIGHT MIND',
    'MINDSET IS A WEAPON',
    'CALM IS A SKILL',
    'DISCIPLINE IS A SKILL',
    'THE WIND OWNS YOU',
    'RESPECT THE CONDITIONS',
    'LET THE DATA LEAD',
    'LET THE IMPACT SPEAK',
    'MAKE STEEL RING',
    'MAKE IT COUNT',
    'EARN THE HIT',
    'PRECISION IS A DECISION',
    'DATA BEATS GUESSWORK',
    'DISCIPLINE OVER DISTANCE',
    'PROCESS OVER PRIDE',
    'CONTROL THE VARIABLES',
    'ZERO IS SACRED',
    'CALM BREATH CLEAN BREAK',
    'CALL THE SHOT',
    'TRACK EVERYTHING',
    'DETAILS DECIDE',
    'SLOW IS SMOOTH',
    'SMOOTH IS FAST',
    'NO RUSH ONLY RESULTS',
    'STABILITY BEFORE SPEED',
    'NATURAL POINT OF AIM',
    'BREAK CLEAN FOLLOW THROUGH',
    '**** HOM OP DIE DAK',
    'HIT IS THE ONLY TRUTH',
    'STEEL DOES NOT LIE',
    'FOCUS THEN FIRE',
    'SHOT PLAN SHOT EXECUTION',
    'BUILD THE POSITION',
    'TRUST YOUR DOPE',
    'VERIFY THEN SEND',
    'LOS EERDER !!!!!!',
    'THE WIND IS ALWAYS TALKING',
    'READ MIRAGE',
    'WATCH THE GRASS',
    'WATCH THE DUST',
    'WATCH THE TREES',
    'CALL YOUR WIND',
    'WIND IS THE REAL BOSS',
    'WIND FIRST EGO LAST',
    'HOLD WITH PURPOSE',
    'DIAL WITH CONFIDENCE',
    'CLICK BY CLICK',
    'MIL BY MIL',
    'MOA BY MOA',
    'RANGE IS EARNED',
    'DISTANCE AMPLIFIES ERROR',
    'SMALL MISS BIG LESSON',
    'BUILD A SOLUTION',
    'SOLVE THE PROBLEM',
    'DOPE IS KING',
    'TEMPERATURE MATTERS',
    'DENSITY ALTITUDE MATTERS',
    'CORIOLIS IS REAL',
    'SPIN DRIFT IS REAL',
    'ANGLE CHANGES EVERYTHING',
    'CENTER PUNCH CULTURE',
    'FIRST ROUND IMPACT',
    'MAKE THE FIRST ONE COUNT',
    'SEND IT WITH INTENT',
    'FIND YOUR LIMITS',
    'PUSH THE DISTANCE',
    'STRETCH THE LEGS',
    'FROM MUZZLE TO MILE',
    'ELR IS A SYSTEM',
    'ELR REWARDS PATIENCE',
    'LONG RANGE SHORT MARGINS',
    'ONE MIL OFF IS A MISS',
    'ONE CLICK MATTERS',
    'OWN THE FUNDAMENTALS',
    'FUNDAMENTALS WIN MATCHES',
    'GAAN LIEWER HUISTOE',
    'POSITION IS EVERYTHING',
    'RECOIL MANAGEMENT WINS',
    'SEE YOUR TRACE',
    'SPOT YOUR IMPACT',
    'SPOT YOUR MISS',
    'FOLLOW THE SPLASH',
    'TRACE TELLS THE STORY',
    'SPLASH IS FEEDBACK',
    'MAKE CORRECTIONS FAST',
    'MAKE CORRECTIONS SMART',
    'REPEATABLE INPUTS',
    'REPEATABLE RESULTS',
    'HEY! JY SKIET SOOS N DOOS',
    'BUILD YOUR BASELINE',
    'CONFIRM YOUR ZERO',
    'CONFIRM YOUR VELOCITY',
    'DINK JY MOET GOLF SPEEL',
    'CHRONO OR CHAOS',
    'TRUE YOUR DOPE',
    'TRUE AT DISTANCE',
    'VERIFY AT RANGE',
    'WRITE IT DOWN',
    'LOG THE CONDITIONS',
    'LOG THE RESULTS',
    'NO DATA NO CONFIDENCE',
    'RIFLE AMMO SHOOTER SYSTEM',
    'GEAR SUPPORTS SKILL',
    'SKILL BEATS GEAR',
    'TRAIN WITH PURPOSE',
    'PRACTICE WITH INTENT',
    'MAKE EVERY ROUND COUNT',
    'QUALITY OVER QUANTITY',
    'PERFECT PRACTICE ONLY',
    'PRESSURE REVEALS PROCESS',
    'MAAK DIE WIND JOU BITCH',
    'PRESSURE REVEALS PROCESS',
    'STAY IN THE GLASS',
    'STAY BEHIND THE GUN',
    'BUILD THE BIPOD LOAD',
    'LOAD CONSISTENTLY',
    'NPA THEN BREAK',
    'DON’T CHASE MISSES',
    'MEASURE THEN ADJUST',
    'ADJUST THEN CONFIRM',
    'CONFIRM THEN COMMIT',
    'KEEP IT BORING',
    'BORING IS CONSISTENT',
    'EK DINK MENSE VERDRA JOU NET',
    'CONSISTENT IS ACCURATE',
    'ACCURATE IS DEADLY',
    'TIGHT GROUPS TIGHT MIND',
    'MINDSET IS A WEAPON',
    'CALM IS A SKILL',
    'DISCIPLINE IS A SKILL',
    'THE WIND OWNS YOU',
    'RESPECT THE CONDITIONS',
    'LET THE DATA LEAD',
    'LET THE IMPACT SPEAK',
    'MAKE STEEL RING',
    'MAKE IT COUNT',
    'EARN THE HIT',
  ];

  // Non-repeating shuffle cycle:
  // - A slogan will NOT repeat until the entire pool has been shown once.
  // - Separate pools are maintained for "all" vs "maxLen" fallback picks.
  private sloganCycleRemaining: Record<string, string[]> = {};

  private pickRandomSlogan(maxLen?: number): string {
    const all = this.FIRST_LAUNCH_SLOGANS || [];
    if (!all.length) return 'TRUST THE DATA';

    const key = typeof maxLen === 'number' ? `max:${maxLen}` : 'all';

    const filtered =
      typeof maxLen === 'number'
        ? all.filter((s) => (s || '').trim().length > 0 && (s || '').trim().length <= maxLen)
        : all;

    const pool = filtered.length ? filtered : all;

    // Use the persisted remaining pool (survives app kill/reopen)
    if (
      !this.firstLaunchSloganCycleRemaining[key] ||
      this.firstLaunchSloganCycleRemaining[key].length === 0
    ) {
      const shuffled = [...pool];

      // Fisher–Yates shuffle
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      this.firstLaunchSloganCycleRemaining[key] = shuffled;

      // Keep the old in-memory field in sync (minimal change, harmless if unused elsewhere)
      this.sloganCycleRemaining = this.firstLaunchSloganCycleRemaining;

      this.saveFirstLaunchSloganCycle();
    }

    const next = this.firstLaunchSloganCycleRemaining[key].pop()!;

    // Keep in-memory field in sync too
    this.sloganCycleRemaining = this.firstLaunchSloganCycleRemaining;

    this.saveFirstLaunchSloganCycle();
    return next;
  }

  // ---------- first-launch slogan (menu banner) ----------
  private sloganListenerReady = false;
  private lastSloganShownAt = 0;

  private showMenuSlogan(): void {
    // Only on main menu and only when no overlays/panels are open
    if (this.currentTab !== 'menu') return;
    if (this.showReportsForm || this.showTools || this.showSetup || this.showExportImportModal)
      return;
    if (this.selectedTool) return;

    // Throttle to avoid double-trigger flicker
    const now = Date.now();
    if (now - this.lastSloganShownAt < 250) return;
    this.lastSloganShownAt = now;

    this.firstLaunchSlogan = this.pickRandomSlogan();
    this.showFirstLaunchSlogan = true;

    // Reset font and shrink after render
    this.firstLaunchSloganFontPx = this.firstLaunchSloganBaseFontPx;
    setTimeout(() => this.shrinkFirstLaunchSloganToFit(), 0);
  }

  private shrinkFirstLaunchSloganToFit(): void {
    const el = this.firstLaunchSloganEl?.nativeElement;
    if (!el) return;

    const min = this.firstLaunchSloganMinFontPx;

    // Start from base and shrink until it fits
    let font = this.firstLaunchSloganBaseFontPx;

    // Direct style updates so measurement is real-time
    el.style.whiteSpace = 'normal';

    let guard = 0;
    while (guard < 80) {
      guard++;

      el.style.fontSize = `${font}px`;

      if (el.scrollWidth <= el.clientWidth) {
        this.firstLaunchSloganFontPx = font;
        return;
      }

      if (font <= min) break;
      font -= 1;
    }

    // Still too long at min: pick a shorter slogan and try once more
    const shorter = this.pickRandomSlogan(18);
    if (shorter !== this.firstLaunchSlogan) {
      this.firstLaunchSlogan = shorter;

      font = this.firstLaunchSloganBaseFontPx;
      while (font > min) {
        el.style.fontSize = `${font}px`;
        if (el.scrollWidth <= el.clientWidth) break;
        font -= 1;
      }

      this.firstLaunchSloganFontPx = font;
      return;
    }

    // Final fallback: lock to min (still no ellipsis, but should be extremely rare after shorter pick)
    this.firstLaunchSloganFontPx = min;
  }

  private initSloganVisibilityListener(): void {
    if (this.sloganListenerReady) return;
    this.sloganListenerReady = true;

    try {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.maybeShowFirstLaunchSlogan();
        }
      });
    } catch {
      // ignore
    }
  }

  private maybeShowFirstLaunchSlogan(): void {
    // Only on main menu and only when no overlays/panels are open
    if (this.currentTab !== 'menu') return;
    if (this.showReportsForm || this.showTools || this.showSetup || this.showExportImportModal)
      return;
    if (this.selectedTool) return;

    // Throttle to avoid double-trigger flicker
    const now = Date.now();
    if (now - this.lastSloganShownAt < 250) return;
    this.lastSloganShownAt = now;

    this.firstLaunchSlogan = this.pickRandomSlogan();
    this.showFirstLaunchSlogan = true;
  }

  private loadDocuments(): void {
    try {
      const raw = localStorage.getItem(this.documentsKey);
      if (!raw) {
        this.documents = [];
        return;
      }
      const parsed = JSON.parse(raw);
      this.documents = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.documents = [];
    }
  }

  private saveDocuments(): void {
    try {
      localStorage.setItem(this.documentsKey, JSON.stringify(this.documents || []));
    } catch {
      // ignore storage failure
    }
  }
  addDocument(): void {
    const title = (this.newDocTitle || '').trim();
    if (!title) return;

    const tags = (this.newDocTags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const link = (this.newDocLink || '').trim();

    this.documents.unshift({
      id: `doc_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      title,
      tags,
      link: link ? link : null,
      createdAt: Date.now(),
    });

    this.saveDocuments();

    this.newDocTitle = '';
    this.newDocTags = '';
    this.newDocLink = '';
    this.showAddDocumentForm = false;
    this.documentsListExpanded = false;
  }

  deleteDocument(id: string): void {
    this.documents = (this.documents || []).filter((d) => d.id !== id);
    this.saveDocuments();
  }
  private toAbsoluteUrl(url: string): string {
    return url && url.includes('://') ? url : new URL(url || '', window.location.origin).toString();
  }

  private sanitizeFileName(name: string): string {
    return (name || 'document')
      .trim()
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 80);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...Array.from(chunk));
    }
    return btoa(binary);
  }

  private async getShareableDocUrl(doc: { title: string; link?: string | null }): Promise<string> {
    const rawLink = doc.link || '';
    const absoluteUrl = this.toAbsoluteUrl(rawLink);

    // Web: sharing the absolute URL is fine.
    if (!Capacitor.isNativePlatform()) return absoluteUrl;

    // Native: if it's not an app asset, share the absolute URL
    const isAsset = rawLink.startsWith('assets/') || absoluteUrl.includes('/assets/');
    if (!isAsset) return absoluteUrl;

    // Native + asset: copy to Cache and share as a real file:// URI
    const res = await fetch(absoluteUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch document (${res.status})`);

    const buf = await res.arrayBuffer();
    const base64 = this.arrayBufferToBase64(buf);

    const safeName = this.sanitizeFileName(doc.title);
    const path = `gsdocs/${safeName}.pdf`;

    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    const uri = await Filesystem.getUri({ path, directory: Directory.Cache });
    return uri.uri;
  }
  async shareDocument(doc: {
    id: string;
    title: string;
    tags: string[];
    link?: string | null;
    createdAt: number;
  }): Promise<void> {
    if (!doc.link) {
      alert('No file link for this document.');
      return;
    }

    const rawLink = doc.link;
    const absoluteUrl = rawLink.includes('://')
      ? rawLink
      : new URL(rawLink, window.location.origin).toString();

    try {
      // Native: if it's an app asset, save to Cache and share the file:// uri
      const isAsset = rawLink.startsWith('assets/') || absoluteUrl.includes('/assets/');
      if (Capacitor.isNativePlatform() && isAsset) {
        const response = await fetch(absoluteUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Document not found (${response.status})`);

        const blob = await response.blob();
        const base64 = await this.blobToBase64(blob);

        const filename = rawLink.split('/').pop() || 'document.pdf';

        await Filesystem.requestPermissions();

        const saved = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
        });

        await Share.share({
          title: doc.title,
          text: doc.title,
          url: saved.uri,
        });

        return;
      }

      // Browser OR non-asset link: share the absolute URL
      await Share.share({
        title: doc.title,
        text: doc.title,
        url: absoluteUrl,
      });
    } catch (err) {
      console.error('shareDocument failed', err);
      alert('Could not share document.');
    }
  }

  async openDocument(doc: {
    id: string;
    title: string;
    tags: string[];
    link?: string | null;
    createdAt: number;
  }): Promise<void> {
    if (!doc.link) {
      alert('No file link for this document.');
      return;
    }

    const rawLink = doc.link;
    const absoluteUrl = rawLink.includes('://')
      ? rawLink
      : new URL(rawLink, window.location.origin).toString();

    try {
      // Browser
      if (!Capacitor.isNativePlatform()) {
        window.open(absoluteUrl, '_blank');
        return;
      }

      // Native asset → write to cache
      const isAsset = rawLink.startsWith('assets/') || absoluteUrl.includes('/assets/');
      if (isAsset) {
        const response = await fetch(absoluteUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Document not found (${response.status})`);

        const blob = await response.blob();
        const base64 = await this.blobToBase64(blob);

        const filename = rawLink.split('/').pop() || 'document.pdf';
        const path = `gsdocs/${filename}`;

        await Filesystem.writeFile({
          path,
          data: base64,
          directory: Directory.Cache,
          recursive: true,
        });

        const uri = await Filesystem.getUri({ path, directory: Directory.Cache });

        // ✅ Open with Android system PDF viewer (FileOpener expects a filesystem path on many builds)
        const filePath = uri.uri.startsWith('file://') ? uri.uri.slice('file://'.length) : uri.uri;
        await FileOpener.open({ filePath, contentType: 'application/pdf' });

        return;
      }

      // Native non-asset
      window.open(absoluteUrl, '_blank');
    } catch (err) {
      console.error('openDocument failed', err);
      alert('Could not open document.');
    }
  }

  private async loadDocumentsFromAssets(): Promise<
    Array<{ id: string; title: string; tags: string[]; link?: string | null; createdAt: number }>
  > {
    try {
      const res = await fetch('assets/documents/index.json', { cache: 'no-store' });
      if (!res.ok) return [];

      const raw = await res.json();
      if (!Array.isArray(raw)) return [];

      return raw
        .filter((x: any) => x && (x.file || x.link || x.title))
        .map((x: any) => {
          const file = x.file ?? null;
          const link = x.link ?? (file ? `assets/documents/${file}` : null);
          const title = x.title ?? (file ? String(file) : 'Document');

          const tags = Array.isArray(x.tags)
            ? x.tags.map((t: any) => String(t).trim()).filter(Boolean)
            : typeof x.tags === 'string'
              ? x.tags
                  .split(',')
                  .map((t: string) => t.trim())
                  .filter(Boolean)
              : [];

          const id = x.id ?? (file ? `asset:${file}` : `asset:${title}`);
          const createdAt = typeof x.createdAt === 'number' ? x.createdAt : Date.now();

          return { id, title, tags, link, createdAt };
        });
    } catch {
      return [];
    }
  }

  exportSubMenuOpen = false;

  kestrelData: KestrelDataSnapshot | null = null;
  // ---------- Converter (accordion) ----------
  converterSection:
    | 'scope'
    | 'distance'
    | 'velocity'
    | 'temperature'
    | 'pressure'
    | 'wind'
    | 'angleSize' = 'scope';

  expandedConverterSection:
    | 'scope'
    | 'distance'
    | 'velocity'
    | 'temperature'
    | 'pressure'
    | 'wind'
    | 'angleSize'
    | null = null;

  converterMode:
    | 'milToMoa'
    | 'moaToMil'
    | 'clicksToMil'
    | 'clicksToMoa'
    | 'mpsToFps'
    | 'fpsToMps'
    | 'msToKmh'
    | 'kmhToMs'
    | 'msToMph'
    | 'mphToMs'
    | 'msToKn'
    | 'knToMs'
    | 'mToYd'
    | 'ydToM'
    | 'cToF'
    | 'fToC'
    | 'hpaToInhg'
    | 'inhgToHpa'
    | 'hpaToMmhg'
    | 'mmhgToHpa'
    | 'kpaToHpa'
    | 'hpaToKpa'
    | 'milToCmAt100m'
    | 'cmToMilAt100m'
    | 'moaToInAt100yd'
    | 'inToMoaAt100yd' = 'milToMoa';

  converterInput: number | null = null;

  // UI structure (collapsed groups)
  converterSections: Array<{
    id: 'scope' | 'distance' | 'velocity' | 'temperature' | 'pressure' | 'wind' | 'angleSize';
    label: string;
    modes: Array<{ id: any; label: string }>;
  }> = [
    {
      id: 'pressure',
      label: 'Pressure',
      modes: [
        { id: 'hpaToInhg', label: 'hPa → inHg' },
        { id: 'inhgToHpa', label: 'inHg → hPa' },
        { id: 'hpaToMmhg', label: 'hPa → mmHg' },
        { id: 'mmhgToHpa', label: 'mmHg → hPa' },
        { id: 'kpaToHpa', label: 'kPa → hPa' },
        { id: 'hpaToKpa', label: 'hPa → kPa' },
      ],
    },
    {
      id: 'wind',
      label: 'Wind Speed',
      modes: [
        { id: 'msToKmh', label: 'm/s → km/h' },
        { id: 'kmhToMs', label: 'km/h → m/s' },
        { id: 'msToMph', label: 'm/s → mph' },
        { id: 'mphToMs', label: 'mph → m/s' },
        { id: 'msToKn', label: 'm/s → kn' },
        { id: 'knToMs', label: 'kn → m/s' },
      ],
    },
    {
      id: 'velocity',
      label: 'Velocity',
      modes: [
        { id: 'mpsToFps', label: 'm/s → fps' },
        { id: 'fpsToMps', label: 'fps → m/s' },
      ],
    },
    {
      id: 'distance',
      label: 'Distance',
      modes: [
        { id: 'mToYd', label: 'm → yd' },
        { id: 'ydToM', label: 'yd → m' },
      ],
    },
    {
      id: 'temperature',
      label: 'Temperature',
      modes: [
        { id: 'cToF', label: '°C → °F' },
        { id: 'fToC', label: '°F → °C' },
      ],
    },
    {
      id: 'scope',
      label: 'Scope / Angle',
      modes: [
        { id: 'milToMoa', label: 'Mil → MOA' },
        { id: 'moaToMil', label: 'MOA → Mil' },
        { id: 'clicksToMil', label: 'Clicks (0.1) → Mil' },
        { id: 'clicksToMoa', label: 'Clicks (¼) → MOA' },
      ],
    },
    {
      id: 'angleSize',
      label: 'Angle ↔ Size',
      modes: [
        { id: 'milToCmAt100m', label: 'Mil → cm @100m' },
        { id: 'cmToMilAt100m', label: 'cm @100m → Mil' },
        { id: 'moaToInAt100yd', label: 'MOA → inch @100yd' },
        { id: 'inToMoaAt100yd', label: 'inch @100yd → MOA' },
      ],
    },
  ];

  get converterSelectedModeLabel(): string {
    for (const s of this.converterSections) {
      const found = s.modes.find((m) => m.id === this.converterMode);
      if (found) return found.label;
    }
    return String(this.converterMode);
  }

  toggleConverterSection(
    id: 'scope' | 'distance' | 'velocity' | 'temperature' | 'pressure' | 'wind' | 'angleSize',
  ): void {
    this.expandedConverterSection = this.expandedConverterSection === id ? null : id;
  }

  selectConverterMode(
    sectionId:
      | 'scope'
      | 'distance'
      | 'velocity'
      | 'temperature'
      | 'pressure'
      | 'wind'
      | 'angleSize',
    modeId: any,
  ): void {
    // Make selection visible in header + ensure only one group open at a time
    this.converterSection = sectionId;
    this.converterMode = modeId;
    this.expandedConverterSection = null;
  }

  private dataService: DataService = inject(DataService);
  private route: ActivatedRoute = inject(ActivatedRoute);
  kestrel: KestrelService = inject(KestrelService);

  // ---------- lifecycle ----------

  ngOnInit(): void {
    this.loadCoreData();
    this.initKestrelSubscription();

    // Load saved prefs on app start (permanent across restarts)
    this.loadPreferences();

    // First-run: if no saved preferences exist yet, force user into Preferences
    try {
      const raw = localStorage.getItem(this.prefsKey);
      if (!raw) {
        // First-run (or after reinstall): do NOT force Preferences.
        // Stay on main menu.
        this.showReportsForm = false;
      }
    } catch {
      // If storage is blocked, do not force Preferences open.
      // Stay on main menu.
    }

    const firstLaunchDone = localStorage.getItem(this.firstLaunchSloganKey);
    // Show a random slogan on the main menu whenever the app becomes active.
    // Hidden as soon as a main menu icon/button is pressed (handled in setTab/openTools/openSetup/etc).
    this.loadFirstLaunchSloganCycle();
    this.initSloganVisibilityListener();
    this.maybeShowFirstLaunchSlogan();

    // If this page is mounted from a router route that wants a specific panel/tool, open it.
    // Used by /tools/utilities/* and /tools/settings/* routes.
    const panel = this.route.snapshot.data?.['panel'] as ('utilities' | 'settings' | undefined);
    const tool = this.route.snapshot.data?.['tool'] as
      | 'converter'
      | 'kestrel'
      | 'targets'
      | 'backup'
      | 'export'
      | 'documents'
      | 'preferences'
      | undefined;

    if (panel) {
      this.isPanelRoute = true;
      this.panelTitle = panel === 'utilities' ? 'Utilities' : 'System & Settings';
      this.currentTab = 'menu';
      this.selectedTool = null as any;

      // Open the correct panel (Utilities vs Setup)
      if (panel === 'utilities') {
        this.openTools();
      } else {
        this.openSetup();
      }

      // Then deep-link into a specific tool if requested.
      if (tool) {
        // Keep the UI stable; some tools expect Utilities vs Setup.
        switch (tool) {
          case 'converter':
            this.onConverterToolClick();
            break;
          case 'kestrel':
            this.showTools = true;
            this.showSetup = false;
            this.selectedTool = 'kestrel';
            break;
          case 'targets':
            this.openTargetDownloads();
            break;
          case 'backup':
            this.showTools = true;
            this.showSetup = false;
            this.openExportImportModal();
            break;
          case 'export':
            this.showTools = true;
            this.showSetup = false;
            this.openDataShareChooser();
            break;
          case 'documents':
            this.onDocumentsToolClick();
            break;
          case 'preferences':
            this.openPreferences();
            break;
        }
      }
    }

  }

  /** Header back button for deep-linked tool panels. */
  goBackToToolsHub(): void {
    // Prefer returning to the Tools hub, since these routes are all under /tools.
    this.router.navigateByUrl('/tools');
  }

  private loadCoreData(): void {
    this.allSessions = this.dataService.getSessions();

    const rifles = this.dataService.getRifles();
    const venues = this.dataService.getVenues();

    this.riflesOptions = rifles
      .map((r: any) => ({ id: Number(r?.id ?? r?.rifleId), name: r?.name }))
      .filter((x: any) => Number.isFinite(x.id));
    this.venuesOptions = venues
      .map((v: any) => ({ id: Number(v?.id ?? v?.venueId), name: v?.name }))
      .filter((x: any) => Number.isFinite(x.id));

    this.recentSessionsCount = this.allSessions.length;

    const loadDevs = this.dataService.getLoadDevProjectsForRifle
      ? rifles.reduce((sum, r) => {
          const rid = Number((r as any)?.id ?? (r as any)?.rifleId);
          const projects = Number.isFinite(rid)
            ? this.dataService.getLoadDevProjectsForRifle(rid)
            : [];
          return sum + projects.length;
        }, 0)
      : 0;
    this.recentLoadDevCount = loadDevs;
  }

  private initKestrelSubscription(): void {
    this.kestrel.kestrelData$.subscribe((snapshot) => {
      this.kestrelData = snapshot;
    });
  }

  // ---------- tab navigation ----------

  setTab(tab: 'menu' | 'sessions' | 'rifles' | 'venues' | 'history' | 'loadDev'): void {
    this.showFirstLaunchSlogan = false;
    this.currentTab = tab;

    // Close overlays/panels when switching tabs
    this.selectedTool = null;
    this.showTools = false;
    this.showSetup = false;
    this.showReportsForm = false;

    // Reset bottom-nav hiding state
    this.showBottomNav = true;
    this.navHidden = false;
    this.lastScrollTop = 0;

    // When landing on the main menu again, show a fresh slogan (no wrap / no ellipsis)
    if (tab === 'menu') {
      this.showMenuSlogan();
    }
  }

  goToSessionsTab(): void {
    this.showFirstLaunchSlogan = false;

    this.setTab('sessions');
  }

  // called by session-tab backToMenu output in template
  onBackFromSessions(): void {
    this.setTab('menu');
  }

  // history-tab jumpToHistory uses setTab directly in template

  // ---------- wind effect full-screen back ----------

  onBackFromWindEffect(): void {
    // Close the full-screen wind tool and go back to the normal menu
    this.selectedTool = null;
    this.currentTab = 'menu';
  }
  onBackFromConverter(): void {
    // Restore the exact UI state from when the converter was opened
    if (this.converterReturnState) {
      this.showTools = this.converterReturnState.showTools;
      this.showSetup = this.converterReturnState.showSetup;
      this.showReportsForm = this.converterReturnState.showReportsForm;
      this.selectedTool = this.converterReturnState.selectedTool;
      this.converterReturnState = null;
      return;
    }

    // Fallback
    this.selectedTool = null;
    this.currentTab = 'menu';
  }

  // ---------- bottom icon bar ----------

  setActiveTab(tab: 'start' | 'rifles' | 'venues' | 'tools'): void {
    this.activeTab = tab;
    // We leave behaviour simple: content still controlled
    // by the text buttons and tools button in the menu.
    // (You can wire this harder later if you want icons to also switch tabs.)
  }

  // ---------- haptics (safe: no extra plugin install) ----------
  private hapticTap(): void {
    try {
      const navAny: any = navigator as any;
      if (typeof navAny?.vibrate === 'function') {
        navAny.vibrate(10);
      }
    } catch {
      // ignore
    }
  }

  // Bottom-nav helper (Home/Rifles/Venues/History)
  navTo(tab: 'menu' | 'rifles' | 'venues' | 'history'): void {
    this.hapticTap();
    this.setTab(tab);
  }

  // ---------- reports UI handlers ----------
  onMainScroll(evt: Event): void {
    const el = evt.target as HTMLElement | null;
    if (!el) return;

    const top = el.scrollTop ?? 0;

    // Always show if near the top
    if (top <= 8) {
      this.showBottomNav = true;
      this.navHidden = false;
      this.lastScrollTop = top;
      return;
    }

    const delta = top - this.lastScrollTop;

    // Scroll down -> hide (with small threshold to prevent flicker)
    if (delta > 10 && !this.navHidden) {
      this.showBottomNav = false;
      this.navHidden = true;
    }

    // Scroll up -> show (with small threshold to prevent flicker)
    if (delta < -6 && this.navHidden) {
      this.showBottomNav = true;
      this.navHidden = false;
    }

    this.lastScrollTop = top;
  }

  toggleReportsForm(): void {
    this.showFirstLaunchSlogan = false;

    this.showReportsForm = !this.showReportsForm;
    if (this.showReportsForm) {
      this.showTools = false;
      this.showSetup = false;
      this.showExportImportModal = false;
      this.showExportImportDataModal = false;
      this.selectedTool = null;
    } else {
      // clear report state when collapsing
      this.lastSettingsResult = null;
      this.lastSettingsError = null;
      this.multiDistanceSummary = [];
      this.windTrendSummary = null;
      this.distanceHistoryGroups = [];
      this.expandedDistanceM = null;
    }
  }
  backToToolsAndResetReports(): void {
    // Reset report filters to defaults
    this.reportRequest = {
      type: 'recent',
      rifleId: null,
      venueId: null,
      dateFrom: null,
      dateTo: null,
      limit: 10,
    };

    this.reportDistanceM = null;

    // Clear report results
    this.lastSettingsResult = null;
    this.lastSettingsError = null;
    this.multiDistanceSummary = [];
    this.windTrendSummary = null;
    this.distanceHistoryGroups = [];
    this.expandedDistanceM = null;

    // Navigate back to Tools & utilities (expanded)
    this.showReportsForm = false;
    this.selectedTool = null;
    this.openTools();
    // <-- expands Tools (same logic as everywhere else)
  }
  // ---------------- REPORTS: canonical Venue picker ----------------
  openReportVenuePicker(): void {
    this.reportVenuePickerOpen = true;
    this.reportVenuePickerSearch = '';
    this.reportVenuePickerFiltered = [...(this.venuesOptions || [])];
  }

  closeReportVenuePicker(): void {
    this.reportVenuePickerOpen = false;
  }

  clearReportVenueFromPicker(): void {
    this.reportRequest.venueId = null;
    this.closeReportVenuePicker();
  }

  onReportVenuePickerSearchChange(v: string): void {
    const q = (v || '').toLowerCase().trim();
    const list = this.venuesOptions || [];
    if (!q) {
      this.reportVenuePickerFiltered = [...list];
      return;
    }
    this.reportVenuePickerFiltered = list.filter((x: any) => {
      const name = (x?.name || '').toString().toLowerCase();
      const loc = (x?.location || '').toString().toLowerCase();
      return name.includes(q) || loc.includes(q);
    });
  }

  selectReportVenueFromPicker(v: any): void {
    this.reportRequest.venueId = v?.id != null ? String(v.id) : null;
    this.closeReportVenuePicker();
  }

  // ---------------- REPORTS: canonical Rifle picker ----------------
  openReportRiflePicker(): void {
    this.reportRiflePickerOpen = true;
    this.reportRiflePickerSearch = '';
    this.reportRiflePickerFiltered = [...(this.riflesOptions || [])];
  }

  closeReportRiflePicker(): void {
    this.reportRiflePickerOpen = false;
  }

  clearReportRifleFromPicker(): void {
    this.reportRequest.rifleId = null;
    this.closeReportRiflePicker();
  }

  onReportRiflePickerSearchChange(v: string): void {
    const q = (v || '').toLowerCase().trim();
    const list = this.riflesOptions || [];
    if (!q) {
      this.reportRiflePickerFiltered = [...list];
      return;
    }
    this.reportRiflePickerFiltered = list.filter((x: any) => {
      const name = (x?.name || '').toString().toLowerCase();
      const cal = (x?.caliber || '').toString().toLowerCase();
      return name.includes(q) || cal.includes(q);
    });
  }

  selectReportRifleFromPicker(r: any): void {
    this.reportRequest.rifleId = r?.id != null ? String(r.id) : null;
    this.closeReportRiflePicker();
  }

  private getFilteredSessionsForReport(): any[] {
    let sessions = [...this.allSessions];

    // filter by rifle
    if (this.reportRequest.rifleId) {
      const rifleIdNum = Number(this.reportRequest.rifleId);
      if (!Number.isNaN(rifleIdNum)) {
        sessions = sessions.filter((s) => s.rifleId === rifleIdNum);
      }
    }

    // filter by venue
    if (this.reportRequest.venueId) {
      const venueIdNum = Number(this.reportRequest.venueId);
      if (!Number.isNaN(venueIdNum)) {
        sessions = sessions.filter((s) => s.venueId === venueIdNum);
      }
    }

    // filter by date range (if type is dateRange)
    if (this.reportRequest.type === 'dateRange') {
      const from = this.reportRequest.dateFrom
        ? new Date(this.reportRequest.dateFrom).getTime()
        : null;
      const to = this.reportRequest.dateTo ? new Date(this.reportRequest.dateTo).getTime() : null;

      sessions = sessions.filter((s) => {
        const rawDate =
          s.date || s.sessionDate || s.startTime || s.startedAt || s.createdAt || s.timestamp;
        if (!rawDate) return false;

        const t = new Date(rawDate).getTime();
        if (Number.isNaN(t)) return false;

        if (from !== null && t < from) return false;
        if (to !== null && t > to) return false;
        return true;
      });
    }

    // sort oldest → newest
    sessions.sort((a, b) => {
      const getTime = (x: any) => {
        const raw =
          x.date || x.sessionDate || x.startTime || x.startedAt || x.createdAt || x.timestamp;
        return raw ? new Date(raw).getTime() : 0;
      };
      return getTime(a) - getTime(b);
    });

    if (this.reportRequest.limit && this.reportRequest.limit > 0) {
      sessions = sessions.slice(-this.reportRequest.limit);
    }

    return sessions;
  }

  submitReportRequest(): void {
    this.lastSettingsError = null;
    this.lastSettingsResult = null;
    this.multiDistanceSummary = [];
    this.windTrendSummary = null;
    this.distanceHistoryGroups = [];
    this.expandedDistanceM = null;

    // Require Venue + Rifle
    if (!this.reportRequest.venueId || !this.reportRequest.rifleId) {
      this.lastSettingsError = 'Please select a Venue and a Rifle first.';
      return;
    }

    const sessions = this.getFilteredSessionsForReport();
    if (!sessions.length) {
      this.lastSettingsError = 'No sessions found for this filter yet. Shoot a session first.';
      return;
    }

    // ✅ NEW BEHAVIOUR:
    // If distance is blank/0, show ALL available distances (grouped) instead of erroring.
    if (!this.reportDistanceM || this.reportDistanceM <= 0) {
      this.distanceHistoryGroups = this.buildDistanceHistoryGroupsAllDistances(sessions);
      if (!this.distanceHistoryGroups.length) {
        this.lastSettingsError = 'No DOPE distances found in the filtered sessions.';
      }
      return;
    }

    const distanceM = this.reportDistanceM;

    // 1) Last settings at this exact distance
    const last = this.findLastSettingsForDistance(sessions, distanceM);
    if (!last) {
      this.lastSettingsError = 'No DOPE found for this distance in the filtered sessions.';
      return;
    }
    this.lastSettingsResult = last;

    // 2) Quick DOPE view at key distances
    this.multiDistanceSummary = this.buildMultiDistanceSummary(sessions, this.REPORT_DISTANCES);

    // 3) Wind trend at this distance
    this.windTrendSummary = this.buildWindTrendSummary(sessions, distanceM);

    // 4) Full distance history groups (ALL distances, comprehensive)
    this.distanceHistoryGroups = this.buildDistanceHistoryGroupsAllDistances(sessions);

    // Optional: auto-expand the selected distance group (nice UX)
    this.expandedDistanceM = distanceM;
  }

  private findLastSettingsForDistance(
    sessions: any[],
    distanceM: number,
  ): LastSettingsResult | null {
    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i];
      const dope = this.findDopeForExactDistance(s, distanceM);
      if (!dope) continue;

      const rifleName = this.dataService.getRifleById?.(s.rifleId)?.name || 'Unknown rifle';
      const venueName = this.dataService.getVenueById?.(s.venueId)?.name || 'Unknown venue';

      const rawDate =
        s.sessionDate || s.date || s.startTime || s.startedAt || s.createdAt || s.timestamp;
      const dateStr = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : 'Unknown date';

      const env = s.environment || {};

      const elevationMil = dope.elevationMil ?? dope.elevation ?? dope.elevationClicks ?? null;
      const windageMil = dope.windageMil ?? dope.windage ?? dope.windClicks ?? null;

      const result: LastSettingsResult = {
        rifleName,
        venueName,
        sessionDate: dateStr,
        distanceM: dope.distanceM ?? dope.distance ?? null,
        elevationMil:
          typeof elevationMil === 'number' && !Number.isNaN(elevationMil) ? elevationMil : null,
        windageMil: typeof windageMil === 'number' && !Number.isNaN(windageMil) ? windageMil : null,
        environment: {
          temperatureC: typeof env.temperatureC === 'number' ? env.temperatureC : null,
          pressureInHg: typeof env.pressureInHg === 'number' ? env.pressureInHg : null,
          humidityPercent: typeof env.humidityPercent === 'number' ? env.humidityPercent : null,
          windSpeedMps: typeof env.windSpeedMps === 'number' ? env.windSpeedMps : null,
          windDirectionClock:
            typeof env.windDirectionClock === 'number' ? env.windDirectionClock : null,
        },
      };

      return result;
    }

    return null;
  }

  private buildDistanceHistoryGroups(sessions: any[], distanceM: number): DistanceHistoryGroup[] {
    const groupsMap = new Map<number, DistanceHistoryEntry[]>();

    for (const s of sessions) {
      const dope = this.findDopeForExactDistance(s, distanceM);
      if (!dope) continue;

      const rawDate =
        s.sessionDate || s.date || s.startTime || s.startedAt || s.createdAt || s.timestamp;
      const dateStr = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : 'Unknown date';

      const d =
        typeof dope.distanceM === 'number'
          ? dope.distanceM
          : typeof dope.distance === 'number'
            ? dope.distance
            : distanceM;

      const elevationMil = dope.elevationMil ?? dope.elevation ?? dope.elevationClicks ?? null;
      const windageMil = dope.windageMil ?? dope.windage ?? dope.windClicks ?? null;

      const entry: DistanceHistoryEntry = {
        sessionDate: dateStr,
        distanceM: d,
        elevationMil:
          typeof elevationMil === 'number' && !Number.isNaN(elevationMil) ? elevationMil : null,
        windageMil: typeof windageMil === 'number' && !Number.isNaN(windageMil) ? windageMil : null,
      };

      const list = groupsMap.get(d) ?? [];
      list.push(entry);
      groupsMap.set(d, list);
    }

    const groups: DistanceHistoryGroup[] = [];
    for (const [d, entries] of groupsMap.entries()) {
      entries.sort((a, b) => (a.sessionDate > b.sessionDate ? 1 : -1));
      groups.push({ distanceM: d, entries });
    }

    groups.sort((a, b) => a.distanceM - b.distanceM);
    return groups;
  }

  // ✅ NEW helper: build groups across ALL distances in the filtered sessions
  private buildDistanceHistoryGroupsAllDistances(sessions: any[]): DistanceHistoryGroup[] {
    const groupsMap = new Map<number, DistanceHistoryEntry[]>();

    for (const s of sessions) {
      const dopes = this.extractAllDopeEntries(s);

      if (!dopes.length) continue;

      const rawDate =
        s.sessionDate || s.date || s.startTime || s.startedAt || s.createdAt || s.timestamp;
      const dateStr = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : 'Unknown date';

      for (const dope of dopes) {
        const d =
          typeof dope.distanceM === 'number'
            ? dope.distanceM
            : typeof dope.distance === 'number'
              ? dope.distance
              : null;

        if (d == null || Number.isNaN(d)) continue;

        const elevationMil = dope.elevationMil ?? dope.elevation ?? dope.elevationClicks ?? null;
        const windageMil = dope.windageMil ?? dope.windage ?? dope.windClicks ?? null;

        const entry: DistanceHistoryEntry = {
          sessionDate: dateStr,
          distanceM: d,
          elevationMil:
            typeof elevationMil === 'number' && !Number.isNaN(elevationMil) ? elevationMil : null,
          windageMil:
            typeof windageMil === 'number' && !Number.isNaN(windageMil) ? windageMil : null,
        };

        const list = groupsMap.get(d) ?? [];
        list.push(entry);
        groupsMap.set(d, list);
      }
    }

    const groups: DistanceHistoryGroup[] = [];
    for (const [d, entries] of groupsMap.entries()) {
      entries.sort((a, b) => (a.sessionDate > b.sessionDate ? 1 : -1));
      groups.push({ distanceM: d, entries });
    }

    groups.sort((a, b) => a.distanceM - b.distanceM);
    return groups;
  }

  // ✅ NEW helper: extract all dope candidates from a session (top-level + subRanges)
  private extractAllDopeEntries(session: any): any[] {
    const candidates: any[] = [];

    const pushArray = (arr: any) => {
      if (Array.isArray(arr)) {
        candidates.push(...arr);
      }
    };

    // top-level arrays where DOPE might live
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

    // sub-ranges
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

    // Keep only entries that actually have a distance field
    return candidates.filter((c) => {
      const d =
        typeof c?.distanceM === 'number'
          ? c.distanceM
          : typeof c?.distance === 'number'
            ? c.distance
            : null;
      return d != null && !Number.isNaN(d);
    });
  }

  private findDopeForExactDistance(session: any, distanceM: number): any | null {
    const candidates: any[] = [];

    const pushArray = (arr: any) => {
      if (Array.isArray(arr)) {
        candidates.push(...arr);
      }
    };

    // top-level arrays where DOPE might live
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

    // sub-ranges
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

    const TOL = 0.01; // allow tiny float noise

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
      (c) => typeof c?.distanceM === 'number' || typeof c?.distance === 'number',
    );

    if (!withDistance.length) {
      return candidates[0];
    }

    const distances = withDistance.map((c) =>
      typeof c.distanceM === 'number' ? c.distanceM : c.distance,
    );
    const min = Math.min(...distances);
    const max = Math.max(...distances);
    const target = (min + max) / 2;

    let best: any = withDistance[0];
    let bestDelta = Number.POSITIVE_INFINITY;

    for (const c of withDistance) {
      const d = typeof c.distanceM === 'number' ? c.distanceM : c.distance;
      const delta = Math.abs(d - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = c;
      }
    }

    return best;
  }

  // ---------- tools / Kestrel / converter ----------
  openTools(): void {
    this.showFirstLaunchSlogan = false;

    this.showTools = !this.showTools;

    // Tools and Setup are mutually exclusive panels
    if (this.showTools) {
      this.showSetup = false;
    }

    if (!this.showTools) {
      this.selectedTool = null;
    }

    this.showReportsForm = false;
  }

  openSetup(): void {
    this.showFirstLaunchSlogan = false;

    this.showSetup = !this.showSetup;

    // Tools and Setup are mutually exclusive panels
    if (this.showSetup) {
      this.showTools = false;
    }
    this.selectedTool = null;

    this.showReportsForm = false;
  }

  closeToolsSetupPanels(): void {
    this.showTools = false;
    this.showSetup = false;
    this.selectedTool = null;
    this.showReportsForm = false;
  }
  returnToUtilities(): void {
    this.showFirstLaunchSlogan = false;
    this.showSetup = false;
    this.showReportsForm = false;
    this.selectedTool = null;
    this.showTools = true; // force Utilities open (no toggle)
  }

  openTargetDownloads(): void {
    // Ensure the tools panel is open
    this.showTools = true;

    // Toggle the targets panel
    this.selectedTool = this.selectedTool === 'targets' ? null : 'targets';
    this.showReportsForm = false;
  }

  /** Mil/MOA converter tool toggle (button calls this) */
  onConverterToolClick(): void {
    const opening = this.selectedTool !== 'converter';

    if (opening) {
      // Capture where we came from so Back returns to the same UI state
      this.converterReturnState = {
        showTools: this.showTools,
        showSetup: this.showSetup,
        showReportsForm: this.showReportsForm,
        selectedTool: this.selectedTool,
      };
    }

    this.showTools = true;
    this.showSetup = false;

    this.selectedTool = opening ? 'converter' : null;

    if (opening) {
      // collapsed by default
      this.expandedConverterSection = null;
    } else {
      // closing via toggle clears return state
      this.converterReturnState = null;
    }

    this.showReportsForm = false;
  }

  /** Wind effect tool toggle (button calls this) */
  onWindEffectToolClick(): void {
    this.showTools = true;
    this.showSetup = false;
    this.selectedTool = this.selectedTool === 'windEffect' ? null : 'windEffect';
    this.showReportsForm = false;
  }
  onDocumentsToolClick(): void {
    this.showTools = true;
    this.showSetup = false;

    const opening = this.selectedTool !== 'documents';
    this.selectedTool = opening ? 'documents' : null;

    this.showReportsForm = false;

    // When opening Documents: start collapsed + empty search
    if (opening) {
      this.documentsSearch = '';
      this.documentsListExpanded = false;
      this.showAddDocumentForm = false;
    } else {
      return;
    }

    // Prefer bundled documents (assets/documents/index.json)
    this.loadDocumentsFromAssets()
      .then((assetDocs) => {
        if (assetDocs && assetDocs.length) {
          this.documents = assetDocs;
          this.saveDocuments(); // optional: keeps them visible even if assets load fails later
        } else {
          this.loadDocuments(); // fallback
        }
      })
      .catch(() => this.loadDocuments());
  }

  // ---------------- Preferences ----------------
  private readonly prefsKey = 'gs_preferences_v1';

  prefs: {
    distanceUnit: 'm' | 'yd';
    velocityUnit: 'mps' | 'fps';
    temperatureUnit: 'c' | 'f';
    loadDevOalUnit: 'mm' | 'in';
    loadDevBcModel: 'g7' | 'g1';

    pressureUnit: 'hpa' | 'inhg' | 'mmhg' | 'kpa';
    windSpeedUnit: 'kmh' | 'mph' | 'ms' | 'kn';
    angleDisplay: 'degrees' | 'clock';
    scopeAdjust: 'mil' | 'moa';
  } = {
    distanceUnit: 'm',
    velocityUnit: 'mps',
    loadDevOalUnit: 'mm',
    loadDevBcModel: 'g7',

    temperatureUnit: 'c',
    pressureUnit: 'hpa',
    windSpeedUnit: 'kmh',
    angleDisplay: 'clock',
    scopeAdjust: 'mil',
  };

  // ✅ this is what your template is complaining about
  preferencesSavedMsg: string = '';

  openPreferences(): void {
    // Preferences live under Setup now
    this.showSetup = true;
    this.showTools = false;

    this.selectedTool = this.selectedTool === 'preferences' ? null : 'preferences';
    this.showReportsForm = false;
    this.loadPreferences();
  }

  closePreferences(): void {
    // Persist structured prefs (v1)
    this.dataService.updatePreferences({
      loadDev: { oalUnit: this.prefs.loadDevOalUnit },
      onboarding: { completed: true },
    });

    // Collapse/close the preferences panel
    this.selectedTool = null;

    // Preferences live under Setup now
    this.showTools = false;
    this.showSetup = true;
  }

  // ✅ Save button = "autosave + message + collapse"
  savePreferences(): void {
    try {
      localStorage.setItem(this.prefsKey, JSON.stringify(this.prefs));
    } catch {
      // ignore storage failure for UX
    }
    // Also save Load Dev COAL/Ogive unit into the structured prefs used by components
    try {
      this.dataService.updatePreferences({
        loadDev: { oalUnit: this.prefs.loadDevOalUnit },
      });
    } catch {
      // ignore (keep UI save working even if storage blocked)
    }

    // Simple “Saved” feedback (no Capacitor Toast dependency)
    this.preferencesSavedMsg = 'Saved';
    setTimeout(() => (this.preferencesSavedMsg = ''), 1200);

    // Collapse/close the preferences panel
    this.closePreferences();
  }

  private loadPreferences(): void {
    try {
      const raw = localStorage.getItem(this.prefsKey);
      if (!raw) return;

      const parsed: any = JSON.parse(raw);

      // Migration from old profile-style prefs
      if (parsed && typeof parsed === 'object' && !parsed.distanceUnit) {
        const units = (parsed.units ?? '').toString().toLowerCase();

        if (units === 'imperial') {
          parsed.distanceUnit = 'yd';
          parsed.velocityUnit = 'fps';
          parsed.temperatureUnit = 'f';
          parsed.pressureUnit = 'inhg';
          parsed.windSpeedUnit = 'mph';
          parsed.angleDisplay = 'clock';
          parsed.scopeAdjust = 'moa';
        } else {
          parsed.distanceUnit = 'm';
          parsed.velocityUnit = 'mps';
          parsed.temperatureUnit = 'c';
          parsed.pressureUnit = 'hpa';
          parsed.windSpeedUnit = 'kmh';
          parsed.angleDisplay = 'clock';
          parsed.scopeAdjust = 'mil';
        }
      }

      this.prefs = {
        distanceUnit: parsed.distanceUnit === 'yd' ? 'yd' : 'm',
        velocityUnit: parsed.velocityUnit === 'fps' ? 'fps' : 'mps',
        loadDevOalUnit:
          String(
            parsed.loadDevOalUnit ??
              parsed.loadDev?.oalUnit ??
              this.dataService.getDefaultLoadDevOalUnit?.(),
          ).toLowerCase() === 'in'
            ? 'in'
            : 'mm',
        loadDevBcModel: parsed.loadDevBcModel === 'g1' ? 'g1' : 'g7',

        temperatureUnit: parsed.temperatureUnit === 'f' ? 'f' : 'c',
        pressureUnit: ['hpa', 'inhg', 'mmhg', 'kpa'].includes(parsed.pressureUnit)
          ? parsed.pressureUnit
          : 'hpa',
        windSpeedUnit: ['kmh', 'mph', 'ms', 'kn'].includes(parsed.windSpeedUnit)
          ? parsed.windSpeedUnit
          : 'kmh',
        angleDisplay: parsed.angleDisplay === 'degrees' ? 'degrees' : 'clock',
        scopeAdjust: parsed.scopeAdjust === 'moa' ? 'moa' : 'mil',
      };
    } catch {
      // ignore parse errors
    }
  }
  readonly TARGETS = [
    { id: 'ocw-ladder-a4', label: 'OCW / Ladder (A4)', file: 'assets/targets/ocw-ladder-a4.pdf' },
    {
      id: 'Target_Square_Green',
      label: 'Target Square Green',
      file: 'assets/targets/Target_Square_Green.pdf',
    },
    {
      id: 'Target_Square_Single',
      label: 'Target Square Single',
      file: 'assets/targets/Target_Square_Single.pdf',
    },
  ] as const;

  async downloadTarget(type: (typeof this.TARGETS)[number]['id']): Promise<void> {
    try {
      const t = this.TARGETS.find((x) => x.id === type);
      if (!t) throw new Error(`Unknown target type: ${type}`);

      const url = t.file;

      // 1) fetch asset
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Target not found: ${url} (${response.status})`);

      const blob = await response.blob();
      const base64 = await this.blobToBase64(blob);

      const filename = url.split('/').pop() ?? `target-${type}.pdf`;

      // 2) Save to Cache (same method as working Documents) — avoids Android scoped-storage permission errors
      await Filesystem.requestPermissions();

      const safeName = this.sanitizeFileName(filename.replace(/\.pdf$/i, ''));
      const cachePath = `gstargets/${safeName}.pdf`;

      await Filesystem.writeFile({
        path: cachePath,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      });

      const uri = await Filesystem.getUri({ path: cachePath, directory: Directory.Cache });
      const shareUrl = uri.uri;

      // 3) Try Share (lets user save to Files/Downloads). If Share fails, open directly.
      try {
        await Share.share({
          title: filename,
          text: 'Save this target to Downloads / Files',
          url: shareUrl,
        });
      } catch {
        // Fallback: open the PDF directly
        const filePath = shareUrl.startsWith('file://')
          ? shareUrl.slice('file://'.length)
          : shareUrl;
        await FileOpener.open({ filePath, contentType: 'application/pdf' });
      }
    } catch (err) {
      console.error('downloadTarget failed', err);
      alert(`Download failed: ${(err as any)?.message ?? err}`);
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.onload = () => {
        const result = reader.result as string;
        // result looks like: data:application/pdf;base64,JVBERi0x...
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.readAsDataURL(blob);
    });
  }

  get converterOutput(): number | null {
    if (this.converterInput == null || Number.isNaN(this.converterInput)) {
      return null;
    }

    const v = this.converterInput;

    // Scope
    if (this.converterMode === 'milToMoa') return Math.round(v * 3.43775 * 100) / 100;
    if (this.converterMode === 'moaToMil') return Math.round((v / 3.43775) * 1000) / 1000;
    if (this.converterMode === 'clicksToMil') return Math.round((v / 10) * 1000) / 1000; // 0.1 mil per click
    if (this.converterMode === 'clicksToMoa') return Math.round((v / 4) * 1000) / 1000; // ¼ MOA per click

    // Velocity
    if (this.converterMode === 'mpsToFps') return Math.round(v * 3.280839895 * 100) / 100;
    if (this.converterMode === 'fpsToMps') return Math.round((v / 3.280839895) * 1000) / 1000;

    // Wind speed
    if (this.converterMode === 'msToKmh') return Math.round(v * 3.6 * 100) / 100;
    if (this.converterMode === 'kmhToMs') return Math.round((v / 3.6) * 1000) / 1000;
    if (this.converterMode === 'msToMph') return Math.round(v * 2.2369362921 * 100) / 100;
    if (this.converterMode === 'mphToMs') return Math.round((v / 2.2369362921) * 1000) / 1000;
    if (this.converterMode === 'msToKn') return Math.round(v * 1.9438444924 * 100) / 100;
    if (this.converterMode === 'knToMs') return Math.round((v / 1.9438444924) * 1000) / 1000;

    // Distance
    if (this.converterMode === 'mToYd') return Math.round(v * 1.0936132983 * 100) / 100;
    if (this.converterMode === 'ydToM') return Math.round((v / 1.0936132983) * 1000) / 1000;

    // Temperature
    if (this.converterMode === 'cToF') return Math.round(((v * 9) / 5 + 32) * 100) / 100;
    if (this.converterMode === 'fToC') return Math.round((((v - 32) * 5) / 9) * 100) / 100;

    // Pressure
    if (this.converterMode === 'hpaToInhg') return Math.round(v * 0.0295299830714 * 10000) / 10000;
    if (this.converterMode === 'inhgToHpa') return Math.round((v / 0.0295299830714) * 100) / 100;
    if (this.converterMode === 'hpaToMmhg') return Math.round(v * 0.750061683 * 1000) / 1000;
    if (this.converterMode === 'mmhgToHpa') return Math.round((v / 0.750061683) * 100) / 100;
    if (this.converterMode === 'kpaToHpa') return Math.round(v * 10 * 100) / 100;
    if (this.converterMode === 'hpaToKpa') return Math.round((v / 10) * 1000) / 1000;

    // Angle ↔ Size (fixed references to avoid extra inputs)
    // 1 mil = 10 cm at 100 m
    if (this.converterMode === 'milToCmAt100m') return Math.round(v * 10 * 100) / 100;
    if (this.converterMode === 'cmToMilAt100m') return Math.round((v / 10) * 1000) / 1000;

    // 1 MOA ≈ 1.047 inch at 100 yd
    if (this.converterMode === 'moaToInAt100yd') return Math.round(v * 1.0471975512 * 100) / 100;
    if (this.converterMode === 'inToMoaAt100yd')
      return Math.round((v / 1.0471975512) * 1000) / 1000;

    return null;
  }

  get converterOutputDisplay(): string {
    const v = this.converterOutput;
    return v == null ? '—' : v.toFixed(3);
  }

  private buildMultiDistanceSummary(
    sessions: any[],
    distances: number[],
  ): MultiDistanceDopeSummary[] {
    const result: MultiDistanceDopeSummary[] = [];

    // Newest → oldest per distance, stop on first hit
    for (const d of distances) {
      let found: MultiDistanceDopeSummary | null = null;

      for (let i = sessions.length - 1; i >= 0; i--) {
        const s = sessions[i];
        const dope = this.findDopeForExactDistance(s, d);
        if (!dope) continue;

        const rawDate =
          s.sessionDate || s.date || s.startTime || s.startedAt || s.createdAt || s.timestamp;

        const dateStr = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : null;

        const elevationMil = dope.elevationMil ?? dope.elevation ?? null;
        const windageMil = dope.windageMil ?? dope.windage ?? null;

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

  private buildWindTrendSummary(sessions: any[], distanceM: number): WindTrendSummary | null {
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

    // For now we just jump to Sessions tab.
    // Later we can pre-fill form via shared service/localStorage.
    this.setTab('sessions');
  }

  openExportImportModal(): void {
    this.showExportImportModal = true;
    this.exportMode = 'root';

    // Ensure the Setup panel is visible
    this.showSetup = true;
    this.showTools = false;
    this.selectedTool = null;
  }

  closeExportImportModal(): void {
    this.exportMode = 'root';
    this.showExportImportModal = false;
  }

  openExportSubmenu(): void {
    this.exportMode = 'export';
  }
  openDataShareChooser(): void {
    // Keep Utilities visible (chooser now lives under Utilities)
    this.showTools = true;
    this.showSetup = false;
    this.selectedTool = null;

    this.showDataShareChooserModal = true;
  }

  closeDataShareChooser(): void {
    this.showDataShareChooserModal = false;

    // Return to Utilities (Tools) screen where the user tapped Export / Print
    this.showTools = true;
    this.showSetup = false;
    this.selectedTool = null;
  }

  chooseDataShareMode(mode: 'export' | 'print'): void {
    // Mode determines which action button is shown in the Export/Share modal:
    // - export => Export (Share) JSON merge-safe
    // - print  => Share (PDF) report
    this.dataShareActionMode = mode;
    this.showDataShareChooserModal = false;
    this.openExportImportDataModal();
  }

  openExportImportDataModal(): void {
    this.showExportImportDataModal = true;
    this.loadCoreData(); // refresh riflesOptions/venuesOptions for the modal lists

    // Keep Utilities visible (modals now live under Utilities)
    this.showTools = true;
    this.showSetup = false;
    this.selectedTool = null;

    // Default selections:
    // - If user chooses "All", the ID sets are ignored.
    // - If they untick "All", we start empty to force explicit selection.
    // Keep the user’s previous selections so the nested lists remain visible
    // this.dataShareIncludeRifles = false;
    // this.dataShareIncludeVenues = false;

    // Always open Share (PDF) in the clean "two master checkboxes" state
    this.dataShareIncludeRifles = false;
    this.dataShareIncludeVenues = false;

    // Use explicit list selection (not "All") when user enables a section
    this.dataShareAllRifles = false;
    this.dataShareAllVenues = false;

    // Start with no picks; when a master is enabled we preselect all items
    this.dataShareRifleIds.clear();
    this.dataShareVenueIds.clear();
  }

  closeExportImportDataModal(): void {
    this.showExportImportDataModal = false;
  }

  // Master toggle: when enabled, preselect ALL rifles so user can untick unwanted
  setIncludeRiflesForShare(checked: boolean): void {
    this.dataShareIncludeRifles = !!checked;

    if (!this.dataShareIncludeRifles) {
      this.dataShareAllRifles = false;
      this.dataShareRifleIds.clear();
      return;
    }

    // Use explicit list selection (not "All") and preselect everything
    this.dataShareAllRifles = false;
    this.dataShareRifleIds.clear();
    for (const r of this.riflesOptions ?? []) {
      this.dataShareRifleIds.add(Number((r as any)?.id));
    }
  }

  // Master toggle: when enabled, preselect ALL venues so user can untick unwanted
  setIncludeVenuesForShare(checked: boolean): void {
    this.dataShareIncludeVenues = !!checked;

    if (!this.dataShareIncludeVenues) {
      this.dataShareAllVenues = false;
      this.dataShareVenueIds.clear();
      return;
    }

    // Use explicit list selection (not "All") and preselect everything
    this.dataShareAllVenues = false;
    this.dataShareVenueIds.clear();
    for (const v of this.venuesOptions ?? []) {
      this.dataShareVenueIds.add(Number((v as any)?.id));
    }
  }

  setAllRiflesForShare(checked: boolean): void {
    this.dataShareAllRifles = !!checked;

    // If switching back to "All rifles", ignore any prior specific picks
    if (this.dataShareAllRifles) this.dataShareRifleIds.clear();
  }

  // Keep venues consistent with rifles: if switching to "All venues", ignore prior picks
  setAllVenuesForShare(checked: boolean): void {
    this.dataShareAllVenues = !!checked;
    if (this.dataShareAllVenues) this.dataShareVenueIds.clear();
  }

  isRifleSelectedForShare(id: number): boolean {
    return this.dataShareRifleIds.has(Number(id));
  }

  toggleRifleShare(id: number): void {
    if (this.dataShareAllRifles) return; // ignore list clicks when "All rifles" is on
    const n = Number(id);
    if (this.dataShareRifleIds.has(n)) this.dataShareRifleIds.delete(n);
    else this.dataShareRifleIds.add(n);
  }

  isVenueSelectedForShare(id: number): boolean {
    return this.dataShareVenueIds.has(Number(id));
  }

  toggleVenueShare(id: number): void {
    if (this.dataShareAllVenues) return; // ignore list clicks when "All venues" is on
    const n = Number(id);
    if (this.dataShareVenueIds.has(n)) this.dataShareVenueIds.delete(n);
    else this.dataShareVenueIds.add(n);
  }

  async onChooseExport(): Promise<void> {
    // Backward-compatible: old button now behaves like Share

    await this.onExportShare();
  }
  async onExportSaveLocal(): Promise<void> {
    this.showExportImportModal = false;
    await this.exportLoadDevBackup(false); // save only
  }

  async onExportShare(): Promise<void> {
    this.showExportImportModal = false;
    await this.exportLoadDevBackup(true); // save + share sheet
  }

  onChooseImport(): void {
    // Keep modal open until user picks (or cancel picker)
    // Trigger the hidden input (more reliable on Android)

    if (this.importFileInput?.nativeElement) {
      this.importFileInput.nativeElement.value = ''; // allow re-import same file twice
      this.importFileInput.nativeElement.click();
    }
  }

  async onImportFileSelected(evt: Event): Promise<void> {
    const input = evt.target as HTMLInputElement;
    const file = input?.files?.[0] ?? null;

    // If user cancelled file picker
    if (!file) {
      return;
    }

    this.importBusy = true;

    try {
      let text = '';
      try {
        text = await file.text();
      } catch {
        alert('Could not read the selected file.');
        return;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        alert('Invalid JSON file.');
        return;
      }

      // Safety prompt (merge import)
      const ok = confirm('Import will MERGE into existing data (no overwrite).\n\nContinue?');
      if (!ok) return;

      const normalizeName = (s: any) => (s ?? '').toString().trim().toLowerCase();

      const takeSnapshot = () => {
        const rifles: any[] = (this.dataService.getRifles?.() ?? []) as any[];
        const venues: any[] = (this.dataService.getVenues?.() ?? []) as any[];
        const sessions: any[] = (this.dataService.getSessions?.() ?? []) as any[];

        const loadDevProjects = this.dataService.getLoadDevProjectsForRifle
          ? rifles.reduce((sum, r) => {
              const rid = Number((r as any)?.id ?? (r as any)?.rifleId);
              const projects = Number.isFinite(rid)
                ? this.dataService.getLoadDevProjectsForRifle(rid)
                : [];
              return sum + projects.length;
            }, 0)
          : 0;
        const loadDevEntriesTotal = this.dataService.getLoadDevProjectsForRifle
          ? rifles.reduce((sum, r) => {
              const rid = Number((r as any)?.id ?? (r as any)?.rifleId);
              const projects = Number.isFinite(rid)
                ? this.dataService.getLoadDevProjectsForRifle(rid)
                : [];
              const entriesCount = (projects ?? []).reduce(
                (s2: number, p: any) => s2 + (Array.isArray(p?.entries) ? p.entries.length : 0),
                0,
              );
              return sum + entriesCount;
            }, 0)
          : 0;

        const venueSubrangesTotal = venues.reduce(
          (sum, v) => sum + (((v as any)?.subRanges?.length ?? 0) as number),
          0,
        );

        const venueSubrangesByName = new Map<string, number>();
        for (const v of venues) {
          const key = normalizeName((v as any)?.name);
          if (!key) continue;
          const srCount = Number(((v as any)?.subRanges?.length ?? 0) as any) || 0;
          venueSubrangesByName.set(key, srCount);
        }

        const rifleSessionsById = new Map<number, number>();
        for (const s of sessions) {
          const rid = Number((s as any)?.rifleId ?? (s as any)?.rifleID);
          if (!Number.isFinite(rid)) continue;
          rifleSessionsById.set(rid, (rifleSessionsById.get(rid) ?? 0) + 1);
        }

        const rifleProjectsById = new Map<number, number>();
        const rifleSerialById = new Map<number, string>();
        for (const r of rifles) {
          const rid = Number((r as any)?.id ?? (r as any)?.rifleId);
          if (!Number.isFinite(rid)) continue;

          const projects = this.dataService.getLoadDevProjectsForRifle
            ? this.dataService.getLoadDevProjectsForRifle(rid)
            : [];
          rifleProjectsById.set(rid, projects.length);

          rifleSerialById.set(rid, ((r as any)?.serialNumber ?? '').toString());
        }

        return {
          rifles: rifles.length,
          venues: venues.length,
          sessions: sessions.length,
          loadDevProjects,
          loadDevEntriesTotal,
          venueSubrangesTotal,
          venueSubrangesByName,
          rifleSessionsById,
          rifleProjectsById,
          rifleSerialById,
        };
      };

      const before = takeSnapshot();

      // ✅ IMPORTANT: restore embedded load-dev photos back into Directory.Data
      await this.rehydrateLoadDevMediaFromImport(parsed);

      const result = this.dataService.importFromBackupMerge(parsed);

      // Refresh menus/counts
      this.loadCoreData();

      const after = takeSnapshot();

      // Delta reporting (captures updates to existing venues e.g. subranges)
      const deltaRifles = after.rifles - before.rifles;
      const deltaVenues = after.venues - before.venues;
      const deltaSessions = after.sessions - before.sessions;
      const deltaLoadDevProjects = after.loadDevProjects - before.loadDevProjects;

      const deltaLoadDevEntries = after.loadDevEntriesTotal - before.loadDevEntriesTotal;

      const deltaVenueSubranges = after.venueSubrangesTotal - before.venueSubrangesTotal;
      let sessionsAddedToExistingRifles = 0;
      for (const [rid, afterCount] of after.rifleSessionsById.entries()) {
        const beforeCount = before.rifleSessionsById.get(rid) ?? 0;
        if (afterCount > beforeCount) {
          sessionsAddedToExistingRifles += afterCount - beforeCount;
        }
      }

      let projectsAddedToExistingRifles = 0;
      for (const [rid, afterCount] of after.rifleProjectsById.entries()) {
        const beforeCount = before.rifleProjectsById.get(rid) ?? 0;
        if (afterCount > beforeCount) {
          projectsAddedToExistingRifles += afterCount - beforeCount;
        }
      }

      let serialsUpdated = 0;
      for (const [rid, afterSerial] of after.rifleSerialById.entries()) {
        const beforeSerial = before.rifleSerialById.get(rid) ?? '';
        if (!beforeSerial && afterSerial) serialsUpdated++;
      }

      let venuesTouched = 0;
      if (deltaVenueSubranges > 0) {
        for (const [name, afterCount] of after.venueSubrangesByName.entries()) {
          const beforeCount = before.venueSubrangesByName.get(name) ?? 0;
          if (afterCount > beforeCount) venuesTouched++;
        }
      }

      const extraLines: string[] = [];
      if (deltaLoadDevEntries !== 0) {
        extraLines.push(
          `Load-dev entries: ${deltaLoadDevEntries > 0 ? '+' : ''}${deltaLoadDevEntries}`,
        );
      }

      if (sessionsAddedToExistingRifles > 0) {
        extraLines.push(
          `Rifle sessions: +${sessionsAddedToExistingRifles} (added to existing rifles)`,
        );
      }

      if (projectsAddedToExistingRifles > 0) {
        extraLines.push(
          `Load-dev projects: +${projectsAddedToExistingRifles} (added to existing rifles)`,
        );
      }

      if (serialsUpdated > 0) {
        extraLines.push(
          `Serial numbers updated on ${serialsUpdated} rifle${serialsUpdated === 1 ? '' : 's'}`,
        );
      }

      if (deltaVenueSubranges !== 0) {
        extraLines.push(
          `Venue subranges: ${deltaVenueSubranges > 0 ? '+' : ''}${deltaVenueSubranges}` +
            (venuesTouched > 0
              ? ` (updated ${venuesTouched} existing venue${venuesTouched === 1 ? '' : 's'})`
              : ''),
        );
      }

      // If DataService message says 0 venues but we changed subranges, this makes it explicit.
      const deltaSummary = `Detected changes: ${deltaRifles > 0 ? '+' : ''}${deltaRifles} rifles, ${
        deltaVenues > 0 ? '+' : ''
      }${deltaVenues} venues, ${deltaSessions > 0 ? '+' : ''}${deltaSessions} sessions, ${
        deltaLoadDevProjects > 0 ? '+' : ''
      }${deltaLoadDevProjects} load-dev projects, ${
        deltaLoadDevEntries > 0 ? '+' : ''
      }${deltaLoadDevEntries} load-dev entries.`;

      const finalMessage =
        `Import complete.\n\n${result.message}\n\n${deltaSummary}` +
        (extraLines.length ? `\n${extraLines.join('\n')}` : '');

      this.showExportImportModal = false;
      alert(finalMessage);

      // IMPORTANT: force UI + DataService to rehydrate from persisted store
      // (Fixes: import succeeded but data not visible until restart)
      setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          // ignore
        }
      }, 50);
    } finally {
      this.importBusy = false;
    }
  }

  async openExportImport(): Promise<void> {
    // OK = Export, Cancel = Import
    const doExport = confirm(
      'Export / Import\n\nOK = Export current data to a JSON file\nCancel = Import a JSON backup from another device',
    );

    if (doExport) {
      await this.exportLoadDevBackup(); // keep your existing export flow
      return;
    }

    await this.importBackupFromJson();
  }

  private async importBackupFromJson(): Promise<void> {
    // Let user pick a .json file (works in browser + Capacitor WebView)
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    const file = await new Promise<File | null>((resolve) => {
      input.onchange = () => resolve(input.files && input.files.length ? input.files[0] : null);
      input.click();
    });

    if (!file) return;

    const text = await file.text();
    // --- Exact-file detection (content hash) ---
    let fileHash = '';
    try {
      fileHash = await this.sha256Text(text);
      const key = 'gs_import_hashes_v1';
      const prev = JSON.parse(localStorage.getItem(key) || '[]') as string[];
      const seen = new Set(prev);

      if (seen.has(fileHash)) {
        const again = confirm(
          'This exact backup file was already imported on this device.\n\n' +
            'OK = import anyway (merge again)\nCancel = stop',
        );
        if (!again) return;
      }
    } catch {
      // If hashing fails, do not block import
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert('Import failed: selected file is not valid JSON.');
      return;
    }

    // Safety prompt (import overwrites local data)
    const ok = confirm(
      'Import will ADD/merge data into this device (it will not delete existing data).\n\nContinue?',
    );
    if (!ok) return;

    // ✅ NEW: add this ONE line (do not re-declare result)
    await this.rehydrateLoadDevMediaFromImport(parsed);

    const result = this.dataService.importFromBackupMerge(parsed);

    if (!result.ok) {
      alert(`Import failed: ${result.message}`);
      return;
    }

    // Refresh menus/counts
    this.loadCoreData();
    // --- Remember imported file hash (last 50) ---
    if (fileHash) {
      const key = 'gs_import_hashes_v1';
      const prev = JSON.parse(localStorage.getItem(key) || '[]') as string[];
      const next = [fileHash, ...prev.filter((h) => h !== fileHash)].slice(0, 50);
      localStorage.setItem(key, JSON.stringify(next));
    }

    alert(`Import complete.\n\n${result.message}`);
  }
  private buildSelectiveExportPayloadWithValidation(opts: any, contextLabel: string): any | null {
    try {
      const fn =
        (this.dataService as any).exportSelectiveShareForMerge ??
        (this.dataService as any).exportSelectiveShare;

      if (!fn) throw new Error('exportSelectiveShare is not available in this build.');

      return fn.call(this.dataService, opts);
    } catch (err) {
      const report = this.buildSelectiveExportValidationReport(opts, contextLabel, err);
      this.maintenanceReport = report;

      console.error('[EXPORT_VALIDATION]', contextLabel, err);
      alert(
        `Export failed (${contextLabel}).\n\nOpen Maintenance to view/share the detailed validation report.`,
      );
      return null;
    }
  }
  private async sha256Text(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private buildSelectiveExportValidationReport(opts: any, contextLabel: string, err: any): string {
    const now = new Date();
    const lines: string[] = [];

    const errMsg = (err as any)?.message ?? String(err);

    lines.push(`GS Export Validation Report`);
    lines.push(`Context: ${contextLabel}`);
    lines.push(`Time: ${now.toLocaleString()}`);
    lines.push(`Error: ${errMsg}`);
    lines.push('');

    // Summarize options
    const r = opts?.rifles ?? null;
    const v = opts?.venues ?? null;

    lines.push('Options:');
    lines.push(
      `  Rifles: ${r ? (r.all ? 'ALL' : 'Selected (' + ((r.ids?.length ?? 0) as any) + ')') : 'None'}`,
    );
    if (r) {
      lines.push(
        `    includeRifleData=${!!r.includeRifleData}, includeLoadDev=${!!r.includeLoadDev}, includeSessions=${!!r.includeSessions}, includeShots=${!!r.includeShots}`,
      );
    }
    lines.push(
      `  Venues: ${v ? (v.all ? 'ALL' : 'Selected (' + ((v.ids?.length ?? 0) as any) + ')') : 'None'}`,
    );
    if (v) {
      lines.push(
        `    includeVenueData=${!!v.includeVenueData}, includeSessions=${!!v.includeSessions}, includeShots=${!!v.includeShots}`,
      );
    }
    lines.push('');

    // Try to isolate failing rifle(s) / venue(s) without modifying any data.
    const fn =
      (this.dataService as any).exportSelectiveShareForMerge ??
      (this.dataService as any).exportSelectiveShare;

    const rifleNameById = new Map<number, string>(
      (this.riflesOptions || []).map((x: any) => [Number(x?.id), String(x?.name ?? '')]),
    );
    const venueNameById = new Map<number, string>(
      (this.venuesOptions || []).map((x: any) => [Number(x?.id), String(x?.name ?? '')]),
    );

    const failingRifles: Array<{ id: number; name: string; error: string }> = [];
    const failingVenues: Array<{ id: number; name: string; error: string }> = [];

    // Rifles isolation
    if (r) {
      const rifleIds: number[] = r.all
        ? (this.riflesOptions || [])
            .map((x: any) => Number(x?.id))
            .filter((n: any) => Number.isFinite(n))
        : (Array.isArray(r.ids) ? r.ids : [])
            .map((n: any) => Number(n))
            .filter((n: any) => Number.isFinite(n));

      for (const id of rifleIds) {
        try {
          fn?.call(this.dataService, {
            rifles: {
              all: false,
              ids: [id],
              includeRifleData: !!r.includeRifleData,
              includeLoadDev: !!r.includeLoadDev,
              includeSessions: !!r.includeSessions,
              includeShots: !!r.includeShots,
            },
            venues: null, // isolate rifles
          });
        } catch (e) {
          failingRifles.push({
            id,
            name: rifleNameById.get(id) || `Rifle ${id}`,
            error: (e as any)?.message ?? String(e),
          });
        }
      }
    }

    // Venues isolation
    if (v) {
      const venueIds: number[] = v.all
        ? (this.venuesOptions || [])
            .map((x: any) => Number(x?.id))
            .filter((n: any) => Number.isFinite(n))
        : (Array.isArray(v.ids) ? v.ids : [])
            .map((n: any) => Number(n))
            .filter((n: any) => Number.isFinite(n));

      for (const id of venueIds) {
        try {
          fn?.call(this.dataService, {
            rifles: null, // isolate venues
            venues: {
              all: false,
              ids: [id],
              includeVenueData: !!v.includeVenueData,
              includeSessions: !!v.includeSessions,
              includeShots: !!v.includeShots,
            },
          });
        } catch (e) {
          failingVenues.push({
            id,
            name: venueNameById.get(id) || `Venue ${id}`,
            error: (e as any)?.message ?? String(e),
          });
        }
      }
    }

    if (!failingRifles.length && !failingVenues.length) {
      lines.push(
        'Isolation result: could not reproduce per-item failure (export still failed as a batch).',
      );
      lines.push('This usually means:');
      lines.push('  - a cross-reference issue (e.g., session points to missing rifle/venue), or');
      lines.push('  - a top-level store shape issue.');
      lines.push('');
      return lines.join('\n');
    }

    if (failingRifles.length) {
      lines.push(`Failing rifles (${failingRifles.length}):`);
      for (const f of failingRifles) {
        lines.push(`  - [${f.id}] ${f.name}: ${f.error}`);
      }
      lines.push('');
      lines.push(
        'Next step (safe): run Maintenance → "Repair only a selected Rifle" for each failing rifle.',
      );
      lines.push('');
    }

    if (failingVenues.length) {
      lines.push(`Failing venues (${failingVenues.length}):`);
      for (const f of failingVenues) {
        lines.push(`  - [${f.id}] ${f.name}: ${f.error}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  async exportPdfFromSelectedData(): Promise<void> {
    const selectedRifleIds = this.dataShareAllRifles
      ? null
      : Array.from(this.dataShareRifleIds.values());

    const selectedVenueIds = this.dataShareAllVenues
      ? null
      : Array.from(this.dataShareVenueIds.values());

    // IMPORTANT: independence = only the TOP checkbox controls inclusion
    const includeRifleBlock = this.dataShareIncludeRifles;
    const includeVenueBlock = this.dataShareIncludeVenues;

    // Validation
    if (includeRifleBlock && !this.dataShareAllRifles && (selectedRifleIds?.length ?? 0) === 0) {
      alert('Select at least one rifle, or tick "All rifles".');
      return;
    }
    if (includeVenueBlock && !this.dataShareAllVenues && (selectedVenueIds?.length ?? 0) === 0) {
      alert('Select at least one venue, or tick "All venues".');
      return;
    }

    // Build opts for the service
    const opts = {
      rifles: includeRifleBlock
        ? {
            all: this.dataShareAllRifles,
            ids: selectedRifleIds,
            includeRifleData: this.dataShareRifleData,
            includeLoadDev: this.dataShareRifleLoadDev,
            includeSessions: this.dataShareRifleSessions,
            includeShots: this.dataShareRifleShots,
          }
        : null,
      venues: includeVenueBlock
        ? {
            all: this.dataShareAllVenues,
            ids: selectedVenueIds,
            includeVenueData: this.dataShareVenueData,
            includeSessions: this.dataShareVenueSessions,
            includeShots: this.dataShareVenueShots,
          }
        : null,
    };

    const payload = this.dataService.exportSelectivePdf(opts);
    if (!payload) {
      alert('Export failed: no data selected.');
      return;
    }

    const data: any = (payload as any)?.data ?? (payload as any)?.store ?? {};
    const rifles: any[] = Array.isArray(data?.rifles) ? data.rifles : [];
    const venues: any[] = Array.isArray(data?.venues) ? data.venues : [];
    const sessions: any[] = Array.isArray(data?.sessions) ? data.sessions : [];
    const loadDevProjects: any[] = Array.isArray(data?.loadDevProjects) ? data.loadDevProjects : [];

    // Debug that matches your logcat pattern
    try {
      console.log('[PDF] riflesSelected=', rifles.length, 'allRifles=', this.dataShareAllRifles);
      console.log('[PDF] venuesSelected=', venues.length, 'allVenues=', this.dataShareAllVenues);
    } catch {}

    const rifleNameById = new Map<number, string>(
      (rifles ?? []).map((r: any) => [Number(r?.id), String(r?.name ?? '')]),
    );
    const venueNameById = new Map<number, string>(
      (venues ?? []).map((v: any) => [Number(v?.id), String(v?.name ?? '')]),
    );

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 12;

    doc.setFontSize(16);
    doc.text('Selective Data Export', 10, y);
    y += 7;

    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 10, y);
    y += 8;

    // ---------- Rifles ----------
    if (includeRifleBlock && rifles.length) {
      doc.setFontSize(12);
      doc.text(`Rifles (${rifles.length})`, 10, y);
      y += 4;

      for (let i = 0; i < rifles.length; i++) {
        const r = rifles[i] ?? {};
        const title = `${r?.name ?? 'Rifle'}${r?.caliber ? ` (${r.caliber})` : ''}`;

        doc.setFontSize(11);
        doc.text(title, 10, y);
        y += 3;

        if (this.dataShareRifleData) {
          const rifleRows: Array<[string, string]> = [
            ['Caliber', `${r?.caliber ?? '-'}`],
            ['Barrel length', `${r?.barrelLength ?? '-'} ${r?.barrelUnit ?? ''}`.trim()],
            ['Twist rate', `${r?.twistRate ?? '-'}`],
            ['Scope', `${r?.scope ?? '-'}${r?.scopeUnit ? ' (' + r.scopeUnit + ')' : ''}`],
            ['Round count', `${r?.roundCount ?? 0}`],
            ['Notes', `${r?.notes ?? '-'}`],
          ];

          autoTable(doc, {
            startY: y,
            theme: 'grid',
            styles: { fontSize: 9, cellPadding: 2 },
            headStyles: { fontSize: 9 },
            columnStyles: { 0: { cellWidth: 45 }, 1: { cellWidth: pageWidth - 20 - 45 } },
            body: rifleRows.map(([k, v]) => [k, v]),
          });

          y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 5 : y + 25;
        }

        // Loads (if present + user requested loaddev)
        if (this.dataShareRifleLoadDev) {
          const loads: any[] = Array.isArray(r?.loads) ? r.loads : [];
          if (loads.length) {
            doc.setFontSize(11);
            doc.text(`Load Data (${loads.length})`, 10, y);
            y += 4;

            const body = loads.map((l: any) => [
              `${l?.powder ?? ''}`,
              `${l?.chargeGn ?? ''}`,
              `${l?.aveVelocityFps ?? ''}`,
              `${l?.coal ?? ''}${l?.coalUnit ? ' ' + l.coalUnit : ''}`,
              `${l?.primer ?? ''}`,
              `${l?.bullet ?? ''}`,
              `${l?.bulletWeightGr ?? ''}`,
              `${l?.bulletBc ?? ''}`,
            ]);

            autoTable(doc, {
              startY: y,
              theme: 'grid',
              styles: { fontSize: 8, cellPadding: 2 },
              headStyles: { fontSize: 8 },
              head: [
                [
                  'Powder',
                  'Charge (gr)',
                  'Vel (fps)',
                  'COAL',
                  'Primer',
                  'Bullet',
                  'Weight (gr)',
                  'BC',
                ],
              ],
              body,
            });

            y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : y + 20;
          }
        }

        const pageHeight = doc.internal.pageSize.getHeight();
        if (y > pageHeight - 20 && i < rifles.length - 1) {
          doc.addPage();
          y = 12;
        }
      }
    }

    // ---------- Venues ----------
    if (includeVenueBlock && venues.length && this.dataShareVenueData) {
      const pageHeight = doc.internal.pageSize.getHeight();
      if (y > pageHeight - 40) {
        doc.addPage();
        y = 12;
      }

      doc.setFontSize(12);
      doc.text(`Venues (${venues.length})`, 10, y);
      y += 4;

      const fmt = (val: any) => {
        if (val == null) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '';
        try {
          return JSON.stringify(val);
        } catch {
          return String(val);
        }
      };

      const venueSummaryRows = venues.map((v: any) => {
        const subRanges = Array.isArray(v?.subRanges)
          ? v.subRanges
          : Array.isArray(v?.subranges)
            ? v.subranges
            : [];

        return [
          `${v?.name ?? ''}`,
          `${v?.location ?? ''}`,
          `${v?.notes ?? ''}`,
          `${subRanges?.length ?? 0}`,
          `${(subRanges || []).reduce((acc: number, sr: any) => acc + (Array.isArray(sr?.distances) ? sr.distances.length : 0), 0)}`,
        ];
      });

      autoTable(doc, {
        startY: y,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fontSize: 8 },
        head: [['Name', 'Location', 'Notes', 'Subranges', '#Distances']],
        body: venueSummaryRows,
      });

      y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : y + 20;

      for (const v of venues) {
        const subRanges = Array.isArray(v?.subRanges)
          ? v.subRanges
          : Array.isArray(v?.subranges)
            ? v.subranges
            : [];

        if (!subRanges.length) continue;

        doc.setFontSize(11);
        doc.text(`Venue: ${fmt(v?.name)}`, 10, y);
        y += 4;

        for (const sr of subRanges) {
          const srName = fmt(sr?.name);
          const distances = Array.isArray(sr?.distances) ? sr.distances : [];

          doc.setFontSize(10);
          doc.text(`Subrange: ${srName}`, 10, y);
          y += 3;

          if (distances.length) {
            const distBody = distances.map((d: any) => [fmt(d)]);
            autoTable(doc, {
              startY: y,
              theme: 'grid',
              styles: { fontSize: 8, cellPadding: 2 },
              headStyles: { fontSize: 8 },
              head: [['Distances']],
              body: distBody,
            });
            y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 5 : y + 15;
          }
        }

        const pageHeight2 = doc.internal.pageSize.getHeight();
        if (y > pageHeight2 - 30) {
          doc.addPage();
          y = 12;
        }
      }
    }

    // ---------- Sessions ----------
    const includeSessionsBlock =
      (includeRifleBlock && this.dataShareRifleSessions) ||
      (includeVenueBlock && this.dataShareVenueSessions);

    if (includeSessionsBlock && sessions.length) {
      const pageHeight = doc.internal.pageSize.getHeight();
      if (y > pageHeight - 40) {
        doc.addPage();
        y = 12;
      }

      doc.setFontSize(12);
      doc.text(`Sessions (${sessions.length})`, 10, y);
      y += 4;

      const sessionRows = sessions.map((s: any) => [
        `${s?.date ?? ''}`,
        `${rifleNameById.get(Number(s?.rifleId)) ?? s?.rifleId ?? ''}`,
        `${venueNameById.get(Number(s?.venueId)) ?? s?.venueId ?? ''}`,
        `${s?.subRange ?? ''}`,
        `${s?.wind ?? ''}`,
        `${s?.notes ?? ''}`,
      ]);

      autoTable(doc, {
        startY: y,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fontSize: 8 },
        head: [['Date', 'Rifle', 'Venue', 'Subrange', 'Wind', 'Notes']],
        body: sessionRows,
      });

      y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : y + 20;
    }

    // ---------- Shots ----------
    const includeShotsBlock =
      (includeRifleBlock && this.dataShareRifleShots) ||
      (includeVenueBlock && this.dataShareVenueShots);

    if (includeShotsBlock && sessions.length) {
      const allShots: any[] = [];
      for (const s of sessions) {
        if (Array.isArray(s?.shots)) {
          for (const sh of s.shots) allShots.push({ ...sh, _session: s });
        }
      }

      if (allShots.length) {
        const pageHeight = doc.internal.pageSize.getHeight();
        if (y > pageHeight - 40) {
          doc.addPage();
          y = 12;
        }

        doc.setFontSize(12);
        doc.text(`Shots (${allShots.length})`, 10, y);
        y += 4;

        const shotRows = allShots.map((sh: any) => [
          `${sh?._session?.date ?? ''}`,
          `${rifleNameById.get(Number(sh?._session?.rifleId)) ?? sh?._session?.rifleId ?? ''}`,
          `${venueNameById.get(Number(sh?._session?.venueId)) ?? sh?._session?.venueId ?? ''}`,
          `${sh?.distance ?? ''}`,
          `${sh?.elev ?? ''}`,
          `${sh?.wind ?? ''}`,
          `${sh?.impact ?? ''}`,
          `${sh?.notes ?? ''}`,
        ]);

        autoTable(doc, {
          startY: y,
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fontSize: 8 },
          head: [['Date', 'Rifle', 'Venue', 'Dist', 'Elev', 'Wind', 'Impact', 'Notes']],
          body: shotRows,
        });

        y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : y + 20;
      }
    }

    // ---------- Load Development Projects ----------
    if (includeRifleBlock && this.dataShareRifleLoadDev && loadDevProjects.length) {
      const pageHeight = doc.internal.pageSize.getHeight();
      if (y > pageHeight - 40) {
        doc.addPage();
        y = 12;
      }

      doc.setFontSize(12);
      doc.text(`Load Development Projects (${loadDevProjects.length})`, 10, y);
      y += 4;

      const ldRows = loadDevProjects.map((p: any) => [
        `${p?.name ?? ''}`,
        `${rifleNameById.get(Number(p?.rifleId)) ?? p?.rifleId ?? ''}`,
        `${p?.created ?? ''}`,
        `${p?.notes ?? ''}`,
      ]);

      autoTable(doc, {
        startY: y,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fontSize: 8 },
        head: [['Project', 'Rifle', 'Created', 'Notes']],
        body: ldRows,
      });

      y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : y + 20;
    }

    // ---------- ALWAYS share/save the PDF (this used to be stuck inside venues.length) ----------
    const filename = 'gunstuff-export-' + new Date().toISOString().slice(0, 10) + '.pdf';

    if (Capacitor.isNativePlatform()) {
      try {
        const pdfBase64 = doc.output('datauristring').split(',')[1];
        const directory = Directory.Cache;
        const path = filename;

        await Filesystem.writeFile({
          path,
          data: pdfBase64,
          directory,
        });

        const { uri } = await Filesystem.getUri({ path, directory });

        await Share.share({
          title: 'GS Export PDF',
          text: 'GS Ballistics PDF export',
          url: uri,
        });
      } catch (err) {
        console.error('PDF export failed:', err);
        alert('PDF export failed on this device.\n\n' + ((err as any)?.message ?? String(err)));
      }
    } else {
      try {
        doc.save(filename);
      } catch (err) {
        console.error('Browser PDF export failed:', err);
        alert('Browser PDF export failed.');
      }
    }
  }

  private buildSimplePdfBase64FromText(text: string): string {
    // Text-only multipage PDF generator (Courier).
    // Fixes the previous single-page truncation that caused missing subranges / load-dev entries.
    const maxLineLen = 92;
    const maxLinesPerPage = 55;

    const rawLines = (text ?? '').replace(/\r/g, '').split('\n');
    const lines: string[] = [];

    // hard wrap long lines
    for (const ln of rawLines) {
      if (ln.length <= maxLineLen) {
        lines.push(ln);
        continue;
      }
      for (let i = 0; i < ln.length; i += maxLineLen) {
        lines.push(ln.slice(i, i + maxLineLen));
      }
    }

    const escapePdfText = (s: string) =>
      s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

    // paginate
    const pages: string[][] = [];
    for (let i = 0; i < lines.length; i += maxLinesPerPage) {
      pages.push(lines.slice(i, i + maxLinesPerPage));
    }
    if (pages.length === 0) pages.push(['']);

    // Object numbering plan:
    // 1 = catalog
    // 2 = pages
    // 3..(2+N) = page objects
    // (3+N) = font
    // (4+N)..(3+2N) = content streams
    const N = pages.length;
    const firstPageObj = 3;
    const fontObj = 3 + N;
    const firstContentObj = fontObj + 1;

    type Obj = { num: number; body: string };
    const objs: Obj[] = [];

    const pageRefs = Array.from({ length: N }, (_, i) => `${firstPageObj + i} 0 R`);
    const kidsArray = `[${pageRefs.join(' ')}]`;

    // 1: catalog
    objs.push({
      num: 1,
      body: `<< /Type /Catalog /Pages 2 0 R >>`,
    });

    // 2: pages
    objs.push({
      num: 2,
      body: `<< /Type /Pages /Kids ${kidsArray} /Count ${N} >>`,
    });

    // font
    objs.push({
      num: fontObj,
      body: `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`,
    });

    // pages + contents
    for (let p = 0; p < N; p++) {
      const pageNum = firstPageObj + p;
      const contentNum = firstContentObj + p;

      const contentLines = pages[p].map((l) => `(${escapePdfText(l)}) Tj T*`).join('\n');
      const stream = `BT\n/F1 9 Tf\n72 780 Td\n10 TL\n${contentLines}\nET\n`;

      const streamBytes = new TextEncoder().encode(stream);

      // content stream obj
      objs.push({
        num: contentNum,
        body: `<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`,
      });

      // page obj
      objs.push({
        num: pageNum,
        body:
          `<< /Type /Page /Parent 2 0 R ` +
          `/MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${fontObj} 0 R >> >> ` +
          `/Contents ${contentNum} 0 R >>`,
      });
    }

    // sort objects by number
    objs.sort((a, b) => a.num - b.num);

    // build PDF + xref
    let pdf = '%PDF-1.4\n';
    const xref: number[] = [];
    const maxObjNum = objs[objs.length - 1].num;

    // xref[0] is special
    xref[0] = 0;
    for (let i = 1; i <= maxObjNum; i++) xref[i] = 0;

    for (const o of objs) {
      xref[o.num] = pdf.length;
      pdf += `${o.num} 0 obj\n${o.body}\nendobj\n`;
    }

    const xrefStart = pdf.length;
    pdf += `xref\n0 ${maxObjNum + 1}\n`;
    pdf += `0000000000 65535 f \n`;

    for (let i = 1; i <= maxObjNum; i++) {
      const off = xref[i] || 0;
      pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
    }

    pdf +=
      `trailer\n<< /Size ${maxObjNum + 1} /Root 1 0 R >>\n` + `startxref\n${xrefStart}\n%%EOF\n`;

    // base64 encode
    const bytes = new TextEncoder().encode(pdf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
    }
    return btoa(binary);
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const bin = atob(base64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  private enforceDataShareDependencies(): void {
    // If LoadDev is being shared, also share sessions (and shots by default),
    // because sessions are the only “context” that links to venues/subranges.
    if (this.dataShareIncludeRifles && this.dataShareRifleLoadDev) {
      this.dataShareRifleData = true; // root dependency
      this.dataShareRifleSessions = true; // required context layer
      this.dataShareRifleShots = true; // ensures dope rows are exported too
    }
  }
  async onExportImportDataShare(): Promise<void> {
    // Close modal immediately for clean UX
    this.showExportImportDataModal = false;

    // PRINT MODE: do NOT generate/share JSON. Produce the PDF and return.
    if (this.dataShareActionMode !== 'export') {
      await this.exportPdfFromSelectedData();
      return;
    }

    // EXPORT MODE (JSON share): enforce merge-safe dependencies
    this.enforceDataShareDependencies();

    const selectedRifleIds = this.dataShareAllRifles
      ? null
      : Array.from(this.dataShareRifleIds.values());

    const selectedVenueIds = this.dataShareAllVenues
      ? null
      : Array.from(this.dataShareVenueIds.values());

    // Basic validation: if "Select" mode but nothing selected
    if (
      this.dataShareIncludeRifles &&
      !this.dataShareAllRifles &&
      (selectedRifleIds?.length ?? 0) === 0
    ) {
      alert('Select at least one rifle, or tick "All rifles".');
      return;
    }
    if (
      this.dataShareIncludeVenues &&
      !this.dataShareAllVenues &&
      (selectedVenueIds?.length ?? 0) === 0
    ) {
      alert('Select at least one venue, or tick "All venues".');
      return;
    }

    const opts = {
      rifles: this.dataShareIncludeRifles
        ? {
            all: this.dataShareAllRifles,
            ids: selectedRifleIds,
            includeRifleData: this.dataShareRifleData,
            includeLoadDev: this.dataShareRifleLoadDev,
            includeSessions: this.dataShareRifleSessions,
            includeShots: this.dataShareRifleShots,
          }
        : null,
      venues: this.dataShareIncludeVenues
        ? {
            all: this.dataShareAllVenues,
            ids: selectedVenueIds,
            includeVenueData: this.dataShareVenueData,
            includeSessions: this.dataShareVenueSessions,
            includeShots: this.dataShareVenueShots,
          }
        : null,
    };

    const fn =
      (this.dataService as any).exportSelectiveShareForMerge ??
      (this.dataService as any).exportSelectiveShare;
    const payload = fn.call(this.dataService, opts);

    // ✅ NEW: add this ONE line (do not re-declare payload/json again)
    await this.attachLoadDevMediaToBackupPayload(payload);

    const json = JSON.stringify(payload, null, 2);

    const filename = 'gunstuff-share-data-' + new Date().toISOString().slice(0, 10) + '.json';

    if (Capacitor.isNativePlatform()) {
      try {
        const directory = Directory.Cache; // Android share-friendly (FileProvider)
        const path = filename;

        await Filesystem.writeFile({
          path,
          data: json,
          directory,
          encoding: Encoding.UTF8,
        });

        const { uri } = await Filesystem.getUri({
          path,
          directory,
        });

        await Share.share({
          title: 'GS Export Data',
          text: 'GS Ballistics selective export (share this file)',
          url: uri,
        });

        alert('Data export created. Share or save it using the app you chose.');
      } catch (err) {
        console.error('Selective export failed:', err);
        alert('Data export failed on this device.\n\n' + ((err as any)?.message ?? String(err)));
      }
    } else {
      try {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Browser selective export failed:', err);
        alert('Browser export failed.');
      }
    }
  }

  // ---------- JSON load-dev backup (backup / export icon) ----------

  async exportLoadDevBackup(shareAfterSave: boolean = true): Promise<void> {
    // Export the REAL persisted store (includes nested data under every section)
    const payload = this.dataService.exportFullBackup?.();

    if (!payload?.store) {
      alert('Export failed: no store data found.');
      return;
    }

    const hasAnyData =
      (payload.store.rifles?.length ?? 0) +
        (payload.store.venues?.length ?? 0) +
        (payload.store.sessions?.length ?? 0) +
        (payload.store.loadDevProjects?.length ?? 0) >
      0;

    if (!hasAnyData) {
      alert('No data found – nothing to backup yet.');
      return;
    }

    // ✅ IMPORTANT: embed load-dev photos from Directory.Data into the JSON payload
    await this.attachLoadDevMediaToBackupPayload(payload);

    const json = JSON.stringify(payload, null, 2);
    const filename = 'gunstuff-full-backup-' + new Date().toISOString().slice(0, 10) + '.json';

    if (Capacitor.isNativePlatform()) {
      try {
        await Filesystem.requestPermissions();

        const path = filename;

        await Filesystem.writeFile({
          path,
          data: json,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });

        const { uri } = await Filesystem.getUri({
          path,
          directory: Directory.Documents,
        });

        if (shareAfterSave) {
          await Share.share({
            title: 'GS Backup',
            text: 'GS Ballistics backup file',
            url: uri,
          });

          alert('Backup saved. Choose an app (e.g. Files) to store or send it.');
        } else {
          alert('Backup saved to app Documents on this device.');
        }
      } catch (err) {
        console.error('Native backup export failed:', err);
        alert('Backup export failed on this device.');
      }
    } else {
      // Browser – download as a JSON file
      try {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Browser backup export failed:', err);
        alert('Browser backup export failed.');
      }
    }
  }

  // ---------- Kestrel button ----------

  async onKestrelButtonClick(): Promise<void> {
    if (this.selectedTool === 'kestrel') {
      this.selectedTool = null;
      return;
    }
    this.selectedTool = 'kestrel';

    try {
      await BleClient.initialize();
    } catch {
      // ignore if already initialised
    }

    await this.kestrel.connectKestrelBluetooth();
    this.kestrelData = this.kestrel.kestrelData$.getValue();
  }
  // ---------- Maintenance (data health / repair) ----------

  showMaintenanceModal = false;
  maintenanceBusy = false;
  maintenanceReport = '';
  maintenanceSelectedRifleId: number | null = null;

  // Maintenance: canonical rifle picker (repair single rifle)
  maintenanceRiflePickerOpen = false;
  maintenanceRiflePickerSearch = '';
  maintenanceRiflePickerFiltered: any[] = [];

  get maintenanceSelectedRifleName(): string | null {
    const id =
      this.maintenanceSelectedRifleId != null ? Number(this.maintenanceSelectedRifleId) : null;
    if (id == null || Number.isNaN(id)) return null;
    const r = (this.riflesOptions || []).find((x: any) => Number(x?.id) === id);
    return r?.name ?? null;
  }

  openMaintenanceModal(): void {
    this.showMaintenanceModal = true;

    // Keep Setup panel visible
    this.showSetup = true;
    this.showTools = false;
    this.selectedTool = null;
  }

  closeMaintenanceModal(): void {
    this.showMaintenanceModal = false;
    this.maintenanceBusy = false;
    this.maintenanceReport = '';

    this.maintenanceRiflePickerOpen = false;
    this.maintenanceRiflePickerSearch = '';
    this.maintenanceRiflePickerFiltered = [];
    this.maintenanceSelectedRifleId = null;
  }

  openMaintenanceRiflePicker(): void {
    this.maintenanceRiflePickerOpen = true;
    this.maintenanceRiflePickerSearch = '';
    this.maintenanceRiflePickerFiltered = [...(this.riflesOptions || [])];
  }

  closeMaintenanceRiflePicker(): void {
    this.maintenanceRiflePickerOpen = false;
  }

  clearMaintenanceRifleFromPicker(): void {
    this.maintenanceSelectedRifleId = null;
    this.maintenanceRiflePickerSearch = '';
    this.maintenanceRiflePickerFiltered = [...(this.riflesOptions || [])];
  }

  onMaintenanceRiflePickerSearchChange(value: string): void {
    const q = String(value ?? '')
      .trim()
      .toLowerCase();
    const list = this.riflesOptions || [];
    if (!q) {
      this.maintenanceRiflePickerFiltered = [...list];
      return;
    }
    this.maintenanceRiflePickerFiltered = list.filter((r: any) =>
      String(r?.name ?? '')
        .toLowerCase()
        .includes(q),
    );
  }

  selectMaintenanceRifleFromPicker(r: any): void {
    const id = r?.id != null ? Number(r.id) : NaN;
    if (Number.isNaN(id)) return;

    this.maintenanceSelectedRifleId = id;
    this.closeMaintenanceRiflePicker();

    this.runMaintenanceRepairSelectedRifle();
  }

  runMaintenanceRepairSelectedRifle(): void {
    const id =
      this.maintenanceSelectedRifleId != null ? Number(this.maintenanceSelectedRifleId) : null;
    if (id == null || Number.isNaN(id)) {
      alert('Select a rifle first.');
      return;
    }

    this.maintenanceBusy = true;
    try {
      const res = (this.dataService as any).maintenanceRepairSingleRifle?.(id);
      this.maintenanceReport = res?.report ?? 'No report returned.';
    } catch (err) {
      console.error('Maintenance single rifle repair failed:', err);
      this.maintenanceReport =
        'Maintenance single rifle repair failed:\n' + ((err as any)?.message ?? String(err));
    } finally {
      this.maintenanceBusy = false;
    }
  }

  runMaintenanceScan(): void {
    this.maintenanceBusy = true;
    try {
      const res = (this.dataService as any).maintenanceScan?.();
      this.maintenanceReport = res?.report ?? 'No report returned.';
    } catch (err) {
      console.error('Maintenance scan failed:', err);
      this.maintenanceReport =
        'Maintenance scan failed:\n' + ((err as any)?.message ?? String(err));
    } finally {
      this.maintenanceBusy = false;
    }
  }

  runMaintenanceRepair(): void {
    this.maintenanceBusy = true;
    try {
      const res = (this.dataService as any).maintenanceRepair?.();
      this.maintenanceReport = res?.report ?? 'No report returned.';
    } catch (err) {
      console.error('Maintenance repair failed:', err);
      this.maintenanceReport =
        'Maintenance repair failed:\n' + ((err as any)?.message ?? String(err));
    } finally {
      this.maintenanceBusy = false;
    }
  }

  async shareMaintenanceReport(): Promise<void> {
    const text = String(this.maintenanceReport ?? '').trim();
    if (!text) {
      alert('No maintenance report to share yet.');
      return;
    }

    try {
      await Share.share({
        title: 'GS Maintenance Report',
        text,
      });
    } catch (err) {
      console.error('Share maintenance report failed:', err);
      alert('Share failed.\n\n' + ((err as any)?.message ?? String(err)));
    }
  }

  // ---------- Support (WhatsApp share) ----------

  showSupportModal = false;
  supportBusy = false;

  supportMessage = '';
  supportScreenshotDataUrl: string | null = null;
  supportScreenshotName: string | null = null;

  @ViewChild('supportScreenshotInput') supportScreenshotInput!: ElementRef<HTMLInputElement>;
  @ViewChild('supportScreenshotFileInput')
  supportScreenshotFileInput!: ElementRef<HTMLInputElement>;

  openSupportModal(): void {
    this.showSupportModal = true;

    // Keep Setup panel visible
    this.showSetup = true;
    this.showTools = false;
    this.selectedTool = null;
  }

  closeSupportModal(): void {
    this.showSupportModal = false;
    this.supportBusy = false;
    this.supportMessage = '';
    this.clearSupportScreenshot();
  }

  triggerSupportScreenshotPick(): void {
    try {
      this.supportScreenshotInput?.nativeElement?.click();
    } catch {
      // ignore
    }
  }
  triggerSupportScreenshotPickFile(): void {
    try {
      this.supportScreenshotFileInput?.nativeElement?.click();
    } catch {
      // ignore
    }
  }

  onSupportScreenshotSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    this.supportScreenshotName = file.name;

    const reader = new FileReader();
    reader.onload = () => {
      this.supportScreenshotDataUrl = String(reader.result ?? '');
    };
    reader.readAsDataURL(file);

    // allow picking the same file again
    if (input) input.value = '';
  }

  clearSupportScreenshot(): void {
    this.supportScreenshotDataUrl = null;
    this.supportScreenshotName = null;
  }

  private buildSupportShareText(): string {
    const header = `${this.appTitle} v${this.appVersion}`;
    const msg = (this.supportMessage || '').trim();
    return msg ? `${header}\n\n${msg}` : header;
  }

  async sendSupportViaWhatsApp(): Promise<void> {
    const text = this.buildSupportShareText();

    if (Capacitor.isNativePlatform()) {
      this.supportBusy = true;

      try {
        let urlToShare: string | undefined;

        // If screenshot selected: write to Cache and share the file URI (Android-safe)
        if (this.supportScreenshotDataUrl) {
          const parts = this.supportScreenshotDataUrl.split(',');
          const base64 = parts.length > 1 ? parts[1] : '';
          const isJpg = this.supportScreenshotDataUrl.startsWith('data:image/jpeg');
          const ext = isJpg ? 'jpg' : 'png';

          const filename =
            'gs-support-' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + ext;

          const directory = Directory.Cache;

          await Filesystem.writeFile({
            path: filename,
            data: base64,
            directory,
          });

          const { uri } = await Filesystem.getUri({
            path: filename,
            directory,
          });

          urlToShare = uri;
        }

        await Share.share({
          title: 'GS Support',
          text,
          url: urlToShare,
        });

        this.closeSupportModal();
      } catch (err) {
        console.error('Support share failed:', err);
        alert('Support share failed on this device.\n\n' + ((err as any)?.message ?? String(err)));
      } finally {
        this.supportBusy = false;
      }
      return;
    }

    // Browser fallback: text-only via wa.me
    const wa = 'https://wa.me/?text=' + encodeURIComponent(text);
    window.open(wa, '_blank');
  }
  // ---------- LoadDev media helpers (export/import) ----------

  private async attachLoadDevMediaToBackupPayload(payload: any): Promise<void> {
    try {
      const projects: any[] = payload?.store?.loadDevProjects ?? [];
      if (!Array.isArray(projects) || projects.length === 0) return;

      payload.loadDevMedia = payload.loadDevMedia ?? {};
      payload.loadDevMedia.files = payload.loadDevMedia.files ?? {};

      const files: Record<string, { base64: string; mime: string }> = payload.loadDevMedia.files;

      const addPath = async (pathRaw: any, mimeRaw: any) => {
        const path = (pathRaw ?? '').toString().trim();
        if (!path) return;
        if (files[path]) return;

        const mime = (mimeRaw ?? 'image/jpeg').toString().trim() || 'image/jpeg';

        try {
          const res = await Filesystem.readFile({ path, directory: Directory.Data });
          const base64 = (res?.data ?? '').toString().trim();
          if (!base64) return;

          files[path] = { base64, mime };
        } catch {
          // ignore missing file on disk
        }
      };

      for (const p of projects) {
        // Project-level overview photo
        await addPath((p as any)?.targetPhotoPath, (p as any)?.targetPhotoMime);

        // Entry-level photos
        const entries: any[] = (p as any)?.entries ?? [];
        if (Array.isArray(entries)) {
          for (const e of entries) {
            const tp = (e as any)?.targetPhoto;
            await addPath(tp?.path, tp?.mime);
          }
        }
      }
    } catch {
      // no-throw export
    }
  }

  private async rehydrateLoadDevMediaFromImport(parsed: any): Promise<void> {
    try {
      const files: Record<string, { base64: string; mime?: string }> =
        parsed?.loadDevMedia?.files ?? {};

      const paths = Object.keys(files || {});
      if (!paths.length) return;

      for (const path of paths) {
        const item = files[path];
        const base64 = (item?.base64 ?? '').toString().trim();
        if (!base64) continue;

        try {
          await Filesystem.writeFile({
            path,
            data: base64,
            directory: Directory.Data,
            recursive: true,
          });
        } catch {
          // ignore write failures
        }
      }
    } catch {
      // no-throw import
    }
  }
}
