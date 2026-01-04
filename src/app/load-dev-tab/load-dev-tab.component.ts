import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  OnInit,
  Output,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import jsPDF from 'jspdf';
import { CapacitorVoiceRecorder } from '@lgicc/capacitor-voice-recorder';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  Rifle,
  LoadDevProject,
  LoadDevEntry,
  LoadDevType,
  GroupSizeUnit
} from '../models';

import { DataService } from '../data.service';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';


interface ProjectForm {
  rifleId: number | null;
  name: string;
  type: LoadDevType | null;
  notes: string;

  powder: string;
  bullet: string;
  bulletWeightGr: number | null;
  brass: string;
  oal: number | null;
  oalOgive: number | null;
  distanceM: number | null;
}

interface EntryForm {
  loadLabel: string;
  powder: string;
  chargeGr: number | null;
  coal: string;
  primer: string;
  bullet: string;
  bulletWeightGr: number | null;
  bulletBc: string;
  distanceM: number | null;
  shotsFired: number | null;
  groupSize: number | null;
  groupUnit: GroupSizeUnit;
  velocityInput: string;
  poiNote: string;
  notes: string;
}

interface PlannerForm {
  distanceM: number | null;
  startChargeGr: number | null;
  endChargeGr: number | null;
  stepGr: number | null;
  shotsPerGroup: number | null;
}

interface VelocityStats {
  avg: number;
  es: number;
  sd: number;
  n: number;
}

interface NodeEntry {
  entry: LoadDevEntry;
  stats: VelocityStats;
}

// ---- OCW graph data (screen) ----
interface OcwShotPoint {
  x: number;          // svg coords (0..100)
  y: number;          // svg coords (0..60)
  charge: number;
  v: number;
  entryId: number;
  shotIndex: number;  // 0..n-1
}

interface OcwGroupEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  charge: number;
  entryId: number;
}

@Component({
  selector: 'app-load-dev-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './load-dev-tab.component.html'
})
export class LoadDevTabComponent implements OnInit {
  @ViewChild('velocityInputEl') velocityInputEl?: ElementRef<HTMLInputElement>;
  @ViewChild('pdfContent') pdfContent?: ElementRef<HTMLElement>;
@ViewChild('targetFileInput') targetFileInput?: ElementRef<HTMLInputElement>;
@ViewChild('entryFileInput') entryFileInput?: ElementRef<HTMLInputElement>;


photoViewerEntry: LoadDevEntry | null = null;
photoViewerImgUrl: string | null = null;

private pendingEntryForPhoto: LoadDevEntry | null = null;

isAnnotatingPhoto = false;

  @Output() backToMenu = new EventEmitter<void>();

  // ----------------------------
  // Focus / highlight behaviour
  // ----------------------------
  velocityFocusToken = 0;

  private focusVelocityInput(selectAll = true): void {
    setTimeout(() => {
      const el = this.velocityInputEl?.nativeElement;
      if (!el) return;

      try {
        el.focus({ preventScroll: false } as any);
      } catch {
        el.focus();
      }

      if (selectAll) {
        try {
          el.select();
        } catch {
          // ignore
        }
      }

      this.velocityFocusToken++;
    }, 0);
  }

  // ---- navigation back from history/footer button ----
  onBackFromHistory(): void {
    this.backToMenu.emit();
  }

  // ==========================
// MIC (VOICE NOTE - ACTIVE)
// ==========================
micInlineMessage: string | null = null;

isVoiceRecording = false;
voiceNoteDataUrl: string | null = null;
voiceNoteDurationMs: number | null = null;

private syncVoiceNoteFromProject(): void {
  try {
    const any = this.selectedProject as any;
    const base64 = (any?.voiceNoteBase64 ?? '').toString().trim();
    const ms = Number(any?.voiceNoteDurationMs ?? 0);

    this.voiceNoteDurationMs = Number.isFinite(ms) && ms > 0 ? ms : null;
    this.voiceNoteDataUrl = base64 ? `data:audio/wav;base64,${base64}` : null;
  } catch {
    this.voiceNoteDurationMs = null;
    this.voiceNoteDataUrl = null;
  }
}

async onMicToggle(event?: Event): Promise<void> {
  try {
    event?.preventDefault();
    event?.stopPropagation();
  } catch {
    // ignore
  }

  if (!this.selectedProject) {
    this.micInlineMessage = 'Select a project first';
    setTimeout(() => (this.micInlineMessage = null), 1500);
    return;
  }

  try {
    if (!this.isVoiceRecording) {
      // Ensure permission
      const { status } = await CapacitorVoiceRecorder.canRecord();
if (status !== 'GRANTED') {
  const perm = await CapacitorVoiceRecorder.requestPermission();
 if (!perm.isGranted) {
    this.micInlineMessage = 'Mic permission denied';
    setTimeout(() => (this.micInlineMessage = null), 1800);
    return;
  }
  
}

      await CapacitorVoiceRecorder.startRecording();
      this.isVoiceRecording = true;
      this.micInlineMessage = 'Recording… tap ⏹ to stop';
      return;
    }

    // Stop + save
    const result = await CapacitorVoiceRecorder.stopRecording();
    this.isVoiceRecording = false;

    const base64 = (result?.base64 ?? '').toString().trim();
    const msDuration = Number(result?.msDuration ?? 0);

    if (!base64) {
      this.micInlineMessage = 'No audio captured';
      setTimeout(() => (this.micInlineMessage = null), 1800);
      return;
    }

    const updated: any = {
      ...(this.selectedProject as any),
      voiceNoteBase64: base64,
      voiceNoteDurationMs: Number.isFinite(msDuration) && msDuration > 0 ? msDuration : undefined
    };

    this.data.updateLoadDevProject(updated);
this.data.updateLoadDevProject(updated);

// 🔥 IMPORTANT: reload selectedProject from DataService, then rebuild preview
this.refreshSelectedProject();
this.syncVoiceNoteFromProject();

    // Refresh UI preview
    this.syncVoiceNoteFromProject();

    this.micInlineMessage = '✅ Voice note saved';
    setTimeout(() => (this.micInlineMessage = null), 1600);
  } catch (err) {
    this.isVoiceRecording = false;
    this.micInlineMessage = 'Mic error (check permission / mic in use)';
    setTimeout(() => (this.micInlineMessage = null), 2200);
  }
}

deleteVoiceNote(): void {
  if (!this.selectedProject) return;

  const updated: any = { ...(this.selectedProject as any) };
  delete updated.voiceNoteBase64;
  delete updated.voiceNoteDurationMs;

  this.data.updateLoadDevProject(updated);
  this.syncVoiceNoteFromProject();

  this.micInlineMessage = 'Voice note removed';
  setTimeout(() => (this.micInlineMessage = null), 1200);
  this.data.updateLoadDevProject(updated);

// 🔥 IMPORTANT: reload selectedProject from DataService, then rebuild preview
this.refreshSelectedProject();
this.syncVoiceNoteFromProject();

}

// ==========================
// TARGET PHOTO (camera)
// ==========================
// Thumbnail shown in UI
targetPhotoDataUrl: string | null = null;
// Inline status next to camera button (like MIC)
targetPhotoInlineMessage: string | null = null;

/** Pulls any previously-saved target photo from the selected project into the UI preview. */
private syncTargetPhotoFromProject(): void {
  try {
    const any = this.selectedProject as any;

    // ✅ New: prefer structured shape if present
    const structuredDataUrl = (any?.targetPhoto?.dataUrl ?? '').toString().trim();
    const base64 = (any?.targetPhotoBase64 ?? '').toString().trim();
    const dataUrl = (any?.targetPhotoDataUrl ?? '').toString().trim();

    if (structuredDataUrl) {
      this.targetPhotoDataUrl = structuredDataUrl;
      return;
    }
    if (dataUrl) {
      this.targetPhotoDataUrl = dataUrl;
      return;
    }
    if (base64) {
      this.targetPhotoDataUrl = `data:image/jpeg;base64,${base64}`;
      return;
    }
    this.targetPhotoDataUrl = null;
  } catch {
    this.targetPhotoDataUrl = null;
  }
}


async onTargetPhotoClick(event?: Event): Promise<void> {
  try {
    event?.preventDefault();
    event?.stopPropagation();
  } catch {
    // ignore
  }

  // Must have a project selected (so we can attach the image)
  if (!this.selectedProject) {
    this.targetPhotoInlineMessage = 'Select a load development first';
    setTimeout(() => (this.targetPhotoInlineMessage = null), 2200);
    return;
  }

  // Ensure preview reflects currently selected project
  this.syncTargetPhotoFromProject();

  // Web fallback: open file picker
  if (!Capacitor.isNativePlatform()) {
    this.targetPhotoInlineMessage = 'Choose a photo (web)';
    setTimeout(() => (this.targetPhotoInlineMessage = null), 1600);
    try {
      this.targetFileInput?.nativeElement?.click();
    } catch {
      // ignore
    }
    return;
  }

  // Native: open camera
  try {
    const photo = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera
    });

    const base64 = photo?.base64String;
    if (!base64) {
      this.targetPhotoInlineMessage = 'No photo captured';
      setTimeout(() => (this.targetPhotoInlineMessage = null), 2200);
      return;
    }

    // Show thumbnail in UI
    this.targetPhotoDataUrl = `data:image/jpeg;base64,${base64}`;

    // Attach to project (stored as base64 so it works offline)
    (this.selectedProject as any).targetPhotoBase64 = base64;
    (this.selectedProject as any).targetPhotoCapturedAt = new Date().toISOString();

    // Persist using your existing project update path
    try {
      this.data.updateLoadDevProject({ ...(this.selectedProject as any) });
      this.refreshSelectedProject();
    } catch {
      // ignore
    }

    // Keep preview in sync
    this.syncTargetPhotoFromProject();

    this.targetPhotoInlineMessage = '📷 Target photo saved';
    setTimeout(() => (this.targetPhotoInlineMessage = null), 2200);
  } catch (err: any) {
    // Common: user cancelled
    const msg = (err?.message ?? '').toString().toLowerCase();
    if (msg.includes('cancel')) {
      this.targetPhotoInlineMessage = 'Cancelled';
    } else {
      this.targetPhotoInlineMessage = 'Camera error';
      console.error(err);
    }
    setTimeout(() => (this.targetPhotoInlineMessage = null), 2200);
  }
}

// Web-only: accept chosen image file
async onTargetFileChosen(event: Event): Promise<void> {
  try {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });

    this.targetPhotoDataUrl = dataUrl;

    // Store base64 on project for consistency
    const base64 = dataUrl.split(',')[1] ?? '';
    if (this.selectedProject && base64) {
      (this.selectedProject as any).targetPhotoBase64 = base64;
      (this.selectedProject as any).targetPhotoCapturedAt = new Date().toISOString();
      try {
        this.data.updateLoadDevProject({ ...(this.selectedProject as any) });
        this.refreshSelectedProject();
      } catch {
        // ignore
      }
    }

    // Keep preview in sync
    this.syncTargetPhotoFromProject();

    // reset input so selecting same file again still triggers change
    input.value = '';
  } catch {
    // ignore
  }
}
async onEntryTargetPhotoClick(entry: LoadDevEntry, event?: Event): Promise<void> {
  try {
    event?.preventDefault();
    event?.stopPropagation();
  } catch {}

  if (!this.selectedProject) {
    this.targetPhotoInlineMessage = 'Select a load development first';
    setTimeout(() => (this.targetPhotoInlineMessage = null), 2200);
    return;
  }
// ✅ Persist photo onto the entry (THIS is the field name)
(entry as any).targetPhoto = {
  dataUrl: this.targetPhotoDataUrl,
  takenAt: new Date().toISOString(),
  groupSize: entry.groupSize ?? null,
  groupUnit: entry.groupUnit ?? null
};

  // Web fallback (file picker)
  if (!Capacitor.isNativePlatform()) {
    this.pendingEntryForPhoto = entry;
    this.targetPhotoInlineMessage = 'Choose a photo (web)';
    setTimeout(() => (this.targetPhotoInlineMessage = null), 1600);
    this.entryFileInput?.nativeElement?.click();
    return;
  }

  try {
    const photo = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera
    });

    const base64 = photo?.base64String;
    if (!base64) {
      this.targetPhotoInlineMessage = 'No photo captured';
      setTimeout(() => (this.targetPhotoInlineMessage = null), 2200);
      return;
    }

    const rawDataUrl = `data:image/jpeg;base64,${base64}`;
    const stampedDataUrl = await this.stampTimestampOnDataUrl(rawDataUrl);

    await this.attachPhotoToEntry(entry, stampedDataUrl);

    this.targetPhotoInlineMessage = 'Photo saved';
    setTimeout(() => (this.targetPhotoInlineMessage = null), 1800);
  } catch (err) {
    console.error(err);
    this.targetPhotoInlineMessage = 'Camera failed';
    setTimeout(() => (this.targetPhotoInlineMessage = null), 2200);
  }
}
async onEntryFileChosen(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input?.files?.[0];
  if (!file) return;

  const entry = this.pendingEntryForPhoto;
  this.pendingEntryForPhoto = null;

  // reset input so same file can be chosen again
  input.value = '';

  if (!entry) return;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const stampedDataUrl = await this.stampTimestampOnDataUrl(dataUrl);
  await this.attachPhotoToEntry(entry, stampedDataUrl);

  this.targetPhotoInlineMessage = 'Photo saved';
  setTimeout(() => (this.targetPhotoInlineMessage = null), 1800);
}
private async attachPhotoToEntry(entry: LoadDevEntry, stampedDataUrl: string): Promise<void> {
  const takenAt = new Date().toISOString();

  // Prompt group size only when photo is added
  const sizeRaw = prompt('Enter group size? (number, optional)', '');
  let groupSize: number | undefined = undefined;

  if (sizeRaw !== null) {
    const v = parseFloat(sizeRaw.replace(',', '.'));
    if (!Number.isNaN(v)) groupSize = v;
  }

   // Unit must match your GroupSizeUnit type (your code uses 'MOA' elsewhere)
  let unit: GroupSizeUnit | undefined = undefined;
  if (groupSize != null) {
    const unitRaw = (prompt('Unit? Enter: MOA / MM', 'MOA') || '').toUpperCase().trim();
    if (unitRaw === 'MM' || unitRaw === 'MILLIMETER' || unitRaw === 'MILLIMETERS') unit = 'mm';
    else unit = 'MOA';
  }


  // Store on the entry (typed model doesn't include targetPhoto, so keep it on "any")
  const updatedEntry: LoadDevEntry = {
    ...(entry as any),
    targetPhoto: {
      dataUrl: stampedDataUrl,
      takenAt,
      groupSize,
      groupUnit: unit
    }
  } as any;

  // ✅ Persist using your REAL, existing persistence method
  if (this.selectedProject) {
    this.data.updateLoadDevEntry(this.selectedProject.id, updatedEntry);
    this.refreshSelectedProject(); // reloads selectedProjectEntries etc
  }
}

private async stampTimestampOnDataUrl(dataUrl: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  ctx.drawImage(img, 0, 0);

  // Timestamp text (bottom-left)
  const stamp = new Date().toLocaleString();
  const pad = Math.max(18, Math.floor(canvas.width * 0.015));
  const fontSize = Math.max(28, Math.floor(canvas.width * 0.03));

  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textBaseline = 'bottom';

  // dark bg behind text
  const metrics = ctx.measureText(stamp);
  const boxW = Math.ceil(metrics.width + pad);
  const boxH = Math.ceil(fontSize + pad * 0.6);

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(pad * 0.6, canvas.height - pad * 0.6 - boxH, boxW, boxH);

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillText(stamp, pad, canvas.height - pad);

  return canvas.toDataURL('image/jpeg', 0.92);
}
openProjectPhotoViewer(url: string | null, event?: Event): void {
  try {
    event?.preventDefault();
    event?.stopPropagation();
  } catch {}

  if (!url) return;

  this.photoViewerEntry = null;
  this.photoViewerImgUrl = url;
  this.photoViewerOpen = true;
  this.isAnnotatingPhoto = false;

  // Step 1: auto-scale for 1cm blocks
  void this.runAutoScaleForPhoto(url);
}

openEntryPhotoViewer(entry: LoadDevEntry, event?: Event): void {
  try {
    event?.preventDefault();
    event?.stopPropagation();
  } catch {}

  const url = this.getEntryPhotoDataUrl(entry);
  if (!url) return;

  this.photoViewerEntry = entry;
  this.photoViewerImgUrl = url;
  this.photoViewerOpen = true;
  this.isAnnotatingPhoto = false;

  // Step 1: auto-scale for 1cm blocks
  void this.runAutoScaleForPhoto(url);
}

closePhotoViewer(): void {
  this.photoViewerOpen = false;
  this.photoViewerEntry = null;
  this.photoViewerImgUrl = null;
  this.isAnnotatingPhoto = false;

  // Step 1: reset overlay state
  this.gridPxPerCm = null;
}

/** Step 1: estimate pixels-per-1cm grid spacing and store for overlay. */
private async runAutoScaleForPhoto(dataUrl: string): Promise<void> {
  this.gridPxPerCm = null;

  // Only run if viewer is still open and image unchanged
  const guardUrl = this.photoViewerImgUrl;

  try {
    const px = await this.estimateGridPxPerCm(dataUrl);

    if (!this.photoViewerOpen) return;
    if (this.photoViewerImgUrl !== guardUrl) return;

    if (px && Number.isFinite(px) && px > 2) {
      this.gridPxPerCm = px;
    }
  } catch {
    // Silent fail (overlay just won't show)
  }
}

/**
 * Attempts to detect the repeating 1cm block grid spacing in pixels.
 * Best-effort: works best with top-down photo and visible grid lines.
 */
private async estimateGridPxPerCm(dataUrl: string): Promise<number | null> {
  const img = new Image();
  img.decoding = 'async';

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });

  const maxW = 700; // keep it lightweight on mobile
  const scale = img.width > maxW ? maxW / img.width : 1;
  const w = Math.max(1, Math.floor(img.width * scale));
  const h = Math.max(1, Math.floor(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;

  // grayscale
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; p < gray.length; p++, i += 4) {
    gray[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
  }

  // vertical edge strength per X (for vertical grid lines)
  const vx = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 1; x < w; x++) {
      const a = gray[row + x];
      const b = gray[row + x - 1];
      vx[x] += Math.abs(a - b);
    }
  }

  // horizontal edge strength per Y (for horizontal grid lines)
  const hy = new Float32Array(h);
  for (let y = 1; y < h; y++) {
    const row = y * w;
    const prev = (y - 1) * w;
    for (let x = 0; x < w; x++) {
      const a = gray[row + x];
      const b = gray[prev + x];
      hy[y] += Math.abs(a - b);
    }
  }

  const vxS = this.smooth1D(vx, 5);
  const hyS = this.smooth1D(hy, 5);

  const pxX = this.findDominantPeriod(vxS, 6, Math.min(140, Math.floor(w / 2)));
  const pxY = this.findDominantPeriod(hyS, 6, Math.min(140, Math.floor(h / 2)));

  const candidates = [pxX, pxY].filter((n): n is number => typeof n === 'number' && n > 0);
  if (!candidates.length) return null;

  // average of best axes (they should be similar)
  const avg = candidates.reduce((a, b) => a + b, 0) / candidates.length;

  // adjust back to original scale
  const pxPerCm = avg / scale;
  return pxPerCm;
}

private smooth1D(arr: Float32Array, win: number): Float32Array {
  const out = new Float32Array(arr.length);
  const half = Math.max(1, Math.floor(win / 2));
  for (let i = 0; i < arr.length; i++) {
    let s = 0;
    let c = 0;
    const a = Math.max(0, i - half);
    const b = Math.min(arr.length - 1, i + half);
    for (let j = a; j <= b; j++) {
      s += arr[j];
      c++;
    }
    out[i] = c ? s / c : arr[i];
  }
  return out;
}

/**
 * Autocorrelation peak finder: returns the lag (period) with strongest repetition.
 */
private findDominantPeriod(arr: Float32Array, minLag: number, maxLag: number): number | null {
  if (arr.length < maxLag + 2) return null;

  // remove mean
  let mean = 0;
  for (let i = 0; i < arr.length; i++) mean += arr[i];
  mean /= arr.length;

  const centered = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) centered[i] = arr[i] - mean;

  let bestLag: number | null = null;
  let bestScore = -Infinity;

  // correlation score per lag
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i < centered.length - lag; i++) {
      score += centered[i] * centered[i + lag];
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  return bestLag;
}

deleteEntryPhoto(): void {
  // 1) If we are viewing an ENTRY photo (OCW row photo)
  const e = this.photoViewerEntry;
  if (e) {
    delete (e as any).targetPhoto;

    if (this.selectedProject) {
      this.data.updateLoadDevEntry(this.selectedProject.id, e as any);
      this.refreshSelectedProject();
    }

    this.closePhotoViewer();
    return;
  }

  // 2) Otherwise we are viewing the PROJECT "Target photo" from Notes panel
  if (!this.selectedProject) return;

  // clear stored photo on the project (covers both legacy keys)
  delete (this.selectedProject as any).targetPhotoBase64;
  delete (this.selectedProject as any).targetPhotoDataUrl;
  delete (this.selectedProject as any).targetPhotoCapturedAt;

  // clear UI preview
  this.targetPhotoDataUrl = null;

  // persist
  this.data.updateLoadDevProject({ ...this.selectedProject });

  this.postSaveMessage = 'Photo deleted ✅';
  setTimeout(() => (this.postSaveMessage = null), 2000);

  this.refreshSelectedProject();
  this.closePhotoViewer();
}
private buildLoadSummaryLine(): string {
  if (!this.selectedProject) return '';

  const p = this.selectedProject as any;

  const parts: string[] = [];

  if (p.powder) parts.push(`Powder: ${p.powder}`);
  if (p.bullet) parts.push(`Bullet: ${p.bullet}`);
  if (p.bulletWeightGr != null) parts.push(`Wt: ${p.bulletWeightGr}gr`);
  if (p.oal != null) parts.push(`COAL: ${p.oal}mm`);
  if (p.oalOgive != null) parts.push(`Ogive: ${p.oalOgive}mm`);

  const range = this.selectedProjectChargeRangeText();
  if (range && range !== '—') parts.push(`Charge: ${range}`);

  return parts.join(' | ');
}


  // ---------- PDF export (Graph + table inside #pdfContent) ----------
   // ---------- PDF export (Graph + table inside #pdfContent) ----------
  async exportPdf(): Promise<void> {
    try {
      if (!this.selectedProject) {
        alert('Select a load development first.');
        return;
      }

      // Always rebuild graph data for export (even if the UI graph is hidden)
      this.rebuildGraphData();

      const doc = new jsPDF({
        orientation: 'p',
        unit: 'pt',
        format: 'a4'
      });

      const pageW = doc.internal.pageSize.getWidth();
      const leftMargin = 55;     // ✅ punch-hole space (increase/decrease as you like)
const rightMargin = 28;    // normal right margin
const topMargin = 40;      // normal top margin
let y = topMargin;


          // Header
      const rifleName =
        this.rifles?.find(r => r.id === this.selectedRifleId)?.name ??
        `Rifle ${this.selectedRifleId ?? ''}`;
      const projectName = this.selectedProject.name ?? 'Load development';

     doc.setFontSize(20);
doc.text(`${projectName}`, leftMargin, y);
y += 15;

doc.setLineWidth(0.4);
doc.line(leftMargin, y, pageW - rightMargin, y);
y += 15;

doc.setFontSize(16);
doc.text(`Rifle: ${rifleName}`, leftMargin, y);
y += 15;



      // Project notes (exported)
      const projectNotes = (this.selectedProject as any)?.notes?.toString?.() ?? '';
      const projectNotesTrim = projectNotes.trim();
      if (projectNotesTrim) {
        doc.setFontSize(10);
       const noteLines = doc.splitTextToSize(
  `Notes: ${projectNotesTrim}`,
  pageW - leftMargin - rightMargin
);
doc.text(noteLines, leftMargin, y);

        y += noteLines.length * 12 + 6;
      }

      // ----- Graph (vector drawn) -----
      const isOcwProject = this.selectedProject.type === 'ocw';

      const hasOcwShots = (this.ocwShotPoints?.length ?? 0) > 0;
      const includeLadderGraph = (this.graphCoords?.length ?? 0) >= 2;
      const includeAnyGraph = isOcwProject ? hasOcwShots : includeLadderGraph;

           // Always reserve the same graph area so exports look identical (with or without shot data)
      const chartX = leftMargin;
      const chartY = y;
      const chartW = pageW - leftMargin - rightMargin;
      const chartH = 180;
      const innerPad = 8;
      const xMin = chartX + innerPad;
      const xMax = chartX + chartW - innerPad;
      const yMin = chartY + innerPad;
      const yMax = chartY + chartH - innerPad;

      // Frame (always)
      doc.setLineWidth(0.7);
      doc.rect(chartX, chartY, chartW, chartH);

      if (includeAnyGraph) {
        // Determine axis ranges
        let minXv = 0;
        let maxXv = 0;
        let minYv = 0;
        let maxYv = 0;

        if (isOcwProject && hasOcwShots) {
          const xs = this.ocwShotPoints.map(p => p.charge);
          const ys = this.ocwShotPoints.map(p => p.v);

          minXv = Math.min(...xs);
          maxXv = Math.max(...xs);

          minYv = Math.min(...ys);
          maxYv = Math.max(...ys);

          const padY = (maxYv - minYv) * 0.08 || 10;
          minYv -= padY;
          maxYv += padY;
        } else {
          const xs = this.graphCoords.map(p => p.charge);
          const ys = this.graphCoords.map(p => p.avg);

          minXv = Math.min(...xs);
          maxXv = Math.max(...xs);

          minYv = Math.min(...ys);
          maxYv = Math.max(...ys);

          const padY = (maxYv - minYv) * 0.08 || 10;
          minYv -= padY;
          maxYv += padY;
        }

        const sx = (charge: number) =>
          chartX + ((charge - minXv) / (maxXv - minXv || 1)) * chartW;

        const sy = (vel: number) =>
          chartY + chartH - ((vel - minYv) / (maxYv - minYv || 1)) * chartH;

        if (isOcwProject && hasOcwShots) {
          // Group ellipses (light grey)
          const entries = this.entriesForSelectedProject();
          for (const e of entries) {
            const charge = e.chargeGr;
            if (charge == null) continue;

            const points = (this.ocwShotPoints || []).filter(p => p.charge === charge);
            const cleaned = points.map(p => p.v).filter(v => Number.isFinite(v));
            if (!cleaned.length) continue;

            const x = Math.max(xMin, Math.min(xMax, sx(charge)));

            const minV = Math.min(...cleaned);
            const maxV = Math.max(...cleaned);

            const padV = Math.max(6, (maxV - minV) * 0.25);
            const top = Math.max(yMin, Math.min(yMax, sy(maxV + padV)));
            const bot = Math.max(yMin, Math.min(yMax, sy(minV - padV)));

            const cy = (top + bot) / 2;
            const ry = Math.max(6, Math.abs(bot - top) / 2);
            const rx = 10;

            doc.setDrawColor(170);
            doc.setLineWidth(0.6);
            (doc as any).ellipse(x, cy, rx, ry);
          }

          // Connect shot points (dark)
          doc.setDrawColor(0);
          doc.setLineWidth(1.2);

          const sorted = [...this.ocwShotPoints].sort((a, b) => a.charge - b.charge);
          for (let i = 0; i < sorted.length - 1; i++) {
            const a = sorted[i];
            const b = sorted[i + 1];
            doc.line(
              Math.max(xMin, Math.min(xMax, sx(a.charge))),
              Math.max(yMin, Math.min(yMax, sy(a.v))),
              Math.max(xMin, Math.min(xMax, sx(b.charge))),
              Math.max(yMin, Math.min(yMax, sy(b.v)))
            );
          }

          // Labels on unique charges
          doc.setFontSize(8);
          doc.setTextColor(0);

          const labelInsidePad = 10;
          const uniqueCharges = Array.from(
            new Set(sorted.map(p => Number(p.charge).toFixed(2)))
          ).map(s => Number(s));

          for (const c of uniqueCharges) {
            const x = Math.max(xMin, Math.min(xMax, sx(c)));
            const txt = `${c.toFixed(2)} gr`;

            let tx = x + 4;
            if (tx > xMax - 22) tx = x - 22;

            let ty = chartY + 16;
            if (ty < yMin + labelInsidePad) ty = yMin + labelInsidePad;
            if (ty > yMax - labelInsidePad) ty = yMax - labelInsidePad;

            doc.text(txt, tx, ty);
          }

          // Axis hints
          doc.setFontSize(9);
          doc.text(`${minXv.toFixed(2)} gr`, chartX, chartY + chartH + 12);
          doc.text(`${maxXv.toFixed(2)} gr`, chartX + chartW - 45, chartY + chartH + 12);
          doc.text(`${Math.round(maxYv)} fps`, chartX + chartW - 55, chartY + 10);
          doc.text(`${Math.round(minYv)} fps`, chartX + chartW - 55, chartY + chartH - 4);

          y += chartH + 26;
        } else {
          // Ladder avg line (connect charges with a line)
          doc.setLineWidth(1.5);
          for (let i = 0; i < this.graphCoords.length - 1; i++) {
            const a = this.graphCoords[i];
            const b = this.graphCoords[i + 1];
            doc.line(sx(a.charge), sy(a.avg), sx(b.charge), sy(b.avg));
          }

          doc.setLineWidth(1);
          doc.setFontSize(8);

          for (const p of this.graphCoords) {
            const x = sx(p.charge);
            const yv = sy(p.avg);

            // marker
            doc.circle(x, yv, 2.2, 'S');

            // label (charge)
            doc.text(p.charge.toFixed(2), x + 4, yv - 2);
          }

          // Axis hints
          doc.setFontSize(9);
          doc.text(`${minXv.toFixed(2)} gr`, chartX, chartY + chartH + 12);
          doc.text(`${maxXv.toFixed(2)} gr`, chartX + chartW - 45, chartY + chartH + 12);
          doc.text(`${Math.round(maxYv)} fps`, chartX + chartW - 55, chartY + 10);
          doc.text(`${Math.round(minYv)} fps`, chartX + chartW - 55, chartY + chartH - 4);

          y += chartH + 26;
        }
      } else {
        // Placeholder (no shots yet) – keep layout identical
        doc.setFontSize(11);
        doc.text('Load development graph (placeholder)', chartX + 10, chartY + 18);

        doc.setFontSize(9);
        doc.text(
          isOcwProject ? 'No OCW shot data yet.' : 'No ladder shot data yet.',
          chartX + 10,
          chartY + 32
        );
        doc.text('Add shot velocities to render the graph.', chartX + 10, chartY + 46);

        y += chartH + 26;
      }

      // ----- Table (real data) -----
      const entries = this.entriesForSelectedProject();
      doc.setFontSize(11);
     doc.text('Data', leftMargin, y);
      y += 12;

      doc.setFontSize(9);

      const cols = isOcwProject
        ? ['Charge', 'Avg', 'SD', 'ES', 'Group', 'Notes']
        : ['Charge', 'Velocity', 'Shot ', 'Notes'];

      // Column anchors (tuned for A4 portrait)
      const colX = isOcwProject
      ? [leftMargin, leftMargin + 70, leftMargin + 120, leftMargin + 160, leftMargin + 205, leftMargin + 255]
: [leftMargin, leftMargin + 85, leftMargin + 145, leftMargin + 190];


      cols.forEach((c, i) => doc.text(c, colX[i], y));
      y += 10;
      doc.setLineWidth(0.5);
      doc.line(leftMargin, y, pageW - rightMargin, y);

      y += 12;

      const lineH = 12;
      let shownRows = 0;

      for (const e of entries) {
        const notesTxt = this.buildExportNotesForEntry(e);

        const notesX = isOcwProject ? colX[5] : colX[3];
        const notesW = (pageW - rightMargin) - notesX;


        const notesLines = notesTxt
          ? doc.splitTextToSize(notesTxt, Math.max(50, notesW))
          : [];

        const neededLines = Math.max(1, notesLines.length || 1);
        const neededHeight = neededLines * lineH;

// ONE-PAGER: stop table early so Comments + bottom boxes stay on page 1
const pageBottom = doc.internal.pageSize.getHeight() - 40;

// Reserve MIN space for:
// - spacer before comments (10)
// - Comments title (~12) + pad after comments block (~10)
// - FIXED bottom boxes (keep target image/photo from ever shrinking) + pad after
const reserveForBottom = 10 + 12 + 10 + 220 + 10;



        if (y + neededHeight + reserveForBottom > pageBottom) {
          const remaining = entries.length - shownRows;
          doc.setFontSize(9);
          doc.setTextColor(80);
          doc.text(`(+${remaining} more rows not shown)`, leftMargin, y);
          doc.setTextColor(0);
          y += 14;
          break;
        }


        const s = this.statsForEntry(e);

        doc.text(`${e.chargeGr ?? ''}`, colX[0], y);
        doc.text(s ? `${Math.round(s.avg)}` : '—', colX[1], y);

        if (isOcwProject) {
          doc.text(s ? `${s.sd.toFixed(1)}` : '—', colX[2], y);
          doc.text(s ? `${Math.round(s.es)}` : '—', colX[3], y);
          doc.text(this.formatGroupSize(e), colX[4], y);
      } else {
  // Use the SAME completion boolean already used elsewhere (graph/colour logic)
  const isLoadCompleted = this.isProjectComplete(this.selectedProject!);

  // Match the UI: 1/Total ... N/Total
  // (shownRows is 0-based count already printed so far)
  const shotLabel = `${shownRows + 1}/${entries.length}`;

  // Always print the same label; no extra "1" overlay
  doc.text(shotLabel, colX[2], y);

  // If you ever want different behavior for incomplete loads, this is where it would go:
  // if (!isLoadCompleted) { ... }
}


        if (notesLines.length) {
         doc.text(`${shownRows + 1}/${entries.length}`, colX[2], y);
        }
           shownRows++;

        y += neededHeight;
      }
  // ----- Comments + bottom boxes (ONE-PAGER, auto-fit) -----
// We do NOT add pages here. Instead, we adapt:
// 1) reduce comment lines if needed
// 2) keep a bottom box area (left blank placeholder + right photo)

const pageBottom = doc.internal.pageSize.getHeight() - 40;

// Layout knobs
const commentLineGap = 14;
const commentTitleH = 12;
const commentPadAfter = 10;

const boxPadAfter = 10;

const boxH = 220; // FIXED: never shrink target image/photo box to make content fit

// Space before comments title (small breathing room)
y += 10;

// How many comment lines can we afford while still keeping the bottom boxes?
const commentsHeight = (n: number) => commentTitleH + n * commentLineGap + commentPadAfter;
const boxesReservedAbs = boxH + boxPadAfter;

let commentLines = 15;

// ✅ Build / fetch summary line for export (must be a single-line string)
const summaryLine = (typeof this.buildLoadSummaryLine === 'function')
  ? (this.buildLoadSummaryLine() || '')
  : '';

// ✅ If we have a summary line, reserve 1 comment row for it
const summaryConsumesOneLine = !!summaryLine;

// Ensure we have room for at least absolute-min boxes.
// If not, reduce comment lines until it fits (down to 0 if required).
while (
  commentLines > 0 &&
  y + commentsHeight(commentLines) + boxesReservedAbs > pageBottom
) {
  commentLines--;
}

// Draw Comments title
doc.setFontSize(11);
doc.setTextColor(0);
doc.text('Comments', leftMargin, y);
y += 12;

// ✅ Draw summary as FIRST comment line (bold), then move y down one line
if (summaryConsumesOneLine && commentLines > 0) {
  // Fit summary on one line (truncate if needed)
  const maxW = (pageW - rightMargin) - leftMargin;
  const oneLine = doc.splitTextToSize(summaryLine, maxW)?.[0] ?? summaryLine;

  // Make sure it truly stays one line with an ellipsis if splitText would wrap
  let summaryOut = oneLine;
  if (doc.getTextWidth(summaryOut) > maxW) {
    while (summaryOut.length > 0 && doc.getTextWidth(summaryOut + '…') > maxW) {
      summaryOut = summaryOut.slice(0, -1);
    }
    summaryOut = summaryOut + '…';
  }

  // Bold summary
  (doc as any).setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.text(summaryOut, leftMargin, y - 3); // slight baseline tweak

  // Back to normal for lines
  (doc as any).setFont(undefined, 'normal');

  // Consume one ruled line for summary
  y += commentLineGap;
  commentLines = Math.max(0, commentLines - 1);
}

// Draw comment lines (lighter grey for printing, but still visible)
doc.setLineWidth(0.7);
doc.setDrawColor(120, 120, 120);

for (let i = 0; i < commentLines; i++) {
  doc.line(
    leftMargin,
    y + i * commentLineGap,
    pageW - rightMargin,
    y + i * commentLineGap
  );
}

y += commentLines * commentLineGap + 10;

// ----- Bottom boxes: LEFT blank placeholder + RIGHT photo -----
const remainingForBoxes = pageBottom - (y + boxPadAfter);


if (remainingForBoxes < boxH) { /* should not happen; comments/table are trimmed first to keep one page */ }

// Split area into 2 equal boxes
const gap = 10;
const halfW = (pageW - leftMargin - rightMargin - gap) / 2;

const leftX = leftMargin;
const leftW = halfW;
const leftY = y;

const photoX = leftMargin + halfW + gap;
const photoW = halfW;
const photoY = y;

// LEFT: placeholder box (NO title, NO hit indicator)
doc.setLineWidth(0.8);
doc.setDrawColor(120, 120, 120);
doc.rect(leftX, leftY, leftW, boxH);

await this.drawAssetImageInBox(
  doc,
  'assets/LoadDevExport.png',
  leftX,
  leftY,
  leftW,
  boxH,
  6
);



// RIGHT: photo box (keep photo behavior the same, but render only once)
doc.setLineWidth(0.8);
doc.setDrawColor(120, 120, 120);
doc.rect(photoX, photoY, photoW, boxH);

// Try find a photo to render (project-level or entry-level)
const projectAny = this.selectedProject as any;

// Project-level: stored base64 (your current approach)
const projectPhotoDataUrl =
  projectAny?.targetPhotoBase64
    ? `data:image/jpeg;base64,${projectAny.targetPhotoBase64}`
    : (projectAny?.targetPhotoDataUrl ?? null);

// Entry-level: allow either dataUrl or base64
const entryWithPhoto = entries?.find(e =>
  !!(e as any)?.targetPhoto?.dataUrl || !!(e as any)?.targetPhotoBase64
) as any;

const entryPhotoDataUrl =
  entryWithPhoto?.targetPhoto?.dataUrl
    ? entryWithPhoto.targetPhoto.dataUrl
    : (entryWithPhoto?.targetPhotoBase64
        ? `data:image/jpeg;base64,${entryWithPhoto.targetPhotoBase64}`
        : null);

// Prefer entry photo if any exists, else project photo
const photoDataUrl = entryPhotoDataUrl ?? projectPhotoDataUrl;

if (photoDataUrl && typeof photoDataUrl === 'string' && photoDataUrl.startsWith('data:image/')) {
  try {
    const imgType = photoDataUrl.includes('data:image/png') ? 'PNG' : 'JPEG';
    const base64 = photoDataUrl.split(',')[1];

    // Fit inside photo box with padding (NO STRETCH)
const pad = 6;

const boxX = photoX + pad;
const boxY = photoY + pad;
const boxW = Math.max(1, photoW - pad * 2);
const boxHInner = Math.max(1, boxH - pad * 2);

let drawX = boxX;
let drawY = boxY;
let drawW = boxW;
let drawH = boxHInner;

try {
  const props = (doc as any).getImageProperties?.(photoDataUrl);
  const iw = props?.width ?? props?.w;
  const ih = props?.height ?? props?.h;

  if (iw && ih) {
    const scale = Math.min(boxW / iw, boxHInner / ih);
    drawW = iw * scale;
    drawH = ih * scale;
    drawX = boxX + (boxW - drawW) / 2;
    drawY = boxY + (boxHInner - drawH) / 2;
  }
} catch {
  // fallback: keep fill behavior
}

doc.addImage(base64, imgType as any, drawX, drawY, drawW, drawH);


    // Optional tiny label (same as before)
    doc.setFontSize(8);
    doc.setTextColor(60);
    doc.text('Target photo', photoX + 6, photoY + 12);
    doc.setTextColor(0);
  } catch {
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text('Photo load failed', photoX + 10, photoY + 18);
    doc.setTextColor(0);
  }
} else {
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text('No target photo', photoX + 10, photoY + 18);
  doc.setTextColor(0);
}

y += boxH + boxPadAfter;

      // ----- Save / Share -----
      const safeName = (projectName || 'load-dev')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const fileName = `${safeName}-${this.selectedProject?.type ?? 'report'}.pdf`;

      if (Capacitor.isNativePlatform()) {
        // Native: write file, then share
        const pdfBase64 = doc.output('datauristring').split(',')[1];

        const res = await Filesystem.writeFile({
          path: fileName,
          data: pdfBase64,
          directory: Directory.Documents
        });

        await Share.share({
          title: 'Load development PDF',
          text: fileName,
          url: res.uri
        });

        this.postSaveMessage = 'Saved & shared ✅';
        setTimeout(() => (this.postSaveMessage = null), 2000);
      } else {
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        this.postSaveMessage = 'Downloaded ✅';
        setTimeout(() => (this.postSaveMessage = null), 2000);
      }
    } catch (err) {
      console.error(err);
      alert('PDF export failed.');
    }
  }

  // ---------- rifles / projects ----------
  rifles: Rifle[] = [];
  selectedRifleId: number | null = null;

  projects: LoadDevProject[] = [];
  selectedProjectId: number | null = null;
 selectedProject:
  | (LoadDevProject & {
      powder?: string;
      bullet?: string;
      bulletWeightGr?: number | null;
      oal?: number | null;
      oalOgive?: number | null;
      distanceM?: number | null;
    })
  | null = null;


  // Project form
  projectFormVisible = false;
  editingProject: LoadDevProject | null = null;
  projectForm: ProjectForm = this.createEmptyProjectForm();
  showNotesPanel = false;

  

  // Planner + validation
  planner: PlannerForm = this.createEmptyPlannerForm();
  plannerError: string | null = null;


    private buildExportNotesForEntry(e: LoadDevEntry): string {
    const any = e as any;

    const parts: string[] = [];

    const n1 = (any.notes ?? '').toString().trim();
    if (n1) parts.push(n1);

    const n2 = (any.poiNote ?? '').toString().trim();
    if (n2) parts.push(n2);

    // Optional: show raw velocities when present (handy in PDF)
    const v = (any.velocityInput ?? '').toString().trim();
    if (v) parts.push(`Vels: ${v}`);

    return parts.join(' | ');
  }

  // Filters
  powderFilter: string | null = null;
  bulletFilter: string | null = null;
  availablePowders: string[] = [];
  availableBullets: string[] = [];
  filteredProjects: LoadDevProject[] | null = null;

  // OCW validation
  ocwValidationWarning: string | null = null;

  // Entries
  entryFormVisible = false;
  editingEntry: LoadDevEntry | null = null;
  entryForm: EntryForm = this.createEmptyEntryForm();
  entrySortMode: 'default' | 'chargeAsc' | 'groupAsc' | 'groupDesc' = 'default';

  // Results visibility
  resultsCollapsed = false;
  hasResultsForSelectedProject = false;

  // Post-save banner (top)
  postSaveMessage: string | null = null;

  // Ladder/OCW wizard
  ladderWizardActive = false;
  ladderWizardEntries: LoadDevEntry[] = [];
  ladderWizardIndex = 0;
  velocityEditEntry: LoadDevEntry | null = null;
  velocityEditValue: string | number = '';

  // Single-row velocity edit
  singleVelocityEditActive = false;

  // Graph (existing ladder/avg line)
  showGraph = false;
  graphCoords: { x: number; y: number; charge: number; avg: number }[] = [];
  graphSvgPoints = '';
  graphMinVel = 0;
  graphMaxVel = 0;

  // OCW shot scatter + group circles (screen)
  ocwShotPoints: OcwShotPoint[] = [];
  ocwGroupEllipses: OcwGroupEllipse[] = [];

  constructor(private data: DataService) {}

  // ---------- lifecycle ----------
  ngOnInit(): void {
    this.rifles = this.data.getRifles();
    if (this.rifles.length > 0) {
      this.selectedRifleId = this.rifles[0].id;
      this.loadProjects();
    }
  }

  // ---------- helpers ----------
   private createEmptyProjectForm(): ProjectForm {
    return {
      rifleId: null,
      name: '',
      type: 'ladder',
      notes: '',
      powder: '',
      bullet: '',
      bulletWeightGr: null,
      brass: '',
      oal: null,
      oalOgive: null,
      distanceM: null
    };
  }


  private createEmptyEntryForm(): EntryForm {
    return {
      loadLabel: '',
      powder: '',
      chargeGr: null,
      coal: '',
      primer: '',
      bullet: '',
      bulletWeightGr: null,
      bulletBc: '',
      distanceM: null,
      shotsFired: null,
      groupSize: null,
      groupUnit: 'MOA',
      velocityInput: '',
      poiNote: '',
      notes: ''
    };
  }
private getEntryPhotoObj(entry: LoadDevEntry): any | null {
  return (entry as any)?.targetPhoto ?? null;
}

hasEntryPhoto(entry: LoadDevEntry): boolean {
  const p = this.getEntryPhotoObj(entry);
  return !!(p?.annotatedDataUrl || p?.dataUrl);
}

getEntryPhotoDataUrl(entry: LoadDevEntry): string | null {
  const p = this.getEntryPhotoObj(entry);
  return (p?.annotatedDataUrl || p?.dataUrl || null) ?? null;
}

getEntryPhotoLabel(entry: LoadDevEntry): string {
  const p = this.getEntryPhotoObj(entry);
  const ts = p?.takenAt ? this.shortDate(p.takenAt) : '';
  return ts ? `Photo • ${ts}` : 'Photo';
}

  private createEmptyPlannerForm(): PlannerForm {
    return {
      distanceM: null,
      startChargeGr: null,
      endChargeGr: null,
      stepGr: null,
      shotsPerGroup: null
    };
  }
entryHasPhoto(entry: LoadDevEntry): boolean {
  const any = entry as any;
  return !!any?.targetPhoto?.dataUrl || !!any?.targetPhotoBase64;
}

projectHasPhoto(): boolean {
  const p: any = this.selectedProject as any;
  return !!p?.targetPhoto?.dataUrl || !!p?.targetPhotoBase64 || !!p?.targetPhotoDataUrl;
}


hasAnyPhoto(): boolean {
  if (this.projectHasPhoto()) return true;
  const entries = this.entriesForSelectedProject?.() ?? [];
  return entries.some(e => this.entryHasPhoto(e));
}

  shortDate(value: string | Date | null | undefined): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit'
    });
  }
// ===============================
// PDF: load and draw placeholder image in a box
// ===============================
private async loadAssetAsDataUrl(assetPath: string): Promise<string | null> {
  try {
const res = await fetch(assetPath.startsWith('/') ? assetPath : `/${assetPath}`);

    if (!res.ok) return null;
    const blob = await res.blob();

    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string) || '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

private async drawAssetImageInBox(
  doc: any,
  assetPath: string,
  x: number,
  y: number,
  w: number,
  h: number,
  pad: number = 4
): Promise<void> {
  const dataUrl = await this.loadAssetAsDataUrl(assetPath);
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return;

  // jsPDF wants base64 (no "data:image/png;base64,")
  const imgType = dataUrl.includes('png') ? 'PNG' : 'JPEG';
  const base64 = dataUrl.split(',')[1];

  const boxX = x + pad;
  const boxY = y + pad;
  const boxW = Math.max(1, w - pad * 2);
  const boxH = Math.max(1, h - pad * 2);

  let drawX = boxX;
  let drawY = boxY;
  let drawW = boxW;
  let drawH = boxH;

  try {
    const props = (doc as any).getImageProperties?.(dataUrl);
    const iw = props?.width ?? props?.w;
    const ih = props?.height ?? props?.h;

    if (iw && ih) {
      const scale = Math.min(boxW / iw, boxH / ih);
      drawW = iw * scale;
      drawH = ih * scale;
      drawX = boxX + (boxW - drawW) / 2;
      drawY = boxY + (boxH - drawH) / 2;
    }
  } catch {
    // fallback: keep fill behavior
  }

  try {
    doc.addImage(base64, imgType as any, drawX, drawY, drawW, drawH, undefined, 'FAST');
  } catch {
    // silent fail (placeholder only)
  }
}


  projectTypeLabel(type: LoadDevType): string {
    switch (type) {
      case 'ladder':
        return 'Ladder';
      case 'ocw':
        return 'OCW';
      case 'groups':
        return 'Group comparison';
      default:
        return 'Other';
    }
  }

  get devTypeDescription(): string | null {
    switch (this.projectForm.type) {
      case 'ladder':
        return `Ladder test: single shots with small powder charge steps. You look for a "flat spot" in velocity (low SD/ES) across 3 or more neighbouring charges – that usually indicates a stable node.`;
      case 'ocw':
        return `OCW (Optimal Charge Weight): 3–5 shot groups over a small charge window. You look for a range of charges where point of impact stays very similar while groups remain tight – that indicates a forgiving accuracy node.`;
      default:
        return null;
    }
  }

  toggleNotesPanel(): void {
  this.showNotesPanel = !this.showNotesPanel;

  // When opening Notes, load the saved project photo into targetPhotoDataUrl
  if (this.showNotesPanel) {
    this.syncTargetPhotoFromProject();
     this.syncVoiceNoteFromProject();
  }
}


  // Save notes for the currently selected project (called by HTML)
  saveSelectedProjectNotes(): void {
    if (!this.selectedProject) return;

    const notes = (this.selectedProject.notes ?? '').toString().trim();

    this.data.updateLoadDevProject({
      ...this.selectedProject,
     notes: notes
    });

   this.postSaveMessage = 'Notes saved ✅';


    setTimeout(() => (this.postSaveMessage = null), 2000);

    // Collapse notes after saving
    this.showNotesPanel = false;

    this.refreshSelectedProject();
  }

  // ---------- loading ----------
  onRifleChange(): void {
    this.selectedProjectId = null;
    this.selectedProject = null;

    this.hasResultsForSelectedProject = false;
    this.resultsCollapsed = false;

    this.showGraph = false;
    this.graphCoords = [];
    this.graphSvgPoints = '';

    this.ocwShotPoints = [];
    this.ocwGroupEllipses = [];

    this.resetWizard();
    this.loadProjects();
  }

  private resetWizard(): void {
    this.showGraph = false;

    this.ladderWizardActive = false;
    this.singleVelocityEditActive = false;

    this.velocityEditEntry = null;
    this.velocityEditValue = '';

    this.ladderWizardEntries = [];
    this.ladderWizardIndex = 0;
  }

  private loadProjects(): void {
    if (this.selectedRifleId == null) {
      this.projects = [];
      this.selectedProject = null;
      this.selectedProjectId = null;

      this.hasResultsForSelectedProject = false;

      this.availablePowders = [];
      this.availableBullets = [];
      this.filteredProjects = null;

      this.rebuildGraphData();
      this.resetWizard();
      return;
    }

    this.projects = this.data.getLoadDevProjectsForRifle(this.selectedRifleId);

    if (this.selectedProjectId != null) {
      this.selectedProject =
        this.projects.find(p => p.id === this.selectedProjectId) ?? null;
      if (!this.selectedProject) {
        this.selectedProjectId = null;
      }
    }

    if (this.selectedProjectId == null) {
      this.selectedProject = null;
    }

    this.rebuildFilterOptions();
    this.applyProjectFilters();

    this.updateHasResultsFlag();
    this.rebuildGraphData();
    if (!this.graphCoords.length && !this.ocwShotPoints.length) this.showGraph = false;

    this.resetWizard();
  }

  private refreshSelectedProject(): void {
    if (!this.selectedRifleId || !this.selectedProjectId) return;

    this.projects = this.data.getLoadDevProjectsForRifle(this.selectedRifleId);
    this.selectedProject =
      this.projects.find(p => p.id === this.selectedProjectId) ?? null;

    this.rebuildFilterOptions();
    this.applyProjectFilters();

    this.updateHasResultsFlag();
    this.rebuildGraphData();
    if (!this.graphCoords.length && !this.ocwShotPoints.length) this.showGraph = false;
  }

  onProjectSelectChange(): void {
    if (this.selectedProjectId == null) {
      this.selectedProject = null;
      this.updateHasResultsFlag();
      this.rebuildGraphData();
      this.showGraph = false;
      this.resetWizard();
      return;
    }

    this.selectedProject =
      this.projects.find(p => p.id === this.selectedProjectId) ?? null;
this.syncTargetPhotoFromProject();
this.syncVoiceNoteFromProject();
    this.updateHasResultsFlag();
    this.rebuildGraphData();
    if (!this.graphCoords.length && !this.ocwShotPoints.length) this.showGraph = false;

    this.resetWizard();
  }

  openSelectedProject(): void {
    if (!this.selectedProjectId) {
      alert('Select a load development first.');
      return;
    }
    this.onProjectSelectChange();
    this.resultsCollapsed = false;
    this.resetWizard();
  }

  private updateHasResultsFlag(): void {
    this.hasResultsForSelectedProject =
      !!this.selectedProject &&
      !!this.selectedProject.entries &&
      this.selectedProject.entries.length > 0;

    this.updateOcwValidationWarning();
  }

  toggleResultsCollapsed(): void {
    this.resultsCollapsed = !this.resultsCollapsed;
  }

  // ---------- filters ----------
  private rebuildFilterOptions(): void {
    const powders = new Set<string>();
    const bullets = new Set<string>();

    for (const p of this.projects) {
      if (!p.entries) continue;
      for (const e of p.entries) {
        const any = e as any;
        if (typeof any.powder === 'string' && any.powder.trim())
          powders.add(any.powder.trim());
        if (typeof any.bullet === 'string' && any.bullet.trim())
          bullets.add(any.bullet.trim());
      }
    }

    this.availablePowders = Array.from(powders).sort();
    this.availableBullets = Array.from(bullets).sort();
  }

  onFilterChange(): void {
    this.applyProjectFilters();
  }

  private applyProjectFilters(): void {
    const powder = this.powderFilter?.trim() || null;
    const bullet = this.bulletFilter?.trim() || null;

    if (!powder && !bullet) {
      this.filteredProjects = null;
      return;
    }

    this.filteredProjects = this.projects.filter(p => {
      if (!p.entries || !p.entries.length) return false;

      return p.entries.some(e => {
        const any = e as any;
        const ePowder = any.powder?.toString().trim() || '';
        const eBullet = any.bullet?.toString().trim() || '';

        if (powder && ePowder !== powder) return false;
        if (bullet && eBullet !== bullet) return false;
        return true;
      });
    });
  }

  // ---------- project CRUD ----------
  newProject(): void {
    if (!this.selectedRifleId) {
      alert('Select rifle first');
      return;
    }

    this.selectedProject = null;
    this.selectedProjectId = null;

    this.hasResultsForSelectedProject = false;
    this.resultsCollapsed = false;

    this.showGraph = false;
    this.graphCoords = [];
    this.graphSvgPoints = '';

    this.ocwShotPoints = [];
    this.ocwGroupEllipses = [];

    this.editingProject = null;
    this.projectForm = this.createEmptyProjectForm();
    this.projectForm.rifleId = this.selectedRifleId;
    this.projectForm.type = 'ladder';

    this.planner = this.createEmptyPlannerForm();
    this.plannerError = null;

    this.projectFormVisible = true;
    this.postSaveMessage = null;
    this.showNotesPanel = false;

    this.resetWizard();
  }

  cancelProjectForm(): void {
    this.projectFormVisible = false;
    this.editingProject = null;
    this.projectForm = this.createEmptyProjectForm();

    this.planner = this.createEmptyPlannerForm();
    this.plannerError = null;

    this.showNotesPanel = false;
  }
// ---------- Media helpers (Photo / future Audio) ----------
photoViewerOpen = false;
photoViewerUrl: string | null = null;

// Step 1: auto-scale pixels-per-1cm for grid overlay
gridPxPerCm: number | null = null;

get gridOverlayStyle(): any {
  if (!this.gridPxPerCm) return null;

  const p = this.gridPxPerCm;
  const p5 = this.gridPxPerCm * 5;

  return {
    'background-image':
      'linear-gradient(to right, rgba(255,255,255,0.18) 1px, transparent 1px),' +
      'linear-gradient(to bottom, rgba(255,255,255,0.18) 1px, transparent 1px),' +
      'linear-gradient(to right, rgba(255,255,255,0.30) 1px, transparent 1px),' +
      'linear-gradient(to bottom, rgba(255,255,255,0.30) 1px, transparent 1px)',
    'background-size':
      `${p}px ${p}px, ${p}px ${p}px, ${p5}px ${p5}px, ${p5}px ${p5}px`,
    'background-position': 'center',
    'opacity': '0.9'
  };
}



getProjectPhotoUrl(): string | null {
  const p: any = this.selectedProject;
  if (!p) return null;

  // Project-level possibilities
  return (
    p?.targetPhoto?.dataUrl ??   // preferred structured shape
    p?.targetPhotoDataUrl ??     // older direct dataUrl
    p?.targetPhoto ??            // older direct dataUrl
    null
  );
}

hasProjectPhoto(): boolean {
  return !!this.getProjectPhotoUrl();
}

openProjectPhoto(): void {
  const url = this.getProjectPhotoUrl();
  if (!url) return;
  this.photoViewerUrl = url;
  this.photoViewerOpen = true;
}

  private createLadderEntriesFromPlanner(projectId: number): void {
    const type = this.projectForm.type;
    if (type !== 'ladder' && type !== 'ocw') return;

    this.plannerError = null;

    const { distanceM, startChargeGr, endChargeGr, stepGr, shotsPerGroup } =
      this.planner;

    if (
      startChargeGr == null ||
      endChargeGr == null ||
      stepGr == null ||
      stepGr <= 0
    ) {
      this.plannerError =
        'Enter start, end and a positive step size for the charge ladder.';
      return;
    }

    if (endChargeGr < startChargeGr) {
      this.plannerError = 'End charge must be greater than start charge.';
      return;
    }

    const span = endChargeGr - startChargeGr;
    const stepsFloat = span / stepGr;
    const stepsInt = Math.round(stepsFloat);
    if (Math.abs(stepsFloat - stepsInt) > 1e-6) {
      this.plannerError =
        'Warning: step does not divide evenly into the window – last charge may be partial.';
    }

    const dist = distanceM ?? undefined;
    const defaultShots: number | undefined =
      type === 'ocw' ? shotsPerGroup ?? undefined : 1;

    let charge = startChargeGr;
    let localId = 1;

    while (charge <= endChargeGr + 1e-6) {
      const roundedCharge = Number(charge.toFixed(2));

      const entry: LoadDevEntry = {
        id: localId++,
        loadLabel: '',
        powder: undefined,
        chargeGr: roundedCharge,
        coal: undefined,
        primer: undefined,
        bullet: undefined,
        bulletWeightGr: undefined,
        bulletBc: undefined,
        distanceM: dist,
        shotsFired: defaultShots,
        groupSize: undefined,
        groupUnit: 'MOA',
        poiNote: undefined,
        notes: undefined
      } as LoadDevEntry;

      this.data.updateLoadDevEntry(projectId, entry);
      charge = Number((charge + stepGr).toFixed(2));
    }
  }

  saveProject(): void {
    if (!this.selectedRifleId || !this.projectForm.name.trim()) {
      alert('Please select rifle and enter a name for the load development.');
      return;

      
    }
const type: LoadDevType = (this.projectForm.type as LoadDevType) || 'ladder';
this.postSaveMessage = null;

// ✅ ADD THIS GUARD (prevents empty ladder/ocw projects)
if (type === 'ladder' || type === 'ocw') {
  const { startChargeGr, endChargeGr, stepGr } = this.planner;

  if (startChargeGr == null || endChargeGr == null || stepGr == null || stepGr <= 0) {
    alert('Please enter Start, End and a positive Step to plan the ladder/OCW charges.');
    return;
  }
}
if (type === 'ladder' || type === 'ocw') {
  const { startChargeGr, endChargeGr } = this.planner;
  if (startChargeGr != null && endChargeGr != null && endChargeGr < startChargeGr) {
    alert('End charge must be greater than start charge.');
    return;
  }
}
 
    this.postSaveMessage = null;
    
    if (this.editingProject) {
           const updatedAny: any = {
        ...this.editingProject,
        rifleId: this.selectedRifleId,
        name: this.projectForm.name.trim(),
        type,
        notes: this.projectForm.notes.trim(),
                powder: this.projectForm.powder?.trim?.() || undefined,
        bullet: this.projectForm.bullet?.trim?.() || undefined,
        bulletWeightGr: this.projectForm.bulletWeightGr ?? null,


        oal: this.projectForm.oal ?? null,
        oalOgive: (this.projectForm as any).oalOgive ?? null,
        distanceM: (type === 'ladder' || type === 'ocw') ? (this.planner.distanceM ?? null) : null
      };
      this.data.updateLoadDevProject(updatedAny as LoadDevProject);
      this.selectedProjectId = updatedAny.id;

      this.postSaveMessage =
        'Load development updated. Use the wizard to enter velocities, view the graph and see the highlighted nodes.';
    } else {
           const newProjectAny: any = {
        id: Date.now(),
        rifleId: this.selectedRifleId,
        name: this.projectForm.name.trim(),
        type,
        notes: this.projectForm.notes.trim() || undefined,
                      powder: this.projectForm.powder?.trim?.() || undefined,
        bullet: this.projectForm.bullet?.trim?.() || undefined,
        bulletWeightGr: this.projectForm.bulletWeightGr ?? null,


        dateStarted: new Date().toISOString(),
        entries: [],
        oal: this.projectForm.oal ?? null,
        oalOgive: (this.projectForm as any).oalOgive ?? null,
        distanceM: (type === 'ladder' || type === 'ocw') ? (this.planner.distanceM ?? null) : null
      };
      this.data.updateLoadDevProject(newProjectAny as LoadDevProject);
      this.selectedProjectId = newProjectAny.id;


      this.createLadderEntriesFromPlanner(newProjectAny.id);
      this.data.createSessionForLoadDevProject(newProjectAny);

      this.postSaveMessage =
        type === 'ocw'
          ? 'OCW planned and saved. Load and "Go Shoot" your groups, then come back here and use the OCW wizard or Edit buttons to enter velocities.'
          : 'Ladder test planned and saved. Load as per table: Go shoot the ladder, then come back here and use the wizard or Edit buttons to enter velocities and view the graph with node highlights.';
    }

    setTimeout(() => (this.postSaveMessage = null), 15000);

    this.projectFormVisible = false;
    this.editingProject = null;

    this.projectForm = this.createEmptyProjectForm();
    this.planner = this.createEmptyPlannerForm();
    this.plannerError = null;
    this.showNotesPanel = false;

    this.loadProjects();
    this.resetWizard();
  }

  deleteProject(project: LoadDevProject): void {
    if (!confirm(`Delete project "${project.name}"?`)) return;

    this.data.deleteLoadDevProject(project.id);

    if (this.selectedProjectId === project.id) {
      this.selectedProject = null;
      this.selectedProjectId = null;
    }

    this.loadProjects();
  }

  // MUST be public (template calls this)
  formatGroupSize(entry: LoadDevEntry): string {
    const any = entry as any;
    if (typeof any.groupSize !== 'number' || !isFinite(any.groupSize)) return '—';
    const unit = (any.groupUnit as string) || 'MOA';
    return `${any.groupSize.toFixed(2)} ${unit}`;
    
  }

  // ---------- entry CRUD ----------
  newEntry(): void {
    if (!this.selectedProject) {
      alert('Select a load development first.');
      return;
    }
    this.entryFormVisible = true;
    this.editingEntry = null;
    this.entryForm = this.createEmptyEntryForm();
  }

  editEntry(entry: LoadDevEntry): void {
    this.entryFormVisible = true;
    this.editingEntry = entry;
    const any = entry as any;

    this.entryForm = {
      loadLabel: any.loadLabel ?? '',
      powder: any.powder ?? '',
      chargeGr: any.chargeGr ?? null,
      coal: any.coal ?? '',
      primer: any.primer ?? '',
      bullet: any.bullet ?? '',
      bulletWeightGr: any.bulletWeightGr ?? null,
      bulletBc: any.bulletBc ?? '',
      distanceM: any.distanceM ?? null,
      shotsFired: any.shotsFired ?? null,
      groupSize: any.groupSize ?? null,
      groupUnit: (any.groupUnit as GroupSizeUnit) ?? 'MOA',
      velocityInput: any.velocityInput ?? '',
      poiNote: any.poiNote ?? '',
      notes: any.notes ?? ''
    };
  }

  cancelEntryForm(): void {
    this.entryFormVisible = false;
    this.editingEntry = null;
    this.entryForm = this.createEmptyEntryForm();
  }

  saveEntryForm(): void {
    if (!this.selectedProject) return;

    const f = this.entryForm;
    if (f.chargeGr == null) {
      alert('Charge (gr) is required.');
      return;
    }

    const payload: (Partial<LoadDevEntry> & { velocityInput?: string }) = {
      loadLabel: f.loadLabel.trim() || undefined,
      powder: f.powder.trim() || undefined,
      chargeGr: f.chargeGr,
      coal: f.coal.trim() || undefined,
      primer: f.primer.trim() || undefined,
      bullet: f.bullet.trim() || undefined,
      bulletWeightGr: f.bulletWeightGr ?? undefined,
      bulletBc: f.bulletBc.trim() || undefined,
      distanceM: f.distanceM ?? undefined,
      shotsFired: f.shotsFired ?? undefined,
      groupSize: f.groupSize ?? undefined,
      groupUnit: f.groupUnit ?? 'MOA',
      poiNote: f.poiNote.trim() || undefined,
      notes: f.notes.trim() || undefined,
      velocityInput: f.velocityInput.trim() || undefined
    };

    if (this.editingEntry) {
      const updated = { ...this.editingEntry, ...payload };
      this.data.updateLoadDevEntry(this.selectedProject.id, updated);
    } else {
      const existing = this.selectedProject.entries ?? [];
      const newId = existing.length ? Math.max(...existing.map(x => x.id)) + 1 : 1;
      const newEntry: LoadDevEntry = { id: newId, ...payload } as LoadDevEntry;
      this.data.updateLoadDevEntry(this.selectedProject.id, newEntry);
    }

    this.entryFormVisible = false;
    this.editingEntry = null;
    this.entryForm = this.createEmptyEntryForm();
    this.loadProjects();
  }

  deleteEntry(entry: LoadDevEntry): void {
    if (!this.selectedProject) return;
    if (!confirm('Delete this entry?')) return;
    this.data.deleteLoadDevEntry(this.selectedProject.id, entry.id);
    this.loadProjects();
  }

  entriesForSelectedProject(): LoadDevEntry[] {
   
    if (!this.selectedProject) return [];
    const list = [...(this.selectedProject.entries ?? [])];

    if (this.selectedProject.type === 'ocw') {
      return this.sortOcwEntriesBySd(list);
    }

    switch (this.entrySortMode) {
      case 'chargeAsc':
        return list.sort((a, b) => (a.chargeGr ?? 0) - (b.chargeGr ?? 0));
      case 'groupAsc':
        return list.sort((a, b) => (a.groupSize ?? 0) - (b.groupSize ?? 0));
      case 'groupDesc':
        return list.sort((a, b) => (b.groupSize ?? 0) - (a.groupSize ?? 0));
      case 'default':
      default:
        return list.sort((a, b) => (a.chargeGr ?? 0) - (b.chargeGr ?? 0));
    }
  }
  selectedProjectChargeRangeText(): string {
    const entries = (this.selectedProject as any)?.entries as any[] | undefined;
    if (!entries || !entries.length) return '—';

    const charges = entries
      .map((e: any) => e?.chargeGr)
      .filter((v: any): v is number => typeof v === 'number' && Number.isFinite(v));

    if (!charges.length) return '—';

    const min = Math.min(...charges);
    const max = Math.max(...charges);

    const fmt = (n: number) => (Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1));
    return `${fmt(min)} – ${fmt(max)} gr`;
  }

  // ---------- velocity stats & parsing ----------
    private parseVelocityInput(raw: string | undefined | null): number[] {
    if (!raw) return [];

        // Accept decimal comma (e.g. "2769,5") by converting it to decimal dot first.
    // Accept decimal space (e.g. "2769 5" or "64 6") some Android keypads emit.
    // After that, remaining commas act as normal separators.
    const normalized = raw
      // 1) decimal space => dot (only when the fractional part is 1 digit)
      .replace(/(\d)[\u00A0\s]+(\d)(?=\D|$)/g, '$1.$2')
      // 2) decimal comma => dot
      .replace(/(\d),(\d)/g, '$1.$2');

    return normalized
      .split(/[\s,;]+/)
      .map(x => Number(x))
      .filter(v => Number.isFinite(v));

  }

  // only fixes obvious paste duplication like "a b c a b c"
  private fixObviousRepeatedPaste(values: number[]): number[] {
    const n = values.length;
    if (n < 6) return values;

    for (const factor of [2, 3, 4]) {
      if (n % factor !== 0) continue;

      const chunkLen = n / factor;
      if (chunkLen < 3) continue;

      let ok = true;
      for (let f = 1; f < factor; f++) {
        for (let i = 0; i < chunkLen; i++) {
          if (values[i] !== values[f * chunkLen + i]) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }

      if (ok) return values.slice(0, chunkLen);
    }

    return values;
  }

  statsForEntry(entry: LoadDevEntry): VelocityStats | null {
    const any = entry as any;
    const values = this.parseVelocityInput(any.velocityInput);
    return this.computeVelocityStats(values);
  }

  private computeVelocityStats(values: number[]): VelocityStats | null {
    if (!values.length) return null;

    const n = values.length;
    const avg = values.reduce((a, b) => a + b, 0) / n;
    const sorted = [...values].sort((a, b) => a - b);
    const es = sorted[n - 1] - sorted[0];

    const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / n;
    const sd = Math.sqrt(variance);

    return { avg, es, sd, n };
  }

  private sortOcwEntriesBySd(entries: LoadDevEntry[]): LoadDevEntry[] {
    const sdCache = new Map<string, number>();
    const getSd = (e: LoadDevEntry): number => {
      const key = String((e as any).id ?? '');
      if (sdCache.has(key)) return sdCache.get(key)!;

      const s = this.statsForEntry(e)?.sd;
      const v =
        typeof s === 'number' && isFinite(s)
          ? s
          : Number.POSITIVE_INFINITY;

      sdCache.set(key, v);
      return v;
    };

    return [...entries].sort((a, b) => {
      const sa = getSd(a);
      const sb = getSd(b);
      if (sa !== sb) return sa - sb;

      const ca = Number((a as any).chargeGr ?? 0);
      const cb = Number((b as any).chargeGr ?? 0);
      if (ca !== cb) return ca - cb;

      const ia = String((a as any).id ?? '');
      const ib = String((b as any).id ?? '');
      return ia.localeCompare(ib);
    });
  }

  ocwRankForEntry(entry: LoadDevEntry): 'best' | 'second' | 'third' | null {
    if (!this.selectedProject || this.selectedProject.type !== 'ocw') return null;

    const ranked = this.sortOcwEntriesBySd(this.selectedProject.entries ?? []).filter(
      e => {
        const s = this.statsForEntry(e)?.sd;
        return typeof s === 'number' && isFinite(s);
      }
    );

    if (ranked.length < 1) return null;

    const id = String((entry as any).id ?? '');
    if (id === String((ranked[0] as any).id ?? '')) return 'best';
    if (ranked.length >= 2 && id === String((ranked[1] as any).id ?? ''))
      return 'second';
    if (ranked.length >= 3 && id === String((ranked[2] as any).id ?? ''))
      return 'third';

    return null;
  }

  ocwSdCssClass(entry: LoadDevEntry): string {
    const r = this.ocwRankForEntry(entry);
    if (r === 'best') return 'bg-emerald-900/30 ring-1 ring-emerald-500/50';
    if (r === 'second') return 'bg-amber-900/25 ring-1 ring-amber-500/40';
    if (r === 'third') return 'bg-rose-900/25 ring-1 ring-rose-500/40';
    return '';
    
  }
// ===============================
// LADDER: node band classification
// ===============================

/**
 * Estimate the ladder step (charge increment) by looking at the smallest
 * non-zero delta between sorted charge weights.
 */
private estimateLadderStepGr(entries: LoadDevEntry[]): number | null {
  const sorted = [...entries]
    .filter(e => typeof e.chargeGr === 'number')
    .sort((a, b) => (a.chargeGr ?? 0) - (b.chargeGr ?? 0));

  if (sorted.length < 2) return null;

  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].chargeGr ?? 0;
    const cur = sorted[i].chargeGr ?? 0;
    const d = +(cur - prev).toFixed(3);
    if (d > 0) deltas.push(d);
  }

  if (!deltas.length) return null;
  return Math.min(...deltas);
}

/**
 * Node band rule:
 * - If step is about 0.2gr => need 3 consecutive charges in a "flat spot"
 * - If step is about 0.3gr (or larger) => need 2 consecutive
 *
 * "Flat spot" here = within-window velocity RANGE <= 10 fps (max - min <= 10).
 */
private ladderNodeWindowSize(sorted: LoadDevEntry[]): number {
  const step = this.estimateLadderStepGr(sorted);

  // Default to 3 if we cannot estimate.
  if (step == null) return 3;

  // If step is around 0.30 or bigger -> 2-shot node; else -> 3-shot node
  return step >= 0.29 ? 2 : 3;
}

private ladderIsInNodeBand(entry: LoadDevEntry): boolean {
  const entries = this.entriesForSelectedProject?.() ?? [];
  if (!entries.length) return false;

  // Only applies to ladder projects
  if (this.selectedProject?.type !== 'ladder') return false;

  // Sort by charge low -> high
  const sorted = [...entries].sort((a, b) => (a.chargeGr ?? 0) - (b.chargeGr ?? 0));
  const k = this.ladderNodeWindowSize(sorted);

  // Collect velocities (avg) per entry
  const vels = sorted.map(e => {
    const s = this.statsForEntry(e);
    const v = s?.avg;
    return typeof v === 'number' && isFinite(v) ? v : null;
  });

  // Mark indices that belong to any qualifying window
  const inBand = new Array(sorted.length).fill(false);

  // Need at least k valid velocities in a window
  for (let i = 0; i <= sorted.length - k; i++) {
    const window = vels.slice(i, i + k);
    if (window.some(v => v == null)) continue;

    const nums = window as number[];
    const vMin = Math.min(...nums);
    const vMax = Math.max(...nums);

    if ((vMax - vMin) <= 14) {
      for (let j = i; j < i + k; j++) inBand[j] = true;
    }
  }

  // Find current entry index (prefer id match if present)
  const anyEntry = entry as any;
  const entryId = anyEntry?.id ?? null;

  let idx = -1;
  if (entryId != null) {
    idx = sorted.findIndex(e => (e as any)?.id === entryId);
  }
  if (idx < 0) {
    // fallback match by charge
    idx = sorted.findIndex(e => (e.chargeGr ?? null) === (entry.chargeGr ?? null));
  }

  if (idx < 0) return false;
  return inBand[idx] === true;
}

/** CSS class used by the ladder table row: called by the template. */
nodeCssClass(entry: LoadDevEntry): string {
  if (this.selectedProject?.type !== 'ladder') return '';

  const isNode = this.ladderIsInNodeBand(entry);
  return isNode
    ? 'bg-emerald-500/10 border-l-2 border-emerald-400'
    : '';
}

/** Used by your wizard guard; returns true if every ladder step has a velocity. */
allEntriesHaveVelocity(): boolean {
  const entries = this.entriesForSelectedProject?.() ?? [];
  if (!entries.length) return false;

  return entries.every(e => {
    const s = this.statsForEntry(e);
    return typeof s?.avg === 'number' && isFinite(s.avg);
  });
}

  
  // ---- OCW shot plotting + group ellipses (ALL SHOTS) ----
  private buildOcwShotAndGroupGeometry(entries: LoadDevEntry[]): void {
    this.ocwShotPoints = [];
    this.ocwGroupEllipses = [];

    const groups: { entryId: number; charge: number; velocities: number[] }[] = [];
      let shownRows = 0;

    for (const e of entries) {
      const charge = e.chargeGr;
      if (charge == null) continue;

      const any = e as any;
      const rawVals = this.parseVelocityInput(any.velocityInput);
      if (!rawVals.length) continue;

      const cleaned = this.fixObviousRepeatedPaste(rawVals);

      groups.push({
        entryId: (e as any).id ?? 0,
        charge,
        velocities: cleaned
      });
    }

    if (!groups.length) return;

    const charges = groups.map(g => g.charge);
    const minX = Math.min(...charges);
    const maxX = Math.max(...charges);

    const allVels: number[] = [];
    for (const g of groups) allVels.push(...g.velocities);

    let minV = Math.min(...allVels);
    let maxV = Math.max(...allVels);

    const padY = (maxV - minV) * 0.1 || 10;
    minV -= padY;
    maxV += padY;

    const x0 = 10;
    const x1 = 95;
    const yTop = 8;
    const yBot = 56;

    const sx = (charge: number) =>
      x0 + ((charge - minX) / (maxX - minX || 1)) * (x1 - x0);

    const sy = (v: number) =>
      yBot - ((v - minV) / (maxV - minV || 1)) * (yBot - yTop);

    const pts: OcwShotPoint[] = [];
    for (const g of groups) {
      const baseX = sx(g.charge);

      for (let i = 0; i < g.velocities.length; i++) {
        const v = g.velocities[i];

        const jitter = ((i % 7) - 3) * 0.75;
        const px = Math.max(x0, Math.min(x1, baseX + jitter));
        const py = Math.max(yTop, Math.min(yBot, sy(v)));

        pts.push({
          x: px,
          y: py,
          charge: g.charge,
          v,
          entryId: g.entryId,
          shotIndex: i
        });
      }
    }

    this.ocwShotPoints = pts;

    const ellipses: OcwGroupEllipse[] = [];
    for (const g of groups) {
      const gPts = pts.filter(p => p.entryId === g.entryId);
      if (!gPts.length) continue;

      let minPx = gPts[0].x, maxPx = gPts[0].x, minPy = gPts[0].y, maxPy = gPts[0].y;
      for (const p of gPts) {
        if (p.x < minPx) minPx = p.x;
        if (p.x > maxPx) maxPx = p.x;
        if (p.y < minPy) minPy = p.y;
        if (p.y > maxPy) maxPy = p.y;
      }

      const padX = 2.2;
      const padY2 = 2.8;

      const cx = (minPx + maxPx) / 2;
      const cy = (minPy + maxPy) / 2;
      const rx = Math.max(3.2, (maxPx - minPx) / 2 + padX);
      const ry = Math.max(3.2, (maxPy - minPy) / 2 + padY2);

      ellipses.push({
        cx,
        cy,
        rx,
        ry,
        charge: g.charge,
        entryId: g.entryId
      });
    }

    this.ocwGroupEllipses = ellipses;
  }

  private rebuildGraphData(): void {
    this.graphCoords = [];
    this.graphSvgPoints = '';
    this.graphMinVel = 0;
    this.graphMaxVel = 0;

    this.ocwShotPoints = [];
    this.ocwGroupEllipses = [];

    if (!this.selectedProject || !this.selectedProject.entries?.length) return;

    const entries = this.selectedProject.entries;

    const pts: { charge: number; avg: number }[] = [];

    for (const e of entries) {
      if (e.chargeGr == null) continue;
      const stats = this.statsForEntry(e);
      if (!stats) continue;
      pts.push({ charge: e.chargeGr, avg: stats.avg });
    }

    if (pts.length) {
      pts.sort((a, b) => a.charge - b.charge);

      let min = pts[0].avg;
      let max = pts[0].avg;

      for (const p of pts) {
        if (p.avg < min) min = p.avg;
        if (p.avg > max) max = p.avg;
      }

      const padding = (max - min) * 0.1 || 10;
      this.graphMinVel = min - padding;
      this.graphMaxVel = max + padding;

      const n = pts.length;
      const span = this.graphMaxVel - this.graphMinVel || 1;

      const coords: { x: number; y: number; charge: number; avg: number }[] = [];
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const x = n === 1 ? 50 : (i / (n - 1)) * 100;
        const y = 55 - ((p.avg - this.graphMinVel) / span) * 45;
        coords.push({ x, y, charge: p.charge, avg: p.avg });
      }

      this.graphCoords = coords;
      this.graphSvgPoints = coords.map(c => `${c.x},${c.y}`).join(' ');
    }

    if (this.selectedProject.type === 'ocw') {
      const sorted = [...entries].sort((a, b) => (a.chargeGr ?? 9999) - (b.chargeGr ?? 9999));
      this.buildOcwShotAndGroupGeometry(sorted);
    }
  }

  toggleGraph(): void {
    const canShow = this.graphCoords.length > 0 || this.ocwShotPoints.length > 0;

    if (!canShow) {
      alert('No velocity data to graph yet.');
      return;
    }
    this.showGraph = !this.showGraph;
  }

  startLadderWizard(): void {
    if (!this.selectedProject) {
      alert('Select a load development first.');
      return;
    }

    if (this.selectedProject.type !== 'ladder' && this.selectedProject.type !== 'ocw') {
      alert('The velocity wizard is only available for ladder and OCW developments.');
      return;
    }

    if (this.allEntriesHaveVelocity()) {
      alert('All steps already have velocities. Use the Edit buttons for changes.');
      return;
    }

    const entries = [...(this.selectedProject.entries ?? [])].sort(
      (a, b) => (a.chargeGr ?? 9999) - (b.chargeGr ?? 9999)
    );

    if (!entries.length) {
      alert('No entries created for this development yet.');
      return;
    }

    this.ladderWizardEntries = entries;
    this.ladderWizardIndex = 0;
    this.ladderWizardActive = true;

    this.singleVelocityEditActive = false;

    this.setWizardCurrentEntry();
  }

  private setWizardCurrentEntry(): void {
    if (!this.ladderWizardActive) return;

    if (this.ladderWizardIndex >= this.ladderWizardEntries.length) {
      this.finishLadderWizard(true);
      return;
    }

    this.velocityEditEntry = this.ladderWizardEntries[this.ladderWizardIndex];
    const any = this.velocityEditEntry as any;
    this.velocityEditValue = any.velocityInput ?? '';

    this.focusVelocityInput(true);
  }

  private finishLadderWizard(showSavedToast = false): void {
    this.ladderWizardActive = false;
    this.velocityEditEntry = null;
    this.velocityEditValue = '';
    this.ladderWizardEntries = [];
    this.ladderWizardIndex = 0;

    if (showSavedToast) {
      this.postSaveMessage = 'Saved ✅';
      setTimeout(() => (this.postSaveMessage = null), 2000);
    }
  }

  private goToNextWizardEntry(): void {
    if (!this.selectedProject || !this.velocityEditEntry) {
      this.finishLadderWizard(false);
      return;
    }

    const sorted = [...(this.selectedProject.entries ?? [])].sort(
      (a, b) => (a.chargeGr ?? 9999) - (b.chargeGr ?? 9999)
    );

    const currentIndex = sorted.findIndex(e => e.id === this.velocityEditEntry!.id);

    if (currentIndex < 0 || currentIndex + 1 >= sorted.length) {
      this.finishLadderWizard(true);
      return;
    }

    this.ladderWizardEntries = sorted;
    this.ladderWizardIndex = currentIndex + 1;

    this.velocityEditEntry = sorted[this.ladderWizardIndex];
    const any = this.velocityEditEntry as any;
    this.velocityEditValue = any.velocityInput ?? '';

    this.focusVelocityInput(true);
  }

  saveVelocityAndNext(): void {
    if (!this.selectedProject || !this.velocityEditEntry) return;

    const raw = this.velocityEditValue ?? '';
    const trimmed = raw.toString().trim();

    if (trimmed) {
      const values = this.parseVelocityInput(trimmed);
      if (!values.length) {
        alert('Enter one or more numeric velocities, separated by spaces or commas.');
        this.focusVelocityInput(true);
        return;
      }

      if (this.selectedProject.type === 'ocw') {
        const plannedShots =
          this.velocityEditEntry.shotsFired ?? this.planner.shotsPerGroup ?? null;

        if (plannedShots && values.length !== plannedShots) {
          alert(
            `You planned ${plannedShots} shots for this charge. Enter exactly ${plannedShots} velocities, or leave the field blank and press Skip if you have not shot this group yet.`
          );
          this.focusVelocityInput(true);
          return;
        }
      }

      const any = this.velocityEditEntry as any;
      any.velocityInput = values.join(' ');
      this.velocityEditEntry.shotsFired = values.length;

      this.data.updateLoadDevEntry(this.selectedProject.id, this.velocityEditEntry);
      this.refreshSelectedProject();
    }

    this.goToNextWizardEntry();
  }

  skipVelocityAndNext(): void {
    this.goToNextWizardEntry();
  }

  cancelLadderWizard(): void {
    this.finishLadderWizard(false);
  }

  editVelocityForEntry(entry: LoadDevEntry): void {
    this.ladderWizardActive = false;

    this.singleVelocityEditActive = true;
    this.velocityEditEntry = entry;

    const any = entry as any;
    this.velocityEditValue = any.velocityInput ?? '';

    this.focusVelocityInput(true);
  }

  saveSingleVelocity(): void {
    if (!this.selectedProject || !this.velocityEditEntry) {
      this.singleVelocityEditActive = false;
      return;
    }

    const raw = this.velocityEditValue ?? '';
    const trimmed = raw.toString().trim();

    if (!trimmed) {
      const any = this.velocityEditEntry as any;
      any.velocityInput = undefined;
      this.velocityEditEntry.shotsFired = undefined;

      this.data.updateLoadDevEntry(this.selectedProject.id, this.velocityEditEntry);
      this.refreshSelectedProject();

      this.singleVelocityEditActive = false;
      this.velocityEditEntry = null;
      this.velocityEditValue = '';
      return;
    }

    const values = this.parseVelocityInput(trimmed);
    if (!values.length) {
      alert('Enter one or more numeric velocities, separated by spaces or commas.');
      this.focusVelocityInput(true);
      return;
    }

    const any = this.velocityEditEntry as any;
    any.velocityInput = values.join(' ');
    this.velocityEditEntry.shotsFired = values.length;

    this.data.updateLoadDevEntry(this.selectedProject.id, this.velocityEditEntry);
    this.refreshSelectedProject();

    this.singleVelocityEditActive = false;
    this.velocityEditEntry = null;
    this.velocityEditValue = '';
  }

  cancelSingleVelocityEdit(): void {
    this.singleVelocityEditActive = false;
    this.velocityEditEntry = null;
    this.velocityEditValue = '';
  }

  private updateOcwValidationWarning(): void {
    const project = this.selectedProject;

    if (!project || project.type !== 'ocw' || !project.entries?.length) {
      this.ocwValidationWarning = null;
      return;
    }

    const entriesWithVel = project.entries.filter(e => {
      const any = e as any;
      const vals = this.parseVelocityInput(any.velocityInput);
      return vals.length > 0;
    });

    if (!entriesWithVel.length) {
      this.ocwValidationWarning = 'No velocities captured yet for OCW groups.';
      return;
    }

    const shotCounts = new Set<number>();
    for (const e of entriesWithVel) {
      const any = e as any;
      const vals = this.parseVelocityInput(any.velocityInput);
      const n = e.shotsFired ?? vals.length;
      if (n > 0) shotCounts.add(n);
    }

    this.ocwValidationWarning =
      shotCounts.size > 1
        ? 'OCW groups do not all have the same number of shots. For good OCW analysis, keep group sizes consistent (e.g. 3 or 5 shots per charge).'
        : null;
  }

  isProjectComplete(project: LoadDevProject): boolean {
    if (!project.entries || !project.entries.length) return false;

    return project.entries.every(e => {
      const any = e as any;
      const vals = this.parseVelocityInput(any.velocityInput);
      return vals.length > 0;
    });
  }

  onBackFromLoadDev(): void {
    this.selectedProjectId = null;
    this.selectedProject = null;

    this.projectFormVisible = false;
    this.editingProject = null;

    this.entryFormVisible = false;
    this.editingEntry = null;

    this.hasResultsForSelectedProject = false;
    this.resultsCollapsed = false;

    this.showGraph = false;
    this.graphCoords = [];
    this.graphSvgPoints = '';

    this.ocwShotPoints = [];
    this.ocwGroupEllipses = [];

    this.singleVelocityEditActive = false;
    this.velocityEditEntry = null;
    this.velocityEditValue = '';

    this.ladderWizardActive = false;
    this.ladderWizardEntries = [];
    this.ladderWizardIndex = 0;

    this.postSaveMessage = null;

    this.resetWizard();
  }
}