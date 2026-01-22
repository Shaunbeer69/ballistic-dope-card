import { CommonModule } from '@angular/common';
import {
  Component,
  ChangeDetectorRef,
  ElementRef,
  EventEmitter,
  NgZone,
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
import { registerPlugin } from '@capacitor/core';
interface AudioRoutePlugin {
  forceSpeaker(): Promise<void>;
}

const AudioRoute = Capacitor.isNativePlatform()
  ? registerPlugin<AudioRoutePlugin>('AudioRoute')
  : null;



interface ProjectForm {
  rifleId: number | null;
  name: string;
  type: LoadDevType | null;
  notes: string;

  powder: string;
  bullet: string;
  bulletWeightGr: number | null;
  brass: string;
	  // Lands (reference length for seating depth)
	  lands: number | null;

  oal: number | null;
  oalOgive: number | null;

  // ✅ NEW: unit selector for COAL / Ogive input
  oalUnit: 'mm' | 'in';

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

  // ✅ NEW: unit selector for distance
  distanceUnit: 'm' | 'mi';

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
  @ViewChild('projectSelectEl') projectSelectEl?: ElementRef<HTMLSelectElement>;
  @ViewChild('shotsPerGroupEl') shotsPerGroupEl?: ElementRef<HTMLInputElement>;

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
    // If we are already at the "project list" level, this Back must still work → go to main menu
    if (!this.selectedProjectId && !this.selectedProject) {
      this.projectPickerOpen = false;
      this.backToMenu.emit();
      return;
    }

    // Go back ONE level: from project detail → project list
    this.selectedProjectId = null;
    this.selectedProject = null;

    // Reset project-level UI only
    this.resultsCollapsed = true;
    this.showGraph = false;
    this.ladderWizardActive = false;
    this.singleVelocityEditActive = false;

    // Open the inline project picker list (reliable on Android)
    this.projectPickerOpen = true;

    // Bring selector into view
    setTimeout(() => {
      const sel = this.projectSelectEl?.nativeElement;
      try {
        sel?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        // ignore
      }
    }, 0);
  }

  selectProjectFromPicker(id: number): void {
    this.projectPickerOpen = false;
    this.selectedProjectId = id;
    this.onProjectSelectChange();
  }


  openProjectPicker(ev?: Event): void {
    try {
      ev?.preventDefault();
      ev?.stopPropagation();
    } catch {
      // ignore
    }

    this.projectPickerOpen = true;

    // Bring selector into view
    setTimeout(() => {
      const sel = this.projectSelectEl?.nativeElement;
      try {
        sel?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        // ignore
      }
    }, 0);
  }

  // ==========================
// MIC (VOICE NOTE - ACTIVE)
// ==========================
micInlineMessage: string | null = null;

isVoiceRecording = false;
voiceNoteDataUrl: string | null = null;
voiceNoteDurationMs: number | null = null;
isVoicePlaying = false;
private audioRoute: AudioRoutePlugin | null = AudioRoute;


private voiceAudioCtx: AudioContext | null = null;
private voiceSource: AudioBufferSourceNode | null = null;

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
async toggleVoicePlayback(): Promise<void> {
  if (this.isVoicePlaying) {
    this.stopVoicePlayback();
    return;
  }
  await this.playVoicePlayback();
}
async forceSpeakerForPlayback(): Promise<void> {
  try {
    if (this.audioRoute) {
      await this.audioRoute.forceSpeaker();
    }
  } catch {
    // ignore
  }
}


private async playVoicePlayback(): Promise<void> {
  if (!this.voiceNoteDataUrl) return;


  this.stopVoicePlayback();

// ✅ Force loudspeaker BEFORE starting audio
await this.forceSpeakerForPlayback();


  // WebAudio tends to route as "media" -> speaker on Android WebView
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  this.voiceAudioCtx = ctx;

  const resp = await fetch(this.voiceNoteDataUrl);
  const arr = await resp.arrayBuffer();
  const buf = await ctx.decodeAudioData(arr.slice(0));

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);

 src.onended = () => {
  this.zone.run(() => {
    this.isVoicePlaying = false;
    try {
      src.disconnect();
    } catch {}
    this.voiceSource = null;
    if (this.voiceAudioCtx && typeof this.voiceAudioCtx.close === 'function') {
      try {
        this.voiceAudioCtx.close();
      } catch {}
      this.voiceAudioCtx = null;
    }
    try {
      this.cdr.detectChanges();
    } catch {}
  });
};


  this.voiceSource = src;
  this.isVoicePlaying = true;

  try {
    await ctx.resume();
  } catch {}

  src.start(0);
  setTimeout(() => {
  void this.forceSpeakerForPlayback();
}, 500);

setTimeout(() => {
  void this.forceSpeakerForPlayback();
}, 1200);

  // 🔊 Android sometimes flips back to earpiece AFTER start.
// Force speaker again a moment later.
setTimeout(() => {
  void this.forceSpeakerForPlayback();
}, 150);

}

private stopVoicePlayback(): void {
  this.isVoicePlaying = false;

  if (this.voiceSource) {
    try {
      this.voiceSource.stop();
    } catch {}
    try {
      this.voiceSource.disconnect();
    } catch {}
    this.voiceSource = null;
  }

  if (this.voiceAudioCtx) {
    try {
      this.voiceAudioCtx.close();
    } catch {}
    this.voiceAudioCtx = null;
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
    await this.forceSpeakerForPlayback();

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
  this.stopVoicePlayback();


  const updated: any = { ...(this.selectedProject as any) };
  delete updated.voiceNoteBase64;
  delete updated.voiceNoteDurationMs;

  this.data.updateLoadDevProject(updated);
  //this.syncVoiceNoteFromProject();

  this.micInlineMessage = 'Voice note removed';
  setTimeout(() => (this.micInlineMessage = null), 1200);
 // this.data.updateLoadDevProject(updated);

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
  private async syncTargetPhotoFromProject(): Promise<void> {
    try {
      const any: any = this.selectedProject as any;
      if (!any) {
        this.targetPhotoDataUrl = null;
        return;
      }

      // 1) Migrate any existing base64/dataUrl onto Filesystem once
      await this.ensureProjectPhotoOnFs(any);

      // 2) Load from Filesystem path (preferred)
      if (any?.targetPhotoPath) {
        const path = String(any.targetPhotoPath);
        const cached = this.photoDataUrlCache.get(path);
        if (cached) {
          this.targetPhotoDataUrl = cached;
        } else {
          const url = await this.readJpegDataUrlFromFs(path);
          this.targetPhotoDataUrl = url;
          if (url) this.photoDataUrlCache.set(path, url);
        }
        // Also preload entry photos so Notes shows instantly
        this.preloadSelectedProjectEntryPhotos();
        return;
      }

      // 3) Nothing
      this.targetPhotoDataUrl = null;
      this.preloadSelectedProjectEntryPhotos();
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
    const file = input.files?.[0];

    if (!file) return;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });

        // Save to Filesystem and store only a path on the project
    const pid = Number((this.selectedProject as any)?.id ?? 0);
    if (pid) {
      const path = this.makeProjectPhotoPath(pid);
      await this.writeJpegDataUrlToFs(path, dataUrl);

      (this.selectedProject as any).targetPhotoPath = path;
      (this.selectedProject as any).targetPhotoCapturedAt = new Date().toISOString();

      // Remove large legacy fields so localStorage stays small
      try { delete (this.selectedProject as any).targetPhotoBase64; } catch {}
      try { delete (this.selectedProject as any).targetPhotoDataUrl; } catch {}
      try { delete (this.selectedProject as any).targetPhoto; } catch {}

      // Cache for instant UI preview
      this.photoDataUrlCache.set(path, dataUrl);

      try {
        this.data.updateLoadDevProject({ ...(this.selectedProject as any) });
        this.refreshSelectedProject();
      } catch {}
    }

    // Keep preview in sync
    void this.syncTargetPhotoFromProject();


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
 // IMPORTANT:
  // Do NOT overwrite entry.targetPhoto here.
  // The correct photo is written after capture in attachPhotoToEntry(...)
  // which saves to Filesystem and stores targetPhoto.path.


  // Web fallback (file picker)
  //if (!Capacitor.isNativePlatform()) {
  // this.pendingEntryForPhoto = entryId;
   // this.entryPhotoInlineMessage = 'Choose an image…';
   // setTimeout(() => inputEl?.nativeElement?.click(), 0);
 //return;
  //  }

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
  const file = input.files?.[0];

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

    // Group size prompt removed — we calculate automatically from grid overlay later
  let groupSize: number | undefined = undefined;
  let unit: GroupSizeUnit | undefined = undefined;



    // Store on the entry: save to Filesystem and persist only path (not big dataUrl)
  if (!this.selectedProject) return;

  const pid = Number((this.selectedProject as any)?.id ?? 0);
  const eid = Number((entry as any)?.id ?? 0);

  const savedPath = (pid && eid)
    ? this.makeEntryPhotoPath(pid, eid)
    : null;

  if (!savedPath) return;

  await this.writeJpegDataUrlToFs(savedPath, stampedDataUrl);

  // Cache for instant UI preview
  this.photoDataUrlCache.set(savedPath, stampedDataUrl);

  const updatedEntry: LoadDevEntry = {
    ...(entry as any),
    targetPhoto: {
      path: savedPath,
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

  // ✅ Downscale before saving (prevents localStorage quota loss)
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const maxDim = 1600; // keep quality, much smaller base64

  let outW = srcW;
  let outH = srcH;

  if (outW > maxDim || outH > maxDim) {
    const scale = maxDim / Math.max(outW, outH);
    outW = Math.max(1, Math.round(outW * scale));
    outH = Math.max(1, Math.round(outH * scale));
  }

  canvas.width = outW;
  canvas.height = outH;


  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);


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

    // ✅ smaller file = survives app exit/restart
  return canvas.toDataURL('image/jpeg', 0.78);
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
  // remove filesystem-backed photo too (this is the real "Overall photo" source now)
const anyP: any = this.selectedProject as any;
const path = anyP?.targetPhotoPath ? String(anyP.targetPhotoPath) : null;

if (path) {
  this.photoDataUrlCache.delete(path);
  // best effort: remove the actual file
  void Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {});
}

try { delete anyP.targetPhotoPath; } catch {}


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
      const pageH = doc.internal.pageSize.getHeight();

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
      // Planned / Shot dates (export header)
      const fmtDateTime = (v: any): string => {
        if (!v) return '';
        const d = v instanceof Date ? v : new Date(v);
        if (Number.isNaN(d.getTime())) return '';
        const ds = d.toLocaleDateString(undefined, { year: '2-digit', month: '2-digit', day: '2-digit' });
        const ts = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
        return `${ds}, ${ts}`;
      };

      const plannedIso =
        (this.selectedProject as any)?.datePlanned ??
        (this.selectedProject as any)?.dateStarted ??
        this.selectedProject.dateStarted;

      // Shot date: prefer explicit project field, else infer from latest entry timestamp that has shot/velocity data
      let shotIso =
        (this.selectedProject as any)?.dateShot ??
        (this.selectedProject as any)?.dateDeveloped ??
        null;

      if (!shotIso) {
      const entries = this.entriesForSelectedProject();

        let best: string | null = null;

        for (const e of entries) {
          const anyE: any = e as any;

          // "has shot data" heuristics (covers your different entry shapes)
          const hasVel =
            (typeof anyE.velocity === 'number' && Number.isFinite(anyE.velocity)) ||
            (Array.isArray(anyE.velocities) && anyE.velocities.length > 0) ||
            (typeof anyE.velocityInput === 'string' && anyE.velocityInput.trim().length > 0);

          if (!hasVel) continue;

          const t = (anyE.updatedAt ?? anyE.createdAt ?? null) as string | null;
          if (!t) continue;

          if (!best || new Date(t).getTime() > new Date(best).getTime()) best = t;
        }

        shotIso = best;
      }

      doc.setFontSize(10);
      doc.text(`Planned: ${fmtDateTime(plannedIso) || '—'}`, leftMargin, y);
      y += 12;

      doc.text(`Shot: ${shotIso ? fmtDateTime(shotIso) : '—'}`, leftMargin, y);
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
                  // ✅ OCW: draw shot dots + velocity labels (no connecting lines)
          try {
            const pts = [...(this.ocwShotPoints || [])]
              .filter(p => Number.isFinite(p.charge) && Number.isFinite(p.v))
              .sort((a, b) => (a.charge - b.charge) || (a.shotIndex - b.shotIndex));

                        doc.setDrawColor(0);
            doc.setTextColor(0);
            doc.setFontSize(7);

            // ✅ Keep velocity labels from overlapping each other
            const placedLabels: { x: number; y: number; w: number; h: number }[] = [];
            const labelH = 9;

            const overlaps = (a: any, b: any) =>
              !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);

            for (const p of pts) {
              // small x-jitter so shots at same charge don't overlap perfectly
              const jitter = ((p.shotIndex % 7) - 3) * 1.2;

              const px = Math.max(xMin, Math.min(xMax, sx(p.charge) + jitter));
              const py = Math.max(yMin, Math.min(yMax, sy(p.v)));

              // dot
              doc.setLineWidth(0.8);
              doc.circle(px, py, 2.0, 'S');

              // velocity label next to dot (outside the dot)
              const vTxt = `${Math.round(p.v)}`;
              const tw = doc.getTextWidth(vTxt);

              let tx = px + 4;
              if (tx + tw > xMax) tx = px - 4 - tw; // flip left near right edge

              const topLimit = yMin + 6;
              const botLimit = yMax - 2;

              // baseline default
              const baseTy = Math.max(topLimit, Math.min(botLimit, py - 2));

              // try down first, then up, in labelH steps until no overlap
              let chosenTy: number | null = null;

              for (const dir of [1, -1]) {
                let tyTry = baseTy;
                for (let tries = 0; tries < 12; tries++) {
                  const box = { x: tx - 1, y: tyTry - labelH, w: tw + 2, h: labelH + 2 };

                  if (box.y < topLimit - labelH) {
                    tyTry += dir * labelH;
                    continue;
                  }
                  if (box.y + box.h > botLimit + 2) {
                    tyTry += dir * labelH;
                    continue;
                  }

                  const hit = placedLabels.some(b => overlaps(box, b));
                  if (!hit) {
                    chosenTy = tyTry;
                    placedLabels.push(box);
                    break;
                  }

                  tyTry += dir * labelH;
                }
                if (chosenTy != null) break;
              }

              const finalTy = chosenTy ?? Math.max(topLimit, Math.min(botLimit, baseTy));
              doc.text(vTxt, tx, finalTy);
            }

          } catch {
            // ignore
          }

          // ✅ OCW: charge labels BELOW the chart frame (outside the block at the bottom)
          try {
            const charges = Array.from(
              new Set(
                (entries || [])
                  .map(e => e.chargeGr)
                  .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
                  .map(v => Number(v.toFixed(2)))
              )
            ).sort((a, b) => a - b);

            doc.setFontSize(8);
            doc.setTextColor(0);

            const labelY = chartY + chartH + 12; // outside the graph frame

            for (const c of charges) {
              const txt = `${c.toFixed(2)} gr`;
              const tw = doc.getTextWidth(txt);

              let tx = sx(c) - tw / 2;
              tx = Math.max(chartX + 2, Math.min(chartX + chartW - 2 - tw, tx)); // clamp

              doc.text(txt, tx, labelY);
            }
          } catch {
            // ignore
          }


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
            doc.text(`${Math.round(p.avg)} fps`, x + 4, yv - 2);


          }
          // LADDER: charge labels BELOW the chart frame (under the graph)
          try {
            const labelY = chartY + chartH + 12;
            doc.setFontSize(8);

            for (const p of this.graphCoords) {
              const txt = `${p.charge.toFixed(2)} gr`;
              const tw = doc.getTextWidth(txt);

              let tx = sx(p.charge) - tw / 2;
              tx = Math.max(chartX + 2, Math.min(chartX + chartW - 2 - tw, tx)); // clamp inside frame

              doc.text(txt, tx, labelY);
            }
          } catch {
            // ignore
          }

                    // Axis hints (min/max) - disabled for Ladder because we print ALL charges below the graph
          if (!includeLadderGraph) {
            doc.setFontSize(9);
            doc.text(`${minXv.toFixed(2)} gr`, chartX, chartY + chartH + 12);
            doc.text(`${maxXv.toFixed(2)} gr`, chartX + chartW - 45, chartY + chartH + 12);
          }

         

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
        : ['Charge', 'Velocity', 'Shot', 'Node', 'Notes'];

      // Column anchors (tuned for A4 portrait)
      const colX = isOcwProject
        ? [leftMargin, leftMargin + 70, leftMargin + 120, leftMargin + 160, leftMargin + 205, leftMargin + 255]
        : [leftMargin, leftMargin + 80, leftMargin + 140, leftMargin + 190, leftMargin + 240];


      cols.forEach((c, i) => doc.text(c, colX[i], y));
      y += 10;
      doc.setLineWidth(0.5);
      doc.line(leftMargin, y, pageW - rightMargin, y);

      y += 12;

      const lineH = 12;
      let shownRows = 0;

      for (const e of entries) {
        const notesTxt = this.buildExportNotesForEntry(e);

                const notesX = isOcwProject ? colX[5] : colX[4];
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
               const isNode = !isOcwProject && this.ladderIsInNodeBand(e);

        const chargeTxt = `${e.chargeGr ?? ''}`;


                doc.text(chargeTxt, colX[0], y);

        doc.text(s ? `${Math.round(s.avg)}` : '—', colX[1], y);

        if (isOcwProject) {
          doc.text(s ? `${s.sd.toFixed(1)}` : '—', colX[2], y);
          doc.text(s ? `${Math.round(s.es)}` : '—', colX[3], y);
          doc.text(this.formatGroupSize(e), colX[4], y);
             } else {
          // Match the UI: 1/Total ... N/Total
          // (shownRows is 0-based count already printed so far)
          const shotLabel = `${shownRows + 1}/${entries.length}`;
          doc.text(shotLabel, colX[2], y);

          // New PDF column: Node indicator (matches on-screen NODE pills)
          doc.text(isNode ? 'NODE' : '', colX[3], y);
        }



                if (notesLines.length) {
          doc.text(notesLines[0], notesX, y);
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
const commentTitleH = 22; // title (bigger) + 1 blank line gap
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

// Draw Comments title (bold + 50% larger) + one-line gap below
(doc as any).setFont(undefined, 'bold');
doc.setFontSize(17); // 11 * 1.5 ≈ 16.5
doc.setTextColor(0);
doc.text('Comments', leftMargin, y);

(doc as any).setFont(undefined, 'normal');
doc.setFontSize(10);

// use the reserved title height (includes blank line)
y += commentTitleH;



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

// Project-level only (single-page target photo area is reserved for the Notes/Project photo)
const projectAny = this.selectedProject as any;

const photoDataUrl =
  projectAny?.targetPhotoPath
    ? (this.photoDataUrlCache.get(String(projectAny.targetPhotoPath)) ?? await this.readJpegDataUrlFromFs(String(projectAny.targetPhotoPath)))
    : (projectAny?.targetPhotoBase64 ? `data:image/jpeg;base64,${projectAny.targetPhotoBase64}` : (projectAny?.targetPhotoDataUrl ?? null));



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
  // ----- OCW line photos: Page 2+ (two columns, max 4 photos per page, charge under + note lines) -----
  if (isOcwProject) {
    const photoItems = this.ocwPhotoNotesItems(); // sorted by charge, only entries with photos

    if (photoItems.length) {
      const innerW = pageW - leftMargin - rightMargin;
      const colGap = 12;
      const colW = (innerW - colGap) / 2;

      const imgH = 250;        // keep your existing tile size
      const captionGap = 12;   // caption baseline distance under image
      const pad = 6;

      const noteLineCount = 5;
      const noteLineGap = 10;  // spacing between note lines
      const noteTopGap = 16;   // gap after caption before first note line
      const afterNotesGap = 18;

      let col = 0; // 0 left, 1 right
      let photosOnPage = 0;
      let yStart = topMargin;

           const drawChargesHeader = () => {
        // Page 2+ header: repeat the same OCW charge table header + rows (like page 1)
        y = topMargin;

        // Optional title (kept)
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text('Charges', leftMargin, y);

        y += 10;

        // Table header (same columns as page 1 for OCW)
        doc.setFontSize(9);
        doc.setTextColor(0);
        cols.forEach((c, i) => doc.text(c, colX[i], y));
        y += 8;

        doc.setLineWidth(0.4);
        doc.setDrawColor(0);
        doc.line(leftMargin, y, pageW - rightMargin, y);
        y += 10;

        // Table rows (same data as page 1)
        doc.setFontSize(8);

        for (const e of entries) {
          const s = this.statsForEntry(e);
          const notesTxt = this.buildExportNotesForEntry(e);
          const notesX = colX[5];
          const notesW = (pageW - rightMargin) - notesX;
          const notesLine = notesTxt ? (doc.splitTextToSize(notesTxt, Math.max(50, notesW))[0] ?? '') : '';

          doc.text(`${e.chargeGr ?? ''}`, colX[0], y);
          doc.text(s ? `${Math.round(s.avg)}` : '—', colX[1], y);
          doc.text(s ? `${s.sd.toFixed(1)}` : '—', colX[2], y);
          doc.text(s ? `${Math.round(s.es)}` : '—', colX[3], y);
          doc.text(this.formatGroupSize(e), colX[4], y);
          if (notesLine) doc.text(notesLine, notesX, y);

          y += 10;
        }

        // Separator line before photos
        y += 2;
        doc.setLineWidth(0.4);
        doc.line(leftMargin, y, pageW - rightMargin, y);
        y += 10;

        yStart = y;
      };


      const drawNoteLines = (startY: number) => {
        doc.setLineWidth(0.3);
        doc.setDrawColor(160);

        for (let i = 0; i < noteLineCount; i++) {
          const ly = startY + i * noteLineGap;
          doc.line(leftMargin, ly, pageW - rightMargin, ly);
        }

        doc.setDrawColor(0);
      };

      const startNewPhotosPage = () => {
        doc.addPage();
        drawChargesHeader();
        col = 0;
        photosOnPage = 0;
        y = yStart;
      };

      // Start Page 2 (or next pages)
      startNewPhotosPage();

      for (const it of photoItems) {
        // Max 4 photos per page
        if (photosOnPage >= 4) {
          startNewPhotosPage();
        }

        const x = leftMargin + (col === 0 ? 0 : (colW + colGap));

        // Draw the image fitted into a tile area (no stretch)
        const url = it.url;

        try {
          const imgType = url.includes('data:image/png') ? 'PNG' : 'JPEG';
          const base64 = url.split(',')[1];

          const boxX = x;
          const boxY = y;
          const boxW = colW;
          const boxH = imgH;

          // optional light frame
          doc.setLineWidth(0.6);
          doc.setDrawColor(160);
          doc.rect(boxX, boxY, boxW, boxH);

          let drawX = boxX + pad;
          let drawY = boxY + pad;
          let drawW = Math.max(1, boxW - pad * 2);
          let drawH = Math.max(1, boxH - pad * 2);

          try {
            const props = (doc as any).getImageProperties?.(url);
            const iw = props?.width ?? props?.w;
            const ih = props?.height ?? props?.h;

            if (iw && ih) {
              const scale = Math.min(drawW / iw, drawH / ih);
              const w = iw * scale;
              const h = ih * scale;

              drawX = boxX + (boxW - w) / 2;
              drawY = boxY + (boxH - h) / 2;
              drawW = w;
              drawH = h;
            }
          } catch {
            // keep default
          }

          doc.addImage(base64, imgType as any, drawX, drawY, drawW, drawH);
        } catch {
          doc.setFontSize(10);
          doc.setTextColor(80);
          doc.text('Photo load failed', x + 10, y + 18);
          doc.setTextColor(0);
        }

        // Charge caption BELOW the photo (centered)
        const chargeTxt = `${Number(it.charge).toFixed(2)} gr`;
        doc.setFontSize(10);
        doc.setTextColor(0);

        const tw = doc.getTextWidth(chargeTxt);
        doc.text(chargeTxt, x + (colW - tw) / 2, y + imgH + captionGap);

        // advance column/row
        photosOnPage++;

        if (col === 0) {
          col = 1;
        } else {
          // row complete (2 photos): add 5 note lines across the page
          col = 0;

          const linesStartY = y + imgH + captionGap + noteTopGap;
          drawNoteLines(linesStartY);

          // move to next row start
          y = linesStartY + (noteLineCount * noteLineGap) + afterNotesGap;
        }
      }

      // If we ended on left column (odd count), still add note lines after that single photo row
      if (col === 1) {
        const linesStartY = y + imgH + captionGap + noteTopGap;
        drawNoteLines(linesStartY);
        y = linesStartY + (noteLineCount * noteLineGap) + afterNotesGap;
      }
    }
  }

            // -------------------------------
      // PAGE 2+: (Disabled)
      // OCW line photos are rendered by the OCW block above:
      // - Header only on Page 1
      // - Page 2+ header is "Charges"
      // - 2 columns, max 4 photos per page
      // - Charge under each photo + 5 note lines after each row
      // -------------------------------



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

               // Share (Print is also a share-target on Android). Some print targets can reject
        // the share promise even after the print job is created — do NOT treat that as export failure.
        try {
          await Share.share({
            title: 'Load development PDF',
            text: fileName,
            url: res.uri
          });

          this.postSaveMessage = 'Sent to printer / shared ✅';
          setTimeout(() => (this.postSaveMessage = null), 2000);
        } catch (shareErr) {
          console.warn('Share/Print returned an error (non-fatal):', shareErr);

          // File was still saved successfully
          this.postSaveMessage = 'Saved ✅';
          setTimeout(() => (this.postSaveMessage = null), 2000);
        }

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
    projectPickerOpen = false;

 selectedProject:
  | (LoadDevProject & {
      powder?: string;
      bullet?: string;
      bulletWeightGr?: number | null;
      oal?: number | null;
      oalOgive?: number | null;
            oalUnit?: 'mm' | 'in';

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
  plannerStepText: string = '.';

  plannerError: string | null = null;


    private buildExportNotesForEntry(e: LoadDevEntry): string {
    const any = e as any;

    const parts: string[] = [];

    const n1 = (any.notes ?? '').toString().trim();
    if (n1) parts.push(n1);

    const n2 = (any.poiNote ?? '').toString().trim();
    if (n2) parts.push(n2);

   
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
   visibleEntries: LoadDevEntry[] = [];
  // ----------------------------
  // PERF CACHES (avoid hangs)
  // ----------------------------
  private statsCache = new Map<number, VelocityStats | null>();
  private ladderNodeBandIds = new Set<number>();
  private ocwRankCache = new Map<number, 'best' | 'second' | 'third' | null>();
  private ocwBestIdCache: number | null = null;
  private readonly LADDER_NODE_MAX_VEL_RANGE_FPS = 10;
  private entryIdOf(e: LoadDevEntry): number | null {
    const id = Number((e as any)?.id);
    return Number.isFinite(id) ? id : null;
  }

  private clearPerfCaches(): void {
    this.statsCache.clear();
    this.ladderNodeBandIds.clear();
    this.ocwRankCache.clear();
    this.ocwBestIdCache = null;
  }

  private rebuildPerfCachesFrom(entries: LoadDevEntry[]): void {
    this.clearPerfCaches();

    // Warm stats cache once
    for (const e of entries) this.statsForEntry(e);

    if (this.selectedProject?.type === 'ladder') {
      this.rebuildLadderNodeBandCache(entries);
    }

    if (this.selectedProject?.type === 'ocw') {
      this.rebuildOcwRankCache(entries);
    }
  }

  private rebuildOcwRankCache(entries: LoadDevEntry[]): void {
    // rank only entries with numeric SD
    const ranked = [...entries]
      .map(e => ({ e, sd: this.statsForEntry(e)?.sd }))
      .filter(x => typeof x.sd === 'number' && isFinite(x.sd as number))
      .sort((a, b) => (a.sd as number) - (b.sd as number));

    // reset
    this.ocwBestIdCache = null;

    const first = ranked[0]?.e;
    const second = ranked[1]?.e;
    const third = ranked[2]?.e;

    const id1 = first ? this.entryIdOf(first) : null;
    const id2 = second ? this.entryIdOf(second) : null;
    const id3 = third ? this.entryIdOf(third) : null;

    if (id1 != null) {
      this.ocwRankCache.set(id1, 'best');
      this.ocwBestIdCache = id1;
    }
    if (id2 != null) this.ocwRankCache.set(id2, 'second');
    if (id3 != null) this.ocwRankCache.set(id3, 'third');
  }

  private rebuildLadderNodeBandCache(entries: LoadDevEntry[]): void {
    // Only applies to ladder projects
    if (this.selectedProject?.type !== 'ladder') return;

    const sorted = [...entries].sort((a, b) => (a.chargeGr ?? 0) - (b.chargeGr ?? 0));
    const k = this.ladderNodeWindowSize(sorted);

    const vels = sorted.map(e => {
      const s = this.statsForEntry(e);
      const v = s?.avg;
      return typeof v === 'number' && isFinite(v) ? v : null;
    });

    const inBand = new Array(sorted.length).fill(false);

    for (let i = 0; i <= sorted.length - k; i++) {
      const window = vels.slice(i, i + k);
      if (window.some(v => v == null)) continue;

      const nums = window as number[];
      const vMin = Math.min(...nums);
      const vMax = Math.max(...nums);

            if ((vMax - vMin) <= this.LADDER_NODE_MAX_VEL_RANGE_FPS) {
        for (let j = i; j < i + k; j++) inBand[j] = true;
      }
    }

    for (let idx = 0; idx < sorted.length; idx++) {
      if (!inBand[idx]) continue;
      const id = this.entryIdOf(sorted[idx]);
      if (id != null) this.ladderNodeBandIds.add(id);
    }
  }

  isLadderNode(entry: LoadDevEntry): boolean {
    if (this.selectedProject?.type !== 'ladder') return false;
    const id = this.entryIdOf(entry);
    return id != null && this.ladderNodeBandIds.has(id);
  }

  // Cache for OCW photo list so template doesn't rebuild arrays every change detection tick
  ocwPhotoNotesCache: { charge: number; entry: LoadDevEntry; url: string; label: string }[] = [];

   private rebuildVisibleEntries(): void {
    const entries = this.entriesForSelectedProject();
    this.visibleEntries = entries;

    // PERF: build caches once per rebuild
    this.rebuildPerfCachesFrom(entries);

    // Keep OCW photo list cache in sync (cheap when not OCW)
    this.ocwPhotoNotesCache = this.ocwPhotoNotesItems();
  }


  // Results visibility
  resultsCollapsed = false;
  hasResultsForSelectedProject = false;
  howToExpanded = false; // How-to hint collapsible (default collapsed)

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
     graphCoords: {
    x: number;
    y: number;
    charge: number;
    avg: number;
    labelX?: number;
    labelY?: number;
    labelAnchor?: 'start' | 'middle' | 'end';
    labelFontSize?: number;
  }[] = [];


  graphSvgPoints = '';
    graphChargeLabels: { x: number; charge: number }[] = [];
  graphMinVel = 0;
  graphMaxVel = 0;

  // OCW shot scatter + group circles (screen)
  ocwShotPoints: OcwShotPoint[] = [];
  ocwGroupEllipses: OcwGroupEllipse[] = [];

 constructor(private data: DataService, private zone: NgZone, private cdr: ChangeDetectorRef) {}


  // ---------- lifecycle ----------
  ngOnInit(): void {
    
    this.rifles = this.data.getRifles();
        // Apply preference defaults once DI is ready (prevents blank-screen crash from early init)
    this.projectForm.oalUnit = this.data.getDefaultLoadDevOalUnit();
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
	  lands: null,
  oal: null,
  oalOgive: null,
    oalUnit: (this as any).data?.getDefaultLoadDevOalUnit?.() ?? 'mm',



  distanceM: null,
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
    const p: any = this.getEntryPhotoObj(entry);
    return !!(p?.path || p?.annotatedDataUrl || p?.dataUrl || (entry as any)?.targetPhotoBase64);
  }

  getEntryPhotoDataUrl(entry: LoadDevEntry): string | null {
    const anyE: any = entry as any;
    const p: any = this.getEntryPhotoObj(entry);

    // Preferred: Filesystem path (sync via cache)
    if (p?.path) {
      const path = String(p.path);
      const cached = this.photoDataUrlCache.get(path);
      if (cached) return cached;

      // Warm cache in background
      const pid = Number((this.selectedProject as any)?.id ?? 0);
      if (pid) {
        void this.ensureEntryPhotoOnFs(entry, pid).then(async () => {
          const tp2: any = (entry as any)?.targetPhoto ?? null;
          if (tp2?.path) {
            const url = await this.readJpegDataUrlFromFs(String(tp2.path));
            if (url) this.photoDataUrlCache.set(String(tp2.path), url);
          }
        });
      }

      return null;
    }

    // Legacy (still supported)
    if (p?.annotatedDataUrl) return p.annotatedDataUrl;
    if (p?.dataUrl) return p.dataUrl;

    // Very old legacy
    if (anyE?.targetPhotoBase64) return `data:image/jpeg;base64,${String(anyE.targetPhotoBase64).trim()}`;

    return null;
  }


getEntryPhotoLabel(entry: LoadDevEntry): string {
  const p = this.getEntryPhotoObj(entry);
  const ts = p?.takenAt ? this.shortDate(p.takenAt) : '';
  return ts ? `Photo • ${ts}` : 'Photo';
  
}
  // ===============================
  // NOTES: OCW entry photos (by charge)
  // ===============================
   ocwPhotoNotesItems(): { charge: number; entry: LoadDevEntry; url: string; label: string }[] {
    const p: any = this.selectedProject as any;
    if (!p || p.type !== 'ocw') return [];

    const entries: LoadDevEntry[] = [...(p.entries ?? [])];
    entries.sort((a, b) => (a.chargeGr ?? 9999) - (b.chargeGr ?? 9999));

    const out: { charge: number; entry: LoadDevEntry; url: string; label: string }[] = [];

    const pid = Number(p.id ?? 0);

    for (const e of entries) {
      const anyE: any = e as any;
      const tp: any = anyE?.targetPhoto ?? null;

      // If photo is FS-based, warm cache (so UI fills in within a tick)
      if (tp?.path && !this.photoDataUrlCache.has(String(tp.path))) {
        void this.readJpegDataUrlFromFs(String(tp.path)).then((u) => {
          if (u) this.photoDataUrlCache.set(String(tp.path), u);
        });
      }

      if (!this.hasEntryPhoto(e)) continue;

      const url = this.getEntryPhotoDataUrl(e);
      if (!url && tp?.path && pid) {
        // Ensure legacy migration happens (if this entry was old dataUrl/base64)
        void this.ensureEntryPhotoOnFs(e, pid);
      }

            // Add even if URL is not ready yet (cache will fill it in)
      const finalUrl =
        url || (tp?.path ? (this.photoDataUrlCache.get(String(tp.path)) ?? null) : null);

      const charge = Number((e.chargeGr ?? 0));
      out.push({ charge, entry: e, url: finalUrl ?? '', label: this.getEntryPhotoLabel(e) });

    }

    return out;
  }


private createEmptyPlannerForm(): PlannerForm {
  this.plannerStepText = '.';

  return {
    distanceUnit: 'm',
    distanceM: null,
    startChargeGr: null,
    endChargeGr: null,
    stepGr: null,
    shotsPerGroup: null
  };
}
onStepFocus(ev: FocusEvent): void {
  const el = ev.target as HTMLInputElement | null;
  if (!el) return;

  if (!el.value) {
    el.value = '.';
    this.plannerStepText = '.';
  }

  // Cursor must start after the fullstop
  if (el.value === '.') {
    setTimeout(() => {
      try {
        el.setSelectionRange(1, 1);
      } catch {}
    }, 0);
  }
}

onStepChange(raw: any): void {
  let s = (raw ?? '').toString();

  // keep only digits and dots, and allow only ONE dot
  s = s.replace(/[^0-9.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }

  // If user clears it, keep the dot placeholder
  if (s === '') {
    this.plannerStepText = '.';
    this.planner.stepGr = null;
    return;
  }

  // If it's only ".", don't set a number yet
  if (s === '.') {
    this.plannerStepText = '.';
    this.planner.stepGr = null;
    return;
  }

  // Auto-correct "1" => ".1"
  if (s === '1') {
    s = '.1';
    this.postSaveMessage = 'Auto-corrected 1 → .1';
    setTimeout(() => (this.postSaveMessage = null), 2000);
  }

  // Parse (".1" works in parseFloat)
  let n = Number.parseFloat(s);

  if (!Number.isFinite(n)) {
    this.plannerStepText = '.';
    this.planner.stepGr = null;
    return;
  }

  // Hard block > 0.6 (cap) + toast
  if (n > 0.6) {
    n = 0.0;
    s = '0.0';
    this.postSaveMessage = 'Step max is 0.6 gr';
    setTimeout(() => (this.postSaveMessage = null), 2000);
  }

  // Normalize display so user sees ".x" instead of "0.x"
  if (s.startsWith('0.') && n < 1) s = s.slice(1);

  this.plannerStepText = s;
  this.planner.stepGr = n;

}
onPlannerRangeChange(): void {
  if (this.projectForm.type !== 'ocw') return;

  const s = this.planner.startChargeGr;
  const e = this.planner.endChargeGr;

  if (s == null || e == null) return;

  // Single-charge OCW (start === end) => force step = 0 and jump to shots input
  if (Number(s) === Number(e)) {
    this.planner.stepGr = 0;
    this.plannerStepText = '0.0';

    setTimeout(() => {
      try {
        this.shotsPerGroupEl?.nativeElement.focus();
      } catch {}
    }, 0);
  }
}

entryHasPhoto(entry: LoadDevEntry): boolean {
  const any = entry as any;
  const tp = any?.targetPhoto;
  return !!tp?.path || !!tp?.annotatedDataUrl || !!tp?.dataUrl || !!any?.targetPhotoBase64;
}

projectHasPhoto(): boolean {
  const p: any = this.selectedProject as any;
  return !!p?.targetPhotoPath || !!p?.targetPhoto?.path || !!p?.targetPhoto?.dataUrl || !!p?.targetPhotoBase64 || !!p?.targetPhotoDataUrl;
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
    shortDateTime(value: string | Date | null | undefined): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
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
        void this.syncTargetPhotoFromProject();
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
      this.visibleEntries = [];
      this.hasResultsForSelectedProject = false;

      this.availablePowders = [];
      this.availableBullets = [];
      this.filteredProjects = null;
      this.visibleEntries = [];
      this.ocwPhotoNotesCache = [];

      this.rebuildGraphData();
      this.resetWizard();
      return;
    }

    // Cleanup legacy “ghost” load developments (empty projects with names left behind)
    this.data.pruneEmptyLoadDevProjects();
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
    // Always resync previews after reloading projects (prevents "photo disappeared" after re-entering)
    if (this.selectedProject) {
      this.syncTargetPhotoFromProject();
      this.syncVoiceNoteFromProject();
    }

    this.rebuildFilterOptions();
    this.applyProjectFilters();
    this.rebuildVisibleEntries();
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
    // Always resync previews after refresh (prevents "photo disappeared" after navigation)
    if (this.selectedProject) {
      this.syncTargetPhotoFromProject();
      this.syncVoiceNoteFromProject();
    }

    this.rebuildFilterOptions();
    this.applyProjectFilters();
    this.rebuildVisibleEntries();
    this.updateHasResultsFlag();
    this.rebuildGraphData();
    if (!this.graphCoords.length && !this.ocwShotPoints.length) this.showGraph = false;
  }  onProjectSelectChange(): void {
        this.projectPickerOpen = false;

    if (this.selectedProjectId == null) {
      this.selectedProject = null;
      this.visibleEntries = []; // ✅ keep cache in sync
      this.resultsCollapsed = true;
      this.howToExpanded = false;

      this.updateHasResultsFlag();
      this.rebuildGraphData();
      this.showGraph = false;

      this.resetWizard();
      return;
    }

    this.selectedProject =
      this.projects.find(p => p.id === this.selectedProjectId) ?? null;

    this.projectFormVisible = false;
    this.resultsCollapsed = false;
        this.howToExpanded = false;


    this.syncTargetPhotoFromProject();
    this.syncVoiceNoteFromProject();

    this.rebuildVisibleEntries(); // ✅ rebuild cache for template
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
      toggleHowToHint(): void {
    this.howToExpanded = !this.howToExpanded;
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
              // ✅ OCW: allow single-charge plan (start === end) by forcing Step = 0.0
    if (
      type === 'ocw' &&
      startChargeGr != null &&
      endChargeGr != null &&
      startChargeGr === endChargeGr
    ) {
      // Force the UI field + planner numeric value
      this.planner.stepGr = 0;
      this.plannerStepText = '0.0';

      const dist = distanceM ?? undefined;
      const defaultShots: number | undefined = shotsPerGroup ?? undefined;

      const entry: LoadDevEntry = {
        id: 1,
        loadLabel: '',
        powder: undefined,
        chargeGr: Number(startChargeGr.toFixed(2)),
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
      return;
    }


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
          // ✅ OCW: enforce 3–5 shots per group
    if (type === 'ocw') {
      const n = Number(shotsPerGroup ?? 0);
      if (!Number.isFinite(n) || n < 3 || n > 5) {
        this.plannerError = 'OCW requires 3 to 5 shots per group.';
        return;
      }
    }

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
// ✅ OCW: allow single-charge plan (start === end) → force Step = 0.0
if (type === 'ocw') {
  const { startChargeGr, endChargeGr } = this.planner;
  if (
    startChargeGr != null &&
    endChargeGr != null &&
    startChargeGr === endChargeGr
  ) {
    this.planner.stepGr = 0;
    this.plannerStepText = '0.0';
  }
}


if (type === 'ocw') {
  const n = Number(this.planner.shotsPerGroup ?? 0);
  if (!Number.isFinite(n) || n < 3 || n > 5) {
    alert('OCW requires 3 to 5 shots per group.');
    return;
  }
}

// ✅ ADD THIS GUARD (prevents empty ladder/ocw projects)
if (type === 'ladder' || type === 'ocw') {
  const { startChargeGr, endChargeGr, stepGr } = this.planner;

  const isOcwSingleCharge =
    type === 'ocw' &&
    startChargeGr != null &&
    endChargeGr != null &&
    startChargeGr === endChargeGr;

  if (
    startChargeGr == null ||
    endChargeGr == null ||
    stepGr == null ||
    (stepGr <= 0 && !isOcwSingleCharge)
  ) {
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

        lands: (this.projectForm as any).lands ?? null,
        oal: this.projectForm.oal ?? null,
        oalOgive: (this.projectForm as any).oalOgive ?? null,
                oalUnit: this.projectForm.oalUnit ?? this.data.getDefaultLoadDevOalUnit(),

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
                lands: (this.projectForm as any).lands ?? null,

        oal: this.projectForm.oal ?? null,
        oalOgive: (this.projectForm as any).oalOgive ?? null,
                oalUnit: this.projectForm.oalUnit ?? this.data.getDefaultLoadDevOalUnit(),

        distanceM: (type === 'ladder' || type === 'ocw') ? (this.planner.distanceM ?? null) : null
      };
      this.data.updateLoadDevProject(newProjectAny as LoadDevProject);
      this.selectedProjectId = newProjectAny.id;


      this.createLadderEntriesFromPlanner(newProjectAny.id);
      this.data.createSessionForLoadDevProject(newProjectAny);

      this.postSaveMessage =
        type === 'ocw'
          ? 'OCW planned and saved. Export this document and use it as guidance.  Load as per table and "Go Shoot" your groups, use this document to take notes.  Come back here and use the OCW wizard or Edit buttons to enter velocities.'
          : 'Ladder test planned and saved.  Export this document and use it as guidance.  Load as per table and "Go Shoot" your groups, use this document to take notes.  Come back here and use the wizard or Edit buttons to enter velocities and view the graph with node highlights.';
    }

    setTimeout(() => (this.postSaveMessage = null), 25000);

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
        // Safety: remove any legacy/ghost projects that are now empty
    this.data.pruneEmptyLoadDevProjects();


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
  // Removed duplicate implementation of rebuildVisibleEntries()
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
    
    // ---------- Lands / Ogive helper (project form) ----------
  landsMinusOgive(): number | null {
    const lands = (this.projectForm as any)?.lands as number | null | undefined;
    const ogive = (this.projectForm as any)?.oalOgive as number | null | undefined;

    if (lands == null || ogive == null) return null;

    const diff = lands - ogive;
    return Number.isFinite(diff) ? diff : null;
  }

  landsMinusOgiveText(): string {
    const d = this.landsMinusOgive();
    if (d == null) return '';

    // Readable precision (inches typically needs more)
    const decimals = this.projectForm?.oalUnit === 'in' ? 3 : 2;
    return d.toFixed(decimals);
  }

  // 1) decimal space => dot (only when the fractional part is 1 digit)

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
    const id = this.entryIdOf(entry);
    if (id != null && this.statsCache.has(id)) return this.statsCache.get(id)!;

    const any = entry as any;
    const values = this.parseVelocityInput(any.velocityInput);
    const stats = this.computeVelocityStats(values);

    if (id != null) this.statsCache.set(id, stats);
    return stats;
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

  const id = this.entryIdOf(entry);
  if (id == null) return null;

  return this.ocwRankCache.get(id) ?? null;
}


 ocwBestEntryId(): number | null {
  if (!this.selectedProject || this.selectedProject.type !== 'ocw') return null;
  return this.ocwBestIdCache ?? null;
}

  isOcwBestEntryId(entryId: number): boolean {
    const best = this.ocwBestEntryId();
    return best != null && Number(entryId) === best;
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

       if ((vMax - vMin) <= this.LADDER_NODE_MAX_VEL_RANGE_FPS) {
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

  return this.isLadderNode(entry)
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
        this.graphChargeLabels = [];
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

            const coords: {
        x: number;
        y: number;
        charge: number;
        avg: number;
        labelX?: number;
        labelY?: number;
        labelAnchor?: 'start' | 'middle' | 'end';
        labelFontSize?: number;
      }[] = [];

      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const x = n === 1 ? 50 : (i / (n - 1)) * 100;
        const y = 55 - ((p.avg - this.graphMinVel) / span) * 45;
                const dx = n === 1 ? 100 : 100 / (n - 1);
        const compact = dx < 9;
        const tiny = dx < 6;
        const labelFontSize = tiny ? 2.4 : dx < 8 ? 2.6 : 3;

        const labelY = compact ? (i % 2 === 0 ? 8 : 4) : 8;

        let labelX = x;
        let labelAnchor: 'start' | 'middle' | 'end' = 'middle';

        if (i === 0) {
          labelX = 2;
          labelAnchor = 'start';
        } else if (i === n - 1) {
          labelX = 98;
          labelAnchor = 'end';
        } else {
          labelX = Math.min(96, Math.max(4, x));
          labelAnchor = 'middle';
        }

        coords.push({
          x,
          y,
          charge: p.charge,
          avg: p.avg,
          labelX,
          labelY,
          labelAnchor,
          labelFontSize
        });

      }

      this.graphCoords = coords;
      this.graphSvgPoints = coords.map(c => `${c.x},${c.y}`).join(' ');
            this.graphChargeLabels = this.buildGraphChargeLabels(coords, 6);

    }

    if (this.selectedProject.type === 'ocw') {
      const sorted = [...entries].sort((a, b) => (a.chargeGr ?? 9999) - (b.chargeGr ?? 9999));
      this.buildOcwShotAndGroupGeometry(sorted);
    }
  }
  private buildGraphChargeLabels(
    coords: { x: number; charge: number }[],
    minGap: number = 6
  ): { x: number; charge: number }[] {
    if (!coords || coords.length === 0) return [];

    const out: { x: number; charge: number }[] = [];

    const lastIdx = coords.length - 1;
    const first = coords[0];
    const last = coords[lastIdx];

    // Always include first
    out.push({ x: first.x, charge: first.charge });
    let lastX = first.x;

    // Greedy include labels only when spacing allows
    for (let i = 1; i < lastIdx; i++) {
      const c = coords[i];
      if (c.x - lastX >= minGap) {
        out.push({ x: c.x, charge: c.charge });
        lastX = c.x;
      }
    }

    // Always include last
    out.push({ x: last.x, charge: last.charge });

    // If the last label overlaps the previous one, drop the previous (unless it is the first)
    if (out.length >= 3) {
      const prev = out[out.length - 2];
      const end = out[out.length - 1];
      if (end.x - prev.x < minGap && prev.x !== first.x) {
        out.splice(out.length - 2, 1);
      }
    }

    return out;
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
  // ================================
  // EXPORT: Page 2 header Load Data
  // ================================

  private getExportLoadDataLines(): string[] {
    const p: any = this.selectedProject as any;
    if (!p) return [];

    const lines: string[] = [];

    const powder = (p.powder ?? '').toString().trim();
    const bullet = (p.bullet ?? '').toString().trim();
    const brass = (p.brass ?? '').toString().trim();

    if (powder) lines.push(`Powder: ${powder}`);
    if (bullet) {
      const bw = Number(p.bulletWeightGr ?? 0);
      lines.push(`Bullet: ${bullet}${bw > 0 ? ` (${bw}gr)` : ''}`);
    }
    if (brass) lines.push(`Brass: ${brass}`);

    const oal = p.oal;
    const ogive = p.oalOgive;

    if (oal != null && oal !== '') lines.push(`COAL: ${oal}mm`);
    if (ogive != null && ogive !== '') lines.push(`Ogive: ${ogive}mm`);

    const dist = p.distanceM;
    if (dist != null && dist !== '') lines.push(`Distance: ${dist}m`);

    return lines;
  }

  private drawExportHeader_Page2WithLoadData(
    doc: any,
    pageW: number,
    leftMargin: number,
    rightMargin: number,
    topMargin: number,
    projectName: string,
    rifleName: string,
    plannedText: string,
    shotText: string
  ): number {
    let y = topMargin;

    // Title (same as page 1)
    doc.setFontSize(20);
    doc.text(`${projectName}`, leftMargin, y);
    y += 15;

    doc.setLineWidth(0.4);
    doc.line(leftMargin, y, pageW - rightMargin, y);
    y += 14;

    // Two columns: LEFT = Rifle/Dates, RIGHT = Load Data
    const gap = 14;
    const colW = (pageW - leftMargin - rightMargin - gap) / 2;

    const leftX = leftMargin;
    const rightX = leftMargin + colW + gap;

    // LEFT column (rifle + planned + shot)
    doc.setFontSize(12);
    doc.text(`Rifle: ${rifleName}`, leftX, y);

    doc.setFontSize(10);
    doc.text(`Planned: ${plannedText || '—'}`, leftX, y + 12);
    doc.text(`Shot: ${shotText || '—'}`, leftX, y + 24);

    // RIGHT column (load data)
    const loadLines = this.getExportLoadDataLines();
    doc.setFontSize(12);
    doc.text(`Load Data`, rightX, y);

    doc.setFontSize(10);
    let ly = y + 12;

    for (const line of loadLines) {
      // keep inside the right column width
      const wrapped = doc.splitTextToSize(line, colW);
      doc.text(wrapped, rightX, ly);
      ly += wrapped.length * 12;
      if (ly > y + 36) break; // keep header compact
    }

    // advance y to below the tallest column content
    y += 40;
    return y;
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
    // ==========================================================
  // PHOTO STORAGE (Option A): Filesystem (Directory.Data)
  // - Persist photos to app folder so they never depend on localStorage quota
  // - Store only small "path" strings in the project/entry objects
  // ==========================================================
  private readonly PHOTO_ROOT = 'gs_photos';

  private photoDataUrlCache = new Map<string, string>(); // path -> dataUrl

  private dataUrlToBase64(dataUrl: string): string {
    const b64 = (dataUrl || '').split(',')[1] ?? '';
    return b64.toString().trim();
  }

  private makeProjectPhotoPath(projectId: number): string {
    return `${this.PHOTO_ROOT}/loaddev/project/p${projectId}-${Date.now()}.jpg`;
  }

  private makeEntryPhotoPath(projectId: number, entryId: number): string {
    return `${this.PHOTO_ROOT}/loaddev/entry/p${projectId}-e${entryId}-${Date.now()}.jpg`;
  }

  private async writeJpegDataUrlToFs(path: string, dataUrl: string): Promise<void> {
    const base64 = this.dataUrlToBase64(dataUrl);
    if (!base64) throw new Error('No base64 image data');
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Data,
      recursive: true,
    });
  }

  private async readJpegDataUrlFromFs(path: string): Promise<string | null> {
    try {
      const res = await Filesystem.readFile({
        path,
        directory: Directory.Data,
      });
      const base64 = (res?.data ?? '').toString().trim();
      if (!base64) return null;
      return `data:image/jpeg;base64,${base64}`;
    } catch {
      return null;
    }
  }

  // Project photo: migrate legacy base64/dataUrl -> Filesystem path once
  private async ensureProjectPhotoOnFs(project: any): Promise<void> {
    if (!project) return;

    // Already on FS
    if (project.targetPhotoPath) return;

    // Legacy sources (what you had before)
    const legacyDataUrl =
      (project?.targetPhotoDataUrl && String(project.targetPhotoDataUrl).startsWith('data:image/'))
        ? String(project.targetPhotoDataUrl)
        : null;

    const legacyBase64 =
      (project?.targetPhotoBase64 && String(project.targetPhotoBase64).trim())
        ? `data:image/jpeg;base64,${String(project.targetPhotoBase64).trim()}`
        : null;

    const toSave = legacyDataUrl || legacyBase64;
    if (!toSave) return;

    const pid = Number(project.id ?? this.selectedProject?.id ?? 0);
    if (!pid) return;

    const path = this.makeProjectPhotoPath(pid);
    await this.writeJpegDataUrlToFs(path, toSave);

    project.targetPhotoPath = path;
    project.targetPhotoCapturedAt = project.targetPhotoCapturedAt ?? new Date().toISOString();

    // IMPORTANT: remove large legacy fields so localStorage stays tiny
    try { delete project.targetPhotoBase64; } catch {}
    try { delete project.targetPhotoDataUrl; } catch {}
    try { delete project.targetPhoto; } catch {}

    // Persist the updated project
    try {
      this.data.updateLoadDevProject({ ...(project as any) });
    } catch {}
  }

  // Entry photo: migrate legacy dataUrl/base64 -> Filesystem path once
  private async ensureEntryPhotoOnFs(entry: LoadDevEntry, projectId: number): Promise<void> {
    const anyE: any = entry as any;
    const tp: any = anyE?.targetPhoto ?? null;
    if (!tp) return;

    if (tp.path) return;

    const legacyDataUrl =
      (tp?.dataUrl && String(tp.dataUrl).startsWith('data:image/')) ? String(tp.dataUrl) : null;

    const legacyAnnotated =
      (tp?.annotatedDataUrl && String(tp.annotatedDataUrl).startsWith('data:image/'))
        ? String(tp.annotatedDataUrl)
        : null;

    const legacyBase64 =
      (anyE?.targetPhotoBase64 && String(anyE.targetPhotoBase64).trim())
        ? `data:image/jpeg;base64,${String(anyE.targetPhotoBase64).trim()}`
        : null;

    const toSave = legacyAnnotated || legacyDataUrl || legacyBase64;
    if (!toSave) return;

    const pid = Number(projectId);
    const eid = Number((entry as any)?.id ?? 0);
    if (!pid || !eid) return;

    const path = this.makeEntryPhotoPath(pid, eid);
    await this.writeJpegDataUrlToFs(path, toSave);

    tp.path = path;

    // Remove big legacy payloads
    try { delete tp.dataUrl; } catch {}
    try { delete tp.annotatedDataUrl; } catch {}
    try { delete anyE.targetPhotoBase64; } catch {}

    // Persist entry
    try {
      const updated: LoadDevEntry = { ...(anyE as any), targetPhoto: { ...(tp as any) } } as any;
      this.data.updateLoadDevEntry(pid, updated);
    } catch {}
  }

  // Preload all entry photos into memory cache so HTML can bind synchronously
  private preloadSelectedProjectEntryPhotos(): void {
    const p: any = this.selectedProject as any;
    if (!p || !p.entries) return;

    const pid = Number(p.id ?? 0);
    for (const e of (p.entries as LoadDevEntry[])) {
      const anyE: any = e as any;
      const tp: any = anyE?.targetPhoto ?? null;
      if (tp?.path) {
        const path = String(tp.path);
        if (!this.photoDataUrlCache.has(path)) {
          void this.readJpegDataUrlFromFs(path).then((url) => {
            if (url) this.photoDataUrlCache.set(path, url);
          });
        }
      }
    }
  }

  private async getPhotoDataUrlFromAnyPhotoObj(tp: any): Promise<string | null> {
    if (!tp) return null;

    // Memory cache by path
    if (tp.path) {
      const path = String(tp.path);
      const cached = this.photoDataUrlCache.get(path);
      if (cached) return cached;

      const url = await this.readJpegDataUrlFromFs(path);
      if (url) this.photoDataUrlCache.set(path, url);
      return url;
    }

    // Legacy in-memory (should migrate away, but still supported)
    if (tp.annotatedDataUrl && String(tp.annotatedDataUrl).startsWith('data:image/')) return String(tp.annotatedDataUrl);
    if (tp.dataUrl && String(tp.dataUrl).startsWith('data:image/')) return String(tp.dataUrl);

    return null;
  }

}