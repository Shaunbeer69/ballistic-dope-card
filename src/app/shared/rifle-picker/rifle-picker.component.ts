import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Rifle } from '../../models';

@Component({
  selector: 'app-rifle-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rifle-picker.component.html'
})
export class RiflePickerComponent {
  @Input() rifles: Rifle[] = [];

  @Input() selectedRifleId: number | null = null;
  @Output() selectedRifleIdChange = new EventEmitter<number | null>();

  riflePickerOpen = false;
  riflePickerSearch = '';
  riflePickerFiltered: Rifle[] = [];

  selectedRiflePickerLabel(): string {
    if (this.selectedRifleId == null) return 'Select rifle…';
    const r = this.rifles.find(x => x.id === this.selectedRifleId);
    return r?.name ?? `Rifle ${this.selectedRifleId}`;
  }

  openRiflePicker(): void {
    this.riflePickerSearch = '';
    this.riflePickerFiltered = [...this.rifles];
    this.riflePickerOpen = true;
  }

  closeRiflePicker(): void {
    this.riflePickerOpen = false;
  }

  clearRifleFromPicker(): void {
    this.selectedRifleIdChange.emit(null);
    this.closeRiflePicker();
  }

  onRiflePickerSearchChange(v: string): void {
    this.riflePickerSearch = (v ?? '').toString();
    const q = this.riflePickerSearch.trim().toLowerCase();

    if (!q) {
      this.riflePickerFiltered = [...this.rifles];
      return;
    }

    this.riflePickerFiltered = this.rifles.filter(r => {
      const hay = `${r?.name ?? ''} ${r?.caliber ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }

  selectRifleFromPicker(r: Rifle): void {
    const id = Number((r as any)?.id ?? (r as any)?.rifleId);
    const next = Number.isFinite(id) ? id : null;
    this.selectedRifleIdChange.emit(next);
    this.closeRiflePicker();
  }
}
