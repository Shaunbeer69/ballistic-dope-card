import { CommonModule } from '@angular/common';
import { Component, OnInit, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../data.service';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

@Component({
  selector: 'app-rifles-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rifles-tab.component.html',
  styleUrls: ['./rifles-tab.component.css'],
})
export class RiflesTabComponent implements OnInit {
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
    scopeUnit: 'MIL',
    barrelUnit: 'inch',
    roundCount: 0,
  };

  loadForm: any = {};

  constructor(private data: DataService) {}

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
      scopeUnit: 'MIL',
      barrelUnit: 'inch',
      roundCount: 0,
    };
    this.editingRifle = null;
  }

  onSelectedRifleChange(rawId: any): void {
    if (rawId === null || rawId === undefined || rawId === '') {
      this.selectedRifleId = null;
      return;
    }
    this.selectedRifleId =
      typeof rawId === 'number' ? rawId : Number(rawId) || rawId;
  }

  editRifle(r: any): void {
    if (!r) return;
    this.addFormVisible = true;
    this.editingRifle = r;

    const { loads, ...rest } = r;
    this.rifleForm = { ...rest };
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

    if (typeof anyData.deleteRifle === 'function') {
      anyData.deleteRifle(r);
    } else if (typeof anyData.setRifles === 'function') {
      const list = this.rifles.filter((x: any) => x.id !== r.id);
      anyData.setRifles(list);
    } else {
      this.rifles = this.rifles.filter((x: any) => x.id !== r.id);
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
      if (!this.editingLoadId) {
        this.resetLoadForm();
      }
    }
  }

  // Load form logic
  resetLoadForm(): void {
    this.loadForm = {};
    this.editingLoadId = null;
  }

  saveLoad(r: any): void {
    if (!r) return;

    const anyData: any = this.data;
    const loads: any[] = [...(r.loads || [])];

    if (this.editingLoadId != null) {
      const idx = loads.findIndex((l) => l.id === this.editingLoadId);
      if (idx !== -1) {
        loads[idx] = {
          ...loads[idx],
          ...this.loadForm,
          id: this.editingLoadId,
          chargeGn:
            this.loadForm.chargeGn != null
              ? Number(this.loadForm.chargeGn)
              : loads[idx].chargeGn,
          bulletWeightGr:
            this.loadForm.bulletWeightGr != null
              ? Number(this.loadForm.bulletWeightGr)
              : loads[idx].bulletWeightGr,
        };
      }
    } else {
      const newLoadId = this.loadForm.id ?? this.generateId('load');

      const newLoad: any = {
        id: newLoadId,
        powder: this.loadForm.powder || '',
        chargeGn:
          this.loadForm.chargeGn != null
            ? Number(this.loadForm.chargeGn)
            : 0,
        coal: this.loadForm.coal || '',
        primer: this.loadForm.primer || '',
        bullet: this.loadForm.bullet,
        bulletWeightGr:
          this.loadForm.bulletWeightGr != null
            ? Number(this.loadForm.bulletWeightGr)
            : undefined,
        bulletBc: this.loadForm.bulletBc,
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
      coal: load.coal,
      primer: load.primer,
      bullet: load.bullet,
      bulletWeightGr: load.bulletWeightGr,
      bulletBc: load.bulletBc,
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
}
