import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService } from './data.service';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { KestrelService, KestrelDataSnapshot } from './shared/services/kestrel-bluetooth.service';

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
  rangeMeters: number | null = 350;

  muzzleVelocityFps = 2700;
  ballisticCoeff = 0.35;

  // Wind
  // Wind
  windUnit: WindUnit = 'mph';
  windSpeedInput: number | null = 6; // what user sees/edits (allow empty)
  windSpeedMph = 6; // internal mph used by math

  windFromClock = "3 o'clock";

  // SVG / dial
  @ViewChild('circleArea', { static: true })
  circleAreaRef!: ElementRef<HTMLDivElement>;

  hours: HourMarker[] = [];
  arrowAngleDeg = 90; // 3 o’clock from top

  // POI red dot (in SVG viewBox coords)
  poiX = 50;
  poiY = 50;

  private dragging = false;

  // --------------------------------
  // Kestrel → Shooting Solution (backbone)
  // --------------------------------
  kestrelData: KestrelDataSnapshot | null = null;
  shootingSolutionEnv: KestrelDataSnapshot | null = null;
  shootingSolutionAt: number | null = null;

  constructor(
    private data: DataService,
    private router: Router,
    public kestrel: KestrelService,
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
    const r = this.rifles.find((rifle) => (rifle.id ?? rifle.rifleId) === id);
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
    const mv = mvCandidates.find((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (mv !== undefined) {
      this.muzzleVelocityFps = mv as number;
    }

    // BC
    const bcCandidates: any[] = [r.ballisticCoeff, r.bulletBc, r.bulletBcG7, r.bulletBcG1, r.bc];
    const bc = bcCandidates.find((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (bc !== undefined) {
      this.ballisticCoeff = bc as number;
    }
  }
  // --------------------------------
  // Rifle picker (canonical modal)
  // --------------------------------
  riflePickerOpen = false;
  riflePickerSearch = '';

  openRiflePicker(): void {
    this.riflePickerOpen = true;
    this.riflePickerSearch = '';
  }

  closeRiflePicker(): void {
    this.riflePickerOpen = false;
  }

  clearRifleFromPicker(): void {
    this.onRifleChanged(null);
    this.closeRiflePicker();
  }

  onRiflePickerSearchChange(v: string): void {
    this.riflePickerSearch = (v ?? '').toString();
  }

  get riflePickerFiltered(): RifleLike[] {
    const list = Array.isArray(this.rifles) ? this.rifles : [];
    const q = (this.riflePickerSearch ?? '').trim().toLowerCase();
    if (!q) return list;

    return list.filter((r) => {
      const name = (r?.name ?? r?.label ?? '').toString().toLowerCase();
      return name.includes(q);
    });
  }

  selectedRifleLabel(): string {
    const id = this.selectedRifleId;
    if (id == null) return 'Choose rifle';

    const r = (this.rifles ?? []).find((x) => (x.id ?? x.rifleId) === id);
    return r?.name || r?.label || `Rifle ${id}`;
  }

  selectRifleFromPicker(r: RifleLike): void {
    const id = (r?.id ?? r?.rifleId) as any;
    if (typeof id === 'number') {
      this.onRifleChanged(id);
    }
    this.closeRiflePicker();
  }

  // --------------------------------
  // Wind speed input
  // --------------------------------
  onWindSpeedInputChange(value: any): void {
    // Allow empty (do NOT force 0 into the field)
    if (value === '' || value === null || value === undefined) {
      this.windSpeedInput = null;
      this.windSpeedMph = 0; // no wind when empty
      this.updatePoiFromDrift();
      return;
    }

    const v = Number(value);
    if (!Number.isFinite(v)) {
      this.windSpeedInput = null;
      this.windSpeedMph = 0;
      this.updatePoiFromDrift();
      return;
    }

    this.windSpeedInput = v;

    // ✅ Critical: update internal mph (this is what drift uses)
    this.windSpeedMph = this.toMph(v, this.windUnit);

    this.updatePoiFromDrift();
  }

  onWindUnitChange(unit: WindUnit): void {
    if (unit === this.windUnit) return;

    const wasEmpty = this.windSpeedInput === null;

    // keep internal mph stable, just convert display
    const speedMph = this.windSpeedMph;

    // apply the new unit
    this.windUnit = unit;

    // If the user cleared the field, keep it empty
    if (wasEmpty) {
      this.windSpeedInput = null;
      this.updatePoiFromDrift();
      return;
    }

    // convert display value using the NEW unit
    const display = this.fromMph(speedMph, this.windUnit);
    this.windSpeedInput = Number(display.toFixed(2));

    this.updatePoiFromDrift();
  }

  private updateWindSpeedInputFromMph(): void {
    this.windSpeedInput = this.fromMph(this.windSpeedMph, this.windUnit);
  }

  onRangeMetersChange(raw: any): void {
    if (raw === '' || raw === null || raw === undefined) {
      this.rangeMeters = null;
      this.updatePoiFromDrift();
      return;
    }

    const v = Number(raw);
    this.rangeMeters = Number.isFinite(v) && v > 0 ? v : null;
    this.updatePoiFromDrift();
  }

  // --------------------------------
  // Dial / pointer handling
  // --------------------------------
  startDrag(event: PointerEvent): void {
    this.dragging = true;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.handlePointer(event);
  }

  onDrag(event: PointerEvent): void {
    if (!this.dragging) return;
    this.handlePointer(event);
  }

  endDrag(event: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  }

  private handlePointer(event: PointerEvent): void {
    if (!this.circleAreaRef) return;

    const rect = this.circleAreaRef.nativeElement.getBoundingClientRect();
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

  /** head/tail factor: +1 at 12 o’clock (headwind), -1 at 6 o’clock (tailwind) */
  private getHeadwindComponent(): number {
    const rad = (this.arrowAngleDeg * Math.PI) / 180;
    return Math.cos(rad);
  }

  // --------------------------------
  // Ballistic core: TOF & drift
  // --------------------------------
  /** simple TOF model that grows with distance and depends on BC */
  private get timeOfFlightSeconds(): number {
    if ((this.rangeMeters ?? 0) <= 0 || this.muzzleVelocityFps <= 0) {
      return 0;
    }
    const distanceFt = this.metersToFeet(this.rangeMeters ?? 0);

    const v = this.muzzleVelocityFps;

    const rangeKm = (this.rangeMeters ?? 0) / 1000;

    const bc = this.ballisticCoeff || 0.5;
    const bcFactor = 0.5 / bc;

    // 600 m → small increase, 2000 m → much bigger TOF
    const slowDownFactor = 1 + 0.4 * rangeKm * bcFactor;

    return (distanceFt / v) * slowDownFactor;
  }

  /** physical lateral drift in inches */
  private computeLateralInches(): number {
    if (!this.windSpeedMph || (this.rangeMeters ?? 0) <= 0 || this.muzzleVelocityFps <= 0) {
      return 0;
    }

    const { factorAbs } = this.getCrosswindComponents();
    if (!factorAbs) {
      return 0;
    }

    const windFps = this.mphToFps(this.windSpeedMph) * factorAbs;
    const tof = this.timeOfFlightSeconds;

    // how effectively wind pushes bullet (fudge factor)
    const windEfficiency = 0.12;

    const lateralFeet = windFps * tof * windEfficiency;
    return lateralFeet * 12;
  }
  /** physical vertical drop delta in inches due to head/tail wind (headwind => more drop) */
  private computeVerticalDropInchesDelta(): number {
    if (!this.windSpeedMph || (this.rangeMeters ?? 0) <= 0 || this.muzzleVelocityFps <= 0) {
      return 0;
    }

    const headFactor = this.getHeadwindComponent(); // signed
    if (!headFactor) {
      return 0;
    }

    const alongWindFps = this.mphToFps(this.windSpeedMph) * headFactor;
    const tof = this.timeOfFlightSeconds;

    // How strongly head/tail wind influences TOF (small on purpose; keeps figures sane)
    const k = 0.45;

    const tofWind = Math.max(0.05, tof * (1 + k * (alongWindFps / this.muzzleVelocityFps)));

    // Gravity drop difference (ft), then inches
    const g = 32.174;
    const dropNoWindFt = 0.5 * g * tof * tof;
    const dropWindFt = 0.5 * g * tofWind * tofWind;

    const deltaFt = dropWindFt - dropNoWindFt; // + = more drop
    return deltaFt * 12;
  }
  /** signed vertical delta */
  get verticalDropInches(): number {
    return this.computeVerticalDropInchesDelta();
  }

  get verticalDropInchesAbs(): number {
    return Math.abs(this.verticalDropInches);
  }

  get verticalDropCmAbs(): number {
    return this.verticalDropInchesAbs * 2.54;
  }
  get verticalLabel(): 'Drop' | 'Lift' {
    // verticalDropInches is + when headwind increases drop, - when tailwind reduces drop (lift)
    return this.verticalDropInches < 0 ? 'Lift' : 'Drop';
  }

  get verticalArrow(): '' | '↑' | '↓' {
    if (!this.windSpeedMph) return '';
    if (!this.verticalDropInches) return '';
    return this.verticalDropInches < 0 ? '↑' : '↓';
  }

  /** signed vertical mil delta for red dot (BC-adjusted same as milDrift) */
  get verticalMilDelta(): number {
    const deltaInches = this.verticalDropInches;
    if (!deltaInches) return 0;

    const rangeInches = (this.rangeMeters ?? 0) * 39.3701;

    if (!rangeInches) return 0;

    const angleRad = deltaInches / rangeInches;
    let mils = angleRad / 0.001;

    const bc = this.ballisticCoeff || 0.5;
    mils = mils / (bc / 0.5);

    return mils;
  }

  // Exposed to template
  get driftInches(): number {
    return this.computeLateralInches();
  }

  get driftCm(): number {
    return this.driftInches * 2.54;
  }
  get driftArrow(): '' | '←' | '→' {
    if (!this.windSpeedMph) return '';

    const rad = (this.arrowAngleDeg * Math.PI) / 180;
    const cross = Math.sin(rad);

    // no crosswind at 12/6
    if (Math.abs(cross) < 1e-6) return '';

    // wind FROM right (3 o'clock) pushes LEFT, and vice-versa
    return cross > 0 ? '←' : '→';
  }

  get driftDirection(): '' | 'Left' | 'Right' {
    if (!this.driftInches) return '';
    return this.driftInches < 0 ? 'Left' : 'Right';
  }

  get milDrift(): number {
    const lateralInches = Math.abs(this.driftInches);
    if (!lateralInches) return 0;

    const rangeInches = (this.rangeMeters ?? 0) * 39.3701;
    if (!rangeInches) return 0;

    const angleRad = lateralInches / rangeInches;
    let mils = angleRad / 0.001; // 1 mil ≈ 0.001 rad

    const bc = this.ballisticCoeff || 0.35;
    mils = mils / (bc / 0.35);

    return mils;
  }

  get moaDrift(): number {
    return this.milDrift * 3.43775;
  }

  // Prefer showing inches when scope adjustment is MOA, otherwise prefer cm.
  get isImperialOutput(): boolean {
    try {
      const p: any = this.data.getPreferences?.() ?? {};
      return String(p?.scopeAdjustment ?? '').toUpperCase() === 'MOA';
    } catch {
      return false;
    }
  }

  /** Vertical drift component (absolute) in inches, derived from wind direction on the dial. */
  get verticalDriftInchesAbs(): number {
    const mag = Math.abs(this.driftInches);
    if (!mag) return 0;

    // Wind-from -> downwind direction (where bullet drifts)
    const downwindTopDeg = (this.arrowAngleDeg + 180) % 360;
    const rad = (downwindTopDeg * Math.PI) / 180;

    // Same mapping as the POI dot: y uses -cos()
    const yFactorAbs = Math.abs(-Math.cos(rad));
    return mag * yFactorAbs;
  }

  /** Vertical drift component (absolute) in cm. */
  get verticalDriftCmAbs(): number {
    return this.verticalDriftInchesAbs * 2.54;
  }

  // --------------------------------
  // Red POI dot (visual only)
  // --------------------------------
  updatePoiFromDrift(): void {
    const centerX = 50;
    const centerY = 50;

    // Lateral (crosswind) in mils (already BC-adjusted)
    const lateralMilsAbs = Math.abs(this.milDrift || 0);

    // Vertical drop delta (headwind = more drop, tailwind = less drop)
    const verticalMils = this.verticalMilDelta || 0; // signed

    // Visual exaggeration only (same exaggeration in every direction)
    const visualScale = 2;
    const pixelsPerMil = 4;

    // Clamp so dot stays inside the circle visually
    const maxRadius = 36;

    // --- LATERAL VECTOR (downwind direction) ---
    let dxL = 0;
    let dyL = 0;

    if (lateralMilsAbs > 0) {
      const rawRadiusL = lateralMilsAbs * visualScale * pixelsPerMil;
      const radiusL = Math.min(rawRadiusL, maxRadius);

      // Wind-from -> downwind direction (where bullet drifts)
      const downwindTopDeg = (this.arrowAngleDeg + 180) % 360;

      // SAME mapping as buildHourMarkers(): x uses sin, y uses -cos
      const rad = (downwindTopDeg * Math.PI) / 180;

      dxL = radiusL * Math.sin(rad);
      dyL = -radiusL * Math.cos(rad);
    }

    // --- VERTICAL VECTOR (pure up/down, independent of arrow direction) ---
    // Positive verticalMils = more drop => dot moves DOWN (+Y)
    const rawDyV = verticalMils * visualScale * pixelsPerMil;
    const dyV = Math.max(Math.min(rawDyV, maxRadius), -maxRadius);

    const x = centerX + dxL;
    const y = centerY + dyL + dyV;

    // Keep inside viewbox-safe area (avoid touching frame)
    this.poiX = Math.max(14, Math.min(86, x));
    this.poiY = Math.max(14, Math.min(86, y));
  }
  // --------------------------------
  // Kestrel → Shooting Solution (backbone)
  // --------------------------------
  private initKestrelSubscription(): void {
    this.kestrel.kestrelData$.subscribe((snapshot) => {
      this.kestrelData = snapshot;
    });
  }

  async onKestrelButtonClick(): Promise<void> {
    try {
      await BleClient.initialize();
    } catch {
      // already initialised
    }

    try {
      await this.kestrel.connectKestrelBluetooth();

      const snap = this.kestrel.kestrelData$.getValue();
      this.kestrelData = snap;

      // Store snapshot for future Shooting Solution
      this.shootingSolutionEnv = snap;
      this.shootingSolutionAt = Date.now();
    } catch (err) {
      console.error('[WindEffect] Kestrel read failed:', err);
    }
  }

  // --------------------------------
  // Back button (if used in template)
  // --------------------------------
}
