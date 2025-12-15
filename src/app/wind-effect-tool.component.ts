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

    const speedMph = this.windSpeedMph;
    this.windUnit = unit;
    this.windSpeedInput = this.fromMph(
      speedMph,
      this.windUnit
    );
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

  /** head/tail component: +1 at 12 (headwind), -1 at 6 (tailwind) */
  private getHeadTailSigned(): number {
    const rad = (this.arrowAngleDeg * Math.PI) / 180;
    return Math.cos(rad);
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

  /**
   * Head/tail wind vertical effect in MIL.
   * +mil = more drop (headwind) => POI down.
   * -mil = less drop (tailwind) => POI up.
   *
   * Uses the SAME MV/BC/TOF ruleset you already have, with a small coupling term.
   */
  private computeHeadTailMil(): number {
    if (
      !this.windSpeedMph ||
      this.rangeMeters <= 0 ||
      this.muzzleVelocityFps <= 0
    ) {
      return 0;
    }

    const headSigned = this.getHeadTailSigned();
    if (!headSigned) return 0;

    const distFt = this.metersToFeet(this.rangeMeters);
    if (!distFt) return 0;

    const tof = this.timeOfFlightSeconds;
    if (!tof) return 0;

    const bc = this.ballisticCoeff || 0.5;
    const bcFactor = 0.5 / bc;

    // wind component along bore line in fps (signed)
    const headFps = this.mphToFps(this.windSpeedMph) * headSigned;

    // Coupling factor (tuned mild; scales with BC)
    const k = 0.35 * bcFactor;

    // fractional TOF change approx (headwind increases TOF, tailwind decreases)
    const frac = (headFps / Math.max(300, this.muzzleVelocityFps)) * k;

    // delta TOF (seconds)
    const dT = tof * frac;

    // gravity drop difference approximation: drop = 0.5*g*t^2 => dDrop ≈ g*t*dT
    const g = 32.174; // ft/s^2
    const dDropFt = g * tof * dT;

    // Convert to mil: angle(rad) ≈ drop/dist => mil ≈ (drop/dist)*1000
    return (dDropFt / distFt) * 1000;
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
  private updatePoiFromDrift(): void {
    const centerX = 50;
    const centerY = 50;

    const mils = this.milDrift;
    const headTailMil = this.computeHeadTailMil();

    if (!mils && !headTailMil) {
      this.poiX = centerX;
      this.poiY = centerY;
      return;
    }

    // Visual exaggeration only
    const visualScale = 2;
    const pixelsPerMil = 6;
    const maxRadius = 36;

    // --- KEEP YOUR EXISTING CIRCLE/DOWNWIND BEHAVIOUR FOR CROSSWIND ---
    const rawRadius = Math.abs(mils) * visualScale * pixelsPerMil;
    const radius = Math.min(rawRadius, maxRadius);

    // Convert wind-from → downwind direction
    const downwindTopDeg = (this.arrowAngleDeg + 180) % 360;

    // SVG: 0° is right, so rotate by -90
    const rad = ((downwindTopDeg - 90) * Math.PI) / 180;

    let x = centerX + radius * Math.cos(rad);
    let y = centerY + radius * Math.sin(rad);

    // --- ADD HEAD/TAIL VERTICAL OFFSET (does NOT change left/right logic) ---
    const dy = headTailMil * visualScale * pixelsPerMil; // +down on screen
    y += dy;

    // Clamp final point to keep it inside the dial
    const dxFromCenter = x - centerX;
    const dyFromCenter = y - centerY;
    const mag = Math.hypot(dxFromCenter, dyFromCenter);

    if (mag > maxRadius && mag > 0) {
      const s = maxRadius / mag;
      x = centerX + dxFromCenter * s;
      y = centerY + dyFromCenter * s;
    }

    this.poiX = x;
    this.poiY = y;
  }

  // --------------------------------
  // Back button (if used in template)
  // --------------------------------
}
