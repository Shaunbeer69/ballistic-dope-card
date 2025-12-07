import {
  Component,
  ElementRef,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
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

@Component({
  selector: 'app-wind-effect-tool',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe],
  templateUrl: './wind-effect-tool.component.html',
})
export class WindEffectToolComponent implements OnInit {
  @ViewChild('circleArea', { static: true })
  circleAreaRef!: ElementRef<HTMLDivElement>;

  // Rifles loaded from main app / DataService
  rifles: any[] = [];
  selectedRifleId: number | null = null;

  get selectedRifle(): any | null {
    if (this.selectedRifleId == null) return null;
    return (
      this.rifles.find(
        (r: any) => r && (r.id === this.selectedRifleId || r.rifleId === this.selectedRifleId)
      ) ?? null
    );
  }

  constructor(private router: Router, private data: DataService) {}

  // --- Rifle / ballistics ---
  rangeMeters = 600;
  muzzleVelocityFps = 2800;
  ballisticCoeff = 0.5;

  // --- Wind speed (canonical stored in mph) ---
  windSpeedMph = 10;
  windUnit: WindUnit = 'mph';
  windSpeedInput = 10;

  // Wind COMING FROM this clock (1–12)
  windFromClock = 9;

  // Arrow angle (0° = 12 o’clock, clockwise) – DRIFT (push) direction
  arrowAngleDeg = 0;

  // Clock markers
  hours: HourMarker[] = [];

  // POI dot coordinates
  poiX = 50;
  poiY = 50;

  private dragging = false;

  ngOnInit(): void {
    this.buildHourMarkers();
    this.updateArrowFromClock();
    this.windSpeedInput = this.fromMph(this.windSpeedMph, this.windUnit);
    this.updatePoiFromDrift();

    // Load rifles from DataService if available
    const anyData: any = this.data as any;
    if (anyData) {
      if (typeof anyData.getRifles === 'function') {
        this.rifles = anyData.getRifles() ?? [];
      } else if (Array.isArray(anyData.rifles)) {
        this.rifles = anyData.rifles;
      }
    }

    // Auto-select first rifle if present
    if (this.rifles.length > 0 && this.selectedRifleId == null) {
      const first = this.rifles[0];
      if (first) {
        this.selectedRifleId = first.id ?? first.rifleId ?? null;
        this.applyRifleBallistics(first);
        this.updatePoiFromDrift();
      }
    }
  }

  // ========================================
  // Rifle selection
  // ========================================

  onRifleChanged(rawId: any): void {
    // ngModel for <select> sometimes passes string; normalise to number|null
    if (rawId === null || rawId === undefined || rawId === '') {
      this.selectedRifleId = null;
      return;
    }

    const numericId = typeof rawId === 'number' ? rawId : Number(rawId);
    if (!Number.isFinite(numericId)) {
      this.selectedRifleId = null;
      return;
    }

    this.selectedRifleId = numericId;
    const r = this.selectedRifle;
    if (!r) return;

    this.applyRifleBallistics(r);
    this.updatePoiFromDrift();
  }

  private applyRifleBallistics(r: any): void {
    if (!r) return;

    // Try a couple of common property names for MV (fps)
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

    // Ballistic coefficient (dimensionless)
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

  // ========================================
  // Unit conversion & inputs
  // ========================================

  onWindSpeedInputChange(raw: any): void {
    const v = Number(raw);
    if (!Number.isFinite(v)) {
      this.windSpeedInput = 0;
      this.windSpeedMph = 0;
      this.updatePoiFromDrift();
      return;
    }
    this.windSpeedInput = v;
    this.windSpeedMph = this.toMph(v, this.windUnit);
    this.updatePoiFromDrift();
  }

  onWindUnitChange(unit: WindUnit): void {
    if (unit === this.windUnit) return;

    const mph = this.windSpeedMph;
    this.windUnit = unit;
    this.windSpeedInput = this.fromMph(mph, unit);
    this.updatePoiFromDrift(); 
  }

  private toMph(v: number, u: WindUnit): number {
    if (!Number.isFinite(v)) return 0;
    switch (u) {
      case 'mph':
        return v;
      case 'kmh':
        return v * 0.621371;
      case 'mps':
        return v * 2.23694;
      default:
        return v;
    }
  }

  private fromMph(v: number, u: WindUnit): number {
    if (!Number.isFinite(v)) return 0;
    switch (u) {
      case 'mph':
        return v;
      case 'kmh':
        return v / 0.621371;
      case 'mps':
        return v / 2.23694;
      default:
        return v;
    }
  }

  // ========================================
  // Build hour markers for the clock
  // ========================================

  private buildHourMarkers(): void {
    const cx = 50;
    const cy = 50;
    const rOuter = 40;

    this.hours = [];
    for (let h = 1; h <= 12; h++) {
      const angleDeg = (h / 12) * 360;
      const rad = ((angleDeg - 90) * Math.PI) / 180;

      const tickRadiusOuter = rOuter;
      const tickRadiusInner = rOuter - 3;

      const x2 = cx + tickRadiusOuter * Math.cos(rad);
      const y2 = cy + tickRadiusOuter * Math.sin(rad);
      const x1 = cx + tickRadiusInner * Math.cos(rad);
      const y1 = cy + tickRadiusInner * Math.sin(rad);

      const labelRadius = rOuter + 4;
      const labelX = cx + labelRadius * Math.cos(rad);
      const labelY = cy + labelRadius * Math.sin(rad);

      this.hours.push({
        hour: h,
        tickX1: x1,
        tickY1: y1,
        tickX2: x2,
        tickY2: y2,
        labelX,
        labelY,
      });
    }
  }

  // ========================================
  // Pointer / drag handling
  // ========================================

  startDrag(ev: PointerEvent): void {
    this.dragging = true;
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    this.updateAngleFromEvent(ev);
  }

  onDrag(ev: PointerEvent): void {
    if (!this.dragging) return;
    this.updateAngleFromEvent(ev);
  }

  endDrag(ev: PointerEvent): void {
    this.dragging = false;
    try {
      (ev.target as HTMLElement).releasePointerCapture(ev.pointerId);
    } catch {
      // ignore
    }
  }

  private updateAngleFromEvent(ev: PointerEvent): void {
    const el = this.circleAreaRef.nativeElement;
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = ev.clientX - centerX;
    const dy = ev.clientY - centerY;

    const angleRad = Math.atan2(dy, dx);
    const angleTopBasedDeg = (angleRad * 180) / Math.PI + 90;

    this.arrowAngleDeg = (angleTopBasedDeg + 360) % 360;

    const directionFromClock = this.clockFromArrow(this.arrowAngleDeg);
    this.windFromClock = directionFromClock;
    this.updatePoiFromDrift();
  }

  private clockFromArrow(arrowDegTop: number): number {
    const fromClockDir = (arrowDegTop + 180) % 360;
    const sector = Math.round(fromClockDir / 30) || 12;
    return sector;
  }

  // ========================================
  // Map clock sector → windFromClock
  // ========================================

  onClockSectorClicked(sector: number): void {
    const hour = sector === 0 ? 12 : sector;

    this.windFromClock = hour;
    this.updateArrowFromClock();
    this.updatePoiFromDrift();
  }

  private updateArrowFromClock(): void {
    const fromClock = this.windFromClock;
    const fromDeg = (fromClock % 12) * 30;
    const towardDeg = (fromDeg + 180) % 360;
    this.arrowAngleDeg = towardDeg;
  }

  // ========================================
  // Drift math
  // ========================================

  private mphToFps(mph: number): number {
    return mph * 1.46667;
  }

  private metersToFeet(m: number): number {
    return m * 3.28084;
  }

  private get timeOfFlightSeconds(): number {
    const distanceFt = this.metersToFeet(this.rangeMeters);
    const v = this.muzzleVelocityFps || 1;
    return distanceFt / v;
  }

 private getCrosswindComponents(): { factorAbs: number; sign: number } {
  const fromClock = this.windFromClock % 12 || 12;
  const fromDeg = (fromClock / 12) * 360;
  const rad = (fromDeg * Math.PI) / 180;

  // Crosswind: max at 3 & 9 o'clock
  const sin = Math.sin(rad);           // -1 .. 1
  const cross = Math.abs(sin);         // 0 .. 1

  // Head/tail: max at 12 & 6 o'clock
  const cos = Math.cos(rad);           // -1 .. 1
  const axial = 0.3 * Math.abs(cos);   // scaled contribution for head/tail

  // Combine: crosswind dominates, head/tail still has a visible effect
  const combined = Math.min(1, Math.sqrt(cross * cross + axial * axial));

  // Sign still tells us which side (3 vs 9 etc.)
  const sign = sin >= 0 ? 1 : -1;

  return { factorAbs: combined, sign };
}


  computeLateralInches(): number {
    if (
      !this.windSpeedMph ||
      this.rangeMeters <= 0 ||
      this.muzzleVelocityFps <= 0
    ) {
      return 0;
    }

    const { factorAbs, sign } = this.getCrosswindComponents();
    if (!factorAbs) return 0;

    const windFps = this.mphToFps(this.windSpeedMph) * factorAbs;
    const tof = this.timeOfFlightSeconds;

    const windEfficiency = 0.12;

    const lateralFeet = windFps * tof * windEfficiency;
    const lateralInches = lateralFeet * 12;

    return lateralInches * sign;
  }

  get driftInches(): number {
    return Math.abs(this.computeLateralInches());
  }

  get driftCm(): number {
    return this.driftInches * 2.54;
  }

  get milDrift(): number {
    const lateralInches = Math.abs(this.computeLateralInches());
    if (!lateralInches) return 0;

    const rangeInches = this.rangeMeters * 39.3701;
    if (!rangeInches) return 0;

    const angleRad = lateralInches / rangeInches;
    let mils = angleRad / 0.001;

    const bc = this.ballisticCoeff || 0.5;
    mils = mils / (bc / 0.5);

    return mils;
  }

  get moaDrift(): number {
    return this.milDrift * 3.438;
  }

  // ========================================
  // Update POI dot on the dial
  // ========================================

  private updatePoiFromDrift(): void {
    const centerX = 50;
    const centerY = 50;

    const mils = this.milDrift;
    if (!mils) {
      this.poiX = centerX;
      this.poiY = centerY;
      return;
    }

    const magMil = Math.min(3, mils);
    const pixelsPerMil = 4;
    const radius = magMil * pixelsPerMil;

    const downwindTopDeg = this.arrowAngleDeg;
    const rad = ((downwindTopDeg - 90) * Math.PI) / 180;

    this.poiX = centerX + radius * Math.cos(rad);
    this.poiY = centerY + radius * Math.sin(rad);
  }

  // ========================================
  // Bottom Back button → go to Menu (root route)
  // ========================================

  goBack(): void {
    this.router.navigate(['/']);
  }
}
