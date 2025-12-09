import { CommonModule } from '@angular/common';
import { Component, OnInit, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../data.service';
import { Venue, SubRange } from '../models';

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
    this.data.deleteVenue(v.id);
    this.loadVenues();

    if (this.venues.length > 0) {
      this.selectedVenueId = this.venues[0].id as number;
    } else {
      this.selectedVenueId = null;
    }

    if (this.expandedVenueId === v.id) {
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
