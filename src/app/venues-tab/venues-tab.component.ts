import { CommonModule } from '@angular/common';
import { Component, OnInit, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../data.service';
import { Venue, SubRange } from '../models';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

interface SubRangeRow {
  id: number;
  name: string;
  distancesText: string; // e.g. "500, 578, 780"
}

@Component({
  selector: 'app-venues-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './venues-tab.component.html',
  styleUrls: ['./venues-tab.component.css'],
})
export class VenuesTabComponent implements OnInit {
  venues: Venue[] = [];

  // 🔸 Tell parent when user presses Back (same pattern as History)
  @Output() backToMenu = new EventEmitter<void>();

  // form state
  formVisible = false;
  editingVenue: Venue | null = null;

  // dropdown + expanded state
  selectedVenueId: number | null = null;
  expandedVenueId: number | null = null;

  // main venue form
  venueForm: Partial<Venue> = {};

  // subrange rows used in the form
  subRangeRows: SubRangeRow[] = [];

  constructor(private data: DataService) {}

  ngOnInit(): void {
    this.loadVenues();
    // start with one empty subrange row
    if (this.subRangeRows.length === 0) {
      this.addSubRangeRow();
    }
  }

  // ---------- helpers ----------

  private generateRowId(): number {
    return Date.now() + Math.floor(Math.random() * 1000);
  }

  private parseDistances(text: string): number[] {
    if (!text) return [];
    return text
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => Number(t))
      .filter((n) => !Number.isNaN(n));
  }

  private loadVenues(): void {
    this.venues = this.data.getVenues();

    if (this.venues.length > 0 && this.selectedVenueId == null) {
      this.selectedVenueId = this.venues[0].id as number;
    }

    if (
      this.selectedVenueId != null &&
      !this.venues.some((v) => v.id === this.selectedVenueId)
    ) {
      this.selectedVenueId = this.venues[0]?.id as number | null;
    }
  }

  get selectedVenue(): Venue | undefined {
    return this.venues.find((v) => v.id === this.selectedVenueId);
  }
  // ==========================
  // PDF Export (Selected Venue)
  // ==========================
  async exportSelectedVenuePdf(): Promise<void> {
    try {
      const v = this.selectedVenue;
      if (!v) {
        alert('Please select a venue first.');
        return;
      }

            // Lazy-load to match Rifles tab (stable with different jspdf/autotable builds)
      const jspdfMod: any = await import('jspdf');
      const autoTableMod: any = await import('jspdf-autotable');
      const jsPDF = jspdfMod?.jsPDF ?? jspdfMod?.default;

      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();

      let y = 12;

      doc.setFontSize(14);
      doc.text('Venue Data Export', 10, y);
      y += 8;

      doc.setFontSize(11);

      const name = (v as any)?.name ?? '';
      const location = (v as any)?.location ?? '';
      const altitudeM = (v as any)?.altitudeM ?? '';
      const notes = ((v as any)?.notes ?? '').toString();

      doc.text(`Name: ${name}`, 10, y); y += 6;
      if (location) { doc.text(`Location: ${location}`, 10, y); y += 6; }
      if (altitudeM !== '' && altitudeM != null) { doc.text(`Altitude (m): ${altitudeM}`, 10, y); y += 6; }

      // Notes (wrapped)
      if (notes.trim().length) {
        y += 2;
        doc.setFontSize(12);
        doc.text('Notes', 10, y);
        y += 6;

        doc.setFontSize(10);
        const wrapped = doc.splitTextToSize(notes, pageWidth - 20);
        doc.text(wrapped, 12, y);
        y += (wrapped.length * 4) + 4;
      }

      // Subranges table
      const subRanges = (v as any)?.subRanges ?? [];
      if (Array.isArray(subRanges) && subRanges.length) {
        // page break if needed
        if (y > 255) {
          doc.addPage();
          y = 12;
        }

                autoTableMod.default(doc, {
          startY: y,
          head: [['Subrange', 'Distances (m)']],
          body: subRanges.map((sr: any) => ([
            `${sr?.name ?? ''}`,
            Array.isArray(sr?.distancesM) ? sr.distancesM.join(', ') : '',
          ])),
          styles: { fontSize: 9 },
          headStyles: { fontSize: 9 },
          margin: { left: 10, right: 10 },
        });


        y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : y + 12;
      }

      const filenameSafe = `${(name || 'venue').toString().replace(/[^\w\-]+/g, '_')}_venue_export.pdf`;
      const pdfBlob = doc.output('blob');

      await this.sharePdfBlob(pdfBlob, filenameSafe);
    } catch (err) {
      console.error('exportSelectedVenuePdf failed:', err);
      alert('Export failed. Check console for details.');
    }
  }

  private async sharePdfBlob(blob: Blob, filename: string): Promise<void> {
    const isNative =
      Capacitor.isNativePlatform?.() ?? (Capacitor.getPlatform?.() !== 'web');

    // Web: download
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

    // Native: write to cache + share
    const base64 = await this.blobToBase64(blob);

    const writeRes = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    await Share.share({
      title: 'Venue Data Export',
      text: 'Venue export PDF',
      url: writeRes.uri,
      dialogTitle: 'Share Venue PDF',
    });
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const res = (reader.result as string) || '';
        const base64 = res.split(',')[1] ?? '';
        resolve(base64);
      };
      reader.readAsDataURL(blob);
    });
  }

  // ---------- form visibility / selection ----------

  toggleForm(): void {
    this.formVisible = !this.formVisible;
    if (!this.formVisible) {
      this.resetForm();
    }
  }

  onSelectedVenueChange(id: number | null): void {
    this.selectedVenueId = id;
    // keep subranges collapsed by default
    this.expandedVenueId = null;
  }

  toggleExpanded(v: Venue): void {
    this.expandedVenueId =
      this.expandedVenueId === (v.id as number) ? null : (v.id as number);
  }

  // ---------- subrange form rows ----------

  addSubRangeRow(): void {
    this.subRangeRows.push({
      id: this.generateRowId(),
      name: '',
      distancesText: '',
    });
  }

  removeSubRangeRow(row: SubRangeRow): void {
    this.subRangeRows = this.subRangeRows.filter((r) => r.id !== row.id);
    if (this.subRangeRows.length === 0) {
      this.addSubRangeRow();
    }
  }

  cancelVenueForm(): void {
    this.resetForm();
    this.formVisible = false;
  }

  // Button labelled "Add subrange" – just adds another row
  saveSubrangesOnly(): void {
    this.addSubRangeRow();
  }

  private resetForm(): void {
    this.venueForm = {};
    this.subRangeRows = [];
    this.editingVenue = null;
    this.addSubRangeRow();
  }

  // ---------- save / edit / delete ----------

  saveVenue(): void {
    const normalizedSubRanges: SubRange[] = this.subRangeRows
      .filter((row) => row.name || row.distancesText)
      .map((row) => {
        const distancesM = this.parseDistances(row.distancesText);

        const existing =
          this.editingVenue?.subRanges?.find((sr) => sr.id === row.id) ??
          undefined;

        return {
          ...(existing || {}),
          id: row.id,
          name: row.name || '',
          distancesM,
        } as SubRange;
      });

    const base: Partial<Venue> = this.editingVenue || {};

    const venue: Venue = {
      ...base,
      ...this.venueForm,
      id: base.id ?? this.venueForm.id ?? Date.now(),
      subRanges: normalizedSubRanges,
    } as Venue;

    if (this.editingVenue) {
  this.data.updateVenue(venue);
} else {
  this.data.addVenue(venue);
}

    this.resetForm();
    this.formVisible = false;
    this.loadVenues();
    this.selectedVenueId = venue.id as number;
    this.expandedVenueId = venue.id as number;
  }

  editVenue(v: Venue): void {
    this.formVisible = true;
    this.editingVenue = v;

    this.venueForm = {
      id: v.id,
      name: v.name,
      location: v.location,
      altitudeM: v.altitudeM,
      notes: v.notes,
    };

    this.subRangeRows =
      (v.subRanges || []).map((sr) => ({
        id: sr.id as number,
        name: sr.name,
        distancesText: (sr.distancesM || []).join(', '),
      })) || [];

    if (this.subRangeRows.length === 0) {
      this.addSubRangeRow();
    }
  }
  deleteVenue(v: Venue): void {
    if (!confirm(`Delete venue "${v.name}"?`)) {
      return;
    }

    const idNum = Number((v as any).id);
    if (!Number.isFinite(idNum)) return;

    this.data.deleteVenue(idNum);
    this.loadVenues();

    if (this.venues.length > 0) {
      this.selectedVenueId = this.venues[0].id as number;
    } else {
      this.selectedVenueId = null;
    }

    if (this.expandedVenueId === idNum) {
      this.expandedVenueId = null;
    }
  }


  // ---------- Back to main menu (like History) ----------

  goBack(): void {
    // Reset local state to something clean
    this.formVisible = false;
    this.editingVenue = null;
    this.expandedVenueId = null;

    if (this.venues.length > 0) {
      this.selectedVenueId = this.venues[0].id as number;
    } else {
      this.selectedVenueId = null;
    }

    this.subRangeRows = [];
    this.addSubRangeRow();

    // Tell parent tab container to go back to Menu
    this.backToMenu.emit();
  }
}
