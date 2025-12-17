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
    this.store.rifles = this.store.rifles.filter(r => r.id !== id);
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

    const newEntry: LoadDevEntry = {
      id: this.store.nextLoadDevEntryId++,
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

    if (idx >= 0) {
      project.entries[idx] = { ...project.entries[idx], ...entry };
    } else {
      project.entries.push({ ...entry });
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
