import { Injectable } from '@angular/core';
import { Rifle, Venue, Session, LoadDevProject, LoadDevEntry } from './models';

interface AppStore {
  nextRifleId: number;
  nextVenueId: number;
  nextSessionId: number;
  nextLoadDevProjectId: number;
  nextLoadDevEntryId: number;
  rifles: Rifle[];
  venues: Venue[];
  sessions: Session[];
  loadDevProjects: LoadDevProject[];
}
type LoadDevOalUnit = 'mm' | 'in';
type WindSpeedUnit = 'mph' | 'kmh' | 'mps';

export interface AppPreferencesV1 {
  loadDev?: {
    oalUnit?: LoadDevOalUnit; // default unit for Load Development COAL/Ogive
  };
  wind?: {
    speedUnit?: WindSpeedUnit; // default unit for Wind Tool wind speed input
  };
  onboarding?: {
    completed?: boolean; // used to prevent first-run forcing Preferences
  };
}

const DEFAULT_PREFS_V1: AppPreferencesV1 = {
  loadDev: { oalUnit: 'mm' },
  wind: { speedUnit: 'mph' },
};

const STORAGE_KEY = 'ballistic-dope-card-v1';

@Injectable({
  providedIn: 'root',
})
export class DataService {
  private store: AppStore;

  constructor() {
    this.store = this.loadStore();
  }

  // ---------- Storage helpers ----------

  private loadStore(): AppStore {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppStore>;

        const store: AppStore = {
          nextRifleId: parsed.nextRifleId ?? 1,
          nextVenueId: parsed.nextVenueId ?? 1,
          nextSessionId: parsed.nextSessionId ?? 1,
          nextLoadDevProjectId: parsed.nextLoadDevProjectId ?? 1,
          nextLoadDevEntryId: parsed.nextLoadDevEntryId ?? 1,
          rifles: parsed.rifles ?? [],
          venues: parsed.venues ?? [],
          sessions: parsed.sessions ?? [],
          loadDevProjects: parsed.loadDevProjects ?? [],
        };

        this.normalizeStore(store);
        return store;
      }
    } catch {
      // ignore parse errors
    }

    const store: AppStore = {
      nextRifleId: 1,
      nextVenueId: 1,
      nextSessionId: 1,
      nextLoadDevProjectId: 1,
      nextLoadDevEntryId: 1,
      rifles: [],
      venues: [],
      sessions: [],
      loadDevProjects: [],
    };

    this.normalizeStore(store);
    return store;
  }

  private normalizeStore(store: AppStore): void {
    // Fix known bad “inch” inputs that were entered as thousandths.
    // Example from your backup: coalUnit="in" but coal=3820, ogive=3456.
    // Those should be 3.820 and 3.456.
    for (const r of store.rifles as any[]) {
      const loads = Array.isArray(r?.loads) ? r.loads : [];
      for (const l of loads) {
        const unit = String(l?.coalUnit ?? '').toLowerCase();

        if (unit === 'in') {
          const c = Number(l?.coal);
          if (!Number.isNaN(c) && c > 50) l.coal = c / 1000;

          const o = Number(l?.coalOgive);
          if (!Number.isNaN(o) && o > 50) l.coalOgive = o / 1000;
        }
      }
    }

    // Remove legacy/ghost load development projects (empty shells left behind by older versions)
    this.pruneEmptyLoadDevProjectsInStore(store);
  }

  private pruneEmptyLoadDevProjectsInStore(store: AppStore): number {
    const isMeaningfulValue = (v: any): boolean => {
      if (v == null) return false;
      if (typeof v === 'string') return v.trim().length > 0;
      if (typeof v === 'number') return Number.isFinite(v);
      if (typeof v === 'boolean') return true;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return false;
    };

    const isEntryMeaningful = (e: any): boolean => {
      if (!e || typeof e !== 'object') return false;
      // ignore id + timestamps when deciding if the entry has real data
      const ignore = new Set(['id', 'createdAt', 'updatedAt']);
      for (const k of Object.keys(e)) {
        if (ignore.has(k)) continue;
        if (isMeaningfulValue((e as any)[k])) return true;
      }
      return false;
    };

    const before = store.loadDevProjects.length;

    store.loadDevProjects = (store.loadDevProjects ?? []).filter((p) => {
      const entries = (p as any)?.entries;
      if (!Array.isArray(entries) || entries.length === 0) return false; // empty project -> prune
      // entries exist, but if ALL are blank shells -> prune
      const anyMeaningful = entries.some((e: any) => isEntryMeaningful(e));
      return anyMeaningful;
    });

    return before - store.loadDevProjects.length;
  }

  private saveStore(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
    } catch (err) {
      // With Option A (Filesystem photos), this should be rare now.
      console.error('saveStore failed:', err);
    }
  }
  // ---------- Maintenance: Single rifle repair ----------
  // Repairs only the chosen rifle record + its nested loads array (no global deletes).
  maintenanceRepairSingleRifle(rifleId: number): { ok: boolean; report: string } {
    const id = Number(rifleId);
    const rifles: any[] = Array.isArray((this.store as any)?.rifles)
      ? (this.store as any).rifles
      : [];
    const r = rifles.find((x: any) => Number(x?.id) === id);

    if (!r) {
      return { ok: false, report: `Repair failed: rifle id ${rifleId} not found.` };
    }

    const res = this.repairSingleRifleInPlace(r);

    // Keep existing baseline behaviors stable:
    // normalize + prune + save (this is already used elsewhere in your service).
    try {
      this.normalizeStore(this.store);
    } catch (e) {
      // normalize should never block repair; we still save what we fixed.
      console.error('normalizeStore failed during maintenanceRepairSingleRifle:', e);
    }

    this.saveStore();

    const lines: string[] = [];
    lines.push('GS Dope Card — Single rifle repair');
    lines.push('--------------------------------');
    lines.push(`Rifle: ${String(r?.name ?? 'Unknown')} (id ${id})`);
    lines.push(`Removed bad load entries: ${res.removedBadLoads}`);
    lines.push(`Fixed inch COAL/Ogive values: ${res.fixedInchFields}`);
    lines.push('Done.');

    return { ok: true, report: lines.join('\n') };
  }

  private repairSingleRifleInPlace(rifle: any): {
    fixedInchFields: number;
    removedBadLoads: number;
  } {
    let fixedInchFields = 0;
    let removedBadLoads = 0;

    if (!rifle || typeof rifle !== 'object') {
      return { fixedInchFields, removedBadLoads };
    }

    // Ensure loads is an array
    if (rifle.loads == null) rifle.loads = [];
    if (!Array.isArray(rifle.loads)) rifle.loads = [];

    const loads: any[] = Array.isArray(rifle.loads) ? rifle.loads : [];

    // Remove non-object load entries
    const filtered: any[] = [];
    for (const l of loads) {
      if (!l || typeof l !== 'object') {
        removedBadLoads++;
        continue;
      }
      filtered.push(l);
    }
    if (filtered.length !== loads.length) rifle.loads = filtered;

    // Fix inch values accidentally saved as thousandths (same idea as your existing inch normalizer)
    for (const l of rifle.loads as any[]) {
      const unit = String(l?.coalUnit ?? '').toLowerCase();
      if (unit === 'in') {
        const c = Number(l?.coal);
        if (!Number.isNaN(c) && c > 50) {
          l.coal = c / 1000;
          fixedInchFields++;
        }

        const o = Number(l?.coalOgive);
        if (!Number.isNaN(o) && o > 50) {
          l.coalOgive = o / 1000;
          fixedInchFields++;
        }
      }
    }

    return { fixedInchFields, removedBadLoads };
  }

  // ---------- Import / Export helpers ----------

  /** Full backup of the entire persisted app store (includes all nested data). */
  exportFullBackup(): any {
    // Deep-clone to avoid accidental mutation and to ensure JSON-safe payload
    const storeCopy: AppStore = JSON.parse(JSON.stringify(this.store));

    return {
      schema: 'ballistic-dope-card-backup-v1',
      exportedAt: new Date().toISOString(),
      store: storeCopy,
    };
  }

  /**
   * Selective share export (for sending to other users).
   * Produces a smaller payload than full backup, and is meant for merge-import.
   */
  exportSelectiveShare(opts: any): any | null {
    const storeCopy: any = JSON.parse(JSON.stringify(this.store));

    const out: any = {
      schema: 'ballistic-dope-card-share-v1',
      exportedAt: new Date().toISOString(),
      data: {
        rifles: [] as any[],
        venues: [] as any[],
        sessions: [] as any[],
        loadDevProjects: [] as any[],
      },
    };

    const riflesOpt = opts?.rifles ?? null;
    const venuesOpt = opts?.venues ?? null;

    const selectedRifleIds: number[] | null =
      riflesOpt && riflesOpt.all
        ? null
        : Array.isArray(riflesOpt?.ids)
          ? riflesOpt.ids.map((x: any) => Number(x))
          : null;

    const selectedVenueIds: number[] | null =
      venuesOpt && venuesOpt.all
        ? null
        : Array.isArray(venuesOpt?.ids)
          ? venuesOpt.ids.map((x: any) => Number(x))
          : null;

    // --- Rifles ---
    if (riflesOpt) {
      const includeRifleData = !!riflesOpt.includeRifleData;
      const includeLoadDev = !!riflesOpt.includeLoadDev;
      const includeSessions = !!riflesOpt.includeSessions;
      const includeShots = !!riflesOpt.includeShots;

      const rifleFilter = (r: any) => !selectedRifleIds || selectedRifleIds.includes(Number(r?.id));

      if (includeRifleData) {
        out.data.rifles = (storeCopy.rifles ?? []).filter(rifleFilter);
      }

      if (includeLoadDev) {
        out.data.loadDevProjects = (storeCopy.loadDevProjects ?? []).filter((p: any) =>
          selectedRifleIds ? selectedRifleIds.includes(Number(p?.rifleId)) : true,
        );
      }

      if (includeSessions || includeShots) {
        const sessions = (storeCopy.sessions ?? []).filter((s: any) =>
          selectedRifleIds ? selectedRifleIds.includes(Number(s?.rifleId)) : true,
        );

        // If shots not included, strip dope array (shot rows)
        if (!includeShots) {
          for (const s of sessions) {
            if (Array.isArray(s?.dope)) s.dope = [];
          }
        }

        out.data.sessions = out.data.sessions.concat(sessions);
      }
    }

    // --- Venues ---
    if (venuesOpt) {
      const includeVenueData = !!venuesOpt.includeVenueData;
      const includeSessions = !!venuesOpt.includeSessions;
      const includeShots = !!venuesOpt.includeShots;

      const venueFilter = (v: any) => !selectedVenueIds || selectedVenueIds.includes(Number(v?.id));

      if (includeVenueData) {
        out.data.venues = (storeCopy.venues ?? []).filter(venueFilter);
      }

      if (includeSessions || includeShots) {
        const sessions = (storeCopy.sessions ?? []).filter((s: any) =>
          selectedVenueIds ? selectedVenueIds.includes(Number(s?.venueId)) : true,
        );

        if (!includeShots) {
          for (const s of sessions) {
            if (Array.isArray(s?.dope)) s.dope = [];
          }
        }

        out.data.sessions = out.data.sessions.concat(sessions);
      }
    }

    // De-dupe sessions by id (rifle+venue selections can overlap)
    // IMPORTANT: Prefer the "richer" version when duplicates exist (keep dope if present).
    if (Array.isArray(out.data.sessions)) {
      const byId = new Map<number, any>();
      const ordered: any[] = [];

      for (const s of out.data.sessions) {
        const id = Number(s?.id);

        // If id is not numeric, just keep as-is (can't dedupe reliably)
        if (!Number.isFinite(id)) {
          ordered.push(s);
          continue;
        }

        const existing = byId.get(id);

        if (!existing) {
          byId.set(id, s);
          ordered.push(s);
          continue;
        }

        const existingDopeLen = Array.isArray(existing?.dope) ? existing.dope.length : 0;
        const incomingDopeLen = Array.isArray(s?.dope) ? s.dope.length : 0;

        // If the existing one has no shots but the incoming one does, replace it in-place.
        if (existingDopeLen === 0 && incomingDopeLen > 0) {
          byId.set(id, s);
          const idx = ordered.findIndex((x) => Number(x?.id) === id);
          if (idx >= 0) ordered[idx] = s;
        }
      }

      out.data.sessions = ordered;
    }

    // Make the share payload compatible with importFromBackupMerge (expects store.* or flat arrays)
    out.store = {
      rifles: out.data.rifles ?? [],
      venues: out.data.venues ?? [],
      sessions: out.data.sessions ?? [],
      loadDevProjects: out.data.loadDevProjects ?? [],
    };

    const hasAny =
      (out.data.rifles?.length ?? 0) +
        (out.data.venues?.length ?? 0) +
        (out.data.sessions?.length ?? 0) +
        (out.data.loadDevProjects?.length ?? 0) >
      0;

    return hasAny ? out : null;
  }
  /**
   * Selective share export but shaped exactly like importFromBackupMerge expects:
   * { schema, exportedAt, store: { rifles, venues, sessions, loadDevProjects } }
   */
  exportSelectiveShareForMerge(opts: any): any | null {
    const base = this.exportSelectiveShare(opts);
    if (!base) return null;

    return {
      schema: base.schema ?? 'ballistic-dope-card-share-v1',
      exportedAt: base.exportedAt ?? new Date().toISOString(),
      store: base.data ?? {
        rifles: [],
        venues: [],
        sessions: [],
        loadDevProjects: [],
      },
    };
  }

  /**
   * Merge-import (append) a backup into existing data.
   * - DOES NOT overwrite existing store
   * - Uses existing add* methods only (so IDs are regenerated safely)
   * - Tries to match rifles/venues/projects by name to avoid obvious duplicates
   */
  importFromBackupMerge(payload: any): { ok: boolean; message: string } {
    try {
      if (!payload || typeof payload !== 'object') {
        return { ok: false, message: 'Invalid backup format (not an object).' };
      }

      // Accept either wrapper { schema, exportedAt, store } or legacy flat object
      const src: any = payload.store && typeof payload.store === 'object' ? payload.store : payload;

      const riflesIn = Array.isArray(src.rifles) ? src.rifles : [];
      const venuesIn = Array.isArray(src.venues) ? src.venues : [];
      const sessionsIn = Array.isArray(src.sessions) ? src.sessions : [];
      const projectsIn = Array.isArray(src.loadDevProjects) ? src.loadDevProjects : [];

      const norm = (s: any) =>
        String(s ?? '')
          .trim()
          .toLowerCase();

      // ----- Build ID maps (old -> new/existing) -----
      const rifleIdMap = new Map<number, number>();
      const venueIdMap = new Map<number, number>();
      let addedRifles = 0;
      let addedVenues = 0;

      // ----- Rifles: match by name, else add -----
      for (const r of riflesIn) {
        const oldId = Number(r?.id);
        const nameKey = norm(r?.name);

        const existing = this.getRifles().find((x) => norm(x.name) === nameKey && nameKey);

        let newId: number;
        if (existing) {
          newId = existing.id;
        } else {
          newId = this.addRifle({
            name: r?.name ?? '',
            caliber: r?.caliber ?? '',
            barrelLength: r?.barrelLength ?? null,
            barrelUnit: r?.barrelUnit ?? 'inch',
            twistRate: r?.twistRate ?? '',
            muzzleVelocityFps: r?.muzzleVelocityFps ?? 0,
            scopeUnit: r?.scopeUnit ?? 'MIL',
            scope: r?.scope ?? '',
            notes: r?.notes ?? '',
            riflePhotoBase64: (r as any)?.riflePhotoBase64 ?? null,
            riflePhotoCapturedAt: (r as any)?.riflePhotoCapturedAt ?? null,
            roundCount: r?.roundCount ?? 0,
            loads: Array.isArray(r?.loads) ? r.loads : [],
          } as any).id;
          addedRifles++;
        }

        if (Number.isFinite(oldId)) rifleIdMap.set(oldId, newId);
      }

      // ----- Venues: match by name, else add -----
      for (const v of venuesIn) {
        const oldId = Number(v?.id);
        const nameKey = norm(v?.name);

        const existing = this.getVenues().find((x) => norm(x.name) === nameKey && nameKey);

        const venuePayload: any = {
          name: v?.name ?? '',
          location: v?.location,
          notes: v?.notes,
        };

        const dist = Array.isArray(v?.distances)
          ? v.distances
          : Array.isArray(v?.distancesM)
            ? v.distancesM
            : null;

        if (dist) venuePayload.distances = dist;

        let newId: number;
        if (existing) {
          newId = existing.id;
        } else {
          newId = this.addVenue(venuePayload).id;
          addedVenues++;
        }

        if (Number.isFinite(oldId)) venueIdMap.set(oldId, newId);
      }

      // ----- Sessions: remap rifleId/venueId, skip if obvious duplicate -----
      let addedSessions = 0;

      for (const s of sessionsIn) {
        const oldRifleId = Number(s?.rifleId);
        const oldVenueId = Number(s?.venueId);

        const newRifleId = rifleIdMap.get(oldRifleId) ?? oldRifleId;
        const newVenueId = venueIdMap.get(oldVenueId) ?? oldVenueId;

        const dateKey = norm(s?.date);
        const titleKey = norm(s?.title);

        const dup = this.getSessions().some(
          (x) =>
            norm(x.date) === dateKey &&
            norm(x.title) === titleKey &&
            Number(x.rifleId) === Number(newRifleId) &&
            Number(x.venueId) === Number(newVenueId),
        );

        if (dup) continue;

        this.addSession({
          date: s?.date ?? new Date().toISOString(),
          rifleId: newRifleId,
          venueId: newVenueId,
          title: s?.title ?? '',
          environment: s?.environment ?? {},
          dope: Array.isArray(s?.dope) ? s.dope : [],
          notes: s?.notes ?? '',
          completed: !!s?.completed,
        });

        addedSessions++;
      }

      // ----- Load dev projects: match by (rifleId + name + dateStarted), else add
      // Entries are added via addLoadDevEntry so IDs regenerate safely
      let addedProjects = 0;
      let addedEntries = 0;

      for (const p of projectsIn) {
        const oldRifleId = Number(p?.rifleId);
        const newRifleId = rifleIdMap.get(oldRifleId) ?? oldRifleId;

        const nameKey = norm(p?.name);
        const dateKey = norm(p?.dateStarted);

        const existingProject = this.getLoadDevProjectsForRifle(newRifleId).find(
          (x) => norm(x.name) === nameKey && norm(x.dateStarted) === dateKey && nameKey && dateKey,
        );

        const targetProject = existingProject
          ? existingProject
          : this.addLoadDevProject({
              rifleId: newRifleId,
              name: p?.name ?? '',
              type: p?.type,
              dateStarted: p?.dateStarted,
              notes: p?.notes,
            });

        if (!existingProject) addedProjects++;

        // Merge entries by chargeGr (skip if same charge already exists)
        const incomingEntries = Array.isArray(p?.entries) ? p.entries : [];
        for (const e of incomingEntries) {
          const charge = Number(e?.chargeGr);
          const already = (targetProject.entries ?? []).some((x) => Number(x.chargeGr) === charge);

          if (already) continue;

          const created = this.addLoadDevEntry(targetProject.id, {
            chargeGr: e?.chargeGr,
            velocity: (e as any)?.velocity,
            velocities: Array.isArray((e as any)?.velocities) ? (e as any).velocities : undefined,

            // ✅ THIS is what Ladder restores from (shot strings)
            velocityInput: (e as any)?.velocityInput ?? undefined,

            // ✅ keep shot count if you stored it
            shotsFired: (e as any)?.shotsFired ?? undefined,

            notes: (e as any)?.notes,
            targetPhotoDataUrl: (e as any)?.targetPhotoDataUrl,
            entryPhotoDataUrl: (e as any)?.entryPhotoDataUrl,

            // keep any extra fields safely
            ...((e as any)?.groupSizeCm !== undefined
              ? { groupSizeCm: (e as any).groupSizeCm }
              : {}),
            ...((e as any)?.createdAt ? { createdAt: (e as any).createdAt } : {}),
            ...((e as any)?.updatedAt ? { updatedAt: (e as any).updatedAt } : {}),
          } as any);

          if (created) addedEntries++;
        }
      }

      return {
        ok: true,
        message:
          `Merge import complete. Added ${addedRifles} rifles, ` +
          `${addedVenues} venues, ${addedSessions} sessions, ` +
          `${addedProjects} load-dev projects, ${addedEntries} load-dev entries.`,
      };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? 'Unknown error.' };
    }
  }

  private nextId(items: any[]): number {
    const maxId = (items || []).reduce((max, item) => {
      const id = typeof item?.id === 'number' ? item.id : Number(item?.id);
      return Number.isFinite(id) ? Math.max(max, id) : max;
    }, 0);
    return maxId + 1;
  }

  // ---------- Rifles ----------

  getRifles(): Rifle[] {
    return this.store.rifles;
  }

  getRifleById(id: number): Rifle | undefined {
    return this.store.rifles.find((r) => r.id === id);
  }

  addRifle(rifle: Omit<Rifle, 'id'>): Rifle {
    const newRifle: Rifle = {
      ...rifle,
      id: this.store.nextRifleId++,
    };
    this.store.rifles.push(newRifle);
    this.saveStore();
    return newRifle;
  }

  updateRifle(rifle: Rifle): void {
    const idx = this.store.rifles.findIndex((r) => r.id === rifle.id);
    if (idx >= 0) {
      this.store.rifles[idx] = rifle;
      this.saveStore();
    }
  }

  deleteRifle(id: number): void {
    const idNum = Number(id);

    // Remove rifle
    this.store.rifles = this.store.rifles.filter((r) => Number(r.id) !== idNum);

    // Remove all rifle-linked data (matches the UI warning)
    this.store.sessions = (this.store.sessions || []).filter((s) => Number(s?.rifleId) !== idNum);
    this.store.loadDevProjects = (this.store.loadDevProjects || []).filter(
      (p) => Number(p?.rifleId) !== idNum,
    );

    this.saveStore();
  }

  // Increment round count, never decreases
  incrementRifleRoundCount(rifleId: number, delta: number): void {
    if (!delta || delta <= 0) return;
    const rifle = this.store.rifles.find((r) => r.id === rifleId);
    if (!rifle) return;
    rifle.roundCount = (rifle.roundCount || 0) + delta;
    this.saveStore();
  }

  // ---------- Venues ----------

  getVenues(): Venue[] {
    return this.store.venues;
  }

  getVenueById(id: number): Venue | undefined {
    return this.store.venues.find((v) => v.id === id);
  }

  addVenue(venue: Omit<Venue, 'id'>): Venue {
    const newVenue: Venue = {
      ...venue,
      id: this.store.nextVenueId++,
    };
    this.store.venues.push(newVenue);
    this.saveStore();
    return newVenue;
  }

  updateVenue(venue: Venue): void {
    const idx = this.store.venues.findIndex((v) => v.id === venue.id);
    if (idx >= 0) {
      this.store.venues[idx] = venue;
      this.saveStore();
    }
  }

  deleteVenue(id: number): void {
    this.store.venues = this.store.venues.filter((v) => v.id !== id);
    this.saveStore();
  }

  // ---------- Sessions ----------

  getSessions(): Session[] {
    return this.store.sessions;
  }

  getSessionById(id: number): Session | undefined {
    return this.store.sessions.find((s) => s.id === id);
  }

  addSession(session: Omit<Session, 'id'>): Session {
    const newSession: Session = {
      ...session,
      id: this.store.nextSessionId++,
    };
    this.store.sessions.push(newSession);
    this.saveStore();
    return newSession;
  }

  updateSession(session: Session): void {
    const idx = this.store.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      this.store.sessions[idx] = session;
      this.saveStore();
    }
  }

  deleteSession(id: number): void {
    this.store.sessions = this.store.sessions.filter((s) => s.id !== id);
    this.saveStore();
  }

  /**
   * Load development is already stored under `loadDevProjects`.
   *
   * This helper used to create an extra "pending" Session in History so
   * it showed up as a yellow row. You asked to stop duplicating load dev
   * into History, so this function now returns a non-persisted Session-like
   * object for backwards compatibility, and DOES NOT write to `store.sessions`.
   *
   * If you don't need the return value anywhere, you can safely ignore it.
   */
  createSessionForLoadDevProject(project: LoadDevProject): Session {
    const title = project.name?.trim() ? `Load dev: ${project.name.trim()}` : 'Load development';

    // IMPORTANT: do NOT add to this.store.sessions
    const session: Session = {
      id: -Date.now(), // negative id indicates "virtual / not stored"
      date: new Date().toISOString(),
      rifleId: project.rifleId,
      venueId: 0, // satisfies `number` type
      title,
      environment: {},
      dope: [],
      notes:
        'Load development – planned here. Results are captured in Load Development (not History).',
      completed: false,
    } as Session;

    return session;
  }

  // ---------- Load Development Projects ----------

  getLoadDevProjectsForRifle(rifleId: number): LoadDevProject[] {
    return this.store.loadDevProjects.filter((p) => p.rifleId === rifleId);
  }

  getLoadDevProjectById(id: number): LoadDevProject | undefined {
    return this.store.loadDevProjects.find((p) => p.id === id);
  }

  addLoadDevProject(
    project: Omit<LoadDevProject, 'id' | 'dateStarted' | 'entries'> & {
      dateStarted?: string;
      entries?: LoadDevEntry[];
    },
  ): LoadDevProject {
    const newProject: LoadDevProject = {
      id: this.store.nextLoadDevProjectId++,
      rifleId: project.rifleId,
      name: project.name,
      type: project.type,
      dateStarted: project.dateStarted ?? new Date().toISOString(),
      notes: project.notes,
      entries: project.entries ?? [],
    };
    this.store.loadDevProjects.push(newProject);
    this.saveStore();
    return newProject;
  }

  /**
   * Upsert behaviour – updates an existing project or inserts it if missing.
    /**
   * This keeps compatibility with places where a new project is created
   * and then passed straight into updateLoadDevProject.
   */
  updateLoadDevProject(project: LoadDevProject): void {
    const idx = this.store.loadDevProjects.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      this.store.loadDevProjects[idx] = project;
    } else {
      this.store.loadDevProjects.push(project);
    }
    this.saveStore();
  }

  deleteLoadDevProject(id: number): void {
    this.store.loadDevProjects = this.store.loadDevProjects.filter((p) => p.id !== id);
    this.saveStore();
  }

  /**
   * Removes legacy/ghost LoadDev projects that are effectively empty.
   * Returns number of projects removed.
   */
  pruneEmptyLoadDevProjects(): number {
    const removed = this.pruneEmptyLoadDevProjectsInStore(this.store);
    if (removed > 0) this.saveStore();
    return removed;
  }

  // ---------- Load Development Entries (inside projects) ----------

  addLoadDevEntry(projectId: number, entry: Omit<LoadDevEntry, 'id'>): LoadDevEntry | null {
    const project = this.getLoadDevProjectById(projectId);
    if (!project) return null;

    const nowIso = new Date().toISOString();

    const newEntry: LoadDevEntry = {
      id: this.store.nextLoadDevEntryId++,
      createdAt: (entry as any)?.createdAt ?? nowIso,
      updatedAt: (entry as any)?.updatedAt ?? nowIso,
      ...entry,
    };

    project.entries = [...(project.entries ?? []), newEntry];
    this.updateLoadDevProject(project);
    return newEntry;
  }

  /**
   * Upsert an entry inside a project.
   * - If the entry exists (matching id), it is updated.
   * - If it does not exist, it is pushed as a new entry.
   * This is critical for the ladder wizard + table to behave correctly.
   */
  updateLoadDevEntry(projectId: number, entry: LoadDevEntry): void {
    const project = this.getLoadDevProjectById(projectId);
    if (!project) return;

    if (!project.entries) {
      project.entries = [];
    }

    const idx = project.entries.findIndex((e) => e.id === entry.id);

    const nowIso = new Date().toISOString();

    if (idx >= 0) {
      const prev = project.entries[idx];

      project.entries[idx] = {
        ...prev,
        ...entry,
        // never lose original createdAt
        createdAt: (prev as any)?.createdAt ?? (entry as any)?.createdAt ?? nowIso,
        // always bump updatedAt on edit
        updatedAt: nowIso,
      };
    } else {
      project.entries.push({
        ...entry,
        createdAt: (entry as any)?.createdAt ?? nowIso,
        updatedAt: (entry as any)?.updatedAt ?? nowIso,
      });
    }

    this.updateLoadDevProject(project);
  }

  deleteLoadDevEntry(projectId: number, entryId: number): void {
    const project = this.getLoadDevProjectById(projectId);
    if (!project) return;

    project.entries = (project.entries ?? []).filter((e) => e.id !== entryId);
    this.updateLoadDevProject(project);
  }
  // -------- Preferences (Units & Display v1) --------
  // -------- Preference defaults used as "goto" (only where Rifle/Project does not override) --------

  getDefaultWindUnit(): 'mph' | 'kmh' | 'mps' {
    const p: any = this.getPreferences() ?? {};
    const raw =
      p?.wind?.speedUnit ??
      p?.wind?.unit ??
      p?.windUnit ??
      p?.units?.windUnit ??
      p?.units?.windSpeedUnit ??
      '';

    const v = String(raw).toLowerCase();
    if (v === 'kmh' || v === 'km/h') return 'kmh';
    if (v === 'mps' || v === 'm/s') return 'mps';
    return 'mph';
  }

  private readonly PREFS_KEY = 'ballistic-dope-card-prefs-v1';
  private readonly LEGACY_PREFS_KEY = 'gs_preferences_v1';

  private sanitizePrefs(p: any): AppPreferencesV1 {
    const out: AppPreferencesV1 = {
      loadDev: { ...(DEFAULT_PREFS_V1.loadDev ?? {}) },
      wind: { ...(DEFAULT_PREFS_V1.wind ?? {}) },
    };

    // LoadDev oalUnit
    const oalUnit = String(p?.loadDev?.oalUnit ?? '').toLowerCase();
    if (oalUnit === 'mm' || oalUnit === 'in') {
      out.loadDev = { ...(out.loadDev ?? {}), oalUnit: oalUnit as any };
    }

    // Wind speedUnit
    const speedUnitRaw = String(
      p?.wind?.speedUnit ??
        p?.windSpeedUnit ?? // legacy flat prefs
        p?.wind?.unit ??
        p?.windUnit ??
        p?.units?.windUnit ??
        p?.units?.windSpeedUnit ??
        '',
    ).toLowerCase();

    // normalize UI/legacy values into internal codes used by the wind tool
    const speedUnit =
      speedUnitRaw === 'km/h'
        ? 'kmh'
        : speedUnitRaw === 'm/s'
          ? 'mps'
          : speedUnitRaw === 'ms'
            ? 'mps'
            : speedUnitRaw === 'kn'
              ? 'mph' // legacy supports knots; wind tool doesn't, so fall back safely
              : speedUnitRaw;

    if (speedUnit === 'mph' || speedUnit === 'kmh' || speedUnit === 'mps') {
      out.wind = { ...(out.wind ?? {}), speedUnit: speedUnit as any };
    }

    return out;
  }
  // ---------- Maintenance / Repair ----------
  /**
   * Quick health check: scan store for common issues that break export/import,
   * missing references, invalid IDs, NaN/Infinity numbers, and legacy garbage fields.
   * Does NOT modify data.
   */
  maintenanceScan(): { ok: boolean; issues: number; report: string } {
    // Read-only scan: no deletes, no counter bumps, no normalize/save.
    // We temporarily run auditAndMaybeRepairStore in "details-only" mode by
    // forcing applyFixes=false AND preventing it from doing any "removed" wording.
    // (The detailed listings are handled inside auditAndMaybeRepairStore below.)

    const res = this.auditAndMaybeRepairStore(false) as any;

    // If your internal report text still says "removed" in SCAN mode,
    // this makes it explicit at the top that scan is read-only.
    const header =
      'MAINTENANCE SCAN (read-only)\n' +
      '• No items were deleted.\n' +
      '• Use “Repair + rebuild store” to remove orphans / fix counters.\n\n';

    return {
      ok: !!res?.ok,
      issues: Number(res?.issues ?? 0),
      report: header + String(res?.report ?? ''),
    };
  }

  /**
   * Repair mode: performs safe repairs + sanitization and saves store.
   * - fixes next*Id counters
   * - removes items with invalid IDs
   * - removes sessions/projects referencing missing rifles/venues
   * - sanitizes NaN/Infinity to null
   * - normalizes store + prunes empty ghost load-dev projects
   */
  maintenanceRepair(): { ok: boolean; issues: number; fixed: number; report: string } {
    const res = this.auditAndMaybeRepairStore(true) as any;
    return {
      ok: res.ok,
      issues: res.issues,
      fixed: res.fixed ?? 0,
      report: res.report,
    };
  }

  private auditAndMaybeRepairStore(applyFixes: boolean): {
    ok: boolean;
    issues: number;
    fixed?: number;
    report: string;
  } {
    const lines: string[] = [];
    let issues = 0;
    let fixed = 0;

    const store: any = applyFixes ? this.store : JSON.parse(JSON.stringify(this.store));

    const isFiniteNum = (n: any) => typeof n === 'number' && Number.isFinite(n);
    const toNum = (v: any) => Number(v);

    const sanitizeValueDeep = (v: any): any => {
      // Convert NaN/Infinity to null
      if (typeof v === 'number') return Number.isFinite(v) ? v : null;

      // Remove unusable types
      if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return null;

      if (Array.isArray(v)) {
        const out = v.map(sanitizeValueDeep).filter((x) => x !== undefined);
        return out;
      }

      if (v && typeof v === 'object') {
        const out: any = {};
        for (const k of Object.keys(v)) {
          const sv = sanitizeValueDeep(v[k]);
          // Drop undefined (JSON would drop it anyway) and drop null functions/etc already mapped to null
          if (sv === undefined) continue;
          out[k] = sv;
        }
        return out;
      }

      return v;
    };

    const sanitizeStoreInPlace = (): void => {
      const clean = sanitizeValueDeep(store);
      if (applyFixes) this.store = clean;
    };

    const rifles: any[] = Array.isArray(store?.rifles) ? store.rifles : [];
    const venues: any[] = Array.isArray(store?.venues) ? store.venues : [];
    const sessions: any[] = Array.isArray(store?.sessions) ? store.sessions : [];
    const projects: any[] = Array.isArray(store?.loadDevProjects) ? store.loadDevProjects : [];

    if (!applyFixes) {
      // ---------- USER-FRIENDLY SCAN REPORT (wording only) ----------
      lines.length = 0;

      lines.push('🔧 Maintenance Scan – Action Required');
      lines.push('');
      lines.push('Nothing was deleted.');
      lines.push('This scan only checks for missing or broken data.');
      lines.push('');

      // We keep counts but present them in plain language
      lines.push(
        `Current data: ${rifles.length} rifles, ${venues.length} venues, ${sessions.length} sessions, ${projects.length} load projects.`,
      );
      lines.push('');
    } else {
      // Repair mode keeps technical header
      lines.push('GS Ballistics — Maintenance Report');
      lines.push(`When: ${new Date().toISOString()}`);
      lines.push('Mode: REPAIR (mutates + saves)');
      lines.push('');
      lines.push(
        `Counts: rifles=${rifles.length}, venues=${venues.length}, sessions=${sessions.length}, loadDevProjects=${projects.length}`,
      );
      lines.push('');
    }

    // --- Validate IDs + rebuild next counters ---
    const maxId = (arr: any[]) =>
      Math.max(0, ...arr.map((x) => toNum(x?.id)).filter((n) => Number.isFinite(n)));

    const maxRifleId = maxId(rifles);
    const maxVenueId = maxId(venues);
    const maxSessionId = maxId(sessions);
    const maxProjectId = maxId(projects);

    const bumpCounterIfNeeded = (key: string, max: number) => {
      const cur = toNum(store?.[key]);
      if (!Number.isFinite(cur) || cur < max + 1) {
        issues++;
        lines.push(
          `• Counter ${key} is invalid/too low (${store?.[key]}). Expected >= ${max + 1}.`,
        );
        if (applyFixes) {
          store[key] = max + 1;
          fixed++;
          lines.push(`  ↳ FIXED: set ${key}=${max + 1}`);
        }
      }
    };

    bumpCounterIfNeeded('nextRifleId', maxRifleId);
    bumpCounterIfNeeded('nextVenueId', maxVenueId);
    bumpCounterIfNeeded('nextSessionId', maxSessionId);
    bumpCounterIfNeeded('nextLoadDevProjectId', maxProjectId);

    const filterValidId = (arr: any[], label: string): any[] => {
      const before = arr.length;

      const removedIds: any[] = [];
      const kept = arr.filter((x) => {
        const id = toNum(x?.id);
        const ok = Number.isFinite(id);
        if (!ok) removedIds.push(x?.id);
        return ok;
      });

      const removed = before - kept.length;
      if (removed > 0) {
        issues++;

        const verb = applyFixes ? 'removed' : 'found';
        lines.push(`• ${label}: ${verb} ${removed} item(s) with invalid id.`);

        // detail (top 10)
        removedIds.slice(0, 10).forEach((badId) => {
          lines.push(`  ↳ invalid id=${String(badId)}`);
        });
        if (removedIds.length > 10) {
          lines.push(`  ↳ ... +${removedIds.length - 10} more`);
        }

        if (applyFixes) fixed += removed;
      }

      return kept;
    };

    const riflesClean = filterValidId(rifles, 'Rifles');
    const venuesClean = filterValidId(venues, 'Venues');
    const sessionsClean = filterValidId(sessions, 'Sessions');
    const projectsClean = filterValidId(projects, 'LoadDevProjects');

    const rifleIdSet = new Set<number>(riflesClean.map((r) => toNum(r.id)));
    const venueIdSet = new Set<number>(venuesClean.map((v) => toNum(v.id)));
    // --- Scan-only grouping buckets (wording only) ---
    const scanOrphanSessionIds: number[] = [];
    const scanOrphanProjectNames: string[] = [];

    // --- Remove/Report sessions that reference missing rifle/venue ---
    const sessionsBefore = sessionsClean.length;

    const orphanSessions = sessionsClean
      .map((s) => {
        const rid = toNum(s?.rifleId);
        const vid = toNum(s?.venueId);

        const missingR = Number.isFinite(rid) ? !rifleIdSet.has(rid) : false;
        const missingV = Number.isFinite(vid) ? !venueIdSet.has(vid) : false;

        return { s, rid, vid, missingR, missingV, isOrphan: missingR || missingV };
      })
      .filter((x) => x.isOrphan);

    const sessionsKept = sessionsClean.filter((s) => {
      const rid = toNum(s?.rifleId);
      const vid = toNum(s?.venueId);
      const okR = Number.isFinite(rid) ? rifleIdSet.has(rid) : true;
      const okV = Number.isFinite(vid) ? venueIdSet.has(vid) : true;
      return okR && okV;
    });

    const sessionsRemoved = sessionsBefore - sessionsKept.length;
    if (sessionsRemoved > 0) {
      issues++;

      if (applyFixes) {
        const verb = 'removed';
        lines.push(
          `• Sessions: ${verb} ${sessionsRemoved} item(s) referencing missing rifle/venue.`,
        );

        // detail (top 10)
        orphanSessions.slice(0, 10).forEach(({ s, rid, vid, missingR, missingV }) => {
          const reasons: string[] = [];
          if (missingR) reasons.push(`missing rifleId=${rid}`);
          if (missingV) reasons.push(`missing venueId=${vid}`);
          lines.push(`  ↳ session id=${s?.id} (${reasons.join(', ')})`);
        });
        if (orphanSessions.length > 10) {
          lines.push(`  ↳ ... +${orphanSessions.length - 10} more`);
        }

        fixed += sessionsRemoved;
      } else {
        // SCAN (read-only): collect for friendly sections, hide technical wording
        orphanSessions.forEach(({ s }) => {
          const sid = toNum(s?.id);
          if (Number.isFinite(sid)) scanOrphanSessionIds.push(sid);
        });
      }
    }

    // --- Remove/Report load dev projects that reference missing rifles ---
    const projectsBefore = projectsClean.length;

    const orphanProjects = projectsClean
      .map((p) => {
        const rid = toNum(p?.rifleId);
        const isOrphan = Number.isFinite(rid) && !rifleIdSet.has(rid);
        return { p, rid, isOrphan };
      })
      .filter((x) => x.isOrphan);

    const projectsKept = projectsClean.filter((p) => {
      const rid = toNum(p?.rifleId);
      if (!Number.isFinite(rid)) return true;
      return rifleIdSet.has(rid);
    });

    const projectsRemoved = projectsBefore - projectsKept.length;
    if (projectsRemoved > 0) {
      issues++;

      if (applyFixes) {
        const verb = 'removed';
        lines.push(
          `• LoadDevProjects: ${verb} ${projectsRemoved} item(s) referencing missing rifle.`,
        );

        // detail (top 10)
        orphanProjects.slice(0, 10).forEach(({ p, rid }) => {
          lines.push(
            `  ↳ project id=${p?.id} name="${String(p?.name ?? '')}" missing rifleId=${rid}`,
          );
        });
        if (orphanProjects.length > 10) {
          lines.push(`  ↳ ... +${orphanProjects.length - 10} more`);
        }

        fixed += projectsRemoved;
      } else {
        // SCAN (read-only): collect for friendly sections, hide technical wording
        orphanProjects.forEach(({ p }) => {
          const nm = String(p?.name ?? '').trim();
          scanOrphanProjectNames.push(nm || `Unnamed load project (id=${String(p?.id ?? '?')})`);
        });
      }
    }
    // ---------- SCAN (read-only): group into user-friendly sections ----------
    if (!applyFixes) {
      const hasLoadDev = scanOrphanProjectNames.length > 0;
      const hasSessions = scanOrphanSessionIds.length > 0;

      if (hasLoadDev || hasSessions) {
        lines.push('❌ Deleted rifle cleanup incomplete');
        lines.push('');
        lines.push('A rifle was removed, but some related data still exists that points to it.');
        lines.push('Expected: zero leftover rifle-linked items after deletion.');
        lines.push('');
        lines.push('👉 Fix: Run “Repair + rebuild store” to permanently remove the leftover data.');
        lines.push('This indicates the delete cleanup did not fully complete.');
        lines.push('');

        if (hasLoadDev) {
          lines.push(
            `🧱 Leftover Load Development data (${scanOrphanProjectNames.length} item(s))`,
          );
          lines.push('');
          lines.push('These load projects still point to a removed rifle:');
          lines.push('');
          scanOrphanProjectNames.forEach((n) => lines.push(`• ${n}`));
          lines.push('');
        }

        if (hasSessions) {
          lines.push(`🎯 Leftover Shooting Sessions (${scanOrphanSessionIds.length} item(s))`);
          lines.push('');
          lines.push('These sessions still point to a removed rifle:');
          lines.push('');
          scanOrphanSessionIds.forEach((id) => lines.push(`• Session #${id}`));
          lines.push('');
        }

        lines.push('✅ What “Repair” will do');
        lines.push('');
        lines.push('• Remove the leftover items listed above');
        lines.push('• Keep all remaining (valid) data intact');
        lines.push('• Restore clean export-safe state');
        lines.push('');
      } else {
        lines.push('✅ Deleted rifle cleanup check passed.');
        lines.push('No leftover rifle-linked data was found.');
        lines.push('Only current rifles and their valid data remain.');
        lines.push('');
      }
    }

    // --- Ensure arrays exist + sanitize numeric garbage ---
    const sanitizeEntries = (p: any) => {
      if (!Array.isArray(p?.entries)) {
        issues++;
        lines.push(`• LoadDevProject id=${p?.id}: entries was not an array.`);
        if (applyFixes) {
          p.entries = [];
          fixed++;
          lines.push(`  ↳ FIXED: set entries=[]`);
        }
      }
    };

    for (const p of projectsKept) sanitizeEntries(p);

    // Apply sanitized arrays back
    store.rifles = riflesClean;
    store.venues = venuesClean;
    store.sessions = sessionsKept;
    store.loadDevProjects = projectsKept;

    // Global deep sanitize (NaN/Infinity/functions/etc)
    sanitizeStoreInPlace();

    if (applyFixes) {
      // Re-run known normalizations/prunes that already exist in your DataService
      try {
        this.normalizeStore(this.store);
        // normalizeStore already calls pruneEmptyLoadDevProjectsInStore(store)
      } catch (e) {
        issues++;
        lines.push(`• normalizeStore threw: ${(e as any)?.message ?? String(e)}`);
      }

      this.saveStore();
      lines.push('');
      lines.push(`✅ Repair completed. Fixed=${fixed}, Issues found=${issues}`);
    } else {
      lines.push('');

      // Guidance is included earlier in scan mode (grouped sections).

      lines.push(`✅ Scan completed. Issues found=${issues}`);
    }

    return {
      ok: true,
      issues,
      ...(applyFixes ? { fixed } : {}),
      report: lines.join('\n'),
    };
  }

  /** Always returns valid prefs with defaults applied. */
  getPreferences(): AppPreferencesV1 {
    try {
      // Primary (new) prefs key
      const raw = localStorage.getItem(this.PREFS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};

      // Legacy prefs key used by the Preferences UI on the menu screen
      const legacyRaw = localStorage.getItem(this.LEGACY_PREFS_KEY);
      const legacy = legacyRaw ? JSON.parse(legacyRaw) : {};

      // Bridge: if legacy has a windSpeedUnit, copy it into the structure expected by components
      const legacyWind = String(legacy?.windSpeedUnit ?? '').toLowerCase();
      const bridgedWind =
        legacyWind === 'kmh' || legacyWind === 'km/h'
          ? 'kmh'
          : legacyWind === 'ms' || legacyWind === 'm/s'
            ? 'mps'
            : legacyWind === 'mph'
              ? 'mph'
              : '';
      // Bridge: legacy LoadDev OAL unit (Preferences UI historically stored this separately)
      const legacyOalRaw = String(
        legacy?.loadDevOalUnit ??
          legacy?.loadDev?.oalUnit ??
          legacy?.oalUnit ??
          legacy?.units?.oalUnit ??
          legacy?.units?.loadDevOalUnit ??
          '',
      ).toLowerCase();

      const bridgedOal =
        legacyOalRaw === 'in' || legacyOalRaw === 'inch' || legacyOalRaw === 'inches'
          ? 'in'
          : legacyOalRaw === 'mm' || legacyOalRaw === 'millimeter' || legacyOalRaw === 'millimetre'
            ? 'mm'
            : '';

      const parsedOal = String(parsed?.loadDev?.oalUnit ?? '').toLowerCase();
      const hasParsedOal = parsedOal === 'mm' || parsedOal === 'in';

      const bridged = {
        ...(parsed ?? {}),
        wind: {
          ...((parsed ?? {})?.wind ?? {}),
          ...(bridgedWind ? { speedUnit: bridgedWind } : {}),
        },
        loadDev: {
          ...((parsed ?? {})?.loadDev ?? {}),
          ...(!hasParsedOal && bridgedOal ? { oalUnit: bridgedOal } : {}),
        },
      };

      return this.sanitizePrefs(bridged ?? {});
    } catch {
      return this.sanitizePrefs({});
    }
  }

  /** Overwrite all prefs (defaults still enforced/sanitized). */
  savePreferences(prefs: AppPreferencesV1): void {
    try {
      const clean = this.sanitizePrefs(prefs ?? {});
      localStorage.setItem(this.PREFS_KEY, JSON.stringify(clean));
    } catch {
      // ignore write errors (storage full / private mode)
    }
  }

  /** Patch-update prefs (safe deep-ish merge). */
  updatePreferences(patch: Partial<AppPreferencesV1>): AppPreferencesV1 {
    const cur = this.getPreferences();
    const merged: AppPreferencesV1 = {
      loadDev: { ...(cur.loadDev ?? {}), ...(patch.loadDev ?? {}) },
      wind: { ...(cur.wind ?? {}), ...(patch.wind ?? {}) },
    };

    this.savePreferences(merged);
    return this.getPreferences();
  }

  // Convenience getters used by components for defaults
  getDefaultLoadDevOalUnit(): LoadDevOalUnit {
    return (this.getPreferences().loadDev?.oalUnit ?? 'mm') as LoadDevOalUnit;
  }

  getDefaultWindSpeedUnit(): WindSpeedUnit {
    return (this.getPreferences().wind?.speedUnit ?? 'mph') as WindSpeedUnit;
  }
}
