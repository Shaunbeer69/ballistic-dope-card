import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'app-converter-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './converter.page.html',
})
export class ConverterPage {
  private readonly router = inject(Router);

  converterSection:
    | 'scope'
    | 'distance'
    | 'velocity'
    | 'temperature'
    | 'pressure'
    | 'wind'
    | 'angleSize' = 'scope';

  expandedConverterSection:
    | 'scope'
    | 'distance'
    | 'velocity'
    | 'temperature'
    | 'pressure'
    | 'wind'
    | 'angleSize'
    | null = null;

  converterMode:
    | 'milToMoa'
    | 'moaToMil'
    | 'clicksToMil'
    | 'clicksToMoa'
    | 'mpsToFps'
    | 'fpsToMps'
    | 'msToKmh'
    | 'kmhToMs'
    | 'msToMph'
    | 'mphToMs'
    | 'msToKn'
    | 'knToMs'
    | 'mToYd'
    | 'ydToM'
    | 'cToF'
    | 'fToC'
    | 'hpaToInhg'
    | 'inhgToHpa'
    | 'hpaToMmhg'
    | 'mmhgToHpa'
    | 'kpaToHpa'
    | 'hpaToKpa'
    | 'milToCmAt100m'
    | 'cmToMilAt100m'
    | 'moaToInAt100yd'
    | 'inToMoaAt100yd' = 'milToMoa';

  converterInput: number | null = null;

  converterSections: Array<{
    id: 'scope' | 'distance' | 'velocity' | 'temperature' | 'pressure' | 'wind' | 'angleSize';
    label: string;
    modes: Array<{ id: any; label: string }>;
  }> = [
    {
      id: 'pressure',
      label: 'Pressure',
      modes: [
        { id: 'hpaToInhg', label: 'hPa → inHg' },
        { id: 'inhgToHpa', label: 'inHg → hPa' },
        { id: 'hpaToMmhg', label: 'hPa → mmHg' },
        { id: 'mmhgToHpa', label: 'mmHg → hPa' },
        { id: 'kpaToHpa', label: 'kPa → hPa' },
        { id: 'hpaToKpa', label: 'hPa → kPa' },
      ],
    },
    {
      id: 'wind',
      label: 'Wind Speed',
      modes: [
        { id: 'msToKmh', label: 'm/s → km/h' },
        { id: 'kmhToMs', label: 'km/h → m/s' },
        { id: 'msToMph', label: 'm/s → mph' },
        { id: 'mphToMs', label: 'mph → m/s' },
        { id: 'msToKn', label: 'm/s → kn' },
        { id: 'knToMs', label: 'kn → m/s' },
      ],
    },
    {
      id: 'velocity',
      label: 'Velocity',
      modes: [
        { id: 'mpsToFps', label: 'm/s → fps' },
        { id: 'fpsToMps', label: 'fps → m/s' },
      ],
    },
    {
      id: 'distance',
      label: 'Distance',
      modes: [
        { id: 'mToYd', label: 'm → yd' },
        { id: 'ydToM', label: 'yd → m' },
      ],
    },
    {
      id: 'temperature',
      label: 'Temperature',
      modes: [
        { id: 'cToF', label: '°C → °F' },
        { id: 'fToC', label: '°F → °C' },
      ],
    },
    {
      id: 'scope',
      label: 'Scope / Angle',
      modes: [
        { id: 'milToMoa', label: 'Mil → MOA' },
        { id: 'moaToMil', label: 'MOA → Mil' },
        { id: 'clicksToMil', label: 'Clicks (0.1) → Mil' },
        { id: 'clicksToMoa', label: 'Clicks (¼) → MOA' },
      ],
    },
    {
      id: 'angleSize',
      label: 'Angle ↔ Size',
      modes: [
        { id: 'milToCmAt100m', label: 'Mil → cm @100m' },
        { id: 'cmToMilAt100m', label: 'cm @100m → Mil' },
        { id: 'moaToInAt100yd', label: 'MOA → inch @100yd' },
        { id: 'inToMoaAt100yd', label: 'inch @100yd → MOA' },
      ],
    },
  ];

  get converterSelectedModeLabel(): string {
    for (const s of this.converterSections) {
      const found = s.modes.find((m) => m.id === this.converterMode);
      if (found) return found.label;
    }
    return String(this.converterMode);
  }

  toggleConverterSection(
    id: 'scope' | 'distance' | 'velocity' | 'temperature' | 'pressure' | 'wind' | 'angleSize',
  ): void {
    this.expandedConverterSection = this.expandedConverterSection === id ? null : id;
  }

  selectConverterMode(
    sectionId:
      | 'scope'
      | 'distance'
      | 'velocity'
      | 'temperature'
      | 'pressure'
      | 'wind'
      | 'angleSize',
    modeId: any,
  ): void {
    this.converterSection = sectionId;
    this.converterMode = modeId;
    this.expandedConverterSection = null;
  }

  get converterOutput(): number | null {
    if (this.converterInput == null || Number.isNaN(this.converterInput)) return null;
    const v = this.converterInput;

    if (this.converterMode === 'milToMoa') return Math.round(v * 3.43775 * 100) / 100;
    if (this.converterMode === 'moaToMil') return Math.round((v / 3.43775) * 1000) / 1000;
    if (this.converterMode === 'clicksToMil') return Math.round((v / 10) * 1000) / 1000;
    if (this.converterMode === 'clicksToMoa') return Math.round((v / 4) * 1000) / 1000;

    if (this.converterMode === 'mpsToFps') return Math.round(v * 3.280839895 * 100) / 100;
    if (this.converterMode === 'fpsToMps') return Math.round((v / 3.280839895) * 1000) / 1000;

    if (this.converterMode === 'msToKmh') return Math.round(v * 3.6 * 100) / 100;
    if (this.converterMode === 'kmhToMs') return Math.round((v / 3.6) * 1000) / 1000;
    if (this.converterMode === 'msToMph') return Math.round(v * 2.2369362921 * 100) / 100;
    if (this.converterMode === 'mphToMs') return Math.round((v / 2.2369362921) * 1000) / 1000;
    if (this.converterMode === 'msToKn') return Math.round(v * 1.9438444924 * 100) / 100;
    if (this.converterMode === 'knToMs') return Math.round((v / 1.9438444924) * 1000) / 1000;

    if (this.converterMode === 'mToYd') return Math.round(v * 1.0936132983 * 100) / 100;
    if (this.converterMode === 'ydToM') return Math.round((v / 1.0936132983) * 1000) / 1000;

    if (this.converterMode === 'cToF') return Math.round(((v * 9) / 5 + 32) * 100) / 100;
    if (this.converterMode === 'fToC') return Math.round((((v - 32) * 5) / 9) * 100) / 100;

    if (this.converterMode === 'hpaToInhg') return Math.round(v * 0.0295299830714 * 10000) / 10000;
    if (this.converterMode === 'inhgToHpa') return Math.round((v / 0.0295299830714) * 100) / 100;
    if (this.converterMode === 'hpaToMmhg') return Math.round(v * 0.750061683 * 1000) / 1000;
    if (this.converterMode === 'mmhgToHpa') return Math.round((v / 0.750061683) * 100) / 100;
    if (this.converterMode === 'kpaToHpa') return Math.round(v * 10 * 100) / 100;
    if (this.converterMode === 'hpaToKpa') return Math.round((v / 10) * 1000) / 1000;

    if (this.converterMode === 'milToCmAt100m') return Math.round(v * 10 * 100) / 100;
    if (this.converterMode === 'cmToMilAt100m') return Math.round((v / 10) * 1000) / 1000;

    if (this.converterMode === 'moaToInAt100yd') return Math.round(v * 1.0471975512 * 100) / 100;
    if (this.converterMode === 'inToMoaAt100yd') return Math.round((v / 1.0471975512) * 1000) / 1000;

    return null;
  }

  back(): void {
    this.router.navigateByUrl('/tools');
  }
}
