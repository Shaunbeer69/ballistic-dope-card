import { Component, inject, OnInit, ViewChild, ElementRef } from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FileOpener } from '@capacitor-community/file-opener';

import { APP_VERSION } from './environments/version';
import { RiflesTabComponent } from './rifles-tab/rifles-tab.component';
import { VenuesTabComponent } from './venues-tab/venues-tab.component';
import { SessionTabComponent } from './session-tab/session-tab.component';
import { HistoryTabComponent } from './history-tab/history-tab.component';
import { LoadDevTabComponent } from './load-dev-tab/load-dev-tab.component';
import { WindEffectToolComponent } from './wind-effect-tool.component';
import { environment } from './environments/environment';
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
  appTitle = 'GS Dope Card';
  appSubtitle = 'Field log for rifles, venues & sessions';
    appVersion = APP_VERSION;



  currentTab: 'menu' | 'sessions' | 'rifles' | 'venues' | 'history' | 'loadDev' =
    'menu';
// --- Export / Import UI ---
showExportImportModal = false;
exportImportInlineMessage: string | null = null;
@ViewChild('importFileInput') importFileInput!: ElementRef<HTMLInputElement>;
@ViewChild('firstLaunchSloganEl') firstLaunchSloganEl?: ElementRef<HTMLElement>;
exportMode: 'root' | 'export' = 'root';
importBusy = false;

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

  // Full distance history at this venue
  distanceHistoryGroups: DistanceHistoryGroup[] = [];
  expandedDistanceM: number | null = null;

  // TOOLS / KESTREL / CONVERTER
  
  showSetup = false;
  showTools = false;
showFirstLaunchSlogan = false;
firstLaunchSlogan = '';
  // First-launch slogan sizing (no wrap, no ellipsis)
  firstLaunchSloganFontPx = 36;
  private readonly firstLaunchSloganBaseFontPx = 36;
  private readonly firstLaunchSloganMinFontPx = 16;

  
 selectedTool: 'converter' | 'windEffect' | 'kestrel' | 'targets' | 'preferences' | 'documents' | null = null;

  // Preferences (Units & Display v1)
  // (removed duplicate 'prefs' declaration; see below for the strongly typed version)


  // ---------------- Documents tool ----------------
  private readonly documentsKey = 'gs_documents_v1';
    documents: Array<{ id: string; title: string; tags: string[]; link?: string | null; createdAt: number }> = [];

  documentsSearch: string = '';
  documentsSort: 'az' | 'za' | 'new' | 'old' = 'az';
  showAddDocumentForm = false;
  documentsListExpanded = false;

  newDocTitle = '';
  newDocTags = '';
  newDocLink = '';

    get filteredDocuments(): Array<{ id: string; title: string; tags: string[]; link?: string | null; createdAt: number }> {
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
    'ONE SHOT ONE STANDARD',
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
    'THE WIND OWNS YOUT',
    'RESPECT THE CONDITIONS',
    'LET THE DATA LEAD',
    'LET THE IMPACT SPEAK',
    'MAKE STEEL RING',
    'MAKE IT COUNT',
    'EARN THE HIT',
  ];


  private pickRandomSlogan(maxLen?: number): string {
    const all = this.FIRST_LAUNCH_SLOGANS || [];
    if (!all.length) return 'TRUST THE DATA';

    const filtered =
      typeof maxLen === 'number'
        ? all.filter((s) => (s || '').trim().length > 0 && (s || '').trim().length <= maxLen)
        : all;

    const pool = filtered.length ? filtered : all;
    const i = Math.floor(Math.random() * pool.length);
    return pool[i];
  }

  
  // ---------- first-launch slogan (menu banner) ----------
  private sloganListenerReady = false;
  private lastSloganShownAt = 0;

  private showMenuSlogan(): void {
    // Only on main menu and only when no overlays/panels are open
    if (this.currentTab !== 'menu') return;
    if (this.showReportsForm || this.showTools || this.showSetup || this.showExportImportModal) return;
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
    el.style.whiteSpace = 'nowrap';

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
    const shorter = this.pickRandomSlogan(24);
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
                    this.showMenuSlogan();

        }
      });
    } catch {
      // ignore
    }
  }

  private maybeShowFirstLaunchSlogan(): void {
    // Throttle to avoid double-trigger flicker
    const now = Date.now();
    if (now - this.lastSloganShownAt < 250) return;
    this.lastSloganShownAt = now;

    this.showMenuSlogan();
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

  private async getShareableDocUrl(doc: {
    title: string;
    link?: string | null;
  }): Promise<string> {
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
          directory: Directory.Cache
        });

        await Share.share({
          title: doc.title,
          text: doc.title,
          url: saved.uri
        });

        return;
      }

      // Browser OR non-asset link: share the absolute URL
      await Share.share({
        title: doc.title,
        text: doc.title,
        url: absoluteUrl
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
              ? x.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
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

    converterMode:
    | 'milToMoa'
    | 'moaToMil'
    | 'clicksToMil'
    | 'clicksToMoa'
    | 'milToClicks'
    | 'moaToClicks'
    | 'mToYd'
    | 'ydToM'
    | 'cToF'
    | 'fToC'
    | 'mpsToFps'
    | 'fpsToMps'
    | 'hpaToInhg'
    | 'inhgToHpa'
    | 'hpaToMmhg'
    | 'mmhgToHpa'
    | 'hpaToKpa'
    | 'kpaToHpa'
    | 'kmhToMph'
    | 'mphToKmh'
    | 'kmhToMs'
    | 'msToKmh'
    | 'kmhToKn'
    | 'knToKmh'
    | 'milToInAtDist'
    | 'moaToInAtDist'
    | 'inToMilAtDist'
    | 'inToMoaAtDist' =
    'milToMoa';

  converterInput: number | null = null;
  converterAux: number | null = null;

  private readonly MIL_PER_CLICK = 0.1;
  private readonly MOA_PER_CLICK = 0.25;

  get converterUsesDistance(): boolean {
    return (
      this.converterMode === 'milToInAtDist' ||
      this.converterMode === 'moaToInAtDist' ||
      this.converterMode === 'inToMilAtDist' ||
      this.converterMode === 'inToMoaAtDist'
    );
  }

  get converterInputLabel(): string {
    switch (this.converterMode) {
      case 'milToMoa':
      case 'milToClicks':
      case 'milToInAtDist':
        return 'Input (mil)';
      case 'moaToMil':
      case 'moaToClicks':
      case 'moaToInAtDist':
        return 'Input (MOA)';
      case 'clicksToMil':
      case 'clicksToMoa':
        return 'Input (clicks)';
      case 'mToYd':
        return 'Input (m)';
      case 'ydToM':
        return 'Input (yd)';
      case 'cToF':
        return 'Input (°C)';
      case 'fToC':
        return 'Input (°F)';
      case 'mpsToFps':
        return 'Input (m/s)';
      case 'fpsToMps':
        return 'Input (fps)';
      case 'hpaToInhg':
      case 'hpaToMmhg':
      case 'hpaToKpa':
        return 'Input (hPa)';
      case 'inhgToHpa':
        return 'Input (inHg)';
      case 'mmhgToHpa':
        return 'Input (mmHg)';
      case 'kpaToHpa':
        return 'Input (kPa)';
      case 'kmhToMph':
      case 'kmhToMs':
      case 'kmhToKn':
        return 'Input (km/h)';
      case 'mphToKmh':
        return 'Input (mph)';
      case 'msToKmh':
        return 'Input (m/s)';
      case 'knToKmh':
        return 'Input (kn)';
      case 'inToMilAtDist':
      case 'inToMoaAtDist':
        return 'Input (inches)';
      default:
        return 'Input';
    }
  }

  get converterAuxLabel(): string {
    return 'Distance (m)';
  }

  get converterOutputLabel(): string {
    switch (this.converterMode) {
      case 'milToMoa':
        return 'Result (MOA)';
      case 'moaToMil':
        return 'Result (mil)';
      case 'clicksToMil':
        return 'Result (mil)';
      case 'clicksToMoa':
        return 'Result (MOA)';
      case 'milToClicks':
      case 'moaToClicks':
        return 'Result (clicks)';
      case 'mToYd':
        return 'Result (yd)';
      case 'ydToM':
        return 'Result (m)';
      case 'cToF':
        return 'Result (°F)';
      case 'fToC':
        return 'Result (°C)';
      case 'mpsToFps':
        return 'Result (fps)';
      case 'fpsToMps':
        return 'Result (m/s)';
      case 'hpaToInhg':
        return 'Result (inHg)';
      case 'inhgToHpa':
        return 'Result (hPa)';
      case 'hpaToMmhg':
        return 'Result (mmHg)';
      case 'mmhgToHpa':
        return 'Result (hPa)';
      case 'hpaToKpa':
        return 'Result (kPa)';
      case 'kpaToHpa':
        return 'Result (hPa)';
      case 'kmhToMph':
        return 'Result (mph)';
      case 'mphToKmh':
        return 'Result (km/h)';
      case 'kmhToMs':
        return 'Result (m/s)';
      case 'msToKmh':
        return 'Result (km/h)';
      case 'kmhToKn':
        return 'Result (kn)';
      case 'knToKmh':
        return 'Result (km/h)';
      case 'milToInAtDist':
      case 'moaToInAtDist':
        return 'Result (inches)';
      case 'inToMilAtDist':
        return 'Result (mil)';
      case 'inToMoaAtDist':
        return 'Result (MOA)';
      default:
        return 'Result';
    }
  }

  private dataService: DataService = inject(DataService);
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


    // Show a random slogan on the main menu whenever the app becomes active.
    // Hidden as soon as a main menu icon/button is pressed (handled in setTab/openTools/openSetup/etc).
    this.initSloganVisibilityListener();
        this.showMenuSlogan();






  }





  private loadCoreData(): void {
    this.allSessions = this.dataService.getSessions();

    const rifles = this.dataService.getRifles();
    const venues = this.dataService.getVenues();

    this.riflesOptions = rifles.map((r) => ({ id: r.id, name: r.name }));
    this.venuesOptions = venues.map((v) => ({ id: v.id, name: v.name }));

    this.recentSessionsCount = this.allSessions.length;

    const loadDevs = this.dataService.getLoadDevProjectsForRifle
      ? rifles.reduce((sum, r) => {
          const projects = this.dataService.getLoadDevProjectsForRifle(r.id);
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

      setTab(
    tab: 'menu' | 'sessions' | 'rifles' | 'venues' | 'history' | 'loadDev'
  ): void {
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
        this.showMenuSlogan();

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
      const to = this.reportRequest.dateTo
        ? new Date(this.reportRequest.dateTo).getTime()
        : null;

      sessions = sessions.filter((s) => {
        const rawDate =
          s.date ||
          s.sessionDate ||
          s.startTime ||
          s.startedAt ||
          s.createdAt ||
          s.timestamp;
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
          x.date ||
          x.sessionDate ||
          x.startTime ||
          x.startedAt ||
          x.createdAt ||
          x.timestamp;
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
      this.lastSettingsError =
        'No sessions found for this filter yet. Shoot a session first.';
      return;
    }

    // ✅ NEW BEHAVIOUR:
    // If distance is blank/0, show ALL available distances (grouped) instead of erroring.
    if (!this.reportDistanceM || this.reportDistanceM <= 0) {
      this.distanceHistoryGroups = this.buildDistanceHistoryGroupsAllDistances(
        sessions
      );
      if (!this.distanceHistoryGroups.length) {
        this.lastSettingsError =
          'No DOPE distances found in the filtered sessions.';
      }
      return;
    }

    const distanceM = this.reportDistanceM;

    // 1) Last settings at this exact distance
    const last = this.findLastSettingsForDistance(sessions, distanceM);
    if (!last) {
      this.lastSettingsError =
        'No DOPE found for this distance in the filtered sessions.';
      return;
    }
    this.lastSettingsResult = last;

    // 2) Quick DOPE view at key distances
    this.multiDistanceSummary = this.buildMultiDistanceSummary(
      sessions,
      this.REPORT_DISTANCES
    );

    // 3) Wind trend at this distance
    this.windTrendSummary = this.buildWindTrendSummary(sessions, distanceM);

    // 4) Full distance history groups (ALL distances, comprehensive)
this.distanceHistoryGroups = this.buildDistanceHistoryGroupsAllDistances(sessions);

// Optional: auto-expand the selected distance group (nice UX)
this.expandedDistanceM = distanceM;

    ;
  }

  private findLastSettingsForDistance(
    sessions: any[],
    distanceM: number
  ): LastSettingsResult | null {
    for (let i = sessions.length - 1; i >= 0; i--) {
      const s = sessions[i];
      const dope = this.findDopeForExactDistance(s, distanceM);
      if (!dope) continue;

      const rifleName =
        this.dataService.getRifleById?.(s.rifleId)?.name || 'Unknown rifle';
      const venueName =
        this.dataService.getVenueById?.(s.venueId)?.name || 'Unknown venue';

      const rawDate =
        s.sessionDate ||
        s.date ||
        s.startTime ||
        s.startedAt ||
        s.createdAt ||
        s.timestamp;
      const dateStr = rawDate
        ? new Date(rawDate).toISOString().slice(0, 10)
        : 'Unknown date';

      const env = s.environment || {};

      const elevationMil =
        dope.elevationMil ?? dope.elevation ?? dope.elevationClicks ?? null;
      const windageMil =
        dope.windageMil ?? dope.windage ?? dope.windClicks ?? null;

      const result: LastSettingsResult = {
        rifleName,
        venueName,
        sessionDate: dateStr,
        distanceM: dope.distanceM ?? dope.distance ?? null,
        elevationMil:
          typeof elevationMil === 'number' && !Number.isNaN(elevationMil)
            ? elevationMil
            : null,
        windageMil:
          typeof windageMil === 'number' && !Number.isNaN(windageMil)
            ? windageMil
            : null,
        environment: {
          temperatureC:
            typeof env.temperatureC === 'number' ? env.temperatureC : null,
          pressureInHg:
            typeof env.pressureInHg === 'number' ? env.pressureInHg : null,
          humidityPercent:
            typeof env.humidityPercent === 'number'
              ? env.humidityPercent
              : null,
          windSpeedMps:
            typeof env.windSpeedMps === 'number' ? env.windSpeedMps : null,
          windDirectionClock:
            typeof env.windDirectionClock === 'number'
              ? env.windDirectionClock
              : null,
        },
      };

      return result;
    }

    return null;
  }

  private buildDistanceHistoryGroups(
    sessions: any[],
    distanceM: number
  ): DistanceHistoryGroup[] {
    const groupsMap = new Map<number, DistanceHistoryEntry[]>();

    for (const s of sessions) {
      const dope = this.findDopeForExactDistance(s, distanceM);
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
        : 'Unknown date';

      const d =
        typeof dope.distanceM === 'number'
          ? dope.distanceM
          : typeof dope.distance === 'number'
          ? dope.distance
          : distanceM;

      const elevationMil =
        dope.elevationMil ?? dope.elevation ?? dope.elevationClicks ?? null;
      const windageMil =
        dope.windageMil ?? dope.windage ?? dope.windClicks ?? null;

      const entry: DistanceHistoryEntry = {
        sessionDate: dateStr,
        distanceM: d,
        elevationMil:
          typeof elevationMil === 'number' && !Number.isNaN(elevationMil)
            ? elevationMil
            : null,
        windageMil:
          typeof windageMil === 'number' && !Number.isNaN(windageMil)
            ? windageMil
            : null,
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
  private buildDistanceHistoryGroupsAllDistances(
    sessions: any[]
  ): DistanceHistoryGroup[] {
    const groupsMap = new Map<number, DistanceHistoryEntry[]>();

    for (const s of sessions) {
      const dopes = this.extractAllDopeEntries(s);

      if (!dopes.length) continue;

      const rawDate =
        s.sessionDate ||
        s.date ||
        s.startTime ||
        s.startedAt ||
        s.createdAt ||
        s.timestamp;
      const dateStr = rawDate
        ? new Date(rawDate).toISOString().slice(0, 10)
        : 'Unknown date';

      for (const dope of dopes) {
        const d =
          typeof dope.distanceM === 'number'
            ? dope.distanceM
            : typeof dope.distance === 'number'
            ? dope.distance
            : null;

        if (d == null || Number.isNaN(d)) continue;

        const elevationMil =
          dope.elevationMil ?? dope.elevation ?? dope.elevationClicks ?? null;
        const windageMil =
          dope.windageMil ?? dope.windage ?? dope.windClicks ?? null;

        const entry: DistanceHistoryEntry = {
          sessionDate: dateStr,
          distanceM: d,
          elevationMil:
            typeof elevationMil === 'number' && !Number.isNaN(elevationMil)
              ? elevationMil
              : null,
          windageMil:
            typeof windageMil === 'number' && !Number.isNaN(windageMil)
              ? windageMil
              : null,
              
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
        typeof c.distanceM === 'number' ? c.distanceM : c.distance;
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
    this.selectedTool = null;
  }

  if (!this.showSetup) {
    this.selectedTool = null;
  }

  this.showReportsForm = false;
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
  this.showTools = true;
  this.showSetup = false;
  this.selectedTool = this.selectedTool === 'converter' ? null : 'converter';
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

  pressureUnit: 'hpa' | 'inhg' | 'mmhg' | 'kpa';
  windSpeedUnit: 'kmh' | 'mph' | 'ms' | 'kn';
  angleDisplay: 'degrees' | 'clock';
  scopeAdjust: 'mil' | 'moa';
} = {
  distanceUnit: 'm',
  velocityUnit: 'mps',
    loadDevOalUnit: 'mm',

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
    this.dataService.updatePreferences({ loadDev: { oalUnit: this.prefs.loadDevOalUnit } });
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
        String(parsed.loadDevOalUnit ?? parsed.loadDev?.oalUnit ?? this.dataService.getDefaultLoadDevOalUnit?.())
          .toLowerCase() === 'in'
          ? 'in'
          : 'mm',

      temperatureUnit: parsed.temperatureUnit === 'f' ? 'f' : 'c',
      pressureUnit: ['hpa', 'inhg', 'mmhg', 'kpa'].includes(parsed.pressureUnit)
        ? parsed.pressureUnit
        : 'hpa',
      windSpeedUnit: ['kmh', 'mph', 'ms', 'kn'].includes(parsed.windSpeedUnit)
        ? parsed.windSpeedUnit
        : 'kmh',
      angleDisplay: parsed.angleDisplay === 'degrees' ? 'degrees' : 'clock',
      scopeAdjust: parsed.scopeAdjust === 'moa' ? 'moa' : 'mil'
    };
  } catch {
    // ignore parse errors
  }
}




async downloadTarget(type: 'ocw' | 'group' | 'dots'): Promise<void> {
  try {
    const files: Record<string, string> = {
      ocw: 'assets/targets/ocw-ladder-a4.pdf',
      group: 'assets/targets/group-zero-a4.pdf',
      dots: 'assets/targets/dot-drill-a4.pdf'
    };

    const url = files[type];
    if (!url) throw new Error(`Unknown target type: ${type}`);

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
    } catch (shareErr) {
      // Fallback: open the PDF directly
      const filePath = shareUrl.startsWith('file://') ? shareUrl.slice('file://'.length) : shareUrl;
      await FileOpener.open({ filePath, contentType: 'application/pdf' });
    }

    // 3) open share sheet so user can "Save to Downloads" or print
    await Share.share({
      title: filename,
      text: 'Save this target to Downloads / Files',
      url: uri.uri,
    });

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

    // Distance-dependent conversions (expects converterAux = distance in meters)
    const needsDistance = this.converterUsesDistance;
    const distanceM =
      needsDistance && this.converterAux != null && !Number.isNaN(this.converterAux)
        ? this.converterAux
        : null;

    const toInches = (meters: number) => meters * 39.37007874015748;
    const inchesToMeters = (inches: number) => inches / 39.37007874015748;
    const moaToRadians = (moa: number) => (moa * Math.PI) / 180 / 60;

    // ---- angle / click conversions ----
    if (this.converterMode === 'milToMoa') {
      return Math.round(v * 3.43775 * 100) / 100;
    }

    if (this.converterMode === 'moaToMil') {
      return Math.round((v / 3.43775) * 1000) / 1000;
    }

    if (this.converterMode === 'clicksToMil') {
      const mil = v * this.MIL_PER_CLICK;
      return Math.round(mil * 1000) / 1000;
    }

    if (this.converterMode === 'clicksToMoa') {
      const moa = v * this.MOA_PER_CLICK;
      return Math.round(moa * 100) / 100;
    }

    if (this.converterMode === 'milToClicks') {
      const clicks = v / this.MIL_PER_CLICK;
      return Math.round(clicks * 10) / 10;
    }

    if (this.converterMode === 'moaToClicks') {
      const clicks = v / this.MOA_PER_CLICK;
      return Math.round(clicks * 10) / 10;
    }

    // ---- distance / env / speed units ----
    if (this.converterMode === 'mToYd') return Math.round(v * 1.0936133 * 1000) / 1000;
    if (this.converterMode === 'ydToM') return Math.round((v / 1.0936133) * 1000) / 1000;

    if (this.converterMode === 'cToF') return Math.round((v * 9 / 5 + 32) * 100) / 100;
    if (this.converterMode === 'fToC') return Math.round(((v - 32) * 5 / 9) * 100) / 100;

    if (this.converterMode === 'mpsToFps') return Math.round(v * 3.280839895 * 100) / 100;
    if (this.converterMode === 'fpsToMps') return Math.round((v / 3.280839895) * 1000) / 1000;

    if (this.converterMode === 'hpaToInhg') return Math.round((v / 33.8638866667) * 10000) / 10000;
    if (this.converterMode === 'inhgToHpa') return Math.round((v * 33.8638866667) * 100) / 100;

    if (this.converterMode === 'hpaToMmhg') return Math.round((v / 1.3332239) * 1000) / 1000;
    if (this.converterMode === 'mmhgToHpa') return Math.round((v * 1.3332239) * 100) / 100;

    if (this.converterMode === 'hpaToKpa') return Math.round((v / 10) * 1000) / 1000;
    if (this.converterMode === 'kpaToHpa') return Math.round((v * 10) * 100) / 100;

    if (this.converterMode === 'kmhToMph') return Math.round((v * 0.621371) * 1000) / 1000;
    if (this.converterMode === 'mphToKmh') return Math.round((v / 0.621371) * 1000) / 1000;

    if (this.converterMode === 'kmhToMs') return Math.round((v / 3.6) * 1000) / 1000;
    if (this.converterMode === 'msToKmh') return Math.round((v * 3.6) * 100) / 100;

    if (this.converterMode === 'kmhToKn') return Math.round((v * 0.539957) * 1000) / 1000;
    if (this.converterMode === 'knToKmh') return Math.round((v / 0.539957) * 1000) / 1000;

    // ---- angle ↔ size at distance (distanceM required) ----
    if (
      this.converterMode === 'milToInAtDist' ||
      this.converterMode === 'moaToInAtDist' ||
      this.converterMode === 'inToMilAtDist' ||
      this.converterMode === 'inToMoaAtDist'
    ) {
      if (distanceM == null || distanceM <= 0) return null;

      if (this.converterMode === 'milToInAtDist') {
        const sizeM = distanceM * (v / 1000);
        return Math.round(toInches(sizeM) * 1000) / 1000;
      }

      if (this.converterMode === 'moaToInAtDist') {
        const sizeM = distanceM * moaToRadians(v);
        return Math.round(toInches(sizeM) * 1000) / 1000;
      }

      if (this.converterMode === 'inToMilAtDist') {
        const sizeM = inchesToMeters(v);
        const mil = (sizeM / distanceM) * 1000;
        return Math.round(mil * 1000) / 1000;
      }

      // inToMoaAtDist
      const sizeM = inchesToMeters(v);
      const moa = (sizeM / distanceM) * (180 / Math.PI) * 60;
      return Math.round(moa * 100) / 100;
    }

    return null;
  }


  private buildMultiDistanceSummary(
    sessions: any[],
    distances: number[]
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
const ok = confirm(
  'Import will MERGE into existing data (no overwrite).\n\nContinue?'
);
if (!ok) return;

const result = this.dataService.importFromBackupMerge(parsed);


        // Refresh menus/counts
    this.loadCoreData();

    this.showExportImportModal = false;
    alert(`Import complete.\n\n${result.message}`);

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
      'Export / Import\n\nOK = Export current data to a JSON file\nCancel = Import a JSON backup from another device'
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

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert('Import failed: selected file is not valid JSON.');
      return;
    }

    // Safety prompt (import overwrites local data)
    const ok = confirm(
      'Import will ADD/merge data into this device (it will not delete existing data).\n\nContinue?'

    );
    if (!ok) return;

    const result = this.dataService.importFromBackupMerge(parsed);

    if (!result.ok) {
      alert(`Import failed: ${result.message}`);
      return;
    }

    // Refresh menus/counts
    this.loadCoreData();

    alert(`Import complete.\n\n${result.message}`);
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


  const json = JSON.stringify(payload, null, 2);
  const filename =
  'gunstuff-full-backup-' +
  new Date().toISOString().slice(0, 10) +
  '.json';


  if (Capacitor.isNativePlatform()) {
    try {
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
}
