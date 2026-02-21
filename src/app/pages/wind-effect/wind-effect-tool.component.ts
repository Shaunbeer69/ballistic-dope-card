import { Component, ElementRef, inject, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { DataService } from '../../data.service';
import { KestrelDataSnapshot, KestrelService } from '../../shared/services/kestrel-bluetooth.service';

type WindUnit = 'mph' | 'kmh' | 'mps';
type DragModel = 'G1' | 'G7';

interface DragSegment {
  vLoFps: number;
  vHiFps: number;
  A: number;
  M: number;
}

interface DragTableJson {
  model: DragModel;
  segments: DragSegment[];
}

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

  // Possible bullet weight fields (grains)
  bulletWeightGrains?: number;
  bulletWeight?: number; // sometimes already in grains
  projectileWeight?: number; // sometimes already in grains
  weightGr?: number;
}

@Component({
  selector: 'app-wind-effect-tool',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
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

  // Bullet weight (grains) — pulled from selected rifle when available
  bulletWeightGrains = 150;
  // Drag tables (loaded from /assets/drag/*.json)
  private dragG1: DragSegment[] = [];
  private dragG7: DragSegment[] = [];

  // PUBLIC so HTML can show status
  dragTablesReady = false;
  dragTablesError: string | null = null;

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
  kestrelStatusText = '';
  kestrelStatusIsError = false;
  kestrelStatusHideTimer: any = null;

  shootingSolutionEnv: KestrelDataSnapshot | null = null;
  shootingSolutionAt: number | null = null;
  shootingSolutionOpen = false;
  shootingSolutionResult: null | {
    at: number;
    rangeM: number;
    sigma: number;
    tofS: number;
    dropCm: number;
    dropAtZeroCm: number;

    elevationMil: number;
    elevationMoa: number;

    turretUnit: 'MIL' | 'MOA';
    clickValue: number;
    clicks: number;
  } = null;

    private data: DataService = inject(DataService);
    private router: Router= inject(Router);
    public kestrel: KestrelService= inject(KestrelService);
    private http: HttpClient= inject(HttpClient);

  constructor(

  ) {}

  // --------------------------------
  // Lifecycle
  // --------------------------------
  ngOnInit(): void {
    this.buildHourMarkers();
    this.loadRifles();
    this.loadDragTables();
    this.initKestrelSubscription();

    // Preferences default wind unit (mph/kmh/mps)
    const prefUnit = (this.data as any).getDefaultWindSpeedUnit?.();
    if (prefUnit === 'kmh' || prefUnit === 'mph' || prefUnit === 'mps') {
      this.windUnit = prefUnit;
    }

    this.updateWindSpeedInputFromMph();
    this.updatePoiFromDrift();
  }

  toggleShootingSolution(): void {
    this.shootingSolutionOpen = !this.shootingSolutionOpen;

    // When opening the accordion, compute immediately so UI can show a result
    if (this.shootingSolutionOpen) {
      this.computeShootingSolution();
    }
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

    // Bullet weight (grains)
    const wCandidates: any[] = [
      (r as any).bulletWeightGrains,
      (r as any).bulletWeight,
      (r as any).projectileWeight,
      (r as any).weightGr,
    ];
    const w = wCandidates.find((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    if (w !== undefined) {
      this.bulletWeightGrains = w as number;
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
      this.computeShootingSolution();

      return;
    }

    const v = Number(raw);
    this.rangeMeters = Number.isFinite(v) && v > 0 ? v : null;
    this.updatePoiFromDrift();
    this.computeShootingSolution();
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
  /** Weight factor: heavier bullets retain velocity better (bounded). */
  private get weightFactor(): number {
    const w = Number(this.bulletWeightGrains ?? 0);
    if (!Number.isFinite(w) || w <= 0) return 1;
    // reference 150gr, clamp to keep outputs sane
    return Math.max(0.7, Math.min(1.4, Math.sqrt(w / 150)));
  }

  /** Effective BC: BC scaled by weight factor (bounded). */
  private get effectiveBc(): number {
    const bc = Number(this.ballisticCoeff ?? 0.5);
    if (!Number.isFinite(bc) || bc <= 0) return 0.5;
    return bc * this.weightFactor;
  }

  private get timeOfFlightSeconds(): number {
    if ((this.rangeMeters ?? 0) <= 0 || this.muzzleVelocityFps <= 0) {
      return 0;
    }
    const distanceFt = this.metersToFeet(this.rangeMeters ?? 0);

    const v = this.muzzleVelocityFps;

    const rangeKm = (this.rangeMeters ?? 0) / 1000;

    const bcEff = this.effectiveBc || 0.5;
    const bcFactor = 0.5 / bcEff;

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

    // how effectively wind pushes bullet (heavier bullets get pushed slightly less)
    const windEfficiencyBase = 0.12;
    const windEfficiency = windEfficiencyBase / this.weightFactor;

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
  get windageInTurretUnits(): number {
    if (!this.shootingSolutionResult) return 0;
    const unit = this.shootingSolutionResult.turretUnit;
    return unit === 'MOA' ? this.moaDrift : this.milDrift;
  }

  get windageClicks(): number {
    if (!this.shootingSolutionResult) return 0;
    const cv = this.shootingSolutionResult.clickValue || 0;
    if (cv <= 0) return 0;
    return this.windageInTurretUnits / cv;
  }

  get windageDialText(): string {
    if (!this.shootingSolutionResult) return '';
    const dir = this.driftArrow === '←' ? 'LEFT' : this.driftArrow === '→' ? 'RIGHT' : '';
    const clicksAbs = Math.abs(this.windageClicks);
    return dir ? `${clicksAbs.toFixed(0)} clicks ${dir}` : `0 clicks`;
  }

  get elevationDialText(): string {
    if (!this.shootingSolutionResult) return '';
    const clicksAbs = Math.abs(this.shootingSolutionResult.clicks || 0);
    return `${clicksAbs.toFixed(0)} clicks UP`;
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
    // Keep shooting solution in sync with any input that changes drift math
    this.computeShootingSolution();
  }
  // --------------------------------
  // Kestrel → Shooting Solution (backbone)
  // --------------------------------
  private initKestrelSubscription(): void {
    this.kestrel.kestrelStatus$.subscribe((status:any) => {
      // Keep showing the current status, but auto-hide RED errors after 3 seconds.
      this.kestrelStatusText = status || '';
      const t = (this.kestrelStatusText || '').toLowerCase();
      const looksLikeError =
        t.includes('no kestrel') ||
        t.includes('not found') ||
        t.includes('failed') ||
        t.includes('error');
      this.kestrelStatusIsError = !!this.kestrel.kestrelError || looksLikeError;

      // Clear any prior hide timer
      if (this.kestrelStatusHideTimer) {
        clearTimeout(this.kestrelStatusHideTimer);
        this.kestrelStatusHideTimer = null;
      }

      // Only auto-hide when it's an error
      if (this.kestrelStatusIsError && this.kestrelStatusText) {
        this.kestrelStatusHideTimer = setTimeout(() => {
          this.kestrelStatusText = '';
          this.kestrelStatusIsError = false;
          this.kestrelStatusHideTimer = null;
        }, 3000);
      }
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
      this.shootingSolutionOpen = true;

      this.applyKestrelSnapshotToWind(snap as any);

      // Now that env + open state are set, compute the dial solution
      this.computeShootingSolution();
    } catch (err) {
      console.error('[WindEffect] Kestrel read failed:', err);
    }
  }
  // Apply the last-read Kestrel snapshot to Wind Effect inputs (backbone for later “Shooting Solution”)
  private applyKestrelSnapshotToWind(snap: any): void {
    this.computeShootingSolution();

    if (!snap) return;

    // Wind unit (best-effort mapping; keep existing if unknown)
    const unit = (snap.windUnit ?? snap.wind_unit ?? '').toString().toLowerCase();
    if (unit.includes('m/s') || unit.includes('mps')) this.windUnit = 'mps';
    else if (unit.includes('km')) this.windUnit = 'kmh';
    else if (unit.includes('mph')) this.windUnit = 'mph';

    // Wind speed (set display + also update internal mph used by drift math)
    const ws = snap.windSpeed ?? snap.wind_speed ?? snap.wind ?? null;
    if (ws !== null && ws !== undefined && !Number.isNaN(Number(ws))) {
      this.windSpeedInput = Number(ws);
      this.windSpeedMph = this.toMph(this.windSpeedInput, this.windUnit);
    }

    // Wind direction (degrees) → drive the dial + clock label directly (no extra props/methods needed)
    const wd = snap.windDirection ?? snap.wind_direction ?? snap.direction ?? null;
    if (wd !== null && wd !== undefined && !Number.isNaN(Number(wd))) {
      const normalized = (Number(wd) + 360) % 360;

      this.arrowAngleDeg = normalized;

      const hourIndex = Math.round(normalized / 30) % 12;
      const hour = hourIndex === 0 ? 12 : hourIndex;
      this.windFromClock = `${hour} o'clock`;
    }

    // Recompute outputs below the dial
    this.updatePoiFromDrift();
    this.computeShootingSolution();
  }
  private loadDragTables(): void {
    this.dragTablesReady = false;
    this.dragTablesError = null;

    forkJoin({
      g1: this.http.get<DragTableJson>('assets/drag/g1.json'),
      g7: this.http.get<DragTableJson>('assets/drag/g7.json'),
    }).subscribe({
      next: ({ g1, g7 }) => {
        this.dragG1 = Array.isArray(g1?.segments) ? g1.segments : [];
        this.dragG7 = Array.isArray(g7?.segments) ? g7.segments : [];

        this.dragTablesReady = this.dragG1.length > 0 && this.dragG7.length > 0;

        if (!this.dragTablesReady) {
          this.dragTablesError =
            'Drag tables loaded but segments[] is empty/invalid (check JSON shape).';
          this.shootingSolutionResult = null;
          return;
        }

        // Recompute once tables are ready
        this.updatePoiFromDrift();
        this.computeShootingSolution();
      },
      error: (err) => {
        console.error('[Ballistics] Drag tables load failed:', err);
        this.dragTablesReady = false;
        this.dragTablesError =
          'Ballistic solver disabled: cannot load assets/drag/g1.json and g7.json. Ensure they exist under src/assets/drag and are included in the build.';
        this.shootingSolutionResult = null;
      },
    });
  }

  private pickDragModel(r: any): DragModel {
    // Best-effort: if rifle has G7 BC use G7, else G1
    const bcG7 = Number(r?.bulletBcG7 ?? r?.bcG7 ?? r?.g7Bc);
    if (Number.isFinite(bcG7) && bcG7 > 0) return 'G7';
    return 'G1';
  }

  private getBcForModel(r: any, model: DragModel): number {
    const bcG1 = Number(r?.ballisticCoeff ?? r?.bulletBcG1 ?? r?.bc ?? r?.g1Bc);
    const bcG7 = Number(r?.bulletBcG7 ?? r?.bcG7 ?? r?.g7Bc);

    if (model === 'G7') {
      if (Number.isFinite(bcG7) && bcG7 > 0) return bcG7;
      // fallback
      if (Number.isFinite(bcG1) && bcG1 > 0) return bcG1;
      return Number(this.ballisticCoeff ?? 0);
    }

    // G1
    if (Number.isFinite(bcG1) && bcG1 > 0) return bcG1;
    if (Number.isFinite(bcG7) && bcG7 > 0) return bcG7;
    return Number(this.ballisticCoeff ?? 0);
  }

  private dragDvDtFpsPerS(vFps: number, bc: number, sigma: number, model: DragModel): number {
    // JBM A/M segments are used as dv/dt = -(A * v^M / BC) * sigma
    // v in fps, dv/dt in fps/s
    if (!this.dragTablesReady || vFps <= 0 || bc <= 0) return 0;

    const segs = model === 'G7' ? this.dragG7 : this.dragG1;
    let seg = segs[segs.length - 1];

    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (vFps >= s.vLoFps && vFps < s.vHiFps) {
        seg = s;
        break;
      }
    }

    const A = seg.A;
    const M = seg.M;

    const sigmaClamped = Math.max(0.2, Math.min(3.0, sigma));
    return -(A * sigmaClamped * Math.pow(vFps, M)) / bc; // fps per second
  }

  private integratePointMassToRange(
    rangeM: number,
    mvFps: number,
    bc: number,
    sigma: number,
    boreUpRad: number,
    model: DragModel,
  ): { tofS: number; dropM: number } {
    // Integrate 2D trajectory (x forward, y up), return y at range and time-of-flight.
    const g = 9.80665; // m/s^2

    const rangeFt = rangeM * 3.28084;

    // Initial velocity components (fps)
    const vx0 = mvFps * Math.cos(boreUpRad);
    const vy0 = mvFps * Math.sin(boreUpRad);

    let xFt = 0;
    let yFt = 0;

    let vx = vx0;
    let vy = vy0;

    let t = 0;

    // Step size in feet (distance-based stepping; stable + fast)
    const dxFt = 1.0; // ~0.305m per step

    // convert gravity to ft/s^2
    const gFt = g * 3.28084;

    // guard rails
    const maxSteps = Math.ceil(rangeFt / dxFt) + 5000;

    for (let step = 0; step < maxSteps; step++) {
      if (xFt >= rangeFt) break;

      const v = Math.sqrt(vx * vx + vy * vy);
      if (!Number.isFinite(v) || v <= 1) break;

      const dvDt = this.dragDvDtFpsPerS(v, bc, sigma, model); // fps/s (negative)
      const axDrag = dvDt * (vx / v); // drag accel along velocity vector
      const ayDrag = dvDt * (vy / v);
      // dt based on forward travel
      const dt = dxFt / Math.max(1e-6, vx);

      // update velocities
      const vxNext = vx + axDrag * dt;
      const vyNext = vy + (ayDrag - gFt) * dt;

      // update positions
      const xNext = xFt + vx * dt;
      const yNext = yFt + vy * dt;

      vx = vxNext;
      vy = vyNext;
      xFt = xNext;
      yFt = yNext;
      t += dt;
    }

    // drop is negative y (if y ends below muzzle line); convert ft->m
    const yM = yFt / 3.28084;
    const dropM = -yM;

    return { tofS: t, dropM };
  }

  private solveBoreUpForZero(
    zeroM: number,
    mvFps: number,
    bc: number,
    sigma: number,
    model: DragModel,
  ): number {
    // Find bore angle so that y(zero) ~= 0 (zeroed at zeroM)
    // Small-angle bracket + binary search
    const lo = -0.01; // ~ -0.57 deg
    const hi = 0.06; // ~ 3.4 deg

    let a = lo;
    let b = hi;

    const fa = this.integratePointMassToRange(zeroM, mvFps, bc, sigma, a, model).dropM;
    const fb = this.integratePointMassToRange(zeroM, mvFps, bc, sigma, b, model).dropM;

    // If bracket fails, return small-angle fallback
    if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) {
      return 0;
    }

    let left = a;
    let right = b;

    for (let i = 0; i < 24; i++) {
      const mid = (left + right) / 2;
      const fm = this.integratePointMassToRange(zeroM, mvFps, bc, sigma, mid, model).dropM;
      if (!Number.isFinite(fm)) break;

      // We want dropM ~= 0 at zero distance
      if (fm === 0) return mid;

      // keep the sign change bracket
      const fl = this.integratePointMassToRange(zeroM, mvFps, bc, sigma, left, model).dropM;
      if (fl * fm <= 0) {
        right = mid;
      } else {
        left = mid;
      }
    }

    return (left + right) / 2;
  }

  // --------------------------------
  private computeShootingSolution(): void {
    const rangeM = Number(this.rangeMeters ?? 0);
    if (!Number.isFinite(rangeM) || rangeM <= 0) {
      this.shootingSolutionResult = null;
      return;
    }

    // Find selected rifle
    const r =
      this.rifles.find((x) => (x.id ?? (x as any).rifleId) === this.selectedRifleId) ?? null;

    // Use rifle MV/BC if present; fallback to inputs
    const mv = Number(
      (r as any)?.muzzleVelocityFps ?? (r as any)?.mvFps ?? this.muzzleVelocityFps ?? 0,
    );

    const bc = Number(
      (r as any)?.ballisticCoeff ?? (r as any)?.bc ?? (r as any)?.g1Bc ?? this.ballisticCoeff ?? 0,
    );

    if (!Number.isFinite(mv) || mv <= 0 || !Number.isFinite(bc) || bc <= 0) {
      this.shootingSolutionResult = null;
      return;
    }

    // Zero range from rifle (fallback 100m)
    const zeroM = Number(
      (r as any)?.zeroRangeMeters ?? (r as any)?.zeroRangeM ?? (r as any)?.zeroDistanceM ?? 100,
    );

    // Environmentals: use ShootingSolution env override, else Kestrel snapshot
    const env = this.shootingSolutionEnv ?? this.kestrelData;

    // Density ratio sigma
    const sigma = this.computeDensityRatioSigma(env);

    // Drag model + BC selection (G1/G7)
    const dragModel = this.pickDragModel(r);
    const bcModel = this.getBcForModel(r, dragModel);

    if (!this.dragTablesReady) {
      // Without tables, we can't produce a trustworthy elevation dial.
      this.shootingSolutionResult = null;
      return;
    }

    if (!Number.isFinite(bcModel) || bcModel <= 0) {
      this.shootingSolutionResult = null;
      return;
    }

    // Solve bore-up angle so zero distance intersects LOS at zeroM
    const boreUp = this.solveBoreUpForZero(zeroM, mv, bcModel, sigma, dragModel);

    // Integrate to target range using that bore angle
    const sol = this.integratePointMassToRange(rangeM, mv, bcModel, sigma, boreUp, dragModel);

    // Elevation to dial is the LOS angle needed to cancel drop relative to bore:
    // small-angle: theta ≈ drop / range
    const theta = rangeM > 0 ? sol.dropM / rangeM : 0;

    const elevationMil = theta / 0.001;
    const elevationMoa = elevationMil * 3.43774677;

    // Turret / clicks
    const turretUnit = this.getPreferredTurretUnit(r);
    const clickValue = this.getPreferredClickValue(turretUnit, r);
    const elevInUnit = turretUnit === 'MOA' ? elevationMoa : elevationMil;
    const clicksVal = clickValue > 0 ? elevInUnit / clickValue : 0;

    this.shootingSolutionResult = {
      at: Date.now(),
      rangeM: rangeM,
      sigma: sigma,
      tofS: sol.tofS,
      dropCm: sol.dropM * 100,
      dropAtZeroCm: 0, // by definition of "zero"
      elevationMil: elevationMil,
      elevationMoa: elevationMoa,
      turretUnit: turretUnit,
      clickValue: clickValue,
      clicks: clicksVal,
    };
  } // ✅ FIX: closes computeShootingSolution()

  private computeDensityRatioSigma(env: any): number {
    if (!env) return 1.0;

    const tempC = Number(env.temperatureC);
    const pressureInHg = Number(env.pressureInHg);
    const rh = Number(env.humidityPercent);

    if (!Number.isFinite(tempC) || !Number.isFinite(pressureInHg) || !Number.isFinite(rh)) {
      return 1.0;
    }

    const T = tempC + 273.15;
    const p = pressureInHg * 3386.389;

    const es = 611.21 * Math.exp((18.678 - tempC / 234.5) * (tempC / (257.14 + tempC)));
    const e = Math.max(0, Math.min(1, rh / 100)) * es;

    const Rd = 287.058;
    const Rv = 461.495;

    const rho = (p - e) / (Rd * T) + e / (Rv * T);

    const rho0 = 1.225;
    const sigma = rho / rho0;

    return Math.max(0.4, Math.min(1.6, sigma));
  }

  private getPreferredTurretUnit(r: any): 'MIL' | 'MOA' {
    try {
      const p: any = this.data.getPreferences?.() ?? {};
      const pref = String(p?.scopeAdjustment ?? '').toUpperCase();
      if (pref === 'MOA') return 'MOA';
      if (pref === 'MIL') return 'MIL';
    } catch {}

    const ru = String(r?.scopeUnit ?? '').toUpperCase();
    if (ru === 'MOA') return 'MOA';
    if (ru === 'MIL') return 'MIL';

    return 'MIL';
  }

  private getPreferredClickValue(unit: 'MIL' | 'MOA', r: any): number {
    try {
      const p: any = this.data.getPreferences?.() ?? {};
      if (unit === 'MIL' && Number.isFinite(Number(p?.clickMil))) return Number(p.clickMil);
      if (unit === 'MOA' && Number.isFinite(Number(p?.clickMoa))) return Number(p.clickMoa);
    } catch {}

    if (unit === 'MIL' && Number.isFinite(Number(r?.clickMil))) return Number(r.clickMil);
    if (unit === 'MOA' && Number.isFinite(Number(r?.clickMoa))) return Number(r.clickMoa);

    return unit === 'MOA' ? 0.25 : 0.1;
  }
}
