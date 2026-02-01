import { CommonModule } from '@angular/common';
import { Component, OnInit, Output, EventEmitter, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../data.service';
import { Rifle, Venue, SubRange, Environment, DistanceDope, Session } from '../models';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { KestrelDataSnapshot, KestrelService } from '../shared/services/kestrel-bluetooth.service';

type WizardStep = 'setup' | 'environment' | 'shots' | 'complete';

interface KestrelSnapshot {
  temperatureC: number;
  humidityPercent: number;
  pressureHpa: number;
  windSpeedMph: number;
  windClock: number; // 1–12
}

@Component({
  selector: 'app-session-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './session-tab.component.html',
  styleUrls: ['./session-tab.component.css'],
})
export class SessionTabComponent implements OnInit {
  step: WizardStep = 'setup';
  @Output() backToMenu = new EventEmitter<void>();

  rifles: Rifle[] = [];
  venues: Venue[] = [];
  // Notify parent app when user wants to jump to History
  @Output() jumpToHistory = new EventEmitter<void>();

  // IDs used in the HTML template
  rifleId: number | null = null;
  venueId: number | null = null;
  subRangeId: number | null = null;
  // ---------- Rifle picker modal (canonical; matches Rifles tab) ----------
  riflePickerOpen = false;
  riflePickerSearch = '';
  riflePickerFiltered: Rifle[] = [];
  // ---------- Sub-range picker modal (canonical; matches Venues tab style) ----------
  subRangePickerOpen = false;
  subRangePickerSearch = '';
  subRangePickerFiltered: SubRange[] = [];

  title = '';
  environment: Environment = {};
  // Wind speed unit toggle (display only). Internally we store windSpeedMps on environment.
  windSpeedUnit: 'mph' | 'mps' = 'mph'; // default mph (as requested)

  // Simple inline toast for Environment validation
  envToastMessage: string | null = null;
  private envToastTimer: any | null = null;

  private showEnvToast(msg: string): void {
    this.envToastMessage = msg;
    if (this.envToastTimer) clearTimeout(this.envToastTimer);
    this.envToastTimer = setTimeout(() => (this.envToastMessage = null), 2500);
  }
  private clearEnvToast(): void {
    this.envToastMessage = null;
    if (this.envToastTimer) {
      clearTimeout(this.envToastTimer);
      this.envToastTimer = null;
    }
  }

  private scrollToField(id: string): void {
    try {
      setTimeout(() => {
        const el = document.getElementById(id);
        if (!el) return;

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const anyEl: any = el;
        if (typeof anyEl.focus === 'function') anyEl.focus();
      }, 50);
    } catch {
      // ignore
    }
  }

  private isFiniteNumber(v: any): v is number {
    return typeof v === 'number' && Number.isFinite(v);
  }

  private kmhToMps(kmh: number): number {
    return kmh / 3.6;
  }

  private mpsToKmh(mps: number): number {
    return mps * 3.6;
  }

  private mphToMps(mph: number): number {
    return mph * 0.44704;
  }

  private mpsToMph(mps: number): number {
    return mps / 0.44704;
  }

  toggleWindSpeedUnit(): void {
    this.windSpeedUnit = this.windSpeedUnit === 'mph' ? 'mps' : 'mph';
  }

  // ngModel bridge for the wind speed input (display unit ⇄ stored mps)
  get windSpeedInputValue(): number | null {
    const mps = this.environment?.windSpeedMps;
    if (!this.isFiniteNumber(mps)) return null;

    return this.windSpeedUnit === 'mph'
      ? Number(this.mpsToMph(mps).toFixed(1))
      : Number(this.mpsToKmh(mps).toFixed(1));
  }

  set windSpeedInputValue(v: number | null) {
    if (v === null || v === undefined || v === ('' as any)) {
      this.environment.windSpeedMps = undefined;
      return;
    }

    const num = typeof v === 'string' ? Number(v) : v;
    if (!Number.isFinite(num)) {
      this.environment.windSpeedMps = undefined;
      return;
    }

    this.environment.windSpeedMps =
      this.windSpeedUnit === 'mph' ? this.mphToMps(num) : this.kmhToMps(num);
  }

  // Wind clock (1–12, relative to target at 12)
  windClock: number | null = null;
  // Wind speed unit toggle (UI shows mph or km/h; internally we store mph in environment.windSpeedMps)
  shotCount: number | null = null;
  selectedDistances: number[] = [];
  wholeVenueDistanceInput: number | null = null;

  notes = '';

  // ---------- Shots step toast ----------
  shotsToastMessage: string | null = null;
  private shotsToastTimer: any | null = null;

  private showShotsToast(msg: string): void {
    this.shotsToastMessage = msg;
    if (this.shotsToastTimer) clearTimeout(this.shotsToastTimer);
    this.shotsToastTimer = setTimeout(() => (this.shotsToastMessage = null), 2500);
  }

  clearShotsToast(): void {
    this.shotsToastMessage = null;
    if (this.shotsToastTimer) {
      clearTimeout(this.shotsToastTimer);
      this.shotsToastTimer = null;
    }
  }

  // ---------- Session Voice Note (Mic) ----------
  sessionMicInlineMessage: string | null = null;
  sessionVoiceNoteDataUrl: string | null = null;

  private sessionMediaRecorder: MediaRecorder | null = null;
  private sessionMediaStream: MediaStream | null = null;
  private sessionAudioChunks: BlobPart[] = [];
  sessionIsRecording = false;

  dopeRows: DistanceDope[] = [];
  completeMessage = '';

  // Kestrel integration state
  kestrelConnected = false;
  kestrelStatus = 'Not connected';
  kestrelLastUpdate: Date | null = null;
  kestrelData: KestrelDataSnapshot | null = null;
  kestrelError: string | null = null;
  kestrelIsConnecting = false;
  public kestrel: KestrelService = inject(KestrelService);

  // Track current device + auto-disconnect timer
  private kestrelDeviceId: string | null = null;
  private kestrelAutoDisconnectTimer: any | null = null;

  constructor(private data: DataService) {}

  ngOnInit(): void {
    this.rifles = this.data.getRifles();
    this.venues = this.data.getVenues();
  }
  // ---------- Rifle picker (canonical; matches Rifles tab) ----------

  selectedRifleLabel(): string {
    const r = this.rifles.find((x) => ((x as any).id ?? (x as any).rifleId) === this.rifleId);

    if (!r) return 'Select rifle';

    const name = (r as any).name || '-';
    const cal = (r as any).caliber || '';
    return cal ? `${name} (${cal})` : name;
  }

  onSelectedRifleChange(id: number | null): void {
    // Keep this hook so it matches Rifles tab pattern.
    // If later you need to reset dependent fields when rifle changes, do it here.
    this.rifleId = id;
  }

  openRiflePicker(): void {
    this.riflePickerOpen = true;
    this.riflePickerSearch = '';
    this.riflePickerFiltered = [...this.rifles];
  }

  closeRiflePicker(): void {
    this.riflePickerOpen = false;
  }

  clearRifleFromPicker(): void {
    this.rifleId = null;
    this.closeRiflePicker();
  }

  selectRifleFromPicker(r: Rifle): void {
    this.rifleId = (r as any).id ?? (r as any).rifleId ?? null;
    this.closeRiflePicker();
  }

  onRiflePickerSearchChange(v: string): void {
    const q = (v ?? '').toString().trim().toLowerCase();

    if (!q) {
      this.riflePickerFiltered = [...this.rifles];
      return;
    }

    this.riflePickerFiltered = this.rifles.filter((r) => {
      const name = ((r as any).name ?? '').toString().toLowerCase();
      const cal = ((r as any).caliber ?? '').toString().toLowerCase();
      return name.includes(q) || cal.includes(q);
    });
  }
  // ---------- Rifle picker helpers (template-safe; avoids "as any" in HTML) ----------

  rifleAnyId(r: Rifle | any): number | null {
    if (!r) return null;
    // Some parts of the app historically used rifleId; others use id.
    const id = (r as any).id;
    if (id !== null && id !== undefined) return Number(id);

    const legacy = (r as any).rifleId;
    if (legacy !== null && legacy !== undefined) return Number(legacy);

    return null;
  }

  rifleAnyLabel(r: Rifle | any): string {
    if (!r) return 'Select rifle';
    const name = ((r as any).name ?? '').toString().trim();
    const cal = ((r as any).caliber ?? '').toString().trim();
    if (!name && !cal) return 'Select rifle';
    return cal ? `${name || '-'} (${cal})` : name || '-';
  }

  // ---------- Derived getters ----------

  get selectedVenue(): Venue | undefined {
    return this.venues.find((v) => v.id === this.venueId);
  }

  get subRanges(): SubRange[] {
    const v = this.selectedVenue;
    return v?.subRanges ?? [];
  }

  get selectedSubRange(): SubRange | undefined {
    const list = this.subRanges;
    return list.find((sr) => sr.id === this.subRangeId);
  }
  goHome(): void {
    this.backToMenu.emit();
  }

  get distanceOptions(): number[] {
    const sr = this.selectedSubRange;
    if (sr?.distancesM && sr.distancesM.length) return sr.distancesM;

    // Whole venue / no sub-range fallback
    const v: any = this.selectedVenue as any;
    return (v?.distancesM as number[]) ?? [];
  }

  get windHint(): string {
    // Keep a single internal basis: mph stored in environment.windSpeedMps (name is legacy)
    const mph = this.environment.windSpeedMps;
    let clock = this.windClock;

    if (!clock || !mph || mph <= 0) return '';

    // Normalize clock to 1..12
    clock = ((clock - 1) % 12) + 1;

    const c = clock;
    const isFront = c === 11 || c === 12 || c === 1;
    const isBack = c === 5 || c === 6 || c === 7;
    const isRight = c >= 1 && c <= 5; // wind from right side
    const isLeft = c >= 7 && c <= 11; // wind from left side

    let directionText = '';

    if (isFront && isRight) directionText = 'slightly low with drift to the left';
    else if (isFront && isLeft) directionText = 'slightly low with drift to the right';
    else if (isFront) directionText = 'slightly low, minimal left/right drift';
    else if (isBack && isRight) directionText = 'slightly high with drift to the left';
    else if (isBack && isLeft) directionText = 'slightly high with drift to the right';
    else if (isBack) directionText = 'slightly high, minimal left/right drift';
    else if (isRight) directionText = 'drift to the left';
    else if (isLeft) directionText = 'drift to the right';

    let intensity = '';
    if (mph < 2) intensity = 'Very light wind – small effect.';
    else if (mph < 5) intensity = 'Light wind – moderate correction.';
    else if (mph < 8) intensity = 'Medium wind – expect noticeable drift.';
    else intensity = 'Strong wind – expect significant drift.';

    const speedDisplay = this.windSpeedUnit === 'mph' ? mph : mph * 1.609344; // mph -> km/h
    const unitLabel = this.windSpeedUnit === 'mph' ? 'mph' : 'km/h';

    const speedText = Number.isFinite(speedDisplay) ? speedDisplay.toFixed(2) : `${speedDisplay}`;

    return `Wind from ${c} o'clock at ${speedText} ${unitLabel}: expect ${directionText}. ${intensity}`;
  }

  // Called by (ngModelChange) in the template – logic is in the getter
  updateWindHint(): void {
    // no-op: windHint is computed on the fly
  }

  // ---------- Setup step ----------

  onVenueChange(): void {
    // Always re-pull venues so subRanges are never stale after edits in Venues tab
    this.venues = this.data.getVenues();

    // Default to "Whole venue / no sub-range" whenever the venue changes
    this.subRangeId = null;

    // Changing venue resets selected distances
    this.selectedDistances = [];
  }

  canGoToEnvironment(): boolean {
    if (!this.rifleId) return false;
    if (!this.venueId) return false;
    // subRange is optional – you allow "Whole venue / no sub-range"
    return true;
  }

  goToEnvironmentStep(): void {
    if (!this.rifleId) {
      alert('Please select a rifle.');
      return;
    }
    if (!this.venueId) {
      alert('Please select a venue.');
      return;
    }
    // Sub-range can be null (whole venue)
    // Sub-range can be null (whole venue)

    this.clearEnvToast();
    this.clearShotsToast();

    this.step = 'environment';

    this.step = 'environment';
  }

  cancelSession(): void {
    this.newSession();
    this.step = 'setup';
  }

  // ---------- Kestrel integration ----------

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private clearKestrelAutoDisconnect(): void {
    if (this.kestrelAutoDisconnectTimer) {
      clearTimeout(this.kestrelAutoDisconnectTimer);
      this.kestrelAutoDisconnectTimer = null;
    }
  }

  async onKestrelButtonClick(): Promise<void> {
    await this.kestrel.connectKestrelBluetooth();
    this.kestrelData = this.kestrel.kestrelData$.getValue();
    this.environment = this.kestrelData as any;
  }

  // ---------- Environment step ----------

  nextFromEnvironment(): void {
    // Convert windClock -> approximate windDirectionDeg (0° = from target / headwind)
    // Validation: all manual numeric fields must be populated (Light conditions excluded)
    const t = this.environment?.temperatureC;
    const p = this.environment?.pressureInHg;
    const h = this.environment?.humidityPercent;
    const w = this.environment?.windSpeedMps;
    const c = this.windClock;

    const firstMissingId = !this.isFiniteNumber(t)
      ? 'envTempInput'
      : !this.isFiniteNumber(p)
        ? 'envPressureInput'
        : !this.isFiniteNumber(h)
          ? 'envHumidityInput'
          : !this.isFiniteNumber(w)
            ? 'envWindSpeedInput'
            : !this.isFiniteNumber(c)
              ? 'envWindClockInput'
              : null;

    if (firstMissingId) {
      this.showEnvToast('Please complete all Environment fields (numeric).');
      this.scrollToField(firstMissingId);
      return;
    }

    if (this.windClock != null) {
      let c = ((this.windClock - 1) % 12) + 1; // 1..12
      const fraction = c === 12 ? 0 : c / 12;
      const deg = Math.round(fraction * 360);
      this.environment.windDirectionDeg = deg;
    } else {
      this.environment.windDirectionDeg = undefined;
    }
    this.clearEnvToast();

    this.step = 'shots';
  }

  // Alias for template name
  backToEnvironmentStep(): void {
    this.step = 'environment';
  }

  // ---------- Shot planning step ----------
  addWholeVenueDistance(): void {
    // Only applies when no sub-range is selected (whole venue).
    if (this.subRangeId != null) return;

    const v = this.selectedVenue as any;
    if (!v) return;

    const raw = this.wholeVenueDistanceInput;
    const d = raw != null ? Number(raw) : NaN;
    if (!Number.isFinite(d) || d <= 0) {
      this.showShotsToast('Enter a valid distance (m) to add.');
      return;
    }

    const existing: number[] = Array.isArray(v.distancesM) ? (v.distancesM as number[]) : [];
    const merged = Array.from(new Set([...existing, d])).sort((a, b) => a - b);

    const updatedVenue = { ...v, distancesM: merged };
    this.data.updateVenue(updatedVenue);

    // Refresh local list so UI updates immediately
    this.venues = this.data.getVenues();
    this.wholeVenueDistanceInput = null;
    this.clearShotsToast();
  }

  toggleDistance(d: number): void {
    this.clearShotsToast();

    if (this.selectedDistances.includes(d)) {
      this.selectedDistances = this.selectedDistances.filter((x) => x !== d);
    } else {
      this.selectedDistances = [...this.selectedDistances, d].sort((a, b) => a - b);
    }
  }

  canCompleteSession(): boolean {
    return (
      this.selectedDistances.length > 0 &&
      !!this.shotCount &&
      this.shotCount > 0 &&
      !!this.notes &&
      this.notes.trim().length > 0
    );
  }

  completeSession(): void {
    this.clearShotsToast();

    const missing: string[] = [];

    if (this.selectedDistances.length === 0) {
      missing.push('distance');
    }
    if (!this.shotCount || this.shotCount <= 0) {
      missing.push('planned shots');
    }
    if (!this.notes || this.notes.trim().length === 0) {
      missing.push('comments');
    }

    if (missing.length) {
      this.showShotsToast(`Please complete: ${missing.join(', ')}.`);

      const firstMissingId =
        this.selectedDistances.length === 0
          ? 'distancePickerBlock'
          : !this.shotCount || this.shotCount <= 0
            ? 'shotCountInput'
            : !this.notes || this.notes.trim().length === 0
              ? 'sessionNotesInput'
              : null;

      if (firstMissingId) this.scrollToField(firstMissingId);

      return;
    }

    if (!this.rifleId || !this.venueId || this.venueId <= 0) {
      this.showShotsToast('Setup is incomplete. Please go back and select rifle and venue.');
      return;
    }

    // Build dope rows for each selected distance
    this.dopeRows = this.selectedDistances.map((distance) => ({
      subRangeId: this.subRangeId ?? undefined,
      distanceM: distance,
    }));
    const sessionNotesParts: string[] = [];
    if (this.notes?.trim()) {
      sessionNotesParts.push(this.notes.trim());
    }
    const sr = this.selectedSubRange;
    const countText =
      this.shotCount && this.shotCount > 0
        ? `${this.shotCount} shots planned`
        : 'Shot count not specified';

    sessionNotesParts.push(
      `${countText} at distances: ${this.selectedDistances.join(', ')} m` +
        (sr ? ` on sub-range "${sr.name}"` : ''),
    );

    const sessionToSave: any = {
      date: new Date().toISOString(),
      rifleId: this.rifleId,
      venueId: this.venueId,
      title: this.title || undefined,
      environment: this.environment,
      dope: this.dopeRows,
      notes: sessionNotesParts.join(' | '),
      voiceNoteDataUrl: this.sessionVoiceNoteDataUrl || undefined,
      completed: false,
    };

    this.data.addSession(sessionToSave);

    // increment rifle round count using planned shot count (if set)
    if (this.shotCount && this.shotCount > 0) {
      this.data.incrementRifleRoundCount(this.rifleId!, this.shotCount);
    }

    this.completeMessage =
      'Session saved to History. Go shoot! After you are done, open the History tab to enter your actual dope.';
    this.step = 'complete';
  }

  // ---------- Navigation ----------

  backToSetup(): void {
    this.step = 'setup';
  }
  onJumpToHistory(): void {
    // Optional: reset the wizard so Sessions tab is clean next time
    this.newSession();
    // Tell AppComponent to switch to History tab
    this.jumpToHistory.emit();
  }

  backToEnvironment(): void {
    this.step = 'environment';
  }

  // Called from the Step 4 button – here we just reset the wizard
  returnToMenu(): void {
    this.newSession();
    this.step = 'setup';
  }

  newSession(): void {
    this.clearEnvToast();
    this.clearShotsToast();

    this.step = 'setup';
    this.title = '';
    this.rifleId = null;
    this.venueId = null;
    this.subRangeId = null;
    this.environment = {};
    this.windClock = null;
    this.shotCount = null;
    this.selectedDistances = [];
    this.notes = '';
    // reset session voice note
    this.sessionMicInlineMessage = null;
    this.sessionVoiceNoteDataUrl = null;
    this.sessionIsRecording = false;
    this.sessionMediaRecorder = null;
    this.sessionMediaStream = null;
    this.sessionAudioChunks = [];

    this.dopeRows = [];
    this.completeMessage = '';

    this.kestrelConnected = false;
    this.kestrelStatus = 'Not connected';
    this.kestrelLastUpdate = null;
    this.kestrelData = null;
    this.kestrelError = null;
    this.kestrelIsConnecting = false;

    this.clearKestrelAutoDisconnect();
    this.kestrelDeviceId = null;

    this.rifles = this.data.getRifles();
    this.venues = this.data.getVenues();
  }
  // ---------- Session Voice Note (Mic) handlers ----------

  // ===== Venue picker (canonical, same as Venues tab) =====
  venuePickerOpen = false;
  venuePickerSearch = '';
  venuePickerFiltered: Venue[] = [];

  openVenuePicker(): void {
    this.venues = this.data.getVenues();
    this.venuePickerOpen = true;
    this.venuePickerSearch = '';
    this.updateVenuePickerFilter();
  }

  closeVenuePicker(): void {
    this.venuePickerOpen = false;
  }

  clearVenueFromPicker(): void {
    this.venueId = null;
    this.onVenueChange();
    this.closeVenuePicker();
  }

  onVenuePickerSearchChange(v: string): void {
    this.venuePickerSearch = v ?? '';
    this.updateVenuePickerFilter();
  }

  private updateVenuePickerFilter(): void {
    const q = (this.venuePickerSearch || '').toLowerCase().trim();
    const src = this.venues || [];

    if (!q) {
      this.venuePickerFiltered = [...src];
      return;
    }

    this.venuePickerFiltered = src.filter((v) => {
      const name = (v?.name || '').toLowerCase();
      const loc = (v?.location || '').toLowerCase();
      return name.includes(q) || loc.includes(q);
    });
  }

  selectVenueFromPicker(v: Venue): void {
    this.venueId = (v?.id as number) ?? null;
    this.onVenueChange();
    this.closeVenuePicker();
  }

  // ===== Sub-range picker (canonical modal, like Venues/Rifles) =====

  openSubRangePicker(): void {
    if (!this.venueId) return;
    this.venues = this.data.getVenues();

    this.subRangePickerOpen = true;
    this.subRangePickerSearch = '';
    this.updateSubRangePickerFilter();
  }

  closeSubRangePicker(): void {
    this.subRangePickerOpen = false;
  }

  clearSubRangeFromPicker(): void {
    this.subRangeId = null;
    this.selectedDistances = [];
    this.closeSubRangePicker();
  }

  onSubRangePickerSearchChange(v: string): void {
    this.subRangePickerSearch = (v ?? '').toString();
    this.updateSubRangePickerFilter();
  }

  private updateSubRangePickerFilter(): void {
    const q = (this.subRangePickerSearch || '').toLowerCase().trim();
    const src = this.subRanges || [];

    if (!q) {
      this.subRangePickerFiltered = [...src];
      return;
    }

    this.subRangePickerFiltered = src.filter((sr) => {
      const name = (sr?.name || '').toLowerCase();
      return name.includes(q);
    });
  }

  selectSubRangeFromPicker(sr: SubRange | null): void {
    this.subRangeId = sr ? ((sr?.id as number) ?? null) : null;
    this.selectedDistances = [];
    this.closeSubRangePicker();
  }

  selectedSubRangeLabel(): string {
    if (!this.venueId) return 'Select venue first';
    if (this.subRangeId == null) return 'Whole venue / no sub-range';
    return this.selectedSubRange?.name || 'Sub-range';
  }

  private async startSessionRecording(): Promise<void> {
    // Basic guard for environments without MediaRecorder
    const anyNav: any = navigator;
    if (
      !anyNav?.mediaDevices?.getUserMedia ||
      typeof (window as any).MediaRecorder === 'undefined'
    ) {
      this.sessionMicInlineMessage = 'Voice notes not supported on this device.';
      setTimeout(() => (this.sessionMicInlineMessage = null), 2500);
      return;
    }

    // Ask for mic permission
    this.sessionMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Prefer a sane mime if available
    const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    let mimeType = '';
    for (const t of preferredTypes) {
      try {
        if ((window as any).MediaRecorder.isTypeSupported?.(t)) {
          mimeType = t;
          break;
        }
      } catch {}
    }

    this.sessionAudioChunks = [];
    this.sessionMediaRecorder = new MediaRecorder(
      this.sessionMediaStream,
      mimeType ? { mimeType } : undefined,
    );

    this.sessionMediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.sessionAudioChunks.push(event.data);
    };

    this.sessionMediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(this.sessionAudioChunks, {
          type: this.sessionMediaRecorder?.mimeType || 'audio/webm',
        });
        this.sessionVoiceNoteDataUrl = await this.blobToDataUrl(blob);

        this.sessionMicInlineMessage = 'Voice note saved';
        setTimeout(() => (this.sessionMicInlineMessage = null), 1500);
      } catch (e) {
        console.error(e);
        this.sessionMicInlineMessage = 'Could not save voice note.';
        setTimeout(() => (this.sessionMicInlineMessage = null), 2500);
      } finally {
        // Stop tracks to release mic
        this.sessionMediaStream?.getTracks()?.forEach((t) => t.stop());
        this.sessionMediaStream = null;
        this.sessionMediaRecorder = null;
        this.sessionAudioChunks = [];
      }
    };

    this.sessionMediaRecorder.start();
    this.sessionIsRecording = true;

    this.sessionMicInlineMessage = 'Recording… tap again to stop';
  }

  private async stopSessionRecording(): Promise<void> {
    if (this.sessionMediaRecorder && this.sessionIsRecording) {
      this.sessionIsRecording = false;
      this.sessionMicInlineMessage = 'Stopping…';
      this.sessionMediaRecorder.stop();
    }
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    });
  }

  onBackFromHistory() {
    this.backToMenu.emit();
  }
}
