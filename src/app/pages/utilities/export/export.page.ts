import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { DataService } from '../../../data.service';

@Component({
  selector: 'app-export-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './export.page.html',
})
export class ExportPage {
  private readonly router = inject(Router);
  private readonly dataService = inject(DataService);

  // Selection model (mirrors existing capability)
  includeRifles = true;
  includeVenues = false;

  allRifles = true;
  allVenues = true;

  rifleData = true;
  rifleLoadDev = true;
  rifleSessions = true;
  rifleShots = true;

  venueData = true;
  venueSessions = true;
  venueShots = true;

  // Selected IDs (only used if "all" is false)
  selectedRifleIds: number[] = [];
  selectedVenueIds: number[] = [];

  busy = false;

  back(): void {
    this.router.navigateByUrl('/tools');
  }

  private buildOpts(): any {
    return {
      includeRifles: this.includeRifles,
      includeVenues: this.includeVenues,
      allRifles: this.allRifles,
      allVenues: this.allVenues,
      rifleIds: this.allRifles ? null : (this.selectedRifleIds || []),
      venueIds: this.allVenues ? null : (this.selectedVenueIds || []),
      rifleData: this.rifleData,
      rifleLoadDev: this.rifleLoadDev,
      rifleSessions: this.rifleSessions,
      rifleShots: this.rifleShots,
      venueData: this.venueData,
      venueSessions: this.venueSessions,
      venueShots: this.venueShots,
    };
  }


onVenueIdsChange(value: string | null | undefined): void {
  const raw = value ?? '';

  this.selectedVenueIds = raw
    .split(',')
    .map(x => Number(x.trim()))
    .filter(n => Number.isFinite(n));
}

  async exportJson(): Promise<void> {
    this.busy = true;
    try {
      const opts = this.buildOpts();
      const payload = (this.dataService as any).exportSelectiveShareForMerge?.(opts);
      if (!payload?.store) {
        alert('Export failed: no data returned.');
        return;
      }

      // Add load-dev media if present in the store
      await this.attachLoadDevMediaToBackupPayload(payload);

      const json = JSON.stringify(payload, null, 2);
      const filename = 'gunstuff-share-data-' + new Date().toISOString().slice(0, 10) + '.json';

      if (Capacitor.isNativePlatform()) {
        try {
          const directory = Directory.Cache;
          const path = filename;

          await Filesystem.writeFile({ path, data: json, directory, encoding: Encoding.UTF8 });
          const { uri } = await Filesystem.getUri({ path, directory });

          await Share.share({
            title: 'GS Export Data',
            text: 'GS Ballistics selective export (share this file)',
            url: uri,
          });

          alert('Data export created. Share or save it using the app you chose.');
        } catch (err) {
          console.error('Selective export failed:', err);
          alert('Data export failed on this device.\n\n' + ((err as any)?.message ?? String(err)));
        }
      } else {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } finally {
      this.busy = false;
    }
  }

  async exportPdf(): Promise<void> {
    this.busy = true;
    try {
      const opts = this.buildOpts();
      const payload = (this.dataService as any).exportSelectivePdf?.(opts);
      if (!payload?.data) {
        alert('PDF export failed: no data returned.');
        return;
      }

      const store = payload.data;
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });

      doc.setFontSize(14);
      doc.text('GS Export (PDF)', 40, 48);
      doc.setFontSize(9);
      doc.text(new Date().toISOString(), 40, 62);

      const summaryRows = [
        ['Rifles', String((store.rifles || []).length)],
        ['Venues', String((store.venues || []).length)],
        ['Sessions', String((store.sessions || []).length)],
        ['Load Dev Projects', String((store.loadDevProjects || []).length)],
      ];

      autoTable(doc, {
        startY: 80,
        head: [['Section', 'Count']],
        body: summaryRows,
      });

      let y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 18 : 120;

      const addTable = (title: string, head: string[], body: any[][]) => {
        doc.setFontSize(11);
        doc.text(title, 40, y);
        y += 8;
        autoTable(doc, { startY: y, head: [head], body });
        y = (doc as any).lastAutoTable.finalY + 18;
      };

      if ((store.rifles || []).length) {
        addTable(
          'Rifles',
          ['Name', 'Caliber', 'Notes'],
          (store.rifles || []).map((r: any) => [r?.name ?? '', r?.caliber ?? '', (r?.notes ?? '').toString().slice(0, 80)]),
        );
      }

      if ((store.venues || []).length) {
        addTable(
          'Venues',
          ['Name', 'Location', 'Notes'],
          (store.venues || []).map((v: any) => [v?.name ?? '', v?.location ?? '', (v?.notes ?? '').toString().slice(0, 80)]),
        );
      }

      const filename = 'gunstuff-export-' + new Date().toISOString().slice(0, 10) + '.pdf';

      if (Capacitor.isNativePlatform()) {
        try {
          const pdfDataUri = doc.output('datauristring');
          const base64 = pdfDataUri.split(',')[1] || '';
          await Filesystem.writeFile({
            path: filename,
            data: base64,
            directory: Directory.Cache,
            recursive: true,
          });
          const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });

          await Share.share({
            title: filename,
            text: 'GS Ballistics export (PDF)',
            url: uri,
          });
        } catch (err) {
          console.error('PDF share failed:', err);
          alert('PDF export failed on this device.\n\n' + ((err as any)?.message ?? String(err)));
        }
      } else {
        doc.save(filename);
      }
    } finally {
      this.busy = false;
    }
  }

  private async attachLoadDevMediaToBackupPayload(payload: any): Promise<void> {
    try {
      const projects: any[] = payload?.store?.loadDevProjects ?? [];
      if (!Array.isArray(projects) || projects.length === 0) return;

      payload.loadDevMedia = payload.loadDevMedia ?? {};
      payload.loadDevMedia.files = payload.loadDevMedia.files ?? {};

      const files: Record<string, { base64: string; mime: string }> = payload.loadDevMedia.files;

      const addPath = async (pathRaw: any, mime: string = 'image/jpeg') => {
        const path = (pathRaw ?? '').toString().trim();
        if (!path) return;
        if (files[path]) return;

        try {
          const res = await Filesystem.readFile({
            path,
            directory: Directory.Data,
          });
          const data = (res?.data ?? '') as any;
          const base64 = typeof data === 'string' ? data : '';
          if (!base64) return;
          files[path] = { base64, mime };
        } catch {
          // ignore missing files
        }
      };

      for (const p of projects) {
        const photos = (p?.photos ?? p?.images ?? []) as any[];
        if (!Array.isArray(photos)) continue;

        for (const ph of photos) {
          const path = ph?.path ?? ph?.uri ?? ph;
          const mime = ph?.mime ?? ph?.contentType ?? 'image/jpeg';
          await addPath(path, mime);
        }
      }
    } catch {
      // ignore
    }
  }
}
