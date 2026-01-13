import {
  Component,
  ElementRef,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService } from './data.service';

type WindUnit = 'mph' | 'kmh' | 'mps';

interface HourMarker {
  hour: number;
  tickX1: number;
  tickY1: number;
  tickX2: number;
  tickY2: number;
  labelX: number;
  labelY: number;
}

interface RifleLike {
  id?: number;
  rifleId?: number;
  name?: string;
  label?: string;

  // Possible MV fields (we’ll pick the first valid one)
  muzzleVelocityFps?: number;
  muzzleVelocity?: number;
  mvFps?: number;
  mv?: number;
  zeroMuzzleVelocity?: number;

  // Possible BC fields
  ballisticCoeff?: number;
  bulletBc?: number;
  bulletBcG1?: number;
  bulletBcG7?: number;
  bc?: number;
}

@Component({
  selector: 'app-wind-effect-tool',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './wind-effect-tool.component.html',
})
export class WindEffectToolComponent implements OnInit {
  // Rifles + selection
  rifles: RifleLike[] = [];
  selectedRifleId: number | null = null;

  // Core ballistic inputs
  rangeMeters = 600;
  muzzleVelocityFps = 2800;
  ballisticCoeff = 0.5;

  // Wind
  windUnit: WindUnit = 'mph';
  windSpeedInput = 10; // what user sees/edits
  windSpeedMph = 10;   // internal mph

  windFromClock = '3 o\'clock';

  // SVG / dial
  @ViewChild('circleArea', { static: true })
  circleAreaRef!: ElementRef<HTMLDivElement>;

  hours: HourMarker[] = [];
  arrowAngleDeg = 90; // 3 o’clock from top

  // POI red dot (in SVG viewBox coords)
  poiX = 50;
  poiY = 50;

  private dragging = false;

  constructor(
    private data: DataService,
    private router: Router
  ) {}

  // --------------------------------
  // Lifecycle
  // --------------------------------
    ngOnInit(): void {
    this.buildHourMarkers();
    this.loadRifles();

      // Preferences default wind unit (mph/kmh/mps)
    const prefUnit = (this.data as any).getDefaultWindSpeedUnit?.();
    if (prefUnit === 'kmh' || prefUnit === 'mph' || prefUnit === 'mps') {
      this.windUnit = prefUnit;
    }

    this.updateWindSpeedInputFromMph();
    this.updatePoiFromDrift();
  }
// --------------------------------
  // Rifle handling
  // --------------------------------
  private loadRifles(): void {
    const anyData: any = this.data;
    if (anyData && typeof anyData.getRifles === 'function') {
      const list = anyData.getRifles();
      if (Array.isArray(list)) {
        this.rifles = list;
      }
    }
  }

  onRifleChanged(id: number | null): void {
    this.selectedRifleId = id;
    const r = this.rifles.find(
      (rifle) => (rifle.id ?? rifle.rifleId) === id
    );
    if (r) {
      this.applyRifleBallistics(r);
      this.updatePoiFromDrift();
    }
  }

  private applyRifleBallistics(r: RifleLike): void {
    // MV
    const mvCandidates: any[] = [
      r.muzzleVelocityFps,
      r.muzzleVelocity,
      r.mvFps,
      r.mv,
      r.zeroMuzzleVelocity,
    ];
    const mv = mvCandidates.find(
      (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
    );
    if (mv !== undefined) {
      this.muzzleVelocityFps = mv as number;
    }

    // BC
    const bcCandidates: any[] = [
      r.ballisticCoeff,
      r.bulletBc,
      r.bulletBcG7,
      r.bulletBcG1,
      r.bc,
    ];
    const bc = bcCandidates.find(
      (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
    );
    if (bc !== undefined) {
      this.ballisticCoeff = bc as number;
    }
  }

  // --------------------------------
  // Wind speed input
  // --------------------------------
  onWindSpeedInputChange(raw: any): void {
    const v = Number(raw);
    this.windSpeedInput =
      Number.isFinite(v) && v >= 0 ? v : 0;

    this.windSpeedMph = this.toMph(
      this.windSpeedInput,
      this.windUnit
    );

    this.updatePoiFromDrift();
  }

    onWindUnitChange(unit: WindUnit): void {
    if (unit === this.windUnit) return;

    // keep internal mph stable, just convert display
    const speedMph = this.windSpeedMph;

    // ✅ actually apply the new unit
    this.windUnit = unit;

    // ✅ convert display value using the NEW unit
    this.windSpeedInput = this.fromMph(speedMph, this.windUnit);

    // optional: keep display tidy
    this.windSpeedInput = Number(this.windSpeedInput.toFixed(2));

    // ensure dot + numbers refresh immediately
    this.updatePoiFromDrift();
  }


  private updateWindSpeedInputFromMph(): void {
    this.windSpeedInput = this.fromMph(
      this.windSpeedMph,
      this.windUnit
    );
  }

  // Range change (so 600m vs 2000m actually matters)
  onRangeMetersChange(raw: any): void {
    const v = Number(raw);
    this.rangeMeters =
      Number.isFinite(v) && v > 0 ? v : 0;
    this.updatePoiFromDrift();
  }

  // --------------------------------
  // Dial / pointer handling
  // --------------------------------
  startDrag(event: PointerEvent): void {
    this.dragging = true;
    (event.target as HTMLElement).setPointerCapture(
      event.pointerId
    );
    this.handlePointer(event);
  }

  onDrag(event: PointerEvent): void {
    if (!this.dragging) return;
    this.handlePointer(event);
  }

  endDrag(event: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    (event.target as HTMLElement).releasePointerCapture(
      event.pointerId
    );
  }

  private handlePointer(event: PointerEvent): void {
    if (!this.circleAreaRef) return;

    const rect =
      this.circleAreaRef.nativeElement.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = event.clientX - cx;
    const dy = event.clientY - cy;

    // 0° = 12 o’clock, 90° = 3 o’clock, clockwise
    const angleRad = Math.atan2(dx, -dy);
    const angleDeg = (angleRad * 180) / Math.PI;
    const normalized = (angleDeg + 360) % 360;

    this.arrowAngleDeg = normalized;

    // Set clock text
    const hourIndex = Math.round(normalized / 30) % 12;
    const hour = hourIndex === 0 ? 12 : hourIndex;
    this.windFromClock = `${hour} o'clock`;

    this.updatePoiFromDrift();
  }

  private buildHourMarkers(): void {
    const centerX = 50;
    const centerY = 50;
    const outerR = 40;
    const innerR = 37;
    const labelR = 31;

    this.hours = [];
    for (let i = 0; i < 12; i++) {
      const hour = i === 0 ? 12 : i;
      const angleDeg = i * 30;
      const rad = (angleDeg * Math.PI) / 180;

      const sin = Math.sin(rad);
      const cos = Math.cos(rad);

      const tickX1 = centerX + outerR * sin;
      const tickY1 = centerY - outerR * cos;
      const tickX2 = centerX + innerR * sin;
      const tickY2 = centerY - innerR * cos;
      const labelX = centerX + labelR * sin;
      const labelY = centerY - labelR * cos;

      this.hours.push({
        hour,
        tickX1,
        tickY1,
        tickX2,
        tickY2,
        labelX,
        labelY,
      });
    }
  }

  // --------------------------------
  // Conversions & wind components
  // --------------------------------
  private mphToFps(mph: number): number {
    return mph * 1.46666667;
  }

  private toMph(value: number, unit: WindUnit): number {
    switch (unit) {
      case 'kmh':
        return value * 0.621371;
      case 'mps':
        return value * 2.23694;
      default:
        return value;
    }
  }

  private fromMph(mph: number, unit: WindUnit): number {
    switch (unit) {
      case 'kmh':
        return mph / 0.621371;
      case 'mps':
        return mph / 2.23694;
      default:
        return mph;
    }
  }

  private metersToFeet(m: number): number {
    return m * 3.28084;
  }

  /** crosswind factor: 0 at 12/6, 1 at 3/9 */
  private getCrosswindComponents(): { factorAbs: number } {
    const rad = (this.arrowAngleDeg * Math.PI) / 180;
    const cross = Math.sin(rad);
    const factorAbs = Math.abs(cross);
    return { factorAbs };
  }

  // --------------------------------
  // Ballistic core: TOF & drift
  // --------------------------------
  /** simple TOF model that grows with distance and depends on BC */
  private get timeOfFlightSeconds(): number {
    if (this.rangeMeters <= 0 || this.muzzleVelocityFps <= 0) {
      return 0;
    }
    const distanceFt = this.metersToFeet(this.rangeMeters);
    const v = this.muzzleVelocityFps;

    const rangeKm = (this.rangeMeters || 0) / 1000;
    const bc = this.ballisticCoeff || 0.5;
    const bcFactor = 0.5 / bc;

    // 600 m → small increase, 2000 m → much bigger TOF
    const slowDownFactor = 1 + 0.4 * rangeKm * bcFactor;

    return (distanceFt / v) * slowDownFactor;
  }

  /** physical lateral drift in inches */
  private computeLateralInches(): number {
    if (
      !this.windSpeedMph ||
      this.rangeMeters <= 0 ||
      this.muzzleVelocityFps <= 0
    ) {
      return 0;
    }

    const { factorAbs } = this.getCrosswindComponents();
    if (!factorAbs) {
      return 0;
    }

    const windFps =
      this.mphToFps(this.windSpeedMph) * factorAbs;
    const tof = this.timeOfFlightSeconds;

    // how effectively wind pushes bullet (fudge factor)
    const windEfficiency = 0.12;

    const lateralFeet = windFps * tof * windEfficiency;
    return lateralFeet * 12;
  }

  // Exposed to template
  get driftInches(): number {
    return this.computeLateralInches();
  }

  get driftCm(): number {
    return this.driftInches * 2.54;
  }

  get milDrift(): number {
    const lateralInches = Math.abs(this.driftInches);
    if (!lateralInches) return 0;

    const rangeInches = this.rangeMeters * 39.3701;
    if (!rangeInches) return 0;

    const angleRad = lateralInches / rangeInches;
    let mils = angleRad / 0.001; // 1 mil ≈ 0.001 rad

    const bc = this.ballisticCoeff || 0.5;
    mils = mils / (bc / 0.5);

    return mils;
  }

  get moaDrift(): number {
    return this.milDrift * 3.43775;
  }

  // --------------------------------
  // Red POI dot (visual only)
  // --------------------------------
  updatePoiFromDrift(): void {

    const centerX = 50;
    const centerY = 50;

    const mils = this.milDrift;
    if (!mils) {
      this.poiX = centerX;
      this.poiY = centerY;
      return;
    }

    // Visual exaggeration only (same exaggeration in every direction)
    const visualScale = 2;
    const pixelsPerMil = 6;
    const maxRadius = 36;

    const rawRadius = Math.abs(mils) * visualScale * pixelsPerMil;
    const radius = Math.min(rawRadius, maxRadius);

    // Wind-from -> downwind direction (where bullet drifts)
    const downwindTopDeg = (this.arrowAngleDeg + 180) % 360;

    // SAME mapping as buildHourMarkers(): x uses sin, y uses -cos
    const rad = (downwindTopDeg * Math.PI) / 180;

    this.poiX = centerX + radius * Math.sin(rad);
    this.poiY = centerY - radius * Math.cos(rad);
  }

  // --------------------------------
  // Back button (if used in template)
  // --------------------------------
}
