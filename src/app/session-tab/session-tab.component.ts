import { CommonModule } from '@angular/common';
import { Component, OnInit, Output, EventEmitter, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../data.service';
import {
  Rifle,
  Venue,
  SubRange,
  Environment,
  DistanceDope,
  Session
} from '../models';
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
  styleUrls: ['./session-tab.component.css']
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

  title = '';
  environment: Environment = {};

  // Wind clock (1–12, relative to target at 12)
  windClock: number | null = null;

  shotCount: number | null = null;
  selectedDistances: number[] = [];
  notes = '';
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
 public kestrel: KestrelService = inject(KestrelService)


  // Track current device + auto-disconnect timer
  private kestrelDeviceId: string | null = null;
  private kestrelAutoDisconnectTimer: any | null = null;

  constructor(private data: DataService) {}

  ngOnInit(): void {
    this.rifles = this.data.getRifles();
    this.venues = this.data.getVenues();
  }

  // ---------- Derived getters ----------

  get selectedVenue(): Venue | undefined {
    return this.venues.find(v => v.id === this.venueId);
  }

  get subRanges(): SubRange[] {
    const v = this.selectedVenue;
    return v?.subRanges ?? [];
  }

  get selectedSubRange(): SubRange | undefined {
    const list = this.subRanges;
    return list.find(sr => sr.id === this.subRangeId);
  }

  get distanceOptions(): number[] {
    const sr = this.selectedSubRange;
    return sr?.distancesM ?? [];
  }

  get windHint(): string {
    const speed = this.environment.windSpeedMps;
    let clock = this.windClock;
    if (!clock || !speed || speed <= 0) return '';

    // Normalize clock to 1..12
    clock = ((clock - 1) % 12) + 1;

    const c = clock;
    const isFront = c === 11 || c === 12 || c === 1;
    const isBack = c === 5 || c === 6 || c === 7;
    const isRight = c >= 1 && c <= 5;   // wind from right side
    const isLeft = c >= 7 && c <= 11;   // wind from left side

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
    if (speed < 2) intensity = 'Very light wind – small effect.';
    else if (speed < 5) intensity = 'Light wind – moderate correction.';
    else if (speed < 8) intensity = 'Medium wind – expect noticeable drift.';
    else intensity = 'Strong wind – expect significant drift.';

    // Note: variable is named windSpeedMps but we describe in mph here; keep text as-is for now.
    return `Wind from ${c} o'clock at ${speed} mph: expect ${directionText}. ${intensity}`;
  }

  // Called by (ngModelChange) in the template – logic is in the getter
  updateWindHint(): void {
    // no-op: windHint is computed on the fly
  }

  // ---------- Setup step ----------

  onVenueChange(): void {
    const srs = this.subRanges;
    if (srs.length > 0) {
      this.subRangeId = srs[0].id;
    } else {
      this.subRangeId = null;
    }
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

    this.step = 'environment';
  }

  cancelSession(): void {
    this.newSession();
    this.step = 'setup';
  }

  // ---------- Kestrel integration ----------

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    if (this.windClock != null) {
      let c = ((this.windClock - 1) % 12) + 1; // 1..12
      const fraction = c === 12 ? 0 : c / 12;
      const deg = Math.round(fraction * 360);
      this.environment.windDirectionDeg = deg;
    } else {
      this.environment.windDirectionDeg = undefined;
    }

    this.step = 'shots';
  }

  // Alias for template name
  backToEnvironmentStep(): void {
    this.step = 'environment';
  }

  // ---------- Shot planning step ----------

  toggleDistance(d: number): void {
    if (this.selectedDistances.includes(d)) {
      this.selectedDistances = this.selectedDistances.filter(x => x !== d);
    } else {
      this.selectedDistances = [...this.selectedDistances, d].sort((a, b) => a - b);
    }
  }

  canCompleteSession(): boolean {
    return this.selectedDistances.length > 0;
  }

  completeSession(): void {
    if (this.selectedDistances.length === 0) {
      alert('Select at least one distance to shoot.');
      return;
    }
    if (!this.rifleId || !this.venueId) {
      alert('Setup is incomplete. Please go back and select rifle and venue.');
      return;
    }

    // Build dope rows for each selected distance
    this.dopeRows = this.selectedDistances.map(distance => ({
      subRangeId: this.subRangeId ?? undefined,
      distanceM: distance
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
        (sr ? ` on sub-range "${sr.name}"` : '')
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
      completed: false
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
  }  onJumpToHistory(): void {
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

 

  private async startSessionRecording(): Promise<void> {
    // Basic guard for environments without MediaRecorder
    const anyNav: any = navigator;
    if (!anyNav?.mediaDevices?.getUserMedia || typeof (window as any).MediaRecorder === 'undefined') {
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
    this.sessionMediaRecorder = new MediaRecorder(this.sessionMediaStream, mimeType ? { mimeType } : undefined);

    this.sessionMediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.sessionAudioChunks.push(event.data);
    };

    this.sessionMediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(this.sessionAudioChunks, { type: this.sessionMediaRecorder?.mimeType || 'audio/webm' });
        this.sessionVoiceNoteDataUrl = await this.blobToDataUrl(blob);

        this.sessionMicInlineMessage = 'Voice note saved';
        setTimeout(() => (this.sessionMicInlineMessage = null), 1500);
      } catch (e) {
        console.error(e);
        this.sessionMicInlineMessage = 'Could not save voice note.';
        setTimeout(() => (this.sessionMicInlineMessage = null), 2500);
      } finally {
        // Stop tracks to release mic
        this.sessionMediaStream?.getTracks()?.forEach(t => t.stop());
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
