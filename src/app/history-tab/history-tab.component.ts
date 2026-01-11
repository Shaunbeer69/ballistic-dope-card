import { CommonModule } from '@angular/common';
import { Component, OnInit, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../data.service';
import { CapacitorVoiceRecorder } from '@lgicc/capacitor-voice-recorder';

@Component({
  selector: 'app-history-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './history-tab.component.html'
})
export class HistoryTabComponent implements OnInit {
  sessions: any[] = [];

  // highlighted sessions that still need DOPE capture
  pendingSessions: any[] = [];

  selectedSessionId: string | null = null;
  editSession: any | null = null;

  validationError: string | null = null;
  saveMessage: string | null = null;
  private saveMessageTimeout: any = null;

  searchTerm: string = '';
  expandedVenueId: number | null = null;
    // PERF: avoid rebuilding massive data: URLs on every change detection tick
  private rowVoiceUrlCache = new WeakMap<any, { b64: string; url: string }>();

onAveVelEnter(ev: Event): void {
  ev.preventDefault();

  // First Elev input in the table (your file already marks it with #elevFirst)
  const el = document.querySelector('#elevFirst') as HTMLInputElement | null;

  el?.focus();
}


focusNotes(row: any): void {
  setTimeout(() => {
    const el = document.querySelector(
      'textarea[placeholder="Notes (optional)"]'
    ) as HTMLTextAreaElement | null;

    el?.focus();
  }, 0);
}
  private focusById(id: string | null | undefined): void {
    if (!id) return;
    setTimeout(() => {
      const el = document.getElementById(id) as any;
      el?.focus?.();
    }, 0);
  }

  private toNumber(val: any): number {
    if (val === null || val === undefined) return NaN;
    if (typeof val === 'number') return val;
    const n = Number(String(val).trim());
    return n;
  }

  /**
   * Apply History defaults:
   * - Wind Dir default = "3" if empty
   * - Wind Speed stored as MPH (autofill from environment windSpeedMps if present)
   */
  private applyHistoryDefaults(session: any | null): void {
    if (!session || !Array.isArray(session.dope)) return;

    // Ensure notes is at least a string (required will be validated separately)
    if (session.notes === null || session.notes === undefined) session.notes = '';

    const env = session.environment || {};
    const mpsRaw = env.windSpeedMps ?? env.windSpeed ?? null;
    const mps = this.toNumber(mpsRaw);
    const mphFromEnv = Number.isFinite(mps) ? mps * 2.2369362920544 : NaN;

    for (const row of session.dope) {
      if (!row) continue;

      // Default wind direction = 3 o'clock
      if (row.windDirection === null || row.windDirection === undefined || String(row.windDirection).trim() === '') {
        row.windDirection = '3';
        row._windDirectionAuto = true;
      }

      // Autofill wind speed in MPH from environment if empty
      if (row.windSpeed === null || row.windSpeed === undefined || String(row.windSpeed).trim() === '') {
        if (Number.isFinite(mphFromEnv)) {
          row.windSpeed = Math.round(mphFromEnv * 10) / 10; // 1 decimal
          row._windSpeedAuto = true;
        }
      }
    }
  }

  private validateRequiredFields(session: any | null): { ok: boolean; message?: string; focusId?: string } {
    if (!session) return { ok: false, message: 'No session selected.' };

    // Ave Vel required
    const av = this.toNumber(session.averageVelocity);
    if (!Number.isFinite(av) || av <= 0) {
      return { ok: false, message: 'Required: Ave Vel (fps).', focusId: 'aveVelInput' };
    }

    // DOPE fields required for ALL rows
    if (!Array.isArray(session.dope) || session.dope.length === 0) {
      return { ok: false, message: 'No DOPE rows found.' };
    }

    for (let i = 0; i < session.dope.length; i++) {
      const row = session.dope[i];
      const elev = this.toNumber(row?.elevationMil);
      const wind = this.toNumber(row?.windageMil);
      const wspd = this.toNumber(row?.windSpeed);
      const wdir = row?.windDirection;

      if (!Number.isFinite(elev)) return { ok: false, message: 'Required: Elev (mil).', focusId: 'elevFirst' };
      if (!Number.isFinite(wind)) return { ok: false, message: 'Required: Wind (mil).', focusId: 'windFirst' };
      if (!Number.isFinite(wspd)) return { ok: false, message: 'Required: W Speed (mph).', focusId: 'wspdFirst' };
      if (wdir === null || wdir === undefined || String(wdir).trim() === '') {
        return { ok: false, message: 'Required: Wind Dir (clock).', focusId: 'wdirFirst' };
      }
    }

    // Global notes required
    const notes = (session.notes ?? '').toString().trim();
    if (!notes) {
      return { ok: false, message: 'Required: Notes (Global Session notes).', focusId: 'sessionNotesInput' };
    }

    return { ok: true };
  }

  // --------------------------------------------------
  // Voice notes per DOPE row (record + store on DOPE row)
  // --------------------------------------------------
  private micTargetRow: any | null = null;
  private rowRecording = false;

  @Output() backToMenu = new EventEmitter<void>();

  constructor(private dataService: DataService) {}

  ngOnInit(): void {
    this.loadSessions();
  }

  // --------------------------------------------------
  // Load sessions
  // --------------------------------------------------
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
    if (s?.completed) return 'Completed';
    if (s?.dope && s.dope.length > 0) return 'In progress';
    return 'Planned';
  }

  getStatusClass(s: any): string {
    const base = 'px-2 py-[2px] rounded-full text-[10px] font-semibold ';
    if (s?.completed) return base + 'bg-emerald-500 text-slate-900';
    if (s?.dope && s.dope.length > 0) return base + 'bg-amber-400 text-slate-900';
    return base + 'bg-slate-600 text-slate-100';
  }

  // --------------------------------------------------
  // Rifle / venue lookup helpers
  // --------------------------------------------------
  getRifleName(rifleId: string | null | undefined): string {
    try {
      const ds: any = this.dataService;
      if (!rifleId || !ds || typeof ds.getRifles !== 'function') return 'Unknown rifle';
      const rifle = ds.getRifles().find((r: any) => String(r.id) === String(rifleId));
      return rifle ? rifle.name : 'Unknown rifle';
    } catch {
      return 'Unknown rifle';
    }
  }

  getVenueName(venueId: string | null | undefined): string {
    try {
      const ds: any = this.dataService;
      if (!venueId || !ds || typeof ds.getVenues !== 'function') return 'Unknown venue';
      const venue = ds.getVenues().find((v: any) => String(v.id) === String(venueId));
      return venue ? venue.name : 'Unknown venue';
    } catch {
      return 'Unknown venue';
    }
  }

  // --------------------------------------------------
  // Search & grouping (read-only history list)
  // --------------------------------------------------
  get filteredSessions(): any[] {
    const base = (this.sessions || []).filter((s: any) => !this.isSessionEditable(s));
    const term = this.searchTerm?.trim().toLowerCase();
   if (!term)    return [...base].sort((a, b) => this.getSessionTime(b) - this.getSessionTime(a));
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

    // sessions oldest → newest
    for (const g of groups) {
  g.sessions.sort((a, b) => this.getSessionTime(b) - this.getSessionTime(a));

    }

    // venues alphabetical
    groups.sort((a, b) => a.venueName.localeCompare(b.venueName));
    return groups;
  }

  private getSessionTime(s: any): number {
    if (!s || !s.date) return 0;
    return new Date(s.date).getTime();
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
    const firstStr = new Date(first.date).toLocaleDateString();
    const lastStr = new Date(last.date).toLocaleDateString();
    return firstStr === lastStr ? firstStr : `${firstStr} → ${lastStr}`;
  }

  // --------------------------------------------------
  // Pending sessions (needs DOPE)
  // --------------------------------------------------
  private rebuildPendingSessions(): void {
    if (!Array.isArray(this.sessions)) {
      this.pendingSessions = [];
      return;
    }

    this.pendingSessions = this.sessions
      .filter((s: any) => this.isSessionEditable(s) && !s.completed)
      .sort((a: any, b: any) => this.getSessionTime(b) - this.getSessionTime(a)); // newest first
  }

  // --------------------------------------------------
  // Selecting / deleting sessions
  // --------------------------------------------------
selectSession(s: any): void {
  const idStr = (s?.id ?? '').toString();
  this.selectedSessionId = idStr;

  // Keep a copy for editing
  this.editSession = JSON.parse(JSON.stringify(s));

  // Apply History defaults (Wind Dir=3, W Speed MPH autofill)
  this.applyHistoryDefaults(this.editSession);

  this.validationError = null;
  this.clearSaveMessage();
}


deleteSession(s: any): void {
  const idNum = Number(s?.id);

  if (!Number.isFinite(idNum)) {
    console.error('deleteSession: invalid session id:', s?.id);
    return;
  }

  const ok = confirm('Delete this session from history? This cannot be undone.');
  if (!ok) return;

  try {
    // 1) Delete from persistent store
    this.dataService.deleteSession(idNum);

    // 2) Delete from in-memory list (so UI updates immediately)
    this.sessions = (this.sessions || []).filter((x: any) => Number(x?.id) !== idNum);

    // 3) Collapse detail screen back to list
    this.editSession = null;
    this.selectedSessionId = null;

    // 4) Rebuild any derived lists you use
    this.rebuildPendingSessions?.();
  } catch (err) {
    console.error('Error deleting session from DataService:', err);
  }
}


private purgeSessionFromLocalStorage(idStr: string, idNum: number | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k) keys.push(k);
  }

  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;

    // Only consider JSON arrays
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) continue;

    // Only touch arrays of objects that look like sessions (have id)
    const looksLikeArrayOfIdObjects =
      parsed.every((x: any) => x && typeof x === 'object' && ('id' in x));

    if (!looksLikeArrayOfIdObjects) continue;

    const beforeLen = parsed.length;

    const filtered = parsed.filter((x: any) => {
      const xIdStr = String(x?.id);
      if (xIdStr === idStr) return false;

      // Also remove numeric-equal if idNum is valid (covers "1" vs 1 mismatches)
      if (idNum != null) {
        const xIdNum = Number(x?.id);
        if (Number.isFinite(xIdNum) && xIdNum === idNum) return false;
      }

      return true;
    });

    if (filtered.length !== beforeLen) {
      window.localStorage.setItem(key, JSON.stringify(filtered));
    }
  }
}




  // --------------------------------------------------
  // Editable rules (In progress only)
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
    if (!session || !Array.isArray(session.dope) || session.dope.length === 0) return false;

    const av = this.toNumber(session.averageVelocity);
    if (!Number.isFinite(av) || av <= 0) return false;

    const notes = (session.notes ?? '').toString().trim();
    if (!notes) return false;

    return !session.dope.some((row: any) => !this.isRowComplete(row));
  }

  private isRowComplete(row: any): boolean {
    if (!row) return false;
    if (row.distanceM == null) return false;

    const elev = this.toNumber(row.elevationMil);
    const wind = this.toNumber(row.windageMil);
    const wspd = this.toNumber(row.windSpeed);
    const wdir = row.windDirection;

    if (!Number.isFinite(elev)) return false;
    if (!Number.isFinite(wind)) return false;
    if (!Number.isFinite(wspd)) return false;
    if (wdir === null || wdir === undefined || String(wdir).trim() === '') return false;

    return true;
  }


  // --------------------------------------------------
  // Wind helpers
  // --------------------------------------------------
  wasAutoFilled(row: any, field: 'windSpeed' | 'windDirection'): boolean {
    if (!row) return false;
    return field === 'windSpeed' ? !!row._windSpeedAuto : !!row._windDirectionAuto;
  }

  private degreesToArrow(deg: number): string {
    const normalized = ((deg % 360) + 360) % 360;
    if (normalized >= 337.5 || normalized < 22.5) return '↑';
    if (normalized < 67.5) return '↗';
    if (normalized < 112.5) return '→';
    if (normalized < 157.5) return '↘';
    if (normalized < 202.5) return '↓';
    if (normalized < 247.5) return '↙';
    if (normalized < 292.5) return '←';
    return '↖';
  }

  private clockToDegrees(clock: number): number {
    let c = clock;
    if (c < 1) c = 1;
    if (c > 12) c = 12;
    return (c % 12) * 30;
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
    const num = parseFloat(str);

    if (!isNaN(num)) {
      if (num >= 1 && num <= 12 && !str.includes('°')) {
        return this.degreesToArrow(this.clockToDegrees(num));
      }
      return this.degreesToArrow(num);
    }

    return '•';
  }

  // --------------------------------------------------
  // Voice note helpers (used by HTML)
  // --------------------------------------------------
  isRowRecording(row: any): boolean {
    return !!row && this.rowRecording && this.micTargetRow === row;
  }

  hasRowVoiceNote(row: any): boolean {
    const b64 = (row?.voiceNoteBase64 ?? '').toString().trim();
    return b64.length > 0;
  }
  rowVoiceDataUrl(row: any): string | null {
    const base64 = (row?.voiceNoteBase64 ?? '').toString().trim();

    if (!base64) {
      this.rowVoiceUrlCache.delete(row);
      return null;
    }

    const cached = this.rowVoiceUrlCache.get(row);
    if (cached && cached.b64 === base64) return cached.url;

    // plugin returns WAV base64 in your current flow
    const url = `data:audio/wav;base64,${base64}`;
    this.rowVoiceUrlCache.set(row, { b64: base64, url });
    return url;
  }

  async onRowMicClick(row: any, ev?: Event): Promise<void> {
    try {
      ev?.stopPropagation?.();
      ev?.preventDefault?.();
    } catch {}

    if (!row) return;

    try {
      // stop recording for THIS row => save to row
      if (this.rowRecording && this.micTargetRow === row) {
        const result: any = await CapacitorVoiceRecorder.stopRecording();

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

        this.showSaveMessage('Voice note saved (tap Save)');
        return;
      }

      // if recording another row, stop (discard)
      if (this.rowRecording && this.micTargetRow && this.micTargetRow !== row) {
        try {
          await CapacitorVoiceRecorder.stopRecording();
        } catch {}
        this.rowRecording = false;
        this.micTargetRow = null;
      }

      // ensure permission
      const can: any = await CapacitorVoiceRecorder.canRecord();
      if (can?.status !== 'GRANTED') {
        const perm: any = await CapacitorVoiceRecorder.requestPermission();
        if (!perm?.isGranted) {
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

  deleteRowVoiceNote(row: any, ev?: Event): void {
    ev?.stopPropagation?.();
    ev?.preventDefault?.();

    // if deleting while recording this row, stop first
    if (this.isRowRecording(row)) {
      CapacitorVoiceRecorder.stopRecording().catch(() => {});
      this.rowRecording = false;
      this.micTargetRow = null;
    }

    row.voiceNoteBase64 = null;
    row.voiceNoteDurationMs = null;
    this.showSaveMessage('Voice note removed (tap Save)');
  }

  // --------------------------------------------------
  // Save logic (THIS IS THE IMPORTANT FIX)
  // --------------------------------------------------
    onPrimarySaveClick(): void {
    if (!this.editSession) return;
    if (!this.isSessionEditable(this.editSession)) return;

    // Ensure defaults (Wind Dir=3, W Speed MPH autofill)
    this.applyHistoryDefaults(this.editSession);

    // HARD validation: do not allow Save or Complete without required fields
    const v = this.validateRequiredFields(this.editSession);
    if (!v.ok) {
      this.validationError = v.message || 'Please fill all required fields.';
      this.focusById(v.focusId || null);
      return;
    }

    this.validationError = null;

    // If it now qualifies as completed, allow "Save & mark completed" flow
    if (this.isSessionFullyCompleted(this.editSession)) {
      this.saveAndComplete();
    } else {
      // (Should rarely happen now, but keep behavior stable)
      this.saveInProgress();
    }
  }


  private saveInProgress(): void {
    if (!this.editSession) return;

    this.validationError = null;

    const targetId = String(this.editSession.id);
    const idx = this.sessions.findIndex(s => String(s.id) === targetId);
    if (idx < 0) return;

    const updated = { ...this.editSession, completed: false };
    this.sessions[idx] = updated;

    this.persistEditedSession(updated);

    this.rebuildPendingSessions();
    this.showSaveMessage('Session saved (In progress).');
  }

  private saveAndComplete(): void {
    if (!this.editSession) return;
    const v = this.validateRequiredFields(this.editSession);
    if (!v.ok) {
      this.validationError = v.message || 'Please fill all required fields.';
      this.focusById(v.focusId || null);
      return;
    }


    this.validationError = null;

    const targetId = String(this.editSession.id);
    const idx = this.sessions.findIndex(s => String(s.id) === targetId);
    if (idx < 0) return;

    const updated = { ...this.editSession, completed: true };
    this.sessions[idx] = updated;

    this.persistEditedSession(updated);

    this.rebuildPendingSessions();
    this.showSaveMessage('Session saved & marked as completed.');

    // close detail view after completion (as before)
    this.editSession = null;
    this.selectedSessionId = null;
    this.expandedVenueId = null;
  }

  /**
   * Persist ONLY the edited session (avoids the broken “loop updateSession for all sessions”).
   * Includes fallbacks for different DataService implementations.
   */
  private persistEditedSession(updatedSession: any): void {
    try {
      const ds: any = this.dataService;

      if (ds && typeof ds.updateSession === 'function') {
        ds.updateSession(updatedSession);
        return;
      }

      // common alternative APIs
      if (ds && typeof ds.saveSession === 'function') {
        ds.saveSession(updatedSession);
        return;
      }

      // if DataService persists the entire list
      if (ds && typeof ds.setSessions === 'function') {
        ds.setSessions(this.sessions);
        return;
      }
      if (ds && typeof ds.saveSessions === 'function') {
        ds.saveSessions(this.sessions);
        return;
      }
      if (ds && typeof ds.persistSessions === 'function') {
        ds.persistSessions(this.sessions);
        return;
      }

      console.warn('No known persist method found on DataService (updateSession/saveSession/setSessions/saveSessions).');
    } catch (err) {
      console.error('Error persisting edited session from HistoryTab:', err);
    }
  }

  // --------------------------------------------------
  // UI messages / navigation
  // --------------------------------------------------
  private showSaveMessage(msg: string): void {
    this.saveMessage = msg;
    if (this.saveMessageTimeout) clearTimeout(this.saveMessageTimeout);

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

  onBackFromHistory(): void {
    this.closeEdit();
    this.selectedSessionId = null;
    this.expandedVenueId = null;
    this.backToMenu.emit();
  }

  closeEdit(): void {
    this.editSession = null;
    this.validationError = null;
    this.clearSaveMessage();
  }
}
