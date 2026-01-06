import { Injectable } from '@angular/core';
import {
  Rifle,
  Venue,
  Session,
  LoadDevProject,
  LoadDevEntry
} from './models';

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

const STORAGE_KEY = 'ballistic-dope-card-v1';

@Injectable({
  providedIn: 'root'
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

        return {
          nextRifleId: parsed.nextRifleId ?? 1,
          nextVenueId: parsed.nextVenueId ?? 1,
          nextSessionId: parsed.nextSessionId ?? 1,
          nextLoadDevProjectId: parsed.nextLoadDevProjectId ?? 1,
          nextLoadDevEntryId: parsed.nextLoadDevEntryId ?? 1,
          rifles: parsed.rifles ?? [],
          venues: parsed.venues ?? [],
          sessions: parsed.sessions ?? [],
          loadDevProjects: parsed.loadDevProjects ?? []
        };
      }
    } catch {
      // ignore parse errors
    }

    return {
      nextRifleId: 1,
      nextVenueId: 1,
      nextSessionId: 1,
      nextLoadDevProjectId: 1,
      nextLoadDevEntryId: 1,
      rifles: [],
      venues: [],
      sessions: [],
      loadDevProjects: []
    };
  }

  private saveStore(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
    } catch {
      // ignore for now
    }
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
      const src: any =
        payload.store && typeof payload.store === 'object' ? payload.store : payload;

      const riflesIn = Array.isArray(src.rifles) ? src.rifles : [];
      const venuesIn = Array.isArray(src.venues) ? src.venues : [];
      const sessionsIn = Array.isArray(src.sessions) ? src.sessions : [];
      const projectsIn = Array.isArray(src.loadDevProjects) ? src.loadDevProjects : [];

      const norm = (s: any) => (String(s ?? '').trim().toLowerCase());

      // ----- Build ID maps (old -> new/existing) -----
      const rifleIdMap = new Map<number, number>();
      const venueIdMap = new Map<number, number>();
            let addedRifles = 0;
      let addedVenues = 0;


      // ----- Rifles: match by name, else add -----
      for (const r of riflesIn) {
        const oldId = Number(r?.id);
        const nameKey = norm(r?.name);
        

               const existing = this.getRifles().find(x => norm(x.name) === nameKey && nameKey);

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

        const existing = this.getVenues().find(x => norm(x.name) === nameKey && nameKey);

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

        const dup = this.getSessions().some(x =>
          norm(x.date) === dateKey &&
          norm(x.title) === titleKey &&
          Number(x.rifleId) === Number(newRifleId) &&
          Number(x.venueId) === Number(newVenueId)
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
          completed: !!s?.completed
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

        const existingProject = this.getLoadDevProjectsForRifle(newRifleId).find(x =>
          norm(x.name) === nameKey &&
          norm(x.dateStarted) === dateKey &&
          nameKey && dateKey
        );

        const targetProject = existingProject
          ? existingProject
          : this.addLoadDevProject({
              rifleId: newRifleId,
              name: p?.name ?? '',
              type: p?.type,
              dateStarted: p?.dateStarted,
              notes: p?.notes
            });

        if (!existingProject) addedProjects++;

        // Merge entries by chargeGr (skip if same charge already exists)
        const incomingEntries = Array.isArray(p?.entries) ? p.entries : [];
        for (const e of incomingEntries) {
          const charge = Number(e?.chargeGr);
          const already = (targetProject.entries ?? []).some(x => Number(x.chargeGr) === charge);

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
            ...( (e as any)?.groupSizeCm !== undefined ? { groupSizeCm: (e as any).groupSizeCm } : {} ),
            ...( (e as any)?.createdAt ? { createdAt: (e as any).createdAt } : {} ),
            ...( (e as any)?.updatedAt ? { updatedAt: (e as any).updatedAt } : {} ),
          } as any);



          if (created) addedEntries++;
        }
      }

      return {
        ok: true,
        message:
                  `Merge import complete. Added ${addedRifles} rifles, ` +
          `${addedVenues} venues, ${addedSessions} sessions, ` +
          `${addedProjects} load-dev projects, ${addedEntries} load-dev entries.`

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
    return this.store.rifles.find(r => r.id === id);
  }

  addRifle(rifle: Omit<Rifle, 'id'>): Rifle {
    const newRifle: Rifle = {
      ...rifle,
      id: this.store.nextRifleId++
    };
    this.store.rifles.push(newRifle);
    this.saveStore();
    return newRifle;
  }

  updateRifle(rifle: Rifle): void {
    const idx = this.store.rifles.findIndex(r => r.id === rifle.id);
    if (idx >= 0) {
      this.store.rifles[idx] = rifle;
      this.saveStore();
    }
  }

 deleteRifle(id: number): void {
  const idNum = Number(id);
  this.store.rifles = this.store.rifles.filter(r => Number(r.id) !== idNum);
  // NOTE: we do not automatically delete load dev projects or sessions.
  this.saveStore();
}


  // Increment round count, never decreases
  incrementRifleRoundCount(rifleId: number, delta: number): void {
    if (!delta || delta <= 0) return;
    const rifle = this.store.rifles.find(r => r.id === rifleId);
    if (!rifle) return;
    rifle.roundCount = (rifle.roundCount || 0) + delta;
    this.saveStore();
  }

  // ---------- Venues ----------

  getVenues(): Venue[] {
    return this.store.venues;
  }

  getVenueById(id: number): Venue | undefined {
    return this.store.venues.find(v => v.id === id);
  }

  addVenue(venue: Omit<Venue, 'id'>): Venue {
    const newVenue: Venue = {
      ...venue,
      id: this.store.nextVenueId++
    };
    this.store.venues.push(newVenue);
    this.saveStore();
    return newVenue;
  }

  updateVenue(venue: Venue): void {
    const idx = this.store.venues.findIndex(v => v.id === venue.id);
    if (idx >= 0) {
      this.store.venues[idx] = venue;
      this.saveStore();
    }
  }

  deleteVenue(id: number): void {
    this.store.venues = this.store.venues.filter(v => v.id !== id);
    this.saveStore();
  }

  // ---------- Sessions ----------

  getSessions(): Session[] {
    return this.store.sessions;
  }

  getSessionById(id: number): Session | undefined {
    return this.store.sessions.find(s => s.id === id);
  }

  addSession(session: Omit<Session, 'id'>): Session {
    const newSession: Session = {
      ...session,
      id: this.store.nextSessionId++
    };
    this.store.sessions.push(newSession);
    this.saveStore();
    return newSession;
  }

  updateSession(session: Session): void {
    const idx = this.store.sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) {
      this.store.sessions[idx] = session;
      this.saveStore();
    }
  }

  deleteSession(id: number): void {
    this.store.sessions = this.store.sessions.filter(s => s.id !== id);
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
    const title = project.name?.trim()
      ? `Load dev: ${project.name.trim()}`
      : 'Load development';

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
      completed: false
    } as Session;

    return session;
  }

  // ---------- Load Development Projects ----------

  getLoadDevProjectsForRifle(rifleId: number): LoadDevProject[] {
    return this.store.loadDevProjects.filter(p => p.rifleId === rifleId);
  }

  getLoadDevProjectById(id: number): LoadDevProject | undefined {
    return this.store.loadDevProjects.find(p => p.id === id);
  }

  addLoadDevProject(
    project: Omit<LoadDevProject, 'id' | 'dateStarted' | 'entries'> & {
      dateStarted?: string;
      entries?: LoadDevEntry[];
    }
  ): LoadDevProject {
    const newProject: LoadDevProject = {
      id: this.store.nextLoadDevProjectId++,
      rifleId: project.rifleId,
      name: project.name,
      type: project.type,
      dateStarted: project.dateStarted ?? new Date().toISOString(),
      notes: project.notes,
      entries: project.entries ?? []
    };
    this.store.loadDevProjects.push(newProject);
    this.saveStore();
    return newProject;
  }

  /**
   * Upsert behaviour – updates an existing project or inserts it if missing.
   * This keeps compatibility with places where a new project is created
   * and then passed straight into updateLoadDevProject.
   */
  updateLoadDevProject(project: LoadDevProject): void {
    const idx = this.store.loadDevProjects.findIndex(p => p.id === project.id);
    if (idx >= 0) {
      this.store.loadDevProjects[idx] = project;
    } else {
      this.store.loadDevProjects.push(project);
    }
    this.saveStore();
  }

  deleteLoadDevProject(id: number): void {
    this.store.loadDevProjects = this.store.loadDevProjects.filter(
      p => p.id !== id
    );
    this.saveStore();
  }

  // ---------- Load Development Entries (inside projects) ----------

  addLoadDevEntry(
    projectId: number,
    entry: Omit<LoadDevEntry, 'id'>
  ): LoadDevEntry | null {
    const project = this.getLoadDevProjectById(projectId);
    if (!project) return null;

   const nowIso = new Date().toISOString();

const newEntry: LoadDevEntry = {
  id: this.store.nextLoadDevEntryId++,
  createdAt: (entry as any)?.createdAt ?? nowIso,
  updatedAt: (entry as any)?.updatedAt ?? nowIso,
  ...entry
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

    const idx = project.entries.findIndex(e => e.id === entry.id);

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

    project.entries = (project.entries ?? []).filter(e => e.id !== entryId);
    this.updateLoadDevProject(project);
  }
}
