import { CommonModule } from '@angular/common';
import { Component, OnInit, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../data.service';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

@Component({
  selector: 'app-rifles-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rifles-tab.component.html',
  styleUrls: ['./rifles-tab.component.css'],
})
export class RiflesTabComponent implements OnInit {
    defaultLoadCoalUnit: 'mm' | 'in' = 'mm';

  @Output() backToMenu = new EventEmitter<void>();

  // All rifles
  rifles: any[] = [];

  // Rifle selection / forms
  selectedRifleId: number | string | null = null;
  addFormVisible = false;
  editingRifle: any | null = null;

  // Loads visibility / forms
  activeLoadsRifleId: number | string | null = null;
  activeLoadFormRifleId: number | string | null = null;
  editingLoadId: number | string | null = null;

  // Forms
      rifleForm: any = {
    name: '',
    caliber: '',
    barrelLength: null,
    barrelUnit: 'inch',
    twistRate: '',
    muzzleVelocityFps: 0,
    scopeUnit: 'MIL',
    scope: '',
    notes: '',
    riflePhotoBase64: null,
    riflePhotoCapturedAt: null,
    roundCount: 0,
  };

  // Rifle photo (same pattern as Load Development photo handling)
  photoViewerOpen = false;
  photoViewerImgUrl: string | null = null;
  photoViewerRifleId: number | string | null = null;
  photoViewerMode: 'form' | 'saved' = 'form';
  riflePhotoInlineMessage: string | null = null;

    private riflePhotoDataUrlFromBase64(base64: string | null | undefined): string | null {
    if (!base64) return null;
    return `data:image/jpeg;base64,${base64}`;
  }

  rifleFormPhotoDataUrl(): string | null {
   const p = (this.rifleForm as any)?.riflePhotoPath;
if (p) {
  const key = String(p);

  const cached = this.riflePhotoCache.get(key);
  if (cached) return cached;

  if (this.riflePhotoMissing.has(key)) return null;
  if (this.riflePhotoLoadInFlight.has(key)) return null;

  this.riflePhotoLoadInFlight.add(key);
  void this.readJpegDataUrlFromFs(key).then((u) => {
    if (u) this.riflePhotoCache.set(key, u);
    else this.riflePhotoMissing.add(key);
  }).finally(() => {
    this.riflePhotoLoadInFlight.delete(key);
  });

  return null;
}

    return this.riflePhotoDataUrlFromBase64(this.rifleForm?.riflePhotoBase64);
  }

  hasRiflePhoto(r: any): boolean {
    return !!(r && ((r as any).riflePhotoPath || (r as any).riflePhotoBase64));
  }

  riflePhotoDataUrl(r: any): string | null {
    const p = (r as any)?.riflePhotoPath;
    if (p) {
     const key = String(p);

const cached = this.riflePhotoCache.get(key);
if (cached) return cached;

if (this.riflePhotoMissing.has(key)) return null;
if (this.riflePhotoLoadInFlight.has(key)) return null;

this.riflePhotoLoadInFlight.add(key);

void this.ensureRiflePhotoOnFs(r).then(async () => {
  const p2 = (r as any)?.riflePhotoPath;
  if (!p2) return;

  const key2 = String(p2);

  // if path changed after migration, guard that too
  if (this.riflePhotoMissing.has(key2)) return;

  const u = await this.readJpegDataUrlFromFs(key2);
  if (u) this.riflePhotoCache.set(key2, u);
  else this.riflePhotoMissing.add(key2);
}).finally(() => {
  this.riflePhotoLoadInFlight.delete(key);
});

return null;

      return null;
    }
    return this.riflePhotoDataUrlFromBase64((r as any)?.riflePhotoBase64);
  }


  openRiflePhotoViewer(
    url: string | null,
    mode: 'form' | 'saved' = 'form',
    rifleId: any = null,
    event?: Event
  ): void {
    try {
      event?.preventDefault();
      event?.stopPropagation();
    } catch {}

    if (!url) return;
    this.photoViewerImgUrl = url;
    this.photoViewerOpen = true;
    this.photoViewerMode = mode;
    this.photoViewerRifleId = rifleId;
  }

  closePhotoViewer(): void {
    this.photoViewerOpen = false;
    this.photoViewerImgUrl = null;
    this.photoViewerRifleId = null;
    this.photoViewerMode = 'form';
  }

  async onRiflePhotoClick(event?: Event): Promise<void> {
    try {
      event?.preventDefault();
      event?.stopPropagation();
    } catch {}

    try {
      const photo = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
      });

      const base64 = photo?.base64String;
      if (!base64) {
        this.riflePhotoInlineMessage = 'No photo captured';
        setTimeout(() => (this.riflePhotoInlineMessage = null), 2200);
        return;
      }

          const dataUrl = `data:image/jpeg;base64,${base64}`;

      const tmpId = (this.rifleForm as any)?.id ?? 'new';
      const path = this.makeRiflePhotoPath(tmpId);

      await this.writeJpegDataUrlToFs(path, dataUrl);

      // store path only (base64 removed so localStorage stays small)
      (this.rifleForm as any).riflePhotoPath = path;
      (this.rifleForm as any).riflePhotoCapturedAt = new Date().toISOString();
      (this.rifleForm as any).riflePhotoBase64 = null;

      // cache for instant thumbnail
      this.riflePhotoCache.set(path, dataUrl);

      this.riflePhotoInlineMessage = '📷 Rifle photo saved (tap thumbnail to view)';
      setTimeout(() => (this.riflePhotoInlineMessage = null), 2200);


    } catch {
      this.riflePhotoInlineMessage = 'Photo capture cancelled';
      setTimeout(() => (this.riflePhotoInlineMessage = null), 2200);
    }
  }

  deleteRiflePhoto(): void {
    const anyData: any = this.data;

    if (this.photoViewerMode === 'saved' && this.photoViewerRifleId != null) {
      // Delete directly from the stored rifle
      const idNum = Number(this.photoViewerRifleId);
      const r = this.rifles.find((x: any) => Number(x?.id) === idNum);
      if (r) {
        (r as any).riflePhotoBase64 = null;
        (r as any).riflePhotoCapturedAt = null;

        if (typeof anyData.updateRifle === 'function') {
          anyData.updateRifle({ ...(r as any) });
        } else if (typeof anyData.setRifles === 'function') {
          const list = this.rifles.map((x: any) => (Number(x?.id) === idNum ? r : x));
          anyData.setRifles(list);
        }
      }

      this.refresh();
      this.closePhotoViewer();
      return;
    }

    // Delete from the current add/edit form (persisted once you Save rifle)
    (this.rifleForm as any).riflePhotoBase64 = null;
    (this.rifleForm as any).riflePhotoCapturedAt = null;
    this.closePhotoViewer();
  }


  loadForm: any = {};

  constructor(private data: DataService) {
  try {
    const u = (this.data as any)?.preferences?.loadDev?.oalUnit;
    if (u === 'in' || u === 'mm') {
      this.defaultLoadCoalUnit = u;
    }
  } catch {
    this.defaultLoadCoalUnit = 'mm';
  }
}


  ngOnInit(): void {
    this.refresh();
  }

  // Back button – same idea as History tab: reset local state and tell parent to go back
  goBack(): void {
    this.addFormVisible = false;
    this.editingRifle = null;
    this.activeLoadsRifleId = null;
    this.activeLoadFormRifleId = null;
    this.editingLoadId = null;
    this.resetLoadForm();
    this.backToMenu.emit();
  }
  // ==========================
  // PDF Export (Selected Rifle)
  // ==========================
  async exportSelectedRiflePdf(): Promise<void> {
    try {
      const r = this.selectedRifle;
      if (!r) {
        alert('Please select a rifle first.');
        return;
      }

      // Lazy-load to match “Load Development” style and avoid bundle bloat
      const jspdfMod: any = await import('jspdf');
      const autoTableMod: any = await import('jspdf-autotable');

      const jsPDF = jspdfMod?.jsPDF ?? jspdfMod?.default;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      const pageWidth = doc.internal.pageSize.getWidth();
      let y = 12;

      // Title
      doc.setFontSize(16);
      doc.text('Rifle Data Export', 10, y);
      y += 7;

      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 10, y);
      y += 6;

      // Rifle header card (simple, clean)
      doc.setFontSize(12);
      doc.text(`${r.name ?? 'Rifle'}${r.caliber ? ` (${r.caliber})` : ''}`, 10, y);
      y += 5;
      

      const rifleRows: Array<[string, string]> = [
        ['Caliber', `${r.caliber ?? '-'}`],
        ['Barrel length', `${r.barrelLength ?? '-'} ${r.barrelUnit ?? ''}`.trim()],
        ['Twist rate', `${r.twistRate ?? '-'}`],
        ['Muzzle velocity (fps)', `${r.muzzleVelocityFps ?? '-'}`],
        ['Scope unit', `${r.scopeUnit ?? '-'}`],
        ['Round count', `${r.roundCount ?? 0}`],
        ['Notes', `${r.notes ?? '-'}`],
      ];

      autoTableMod.default(doc, {
        startY: y,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fontSize: 9 },
        columnStyles: { 0: { cellWidth: 45 }, 1: { cellWidth: pageWidth - 20 - 45 } },
        body: rifleRows.map(([k, v]) => [k, v]),
      });

      y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : y + 40;

        // Loads table
      const loads = Array.isArray(r.loads) ? r.loads : [];
      doc.setFontSize(12);
      doc.text(`Loads (${loads.length})`, 10, y);
      y += 3;
      // Loads table (keep it horizontal; notes go underneath per-load)
      autoTableMod.default(doc, {
        startY: y,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fontSize: 8 },
        head: [[
          'Powder',
          'Charge',
          'COAL',
          'Primer',
          'Bullet',
          'BW (gr)',
          'BC'
        ]],
        body: loads.map((l: any) => ([
          `${l?.powder ?? ''}`,
          `${l?.chargeGn ?? ''}`,
          `${l?.coal ?? ''}`,
          `${l?.primer ?? ''}`,
          `${l?.bullet ?? ''}`,
          `${l?.bulletWeightGr ?? ''}`,
          `${l?.bulletBc ?? ''}`,
        ])),
      });

      // Move cursor below the table
      y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : y + 12;

      // Load notes (under each load, in its own section like rifle notes)
      const loadsWithNotes = loads.filter((l: any) => (l?.notes ?? '').toString().trim().length > 0);

      if (loadsWithNotes.length) {
        // Page break if needed
        if (y > 270) {
          doc.addPage();
          y = 12;
        }

        doc.setFontSize(12);
        doc.text('Load Notes', 10, y);
        y += 5;

        doc.setFontSize(9);

        for (let i = 0; i < loadsWithNotes.length; i++) {
          const l: any = loadsWithNotes[i];
          const note = (l?.notes ?? '').toString().trim();

          const header = `${i + 1}) ${l?.powder ?? ''} ${l?.chargeGn ?? ''}gn | ${l?.bullet ?? ''} ${l?.bulletWeightGr ?? ''}gr | Coal ${l?.coal ?? ''}`;

          // Page break if needed
          if (y > 270) {
            doc.addPage();
            y = 12;
          }

          doc.setFontSize(9);
          doc.text(header, 10, y);
          y += 4;

          const wrapped = doc.splitTextToSize(note, pageWidth - 20);
          doc.text(wrapped, 12, y);
          y += (wrapped.length * 4) + 3;
        }
      }

            // --------------------------
      // Rifle photo (use remaining space under Loads)
      // --------------------------
            let riflePhotoDataUrl: string | null = this.riflePhotoDataUrl(r);



      if (riflePhotoDataUrl) {
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 10;

        // If we don't have enough space left on this page, move photo to next page
        const minPhotoBlockH = 45; // label + usable photo
        if (y + minPhotoBlockH > pageHeight - margin) {
          doc.addPage();
          y = 12;
        }

        doc.setFontSize(12);
        doc.text('Rifle photo', 10, y);
        y += 4;

        const maxW = pageWidth - 20; // 10mm margins
        const maxH = pageHeight - margin - y;

        // Keep aspect ratio using image properties
                // If FS based and not cached yet, load now for PDF export
        const p = (r as any)?.riflePhotoPath;
        if (!riflePhotoDataUrl && p) {
          const u = await this.readJpegDataUrlFromFs(String(p));
          if (u) {
            this.riflePhotoCache.set(String(p), u);
            riflePhotoDataUrl = u;
          }
        }

        const fmt = riflePhotoDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        const props = (doc as any).getImageProperties
          ? (doc as any).getImageProperties(riflePhotoDataUrl)
          : null;

        let imgW = maxW;
        let imgH = maxH;

        if (props?.width && props?.height) {
          const ratio = props.width / props.height;
          imgW = maxW;
          imgH = imgW / ratio;

          if (imgH > maxH) {
            imgH = maxH;
            imgW = imgH * ratio;
          }
        }

        const x = (pageWidth - imgW) / 2;
        (doc as any).addImage(riflePhotoDataUrl, fmt, x, y, imgW, imgH, undefined, 'FAST');
        y += imgH + 4;
      }


      const filenameSafe = `${(r.name ?? 'rifle').toString().replace(/[^\w\-]+/g, '_')}_rifle_export.pdf`;
      const pdfBlob = doc.output('blob');

      // Prefer native share on device; fallback to download on web
      await this.sharePdfBlob(pdfBlob, filenameSafe);
    } catch (err) {
      console.error('exportSelectedRiflePdf failed:', err);
      alert('Export failed. Check console for details.');
    }
  }

  private async sharePdfBlob(blob: Blob, filename: string): Promise<void> {
    // If we’re on web (or Share plugin not available), trigger a download
    const isNative = Capacitor.isNativePlatform?.() ?? (Capacitor.getPlatform?.() !== 'web');
    if (!isNative) {
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      return;
    }

    // Native (Android/iOS): write to cache, then Share
    const base64 = await this.blobToBase64(blob);

    const writeRes = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    await Share.share({
      title: 'Rifle Data Export',
      text: 'Rifle export PDF',
      url: writeRes.uri,
      dialogTitle: 'Share Rifle PDF',
    });
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const res = (reader.result as string) || '';
        // res = "data:application/pdf;base64,...."
        const base64 = res.split(',')[1] ?? '';
        resolve(base64);
      };
      reader.readAsDataURL(blob);
    });
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }

  refresh(): void {
    const anyData: any = this.data;

    if (typeof anyData.getRifles === 'function') {
      this.rifles = anyData.getRifles() ?? [];
    } else if (Array.isArray(anyData.rifles)) {
      this.rifles = anyData.rifles;
    } else {
      this.rifles = [];
    }

    if (this.rifles.length && this.selectedRifleId == null) {
      const first = this.rifles[0];
      this.selectedRifleId = first?.id ?? first?.rifleId ?? null;
    }
  }

  get selectedRifle(): any | null {
    if (this.selectedRifleId == null) return null;
    return (
      this.rifles.find(
        (r: any) =>
          r &&
          (r.id === this.selectedRifleId || r.rifleId === this.selectedRifleId)
      ) ?? null
    );
  }

  // Rifle form logic
  toggleAddForm(): void {
    this.addFormVisible = !this.addFormVisible;
    if (!this.addFormVisible) {
      this.clearRifleForm();
    }
  }

  clearRifleForm(): void {
      this.rifleForm = {
      name: '',
      caliber: '',
      barrelLength: null,
      barrelUnit: 'inch',
      twistRate: '',
      muzzleVelocityFps: 0,
      scopeUnit: 'MIL',
      scope: '',
      notes: '',
      riflePhotoBase64: null,
      riflePhotoCapturedAt: null,
      roundCount: 0,
    };

    this.editingRifle = null;
  }

  onSelectedRifleChange(rawId: any): void {
    if (rawId === null || rawId === undefined || rawId === '') {
      this.selectedRifleId = null;
      return;
    }
   const n = Number(rawId);
this.selectedRifleId =
  typeof rawId === 'number' ? rawId : (!Number.isNaN(n) ? n : rawId);

  }

  editRifle(r: any): void {
    if (!r) return;
    this.addFormVisible = true;
    this.editingRifle = r;

    const { loads, ...rest } = r;
    this.rifleForm = { ...rest };
        delete (this.rifleForm as any).riflePhotoBase64;

  }

  saveRifle(): void {
    const anyData: any = this.data;
    const isEditing = !!this.editingRifle;
    const existingLoads = this.editingRifle?.loads ?? [];

    const roundCount =
      this.rifleForm.roundCount != null
        ? Number(this.rifleForm.roundCount)
        : 0;

    const id =
      this.editingRifle?.id ??
      this.rifleForm.id ??
      this.generateId('rifle');

    const rifle = {
      ...(this.editingRifle || {}),
      ...this.rifleForm,
      id,
      loads: existingLoads,
      roundCount,
    };

    if (isEditing && typeof anyData.updateRifle === 'function') {
      anyData.updateRifle(rifle);
    } else if (!isEditing && typeof anyData.addRifle === 'function') {
      anyData.addRifle(rifle);
    } else if (typeof anyData.setRifles === 'function') {
      const list = isEditing
        ? this.rifles.map((x: any) => (x.id === id ? rifle : x))
        : [...this.rifles, rifle];
      anyData.setRifles(list);
    } else {
      this.rifles = isEditing
        ? this.rifles.map((x: any) => (x.id === id ? rifle : x))
        : [...this.rifles, rifle];
      anyData.rifles = this.rifles;
    }

    this.clearRifleForm();
    this.addFormVisible = false;
    this.refresh();
    this.selectedRifleId = id;
  }

  deleteRifle(r: any): void {
    if (!r) return;
    if (!confirm('Delete this rifle and all its loads?')) return;

    const anyData: any = this.data;

       const nextList = this.rifles.filter((x: any) => x.id !== r.id);

    // Prefer setRifles because it should be the persistence path (localStorage/backup)
    if (typeof anyData.setRifles === 'function') {
      anyData.setRifles(nextList);
    } else if (typeof anyData.deleteRifle === 'function') {
      // Fallback: attempt delete, but also update local list so UI stays correct
      try {
        anyData.deleteRifle(r.id ?? r);
      } catch {
        anyData.deleteRifle(r);
      }
      this.rifles = nextList;
      anyData.rifles = this.rifles;
    } else {
      // Last resort: local only
      this.rifles = nextList;
      anyData.rifles = this.rifles;
    }


    this.refresh();
    if (this.rifles.length) {
      const first = this.rifles[0];
      this.selectedRifleId = first?.id ?? first?.rifleId ?? null;
    } else {
      this.selectedRifleId = null;
    }

    this.activeLoadsRifleId = null;
    this.activeLoadFormRifleId = null;
    this.editingLoadId = null;
    this.resetLoadForm();
  }

  // Loads visibility
  toggleLoads(r: any): void {
    if (!r) return;

    if (this.activeLoadsRifleId === r.id) {
      this.activeLoadsRifleId = null;
      this.activeLoadFormRifleId = null;
      this.editingLoadId = null;
      this.resetLoadForm();
    } else {
      this.activeLoadsRifleId = r.id;
    }
  }

      toggleLoadForm(rifleId: number | string): void {
    if (this.activeLoadFormRifleId === rifleId) {
      this.activeLoadFormRifleId = null;
      this.editingLoadId = null;
      this.resetLoadForm();
    } else {
      this.activeLoadFormRifleId = rifleId;

      // Ensure the loads section is expanded so the form can render
      this.activeLoadsRifleId = rifleId;

      if (!this.editingLoadId) {
        this.resetLoadForm();
      }

      // Jump cursor to first field (and scroll it into view)
      this.focusFirstLoadField();
    }
  }
  private focusFirstLoadField(): void {
    // Allow Angular to render the form first
    setTimeout(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector('input[name="loadPowder"]') as HTMLInputElement | null;
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
      });
    }, 50);
  }



  // Load form logic
    // Load form logic
resetLoadForm(): void {
  const defUnit =
    typeof (this.data as any).getDefaultLoadDevOalUnit === 'function'
      ? (this.data as any).getDefaultLoadDevOalUnit()
      : 'mm';

  this.loadForm = { notes: '', coalUnit: defUnit, landsOgive: '', coal: '', coalOgive: '' };

  this.editingLoadId = null;
}

  // Lands - Ogive (Load Data form + display helpers)
 private toNumOrNull(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Returns Lands - COAL(Ogive). Positive = jump (if Lands > Ogive). */
loadLandsMinusOgiveText(): string {
  const lands = this.toNumOrNull(this.loadForm?.landsOgive);
  const ogive = this.toNumOrNull(this.loadForm?.coalOgive);
  if (lands == null || ogive == null) return '';
  const d = lands - ogive;
  return d.toFixed(3);
}

loadLandsMinusOgiveTextForLoad(l: any): string | null {
  const lands = this.toNumOrNull(l?.landsOgive ?? l?.lands);
  const ogive = this.toNumOrNull(l?.coalOgive);
  if (lands == null || ogive == null) return null;
  const d = lands - ogive;
  return d.toFixed(3);
}



  saveLoad(r: any): void {
    if (!r) return;

    const anyData: any = this.data;
    const loads: any[] = [...(r.loads || [])];

    if (this.editingLoadId != null) {
      const idx = loads.findIndex((l) => l.id === this.editingLoadId);
      if (idx !== -1) {
              const charge = this.toNumOrNull(this.loadForm.chargeGn);
        const bw = this.toNumOrNull(this.loadForm.bulletWeightGr);
        const landsOgiveNum = this.toNumOrNull(this.loadForm.landsOgive);

        loads[idx] = {
          ...loads[idx],
          ...this.loadForm,
          id: this.editingLoadId,

          chargeGn: charge != null ? charge : loads[idx].chargeGn,
          bulletWeightGr: bw != null ? bw : loads[idx].bulletWeightGr,

          // ✅ keep both fields aligned; UI reads landsOgive first
          landsOgive:
            landsOgiveNum != null
              ? landsOgiveNum
              : (loads[idx] as any).landsOgive ?? (loads[idx] as any).lands ?? null,

          lands:
            landsOgiveNum != null
              ? landsOgiveNum
              : (loads[idx] as any).lands ?? null,
        };

      }
    } else {
        const newLoad = {
        id: Date.now(),

        powder: (this.loadForm.powder || '').toString(),
        chargeGn: this.toNumOrNull(this.loadForm.chargeGn),

        coalUnit: this.loadForm.coalUnit || 'mm',

        // ✅ store the field the UI actually edits/displays
        landsOgive: this.toNumOrNull(this.loadForm.landsOgive),

        // keep legacy field in sync for older data/display fallbacks
        lands: this.toNumOrNull(this.loadForm.landsOgive),

        coal: this.toNumOrNull(this.loadForm.coal),
        coalOgive: this.toNumOrNull(this.loadForm.coalOgive),

        primer: (this.loadForm.primer || '').toString(),
        bullet: (this.loadForm.bullet || '').toString(),
        bulletWeightGr: this.toNumOrNull(this.loadForm.bulletWeightGr),
        bulletBc: (this.loadForm.bulletBc || '').toString(),

        notes: (this.loadForm.notes || '').toString(),
      };



      

      loads.push(newLoad);
    }

    const updatedRifle = {
      ...r,
      loads,
    };

    if (typeof anyData.updateRifle === 'function') {
      anyData.updateRifle(updatedRifle);
    } else if (typeof anyData.setRifles === 'function') {
         const list = this.rifles.map((x: any) =>
        (x.id ?? x.rifleId) === (updatedRifle.id ?? (updatedRifle as any).rifleId) ? updatedRifle : x
      );

      anyData.setRifles(list);
    } else {
           this.rifles = this.rifles.map((x: any) =>
        (x.id ?? x.rifleId) === (updatedRifle.id ?? (updatedRifle as any).rifleId) ? updatedRifle : x
      );

      anyData.rifles = this.rifles;
    }

    this.refresh();
    this.activeLoadsRifleId = updatedRifle.id;
    this.activeLoadFormRifleId = null; // collapse form after save
    this.resetLoadForm();
    this.editingLoadId = null;
  }

  editLoad(r: any, load: any): void {
    if (!r || !load) return;

    this.activeLoadsRifleId = r.id;
    this.activeLoadFormRifleId = r.id;
    this.editingLoadId = load.id;

       this.loadForm = {
      id: load.id,
      powder: load.powder,
      chargeGn: load.chargeGn,
      coalUnit: load.coalUnit || 'mm',
      landsOgive: load.landsOgive ?? load.lands ?? '',

      coalOgive: load.coalOgive || '',
      lands: load.lands ?? null,

      coal: load.coal,
      primer: load.primer,
      bullet: load.bullet,
      bulletWeightGr: load.bulletWeightGr,
      bulletBc: load.bulletBc,
      notes: (load.notes || '').toString(), // <-- ADD THIS LINE
    };

  }

  deleteLoad(r: any, load: any): void {
    if (!r || !load) return;
    if (!confirm('Delete this load?')) return;

    const anyData: any = this.data;

    const loads = (r.loads || []).filter((l: any) => l.id !== load.id);
    const updatedRifle = { ...r, loads };

    if (typeof anyData.updateRifle === 'function') {
      anyData.updateRifle(updatedRifle);
    } else if (typeof anyData.setRifles === 'function') {
      const list = this.rifles.map((x: any) =>
        x.id === updatedRifle.id ? updatedRifle : x
      );
      anyData.setRifles(list);
    } else {
      this.rifles = this.rifles.map((x: any) =>
        x.id === updatedRifle.id ? updatedRifle : x
      );
      anyData.rifles = this.rifles;
    }

    this.refresh();
    this.activeLoadsRifleId = updatedRifle.id;
    this.activeLoadFormRifleId = null;
    this.editingLoadId = null;
    this.resetLoadForm();
  }
  // ==========================================================
  // PHOTO STORAGE (Option A): Filesystem (Directory.Data)
  // ==========================================================
  private readonly RIFLE_PHOTO_ROOT = 'gs_photos/rifles';
  private riflePhotoCache = new Map<string, string>(); // path -> dataUrl
  private riflePhotoLoadInFlight = new Set<string>(); // prevent repeated FS reads
private riflePhotoMissing = new Set<string>();      // remember missing/unreadable files


  private dataUrlToBase64(dataUrl: string): string {
    const b64 = (dataUrl || '').split(',')[1] ?? '';
    return b64.toString().trim();
  }

  private makeRiflePhotoPath(rifleId: number | string): string {
    const rid = String(rifleId ?? 'new').replace(/[^a-z0-9_-]/gi, '');
    return `${this.RIFLE_PHOTO_ROOT}/r${rid}-${Date.now()}.jpg`;
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
      const res = await Filesystem.readFile({ path, directory: Directory.Data });
      const base64 = (res?.data ?? '').toString().trim();
      if (!base64) return null;
      return `data:image/jpeg;base64,${base64}`;
    } catch {
      return null;
    }
  }

  private async ensureRiflePhotoOnFs(r: any): Promise<void> {
    if (!r) return;
    if (r.riflePhotoPath) return;

    const legacyBase64 = (r?.riflePhotoBase64 && String(r.riflePhotoBase64).trim())
      ? `data:image/jpeg;base64,${String(r.riflePhotoBase64).trim()}`
      : null;

    if (!legacyBase64) return;

    const path = this.makeRiflePhotoPath(r.id ?? 'saved');
    await this.writeJpegDataUrlToFs(path, legacyBase64);

    r.riflePhotoPath = path;
    r.riflePhotoCapturedAt = r.riflePhotoCapturedAt ?? new Date().toISOString();

    try { delete r.riflePhotoBase64; } catch {}

    // persist
    try {
      const anyData: any = this.data;
      if (typeof anyData.updateRifle === 'function') anyData.updateRifle({ ...(r as any) });
      else if (typeof anyData.setRifles === 'function') {
        const list = this.rifles.map((x: any) => (x.id === r.id ? r : x));
        anyData.setRifles(list);
      }
    } catch {}
  }

}
