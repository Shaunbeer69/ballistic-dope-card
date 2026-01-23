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
  private lastLoadCoalUnit: 'mm' | 'in' = 'mm';
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
    // Load details modal (Show Loads -> tap a row -> modal)
  loadDetailsOpen = false;
  loadDetailsRifleId: number | string | null = null;
  loadDetailsLoad: any | null = null;

  // Selected load details (for the “View” panel under the table)
  selectedLoadDetails: { rifle: any; load: any } | null = null;

  // selectLoadForDetails(r: any, l: any): void {
  //   if (!r || !l) return;
  //   this.selectedLoadDetails = { rifle: r, load: l };
  // }


  // Forms
      rifleForm: any = {
    name: '',
    caliber: '',
    barrelLength: null,
    barrelUnit: 'inch',
    twistRate: '',
    scopeUnit: 'MIL',
    scope: '',
    notes: '',
    riflePhotoBase64: null,
    riflePhotoCapturedAt: null,
    roundCount: 'Starting or Current round count',
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
      const u =
        typeof (this.data as any).getDefaultLoadDevOalUnit === 'function'
          ? (this.data as any).getDefaultLoadDevOalUnit()
          : 'mm';

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
          this.closeLoadDetails();
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
         const sn = (r as any)?.serialNumber ? ` SN: ${(r as any).serialNumber}` : '';
      doc.text(`${r.name ?? 'Rifle'}${r.caliber ? ` (${r.caliber})` : ''}${sn}`, 10, y);

      y += 5;
      

      const rifleRows: Array<[string, string]> = [
        ['Caliber', `${r.caliber ?? '-'}`],
        ['Barrel length', `${r.barrelLength ?? '-'} ${r.barrelUnit ?? ''}`.trim()],
        ['Twist rate', `${r.twistRate ?? '-'}`],
              ['Scope', `${r.scope ?? '-'}${r.scopeUnit ? ' (' + r.scopeUnit + ')' : ''}`],
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
            const outUnit: 'mm' | 'in' = (this.defaultLoadCoalUnit === 'in' ? 'in' : 'mm');
      doc.setFontSize(12);
      doc.text('Load Data', 10, y);
      doc.setFontSize(10);
      doc.text(`Loads (${loads.length})`, 10, y + 5);
      y += 9;
      // Loads table (keep it horizontal; notes/comments go underneath)
            const loadTableBody = (loads as any[]).reduce((acc: any[], l: any) => {
               const fromUnit: 'mm' | 'in' = (l?.coalUnit === 'in' ? 'in' : 'mm');

        const coalText = this.oalConvertValue(l?.coal, fromUnit, outUnit);
        const coalOgiveText = this.oalConvertValue(l?.coalOgive, fromUnit, outUnit);
        const landsText = this.oalConvertValue(l?.landsOgive ?? l?.lands, fromUnit, outUnit);

        // Jump = Lands - Ogive (in OUT unit)
        const landsN = this.oalParseNum(l?.landsOgive ?? l?.lands);
        const ogiveN = this.oalParseNum(l?.coalOgive);
        let jumpText: any = '';
        if (landsN != null && ogiveN != null) {
          const landsOut = this.oalConvert(landsN, fromUnit, outUnit);
          const ogiveOut = this.oalConvert(ogiveN, fromUnit, outUnit);
          jumpText = this.oalFormat(landsOut - ogiveOut, outUnit);
        }

        const row = [
          `${l?.powder ?? ''}`,
          `${l?.chargeGn ?? ''}`,
          `${l?.aveVelocityFps ?? ''}`,
          `${coalText ?? ''}`,
          `${coalOgiveText ?? ''}`,
          `${landsText ?? ''}`,
          `${jumpText ?? ''}`,
          `${l?.primer ?? ''}`,
          `${l?.bullet ?? ''}`,
          `${l?.bulletWeightGr ?? ''}`,
          `${l?.bulletBc ?? ''}`,
        ];


        const noteText = (l?.notes ?? '').toString().trim();

        const noteRow = [
          {
            content: `Notes: ${noteText}`,
            colSpan: 11,
            styles: { fontSize: 7, fontStyle: 'italic' as any },
          },
        ];

        acc.push(row);
        acc.push(noteRow);
        return acc;
      }, []);


      autoTableMod.default(doc, {
        startY: y,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fontSize: 8 },
        head: [[
  'Powder',
  'Charge (gr)',
    'Vel (fps)',
  `COAL (${outUnit})`,
  `COAL Ogive (${outUnit})`,
  `Lands / Ogive (${outUnit})`,
  `Jump (${outUnit})`,
  'Primer',
  'Bullet',
  'Weight (gr)',
  'BC'
]],


      body: loadTableBody,





      });

      // Move cursor below the table
      y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : y + 12;
     

                 // --------------------------
      // Rifle photo (use remaining space under Loads)
      // --------------------------
            let riflePhotoDataUrl: string | null = this.riflePhotoDataUrl(r);



      if (riflePhotoDataUrl) {
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 10;
        // Keep everything on one page: do NOT add a page; just scale to remaining space


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
        if (imgW > 0 && imgH > 0) {
          (doc as any).addImage(riflePhotoDataUrl, fmt, x, y, imgW, imgH, undefined, 'FAST');
          y += imgH + 4;
        }
      }

      const filenameSafe = `${(r.name ?? 'rifle').toString().replace(/[^\w\-]+/g, '_')}_rifle_export.pdf`;
      const pdfBlob = doc.output('blob');

    // Prefer native share on device; fallback to download on web
      await this.sharePdfBlob(pdfBlob, filenameSafe);
    } catch (err) {
      console.error('exportSelectedRiflePdf failed:', err);
      alert('File Export cancelled');
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

       // Do not auto-select a rifle. Only clear selection if it no longer exists.
    if (this.selectedRifleId != null) {
      const sel = this.selectedRifleId;
      const stillExists = this.rifles.some(
        (r: any) => r && (r.id === sel || r.rifleId === sel)
      );
      if (!stillExists) this.selectedRifleId = null;
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
       serialNumber: '',
      barrelLength: null,
      barrelUnit: 'inch',
      twistRate: '',
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
    const prev = this.selectedRifleId;

    if (rawId === null || rawId === undefined || rawId === '') {
      this.selectedRifleId = null;

      // Auto-collapse / clear load UI when selection is cleared
      this.activeLoadsRifleId = null;
      this.activeLoadFormRifleId = null;
      this.editingLoadId = null;
      this.selectedLoadDetails = null;
      this.closeLoadDetails();
      this.resetLoadForm();
      return;
    }

    const n = Number(rawId);
    const nextId =
      typeof rawId === 'number' ? rawId : (!Number.isNaN(n) ? n : rawId);

    // If changing rifle, collapse the previous rifle's open sections/modals
    if (prev !== nextId) {
      this.activeLoadsRifleId = null;
      this.activeLoadFormRifleId = null;
      this.editingLoadId = null;
      this.selectedLoadDetails = null;
      this.closeLoadDetails();
      this.resetLoadForm();
    }

    this.selectedRifleId = nextId;
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

    // Do not auto-select a rifle after delete.
    // If current selection no longer exists, clear it.
    if (this.selectedRifleId != null) {
      const sel = this.selectedRifleId;
      const stillExists = this.rifles.some(
        (x: any) => x && (x.id === sel || x.rifleId === sel)
      );
      if (!stillExists) this.selectedRifleId = null;
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
            this.selectedLoadDetails = null;

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

       this.loadForm = { powder: '', chargeGn: null, lands: null, coalUnit: defUnit, coal: null, coalOgive: null, primer: '', bullet: '', bulletWeightGr: null, bulletBc: '', aveVelocityFps: null, notes: '' };
  this.lastLoadCoalUnit = (defUnit === 'in' ? 'in' : 'mm');

  this.editingLoadId = null;
   

}
  selectLoadForDetails(l: any): void {
    this.selectedLoadDetails = l ?? null;
  }

  clearSelectedLoadDetails(): void {
    this.selectedLoadDetails = null;
  }
  openLoadDetails(r: any, l: any, ev?: Event): void {
    try {
      ev?.preventDefault();
      ev?.stopPropagation();
    } catch {}

    if (!r || !l) return;
    this.loadDetailsOpen = true;
    this.loadDetailsRifleId = r.id ?? r.rifleId ?? null;
    this.loadDetailsLoad = l;
  }

  closeLoadDetails(): void {
    this.loadDetailsOpen = false;
    this.loadDetailsRifleId = null;
    this.loadDetailsLoad = null;
  }

  loadsVelocitySummaryText(r: any): string {
    const loads = Array.isArray(r?.loads) ? r.loads : [];
    const vels = loads
      .map((x: any) => (x?.aveVelocityFps != null ? Number(x.aveVelocityFps) : NaN))
      .filter((n: number) => Number.isFinite(n));

    if (!vels.length) return 'Vel: —';

    const sum = vels.reduce((a: number, b: number) => a + b, 0);
    const avg = sum / vels.length;
    const min = Math.min(...vels);
    const max = Math.max(...vels);

    return `Vel (fps): avg ${Math.round(avg)} • min ${Math.round(min)} • max ${Math.round(max)}`;
  }

  // Lands - Ogive (Load Data form + display helpers)
 private toNumOrNull(v: any): number | null {
  
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
  private oalParseNum(v: any): number | null {
    if (v == null || v === '') return null;
    const s = String(v).trim().replace(/,/g, '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  private oalFormat(n: number, unit: 'mm' | 'in'): string {
    const fixed = unit === 'in' ? 3 : 2;
    return Number(n.toFixed(fixed)).toString();
  }

  private oalConvert(n: number, from: 'mm' | 'in', to: 'mm' | 'in'): number {
    if (from === to) return n;
    return from === 'mm' ? (n / 25.4) : (n * 25.4);
  }

  private oalConvertValue(v: any, from: 'mm' | 'in', to: 'mm' | 'in'): any {
    const n = this.oalParseNum(v);
    if (n == null) return v;
    return this.oalFormat(this.oalConvert(n, from, to), to);
  }

  onLoadCoalUnitChange(newUnit: 'mm' | 'in'): void {
    const fromUnit = (this.lastLoadCoalUnit === 'in' ? 'in' : 'mm');
    const toUnit = (newUnit === 'in' ? 'in' : 'mm');

    if (fromUnit === toUnit) {
      this.lastLoadCoalUnit = toUnit;
      return;
    }

    // Convert the editable fields to the newly selected unit
    this.loadForm.landsOgive = this.oalConvertValue(this.loadForm?.landsOgive, fromUnit, toUnit);
    this.loadForm.coal = this.oalConvertValue(this.loadForm?.coal, fromUnit, toUnit);
    this.loadForm.coalOgive = this.oalConvertValue(this.loadForm?.coalOgive, fromUnit, toUnit);

    // keep legacy field aligned if it’s being used anywhere
    if (this.loadForm?.lands != null) {
      this.loadForm.lands = this.oalConvertValue(this.loadForm?.lands, fromUnit, toUnit);
    }

    this.lastLoadCoalUnit = toUnit;
  }

  onInchDecimalInput(field: 'landsOgive' | 'coal' | 'coalOgive', ev: Event): void {
    // Only enforce formatting when user is working in inches
    const unit = (this.loadForm?.coalUnit ?? this.defaultLoadCoalUnit);
    if (unit !== 'in') return;

    const input = ev.target as HTMLInputElement | null;
    if (!input) return;

    let v = (input.value ?? '').toString();

    // 1) Comma -> dot
    v = v.replace(/,/g, '.');

    // 2) Only allow digits and a single dot
    v = v.replace(/[^0-9.]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    }
// 3) Auto dot after first digit ONLY when typing forward (not when deleting)
const inputType = (ev as any)?.inputType as string | undefined;
const isDeleting =
  inputType === 'deleteContentBackward' ||
  inputType === 'deleteContentForward';

if (!isDeleting && /^\d$/.test(v)) {
  v = v + '.';
}


    input.value = v;
    (this.loadForm as any)[field] = v;
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
            const aveV = this.toNumOrNull(this.loadForm.aveVelocityFps);

    if (!r) return;

    const anyData: any = this.data;
    const loads: any[] = [...(r.loads || [])];
    

    if (this.editingLoadId != null) {
      const idx = loads.findIndex((l) => l.id === this.editingLoadId);
      if (idx !== -1) {
              const charge = this.toNumOrNull(this.loadForm.chargeGn);
        const bw = this.toNumOrNull(this.loadForm.bulletWeightGr);
        const landsOgiveNum = this.toNumOrNull(this.loadForm.landsOgive);
        const coalOgiveNum = this.toNumOrNull(this.loadForm.coalOgive);


        loads[idx] = {
          ...loads[idx],
          ...this.loadForm,
                 id: this.editingLoadId,

          chargeGn: charge != null ? charge : loads[idx].chargeGn,
          bulletWeightGr: bw != null ? bw : loads[idx].bulletWeightGr,
          aveVelocityFps: aveV != null ? aveV : (loads[idx] as any).aveVelocityFps ?? null,

          // ✅ keep both fields aligned; UI reads landsOgive first
          landsOgive:
            landsOgiveNum != null
              ? landsOgiveNum
              : (loads[idx] as any).landsOgive ?? (loads[idx] as any).lands ?? null,

          lands:
            landsOgiveNum != null
              ? landsOgiveNum
              : (loads[idx] as any).lands ?? null,
              jump: (() => {
  const lands = (landsOgiveNum != null)
    ? landsOgiveNum
    : (loads[idx] as any).landsOgive ?? (loads[idx] as any).lands ?? null;

  const ogive = (coalOgiveNum != null)
    ? coalOgiveNum
    : (loads[idx] as any).coalOgive ?? null;

  return (lands != null && ogive != null) ? (lands - ogive) : (loads[idx] as any).jump ?? null;
})(),

        };

      }
    } else {
        const newLoad = {
        id: Date.now(),

        powder: (this.loadForm.powder || '').toString(),
        chargeGn: this.toNumOrNull(this.loadForm.chargeGn),
aveVelocityFps: this.toNumOrNull(this.loadForm.aveVelocityFps),

        coalUnit: this.loadForm.coalUnit || 'mm',

        // ✅ store the field the UI actually edits/displays
        landsOgive: this.toNumOrNull(this.loadForm.landsOgive),
      

        // keep legacy field in sync for older data/display fallbacks
        lands: this.toNumOrNull(this.loadForm.landsOgive),

        coal: this.toNumOrNull(this.loadForm.coal),
        coalOgive: this.toNumOrNull(this.loadForm.coalOgive),
jump: (() => {
  const lands = this.toNumOrNull(this.loadForm.landsOgive);
  const ogive = this.toNumOrNull(this.loadForm.coalOgive);
  return (lands != null && ogive != null) ? (lands - ogive) : null;
})(),

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
      aveVelocityFps: load.aveVelocityFps ?? null,

    this.activeLoadsRifleId = r.id;
    this.activeLoadFormRifleId = r.id;
    aveVelocityFps: this.toNumOrNull(this.loadForm.aveVelocityFps),

    this.editingLoadId = load.id;

           this.loadForm = {
      id: load.id,
      powder: load.powder,
      chargeGn: load.chargeGn,
      aveVelocityFps: load.aveVelocityFps ?? '',
      coalUnit: load.coalUnit || 'mm',
      landsOgive: load.landsOgive ?? load.lands ?? '',
      coal: load.coal ?? '',
      coalOgive: load.coalOgive ?? '',
      primer: load.primer,
      bullet: load.bullet,
      bulletWeightGr: load.bulletWeightGr,
      
      bulletBc: load.bulletBc,
      notes: (load.notes || '').toString(),
    };
    this.lastLoadCoalUnit = (this.loadForm?.coalUnit === 'in' ? 'in' : 'mm');

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
