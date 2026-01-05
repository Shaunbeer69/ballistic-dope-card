// ---------------- Rifles & loads ----------------

export interface RifleLoad {
  id: number;
  powder: string;
  chargeGn: number;
  coal: string;
  primer: string;
  bullet?: string;
  bulletWeightGr?: number;
  bulletBc?: string;
}

export type ScopeUnit = 'MIL' | 'MOA';

export interface Rifle {
  id: number;
  name: string;
  caliber: string;
  barrelLength: number | null;
  barrelUnit: 'cm' | 'inch';
  twistRate: string;
  muzzleVelocityFps: number | null;
  scopeUnit: ScopeUnit;
  scope?: string; // e.g. "GPO 6-36x56"
  notes?: string;
  roundCount?: number;        // total rounds through this rifle
  loads: RifleLoad[];
}

// ---------------- Venues & sub-ranges ----------------

export interface SubRange {
  id: number;
  name: string;
  distancesM: number[];
}

export interface Venue {
  id: number;
  name: string;
  location?: string;
  altitudeM?: number;
  notes?: string;
  subRanges: SubRange[];
}

// ---------------- Environment & DOPE ----------------

export interface Environment {
  // basic conditions
  temperatureC?: number;
  pressureInHg?: number;

  // match what session-tab & history-tab are using
  pressureHpa?: number;         // hPa
  humidityPercent?: number;     // %

  densityAltitudeM?: number;
  windSpeedMps?: number;
  windDirectionClock?: number;  // 0–12 o’clock (clock system)
  windDirectionDeg?: number;    // 0–360 degrees

  // used in history / session templates
  lightConditions?: string;     // e.g. "overcast", "late afternoon"

  notes?: string;
}

export interface DistanceDope {
  id?: number;                  // optional so we can create rows before persisting
  subRangeId?: number;          // used by session-tab when mapping distances

  distanceM: number;

  // click-based DOPE (what you’re editing in history/session)
  elevationClicks?: number;
  windClicks?: number;

  // MIL-based columns used in history-tab (keep them optional)
  elevationMil?: number;
  windageMil?: number;

  // descriptive notes for where the shots landed
  impactsDescription?: string;

  windDirectionClock?: number;
  notes?: string;
}

export interface Session {
  id: number;
  date: string;
  rifleId: number;
  venueId: number;
  title?: string;
  environment: Environment;
  dope: DistanceDope[];
  notes?: string;
  completed?: boolean;
}

// ---------------- Load development ----------------

export type LoadDevType = 'ladder' | 'ocw' | 'groups';

export type GroupSizeUnit = 'MOA' | 'mm';

export interface LoadDevEntry {
  id: number;
  // nested under project; no projectId needed
  loadLabel: string;          // e.g. "42.3 gr N570 140 ELD-M"
  powder?: string;
  chargeGr?: number;
  coal?: string;
  primer?: string;
  bullet?: string;
  bulletWeightGr?: number;
  bulletBc?: string;          // G7/G1 BC for this load
  distanceM?: number;
   shotsFired?: number;
  groupSize?: number;
  groupUnit?: GroupSizeUnit;
  poiNote?: string;           // POI description
  notes?: string;

  createdAt?: string; // ISO datetime when entry was first captured
  updatedAt?: string; // ISO datetime when entry was last edited
}


export interface LoadDevProject {
  id: number;
  rifleId: number;
  name: string;               // "N570 OCW Dec 2025"
  type: LoadDevType;
  dateStarted: string;        // ISO string
  notes?: string;
  entries: LoadDevEntry[];
}
