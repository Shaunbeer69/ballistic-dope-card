import { CommonModule } from '@angular/common';
import { Component, OnInit, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../data.service';
import { Capacitor } from '@capacitor/core';
import { CapacitorVoiceRecorder } from '@lgicc/capacitor-voice-recorder';

@Component({
  selector: 'app-history-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './history-tab.component.html'
})
export class HistoryTabComponent implements OnInit {
  sessions: any[] = [];
  // NEW: highlighted sessions that still need DOPE capture
  pendingSessions: any[] = [];
  notesExpanded: boolean = false;
  selectedSessionId: string | null = null;
  editSession: any | null = null;
  validationError: string | null = null;
  saveMessage: string | null = null;
  private saveMessageTimeout: any = null;
  // --------------------------------------------------
  // Voice notes (per DOPE row)
  // --------------------------------------------------
   // --------------------------------------------------
  // Voice notes (per-distance row in Shot Data input)
  // Stored on the DOPE row as base64 for playback
  // --------------------------------------------------
  private activeVoiceRow: any | null = null;
  private recordingRowRef: any | null = null;


  searchTerm: string = '';
  expandedVenueId: number | null = null;
  // --------------------------------------------------
  // Voice notes per DOPE row (same plugin as Load Dev)
  // --------------------------------------------------
  private micTargetRow: any | null = null;
  private rowRecording = false;

  // Kept only to satisfy older references (safe no-op)
  micRecorder: any = null;

  isRowRecording(row: any): boolean {
    return !!row && this.rowRecording && this.micTargetRow === row;
  }

  hasRowVoice(row: any): boolean {
    const b64 = (row?.voiceNoteBase64 ?? '').toString().trim();
    return !!b64;
  }

  rowVoiceDataUrl(row: any): string | null {
    const base64 = (row?.voiceNoteBase64 ?? '').toString().trim();
    if (!base64) return null;
    return `data:audio/wav;base64,${base64}`;
  }

  async onRowMicClick(row: any, ev?: Event): Promise<void> {
    try {
      ev?.stopPropagation?.();
      ev?.preventDefault?.();
    } catch {}

    if (!row) return;

    try {
      // If recording for THIS row -> stop & save
      if (this.rowRecording && this.micTargetRow === row) {
        const result = await CapacitorVoiceRecorder.stopRecording();
        this.rowRecording = false;
        this.micTargetRow = null;

        const base64 = (result?.base64 ?? '').toString().trim();
        const msDuration = Number(result?.msDuration ?? 0);

        if (!base64) {
          this.showSaveMessage('No audio captured');
          return;
        }

        row.voiceNoteBase64 = base64;
        row.voiceNoteDurationMs =
          Number.isFinite(msDuration) && msDuration > 0 ? msDuration : undefined;

        // The row is part of editSession; your existing Save button persists via updateSession()
        this.showSaveMessage('Voice note saved (tap Save)');
        return;
      }

      // If recording for ANOTHER row -> stop it first (and discard)
      if (this.rowRecording && this.micTargetRow && this.micTargetRow !== row) {
        try {
          await CapacitorVoiceRecorder.stopRecording();
        } catch {}
        this.rowRecording = false;
        this.micTargetRow = null;
      }

      // Ensure mic permission (same style as Load Dev, but FIXED logic)
      const can = await CapacitorVoiceRecorder.canRecord();
      const status = (can as any)?.status;

      if (status !== 'GRANTED') {
        const perm = await CapacitorVoiceRecorder.requestPermission();
        if (!(perm as any)?.isGranted) {
          this.showSaveMessage('Microphone permission denied or not available.');
          return;
        }
      }

      await CapacitorVoiceRecorder.startRecording();
      this.micTargetRow = row;
      this.rowRecording = true;
      this.showSaveMessage('Recording… tap ⏹ to stop');
    } catch (err) {
      console.error('History row voice note error:', err);
      this.rowRecording = false;
      this.micTargetRow = null;
      this.showSaveMessage('Microphone permission denied or not available.');
    }
  }

  // 🔸 Tell parent when user presses Back
  @Output() backToMenu = new EventEmitter<void>();

  constructor(private dataService: DataService) {}

  ngOnInit(): void {
    this.loadSessions();
  }

  private loadSessions(): void {
    try {
      const ds: any = this.dataService;
      if (ds && typeof ds.getSessions === 'function') {
        this.sessions = ds.getSessions() || [];
      } else if (ds && typeof ds.loadSessions === 'function') {
        this.sessions = ds.loadSessions() || [];
      } else {
        console.warn('DataService has no getSessions/loadSessions – using empty history.');
        this.sessions = [];
      }
    } catch (err) {
      console.error('Error loading sessions in HistoryTab:', err);
      this.sessions = [];
    }

    this.rebuildPendingSessions();
  }

  // --------------------------------------------------
  // Status helpers
  // --------------------------------------------------
  getStatusLabel(s: any): string {
    if (s.completed) return 'Completed';
    if (s.dope && s.dope.length > 0) return 'In progress';
    return 'Planned';
  }

  getStatusClass(s: any): string {
    const base = 'px-2 py-[2px] rounded-full text-[10px] font-semibold ';
    if (s.completed) {
      return base + 'bg-emerald-500 text-slate-900';
    }
    if (s.dope && s.dope.length > 0) {
      return base + 'bg-amber-400 text-slate-900';
    }
    return base + 'bg-slate-600 text-slate-100';
  }

  // --------------------------------------------------
  // Rifle / venue lookup helpers
  // --------------------------------------------------
  getRifleName(rifleId: string | null | undefined): string {
    try {
      const ds: any = this.dataService;
      if (!rifleId || !ds || typeof ds.getRifles !== 'function') {
        return 'Unknown rifle';
      }
      const rifle = ds.getRifles().find((r: any) => r.id === rifleId);
      return rifle ? rifle.name : 'Unknown rifle';
    } catch {
      return 'Unknown rifle';
    }
  }

  getVenueName(venueId: string | null | undefined): string {
    try {
      const ds: any = this.dataService;
      if (!venueId || !ds || typeof ds.getVenues !== 'function') {
        return 'Unknown venue';
      }
      const venue = ds.getVenues().find((v: any) => v.id === venueId);
      return venue ? venue.name : 'Unknown venue';
    } catch {
      return 'Unknown venue';
    }
  }

  // --------------------------------------------------
  // Search & grouping for venue-based history view
  // --------------------------------------------------
  get filteredSessions(): any[] {
    // History list only shows non-editable sessions.
    const base = (this.sessions || []).filter(
      (s: any) => !this.isSessionEditable(s)
    );

    const term = this.searchTerm?.trim().toLowerCase();
    if (!term) {
      return base;
    }

    return base.filter((s: any) => {
      const venueName = (this.getVenueName(s.venueId) || '').toLowerCase();
      const rifleName = (this.getRifleName(s.rifleId) || '').toLowerCase();
      const title = (s.title || '').toLowerCase();
      const notes = (s.notes || '').toLowerCase();
      return (
        venueName.includes(term) ||
        rifleName.includes(term) ||
        title.includes(term) ||
        notes.includes(term)
      );
    });
  }

  get venueGroups(): { venueId: number | null; venueName: string; sessions: any[] }[] {
    const map = new Map<number | null, { venueId: number | null; venueName: string; sessions: any[] }>();

    for (const s of this.filteredSessions) {
      const vid = (s.venueId ?? null) as number | null;
      const vname = this.getVenueName(s.venueId) || 'Unknown venue';
      let group = map.get(vid);
      if (!group) {
        group = { venueId: vid, venueName: vname, sessions: [] };
        map.set(vid, group);
      }
      group.sessions.push(s);
    }

    const groups = Array.from(map.values());

    // sort sessions in each group by date (oldest → newest)
    for (const g of groups) {
      g.sessions.sort((a, b) => this.getSessionTime(a) - this.getSessionTime(b));
    }

    // sort venues alphabetically
    groups.sort((a, b) => a.venueName.localeCompare(b.venueName));
    return groups;
  }

  private getSessionTime(s: any): number {
    if (!s || !s.date) return 0;
    return new Date(s.date).getTime();
  }

  // Build the “needs DOPE” list (highlighted at top)
  private rebuildPendingSessions(): void {
    if (!Array.isArray(this.sessions)) {
      this.pendingSessions = [];
      return;
    }

    this.pendingSessions = this.sessions
      .filter(s => this.isSessionEditable(s) && !s.completed)
      .sort((a, b) => this.getSessionTime(b) - this.getSessionTime(a)); // newest first
  }

  clearSearch(): void {
    this.searchTerm = '';
  }

  toggleVenue(venueId: number | null): void {
    this.expandedVenueId = this.expandedVenueId === venueId ? null : venueId;
  }

  summarizeDateRange(sessions: any[]): string {
    if (!sessions || sessions.length === 0) return '';
    const sorted = [...sessions].sort((a, b) => this.getSessionTime(a) - this.getSessionTime(b));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const firstDate = new Date(first.date);
    const lastDate = new Date(last.date);
    const firstStr = firstDate.toLocaleDateString();
    const lastStr = lastDate.toLocaleDateString();
    if (firstStr === lastStr) {
      return firstStr;
    }
    return `${firstStr} → ${lastStr}`;
  }

  // --------------------------------------------------
  // Selecting / deleting sessions
  // --------------------------------------------------
  selectSession(s: any): void {
    this.selectedSessionId = s.id;
    this.validationError = null;
    this.clearSaveMessage();

    // Deep clone so we can edit safely
    this.editSession = JSON.parse(JSON.stringify(s));
  }

  deleteSession(s: any): void {
    if (!s || !s.id) return;

    const confirmed = confirm(
      'Delete this session from history? This cannot be undone.'
    );
    if (!confirmed) return;

    const id = s.id;

    // Remove from local sessions array
    const idx = this.sessions.findIndex(sess => sess.id === id);
    if (idx >= 0) {
      this.sessions.splice(idx, 1);
    }

    // Persist via DataService
    try {
      const ds: any = this.dataService;
      if (ds && typeof ds.deleteSession === 'function') {
        ds.deleteSession(id);
      }
    } catch (err) {
      console.error('Error deleting session from DataService:', err);
    }

    // If this was the open session, close the detail view
    if (this.selectedSessionId === id) {
      this.selectedSessionId = null;
      this.editSession = null;
    }

    // refresh yellow block at the top
    this.rebuildPendingSessions();
  }

  // --------------------------------------------------
  // Editable rules for DOPE
  // --------------------------------------------------

  isSessionEditable(session: any | null): boolean {
    return !!(
      session &&
      !session.completed &&
      Array.isArray(session.dope) &&
      session.dope.length > 0
    );
  }

  isSessionFullyCompleted(session: any | null): boolean {
    if (
      !session ||
      !Array.isArray(session.dope) ||
      session.dope.length === 0
    ) {
      return false;
    }
    return !session.dope.some((row: any) => !this.isRowComplete(row));
  }

  private isRowComplete(row: any): boolean {
    if (!row) return false;
    if (row.distanceM == null) return false;
    if (row.elevationMil === null || row.elevationMil === undefined || row.elevationMil === '') return false;
    if (row.windageMil === null || row.windageMil === undefined || row.windageMil === '') return false;
    if (row.windSpeed === null || row.windSpeed === undefined || row.windSpeed === '') return false;
    if (row.windDirection === null || row.windDirection === undefined || row.windDirection === '') return false;
    return true;
  }

  // --------------------------------------------------
  // Wind auto-fill & helpers
  // --------------------------------------------------
  autoFillWindFromEnvironment(): void {
    if (!this.editSession || !this.editSession.environment || !Array.isArray(this.editSession.dope)) {
      return;
    }

    const env = this.editSession.environment;

    const envWindSpeed =
      env.windSpeedMps ??
      env.windSpeedKph ??
      env.windSpeedMph ??
      null;

    let envClock: number | null = null;

    if (env.windDirectionDeg != null) {
      envClock = this.degreesToClock(env.windDirectionDeg);
    } else {
      let envWindDirRaw: any = env.windDirection ?? null;
      if (envWindDirRaw != null) {
        if (typeof envWindDirRaw === 'number') {
          envClock = this.degreesToClock(envWindDirRaw);
        } else {
          const str = String(envWindDirRaw);
          const parsed = parseFloat(str);
          if (!isNaN(parsed)) {
            if (parsed > 12 || str.includes('°')) {
              // treat as degrees
              envClock = this.degreesToClock(parsed);
            } else {
              // already a clock value
              envClock = parsed;
            }
          }
        }
      }
    }

    for (const row of this.editSession.dope) {
      if (row.windSpeed == null && envWindSpeed != null) {
        row.windSpeed = envWindSpeed;
        row._windSpeedAuto = true;
      }
      if (row.windDirection == null && envClock != null) {
        row.windDirection = envClock.toString();
        row._windDirectionAuto = true;
      }
    }
  }

  wasAutoFilled(row: any, field: 'windSpeed' | 'windDirection'): boolean {
    if (!row) return false;
    return field === 'windSpeed' ? !!row._windSpeedAuto : !!row._windDirectionAuto;
  }

  private degreesToArrow(deg: number): string {
    const normalized = ((deg % 360) + 360) % 360;

    if (normalized >= 337.5 || normalized < 22.5) return '↑';
    if (normalized >= 22.5 && normalized < 67.5) return '↗';
    if (normalized >= 67.5 && normalized < 112.5) return '→';
    if (normalized >= 112.5 && normalized < 157.5) return '↘';
    if (normalized >= 157.5 && normalized < 202.5) return '↓';
    if (normalized >= 202.5 && normalized < 247.5) return '↙';
    if (normalized >= 247.5 && normalized < 292.5) return '←';
    return '↖';
  }

  private clockToDegrees(clock: number): number {
    let c = clock;
    if (c < 1) c = 1;
    if (c > 12) c = 12;
    return (c % 12) * 30;
  }

  private degreesToClock(deg: number): number {
    let d = ((deg % 360) + 360) % 360;
    const hour = Math.round(d / 30) % 12 || 12;
    return hour;
  }

  getWindArrow(row: any): string {
    if (!row) return '•';

    let dirRaw: any = row.windDirection;

    if (dirRaw == null && this.editSession?.environment) {
      dirRaw =
        this.editSession.environment.windDirectionDeg ??
        this.editSession.environment.windDirection ??
        null;
    }

    if (dirRaw == null) return '•';

    const str = String(dirRaw).trim();

    if (str.includes("o'clock")) {
      const num = parseFloat(str);
      if (!isNaN(num) && num >= 1 && num <= 12) {
        const degFromClock = this.clockToDegrees(num);
        return this.degreesToArrow(degFromClock);
      }
    }

    const num = parseFloat(str);
    if (!isNaN(num)) {
      if (num >= 1 && num <= 12 && !str.includes('°')) {
        const degFromClock = this.clockToDegrees(num);
        return this.degreesToArrow(degFromClock);
      }
      return this.degreesToArrow(num);
    }

    return '•';
    
  }
  // --------------------------------------------------
  // Voice notes (record + store on row)
  // --------------------------------------------------
  hasRowVoiceNote(row: any): boolean {
    const b64 = (row?.voiceNoteBase64 ?? '').toString().trim();
    return b64.length > 0;
  }

  isRecordingRow(row: any): boolean {
    return !!this.micRecorder && this.micTargetRow === row;
  }

  rowVoiceNoteSrc(row: any): string | null {
    const dataUrl = (row?.voiceNoteDataUrl ?? '').toString().trim();
    if (dataUrl) return dataUrl;

    const b64 = (row?.voiceNoteBase64 ?? '').toString().trim();
    if (!b64) return null;

       const mime = (row?.voiceNoteMime ?? 'audio/aac').toString().trim() || 'audio/aac';

    return `data:${mime};base64,${b64}`;
  }

    async onRowVoiceNoteClick(row: any, ev?: Event): Promise<void> {
    try {
      ev?.stopPropagation();
      ev?.preventDefault();

      if (!this.editSession || !this.isSessionEditable(this.editSession)) return;

      // Tap same row while recording => stop & save
      if (this.isRowRecording(row)) {
        await this.stopAndSaveRowRecording();
        return;
      }

      // If recording another row, stop & save it first
      if (this.recordingRowRef) {
        await this.stopAndSaveRowRecording();
      }

      // Native (Capacitor) recording: SAME approach as Load Dev
      const { status } = await CapacitorVoiceRecorder.canRecord();
      if (status !== 'GRANTED') {
        const perm = await CapacitorVoiceRecorder.requestPermission();
        if (!perm?.isGranted) {
          alert('Microphone permission denied or not available.');
          this.activeVoiceRow = null;
          this.recordingRowRef = null;
          return;
        }
      }

      await CapacitorVoiceRecorder.startRecording();
      this.activeVoiceRow = row;
      this.recordingRowRef = row;
    } catch (err) {
      console.warn('Voice note start failed:', err);
      alert('Microphone permission denied or not available.');
      this.activeVoiceRow = null;
      this.recordingRowRef = null;
    }
  }

  private async stopAndSaveRowRecording(): Promise<void> {
    const row = this.activeVoiceRow;

    try {
      const result: any = await CapacitorVoiceRecorder.stopRecording();

      this.activeVoiceRow = null;
      this.recordingRowRef = null;

      const base64 = (result?.base64 ?? '').toString().trim();
      const msDuration = Number(result?.msDuration ?? 0);

      if (!row || !base64) return;

      // Store ON THE ROW (persists with normal session Save)
      row.voiceNoteBase64 = base64;
      row.voiceNoteMime = (result?.mimeType ?? 'audio/aac').toString().trim() || 'audio/aac';
      row.voiceNoteRecordedAt = new Date().toISOString();
      row.voiceNoteDurationMs =
        Number.isFinite(msDuration) && msDuration > 0 ? msDuration : null;
    } catch (err) {
      console.warn('stopAndSaveRowRecording failed:', err);
      this.activeVoiceRow = null;
      this.recordingRowRef = null;
    }
  }

  deleteRowVoiceNote(row: any, ev?: Event): void {
    ev?.stopPropagation();
    ev?.preventDefault();

    // If deleting while recording this row, stop first
    if (this.isRowRecording(row)) {
      this.stopAndSaveRowRecording();
    }

    row.voiceNoteBase64 = null;
    row.voiceNoteMime = null;
    row.voiceNoteRecordedAt = null;
    row.voiceNoteDurationMs = null;
  }

  private pickSupportedAudioMimeType(): string | null {
    const MR: any = (window as any).MediaRecorder;
    if (!MR || typeof MR.isTypeSupported !== 'function') return null;

    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg'
    ];

    for (const c of candidates) {
      try {
        if (MR.isTypeSupported(c)) return c;
      } catch {}
    }
    return null;
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error);
      r.onload = () => {
        const res = (r.result || '').toString();
        const idx = res.indexOf('base64,');
        resolve(idx >= 0 ? res.slice(idx + 7) : '');
      };
      r.readAsDataURL(blob);
    });
  }

  // --------------------------------------------------
  // Save logic (in-progress vs completed)
  // --------------------------------------------------
  onPrimarySaveClick(): void {
    if (!this.editSession) return;

    if (!this.isSessionEditable(this.editSession)) {
      return;
    }

    if (!this.isSessionFullyCompleted(this.editSession)) {
      this.saveInProgress();
      return;
    }

    this.saveAndComplete();
  }

  private saveInProgress(): void {
    if (!this.editSession) return;

    this.validationError = null;

    const idx = this.sessions.findIndex(s => s.id === this.editSession!.id);
    if (idx >= 0) {
      this.sessions[idx] = { ...this.editSession, completed: false };
      this.persistSessions();
      this.rebuildPendingSessions();
      this.showSaveMessage('Session saved (In progress).');
    }
  }

  private saveAndComplete(): void {
    if (!this.editSession) return;

    if (!this.isSessionFullyCompleted(this.editSession)) {
      this.validationError = 'Please fill all DOPE fields (elevation, wind, speed, direction).';
      return;
    }

    this.validationError = null;

    const idx = this.sessions.findIndex(s => s.id === this.editSession!.id);
    if (idx >= 0) {
      this.sessions[idx] = { ...this.editSession, completed: true };
      this.persistSessions();
      this.rebuildPendingSessions();
      this.showSaveMessage('Session saved & marked as completed.');

      this.editSession = null;
      this.selectedSessionId = null;
      this.expandedVenueId = null;
    }
  }

  private persistSessions(): void {
    try {
      const ds: any = this.dataService;
      if (ds && typeof ds.updateSession === 'function') {
        for (const s of this.sessions) {
          ds.updateSession(s);
        }
      }
    } catch (err) {
      console.error('Error persisting sessions from HistoryTab:', err);
    }
  }

  private showSaveMessage(msg: string): void {
    this.saveMessage = msg;
    if (this.saveMessageTimeout) {
      clearTimeout(this.saveMessageTimeout);
    }
    this.saveMessageTimeout = setTimeout(() => {
      this.saveMessage = null;
      this.saveMessageTimeout = null;
    }, 2500);
  }

  private clearSaveMessage(): void {
    if (this.saveMessageTimeout) {
      clearTimeout(this.saveMessageTimeout);
      this.saveMessageTimeout = null;
    }
    this.saveMessage = null;
  }

  // --------------------------------------------------
  // Back from main History list
  // --------------------------------------------------
  onBackFromHistory(): void {
    // Reset local History-tab state
    this.closeEdit();
    this.selectedSessionId = null;
    this.expandedVenueId = null;

    // 🔸 Tell the parent "please go back to Menu tab"
    this.backToMenu.emit();
  }

  // --------------------------------------------------
  // Closing detail
  // --------------------------------------------------
  closeEdit(): void {
    this.editSession = null;
    this.validationError = null;
    this.clearSaveMessage();
  }
}
