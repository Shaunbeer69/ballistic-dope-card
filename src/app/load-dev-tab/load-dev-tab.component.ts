import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  OnInit,
  Output,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  Rifle,
  LoadDevProject,
  LoadDevEntry,
  LoadDevType,
  GroupSizeUnit
} from '../models';

import { DataService } from '../data.service';

interface ProjectForm {
  rifleId: number | null;
  name: string;
  type: LoadDevType | null;
  notes: string;

  powder: string;
  bullet: string;
  bulletWeightGr: number | null;
  brass: string;
  oal: number | null;
  distanceM: number | null;
}

interface EntryForm {
  loadLabel: string;
  powder: string;
  chargeGr: number | null;
  coal: string;
  primer: string;
  bullet: string;
  bulletWeightGr: number | null;
  bulletBc: string;
  distanceM: number | null;
  shotsFired: number | null;
  groupSize: number | null;
  groupUnit: GroupSizeUnit;
  velocityInput: string;
  poiNote: string;
  notes: string;
}

interface PlannerForm {
  distanceM: number | null;
  startChargeGr: number | null;
  endChargeGr: number | null;
  stepGr: number | null;
  shotsPerGroup: number | null;
}

interface VelocityStats {
  avg: number;
  es: number;
  sd: number;
  n: number;
}

interface NodeEntry {
  entry: LoadDevEntry;
  stats: VelocityStats;
}

@Component({
  selector: 'app-load-dev-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './load-dev-tab.component.html'
})
export class LoadDevTabComponent implements OnInit {
  @ViewChild('velocityInputEl') velocityInputEl?: ElementRef<HTMLInputElement>;
  @Output() backToMenu = new EventEmitter<void>();

  // Optional token you can use in HTML for a brief pulse
  velocityFocusToken = 0;

  private focusVelocityInput(selectAll = true): void {
    setTimeout(() => {
      const el = this.velocityInputEl?.nativeElement;
      if (!el) return;

      try {
        el.focus({ preventScroll: false } as any);
      } catch {
        el.focus();
      }

      if (selectAll) {
        try {
          el.select();
        } catch {
          // ignore
        }
      }

      this.velocityFocusToken++;
    }, 0);
  }

  // ---------- rifles / projects ----------
  rifles: Rifle[] = [];
  selectedRifleId: number | null = null;

  projects: LoadDevProject[] = [];
  selectedProjectId: number | null = null;
  selectedProject: LoadDevProject | null = null;

  // Project form
  projectFormVisible = false;
  editingProject: LoadDevProject | null = null;
  projectForm: ProjectForm = this.createEmptyProjectForm();
  showNotesPanel = false;

  // Planner + validation
  planner: PlannerForm = this.createEmptyPlannerForm();
  plannerError: string | null = null;

  // Filters
  powderFilter: string | null = null;
  bulletFilter: string | null = null;
  availablePowders: string[] = [];
  availableBullets: string[] = [];
  filteredProjects: LoadDevProject[] | null = null;

  // OCW validation
  ocwValidationWarning: string | null = null;

  // Entries
  entryFormVisible = false;
  editingEntry: LoadDevEntry | null = null;
  entryForm: EntryForm = this.createEmptyEntryForm();
  entrySortMode: 'default' | 'chargeAsc' | 'groupAsc' | 'groupDesc' = 'default';

  // Results visibility
  resultsCollapsed = false;
  hasResultsForSelectedProject = false;

  // Post-save banner
  postSaveMessage: string | null = null;

  // Ladder/OCW wizard
  ladderWizardActive = false;
  ladderWizardEntries: LoadDevEntry[] = [];
  ladderWizardIndex = 0;
  velocityEditEntry: LoadDevEntry | null = null;
  velocityEditValue: string | number = '';

  // Single-row velocity edit
  singleVelocityEditActive = false;

  // Graph
  showGraph = false;
  graphCoords: { x: number; y: number; charge: number; avg: number }[] = [];
  graphSvgPoints = '';
  graphMinVel = 0;
  graphMaxVel = 0;

  constructor(private data: DataService) {}

  // ---------- lifecycle ----------
  ngOnInit(): void {
    this.rifles = this.data.getRifles();
    if (this.rifles.length > 0) {
      this.selectedRifleId = this.rifles[0].id;
      this.loadProjects();
    }
  }

  // ---------- helpers ----------
  private createEmptyProjectForm(): ProjectForm {
    return {
      rifleId: null,
      name: '',
      type: 'ladder',
      notes: '',
      powder: '',
      bullet: '',
      bulletWeightGr: null,
      brass: '',
      oal: null,
      distanceM: null
    };
  }
poiNote(entry: LoadDevEntry): string {
  const any = entry as any;
  const v = (any?.poiNote ?? '').toString().trim();
  return v ? v : '—';
}

  private createEmptyEntryForm(): EntryForm {
    return {
      loadLabel: '',
      powder: '',
      chargeGr: null,
      coal: '',
      primer: '',
      bullet: '',
      bulletWeightGr: null,
      bulletBc: '',
      distanceM: null,
      shotsFired: null,
      groupSize: null,
      groupUnit: 'MOA',
      velocityInput: '',
      poiNote: '',
      notes: ''
    };
  }

  private createEmptyPlannerForm(): PlannerForm {
    return {
      distanceM: null,
      startChargeGr: null,
      endChargeGr: null,
      stepGr: null,
      shotsPerGroup: null
    };
  }

  shortDate(value: string | Date | null | undefined): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit'
    });
  }

  projectTypeLabel(type: LoadDevType): string {
    switch (type) {
      case 'ladder':
        return 'Ladder';
      case 'ocw':
        return 'OCW';
      case 'groups':
        return 'Group comparison';
      default:
        return 'Other';
    }
  }

  get devTypeDescription(): string | null {
    switch (this.projectForm.type) {
      case 'ladder':
        return 'Ladder test: single shots with small powder charge steps.';
      case 'ocw':
        return 'OCW (Optimal Charge Weight): 3–5 shot groups over a small charge window.';
      default:
        return null;
    }
  }

  toggleNotesPanel(): void {
    this.showNotesPanel = !this.showNotesPanel;
  }

  // ---------- loading ----------
  onRifleChange(): void {
    this.selectedProjectId = null;
    this.selectedProject = null;

    this.hasResultsForSelectedProject = false;
    this.resultsCollapsed = false;

    this.showGraph = false;
    this.graphCoords = [];
    this.graphSvgPoints = '';

    this.resetWizard();
    this.loadProjects();
  }

  private resetWizard(): void {
    this.showGraph = false;

    this.ladderWizardActive = false;
    this.singleVelocityEditActive = false;

    this.velocityEditEntry = null;
    this.velocityEditValue = '';

    this.ladderWizardEntries = [];
    this.ladderWizardIndex = 0;
  }

  private loadProjects(): void {
    if (this.selectedRifleId == null) {
      this.projects = [];
      this.selectedProject = null;
      this.selectedProjectId = null;

      this.hasResultsForSelectedProject = false;

      this.availablePowders = [];
      this.availableBullets = [];
      this.filteredProjects = null;

      this.rebuildGraphData();
      this.resetWizard();
      return;
    }

    this.projects = this.data.getLoadDevProjectsForRifle(this.selectedRifleId);

    if (this.selectedProjectId != null) {
      this.selectedProject =
        this.projects.find(p => p.id === this.selectedProjectId) ?? null;
      if (!this.selectedProject) {
        this.selectedProjectId = null;
      }
    }

    if (this.selectedProjectId == null) {
      this.selectedProject = null;
    }

    this.rebuildFilterOptions();
    this.applyProjectFilters();

    this.updateHasResultsFlag();
    this.rebuildGraphData();
    if (!this.graphCoords.length) this.showGraph = false;

    this.resetWizard();
  }

  private refreshSelectedProject(): void {
    if (!this.selectedRifleId || !this.selectedProjectId) return;

    this.projects = this.data.getLoadDevProjectsForRifle(this.selectedRifleId);
    this.selectedProject =
      this.projects.find(p => p.id === this.selectedProjectId) ?? null;

    this.rebuildFilterOptions();
    this.applyProjectFilters();

    this.updateHasResultsFlag();
    this.rebuildGraphData();
    if (!this.graphCoords.length) this.showGraph = false;
  }

  onProjectSelectChange(): void {
    if (this.selectedProjectId == null) {
      this.selectedProject = null;
      this.updateHasResultsFlag();
      this.rebuildGraphData();
      this.showGraph = false;
      this.resetWizard();
      return;
    }

    this.selectedProject =
      this.projects.find(p => p.id === this.selectedProjectId) ?? null;

    this.updateHasResultsFlag();
    this.rebuildGraphData();
    if (!this.graphCoords.length) this.showGraph = false;

    this.resetWizard();
  }

  openSelectedProject(): void {
    if (!this.selectedProjectId) {
      alert('Select a load development first.');
      return;
    }
    this.onProjectSelectChange();
    this.resultsCollapsed = false;
    this.resetWizard();
  }

  private updateHasResultsFlag(): void {
    this.hasResultsForSelectedProject =
      !!this.selectedProject &&
      !!this.selectedProject.entries &&
      this.selectedProject.entries.length > 0;

    this.updateOcwValidationWarning();
  }

  toggleResultsCollapsed(): void {
    this.resultsCollapsed = !this.resultsCollapsed;
  }

  // ---------- filters ----------
  private rebuildFilterOptions(): void {
    const powders = new Set<string>();
    const bullets = new Set<string>();

    for (const p of this.projects) {
      if (!p.entries) continue;
      for (const e of p.entries) {
        const any = e as any;
        if (typeof any.powder === 'string' && any.powder.trim()) powders.add(any.powder.trim());
        if (typeof any.bullet === 'string' && any.bullet.trim()) bullets.add(any.bullet.trim());
      }
    }

    this.availablePowders = Array.from(powders).sort();
    this.availableBullets = Array.from(bullets).sort();
  }

  onFilterChange(): void {
    this.applyProjectFilters();
  }

  private applyProjectFilters(): void {
    const powder = this.powderFilter?.trim() || null;
    const bullet = this.bulletFilter?.trim() || null;

    if (!powder && !bullet) {
      this.filteredProjects = null;
      return;
    }

    this.filteredProjects = this.projects.filter(p => {
      if (!p.entries || !p.entries.length) return false;

      return p.entries.some(e => {
        const any = e as any;
        const ePowder = any.powder?.toString().trim() || '';
        const eBullet = any.bullet?.toString().trim() || '';

        if (powder && ePowder !== powder) return false;
        if (bullet && eBullet !== bullet) return false;
        return true;
      });
    });
  }

  // ---------- project CRUD ----------
  newProject(): void {
    if (!this.selectedRifleId) {
      alert('Select rifle first');
      return;
    }

    this.selectedProject = null;
    this.selectedProjectId = null;

    this.hasResultsForSelectedProject = false;
    this.resultsCollapsed = false;

    this.showGraph = false;
    this.graphCoords = [];
    this.graphSvgPoints = '';

    this.editingProject = null;
    this.projectForm = this.createEmptyProjectForm();
    this.projectForm.rifleId = this.selectedRifleId;
    this.projectForm.type = 'ladder';

    this.planner = this.createEmptyPlannerForm();
    this.plannerError = null;

    this.projectFormVisible = true;
    this.postSaveMessage = null;
    this.showNotesPanel = false;

    this.resetWizard();
  }

  cancelProjectForm(): void {
    this.projectFormVisible = false;
    this.editingProject = null;
    this.projectForm = this.createEmptyProjectForm();

    this.planner = this.createEmptyPlannerForm();
    this.plannerError = null;

    this.showNotesPanel = false;
  }

  private createLadderEntriesFromPlanner(projectId: number): void {
    const type = this.projectForm.type;
    if (type !== 'ladder' && type !== 'ocw') return;

    this.plannerError = null;

    const { distanceM, startChargeGr, endChargeGr, stepGr, shotsPerGroup } = this.planner;

    if (startChargeGr == null || endChargeGr == null || stepGr == null || stepGr <= 0) {
      this.plannerError = 'Enter start, end and a positive step size for the charge ladder.';
      return;
    }

    if (endChargeGr < startChargeGr) {
      this.plannerError = 'End charge must be greater than start charge.';
      return;
    }

    const dist = distanceM ?? undefined;
    const defaultShots: number | undefined = type === 'ocw' ? shotsPerGroup ?? undefined : 1;

    let charge = startChargeGr;
    let localId = 1;

    while (charge <= endChargeGr + 1e-6) {
      const roundedCharge = Number(charge.toFixed(2));

      const entry: LoadDevEntry = {
        id: localId++,
        loadLabel: '',
        powder: undefined,
        chargeGr: roundedCharge,
        coal: undefined,
        primer: undefined,
        bullet: undefined,
        bulletWeightGr: undefined,
        bulletBc: undefined,
        distanceM: dist,
        shotsFired: defaultShots,
        groupSize: undefined,
        groupUnit: 'MOA',
        poiNote: undefined,
        notes: undefined
      } as LoadDevEntry;

      this.data.updateLoadDevEntry(projectId, entry);
      charge = Number((charge + stepGr).toFixed(2));
    }
  }

  saveProject(): void {
    if (!this.selectedRifleId || !this.projectForm.name.trim()) {
      alert('Please select rifle and enter a name for the load development.');
      return;
    }

    const type: LoadDevType = (this.projectForm.type as LoadDevType) || 'ladder';
    this.postSaveMessage = null;

    if (this.editingProject) {
      const updated: LoadDevProject = {
        ...this.editingProject,
        rifleId: this.selectedRifleId,
        name: this.projectForm.name.trim(),
        type,
        notes: this.projectForm.notes.trim()
      };
      this.data.updateLoadDevProject(updated);
      this.selectedProjectId = updated.id;

      this.postSaveMessage = 'Load development updated.';
    } else {
      const newProject: LoadDevProject = {
        id: Date.now(),
        rifleId: this.selectedRifleId,
        name: this.projectForm.name.trim(),
        type,
        notes: this.projectForm.notes.trim() || undefined,
        dateStarted: new Date().toISOString(),
        entries: []
      };
      this.data.updateLoadDevProject(newProject);
      this.selectedProjectId = newProject.id;

      this.createLadderEntriesFromPlanner(newProject.id);
      this.data.createSessionForLoadDevProject(newProject);

      this.postSaveMessage = 'Load development planned and saved.';
    }

    setTimeout(() => (this.postSaveMessage = null), 8000);

    this.projectFormVisible = false;
    this.editingProject = null;

    this.projectForm = this.createEmptyProjectForm();
    this.planner = this.createEmptyPlannerForm();
    this.plannerError = null;
    this.showNotesPanel = false;

    this.loadProjects();
    this.resetWizard();
  }

  deleteProject(project: LoadDevProject): void {
    if (!confirm(`Delete project "${project.name}"?`)) return;

    this.data.deleteLoadDevProject(project.id);

    if (this.selectedProjectId === project.id) {
      this.selectedProject = null;
      this.selectedProjectId = null;
    }

    this.loadProjects();
  }

  // ---------- entry helpers ----------
  formatGroupSize(entry: LoadDevEntry): string {
    const any = entry as any;
    if (typeof any.groupSize !== 'number' || !isFinite(any.groupSize)) return '—';
    const unit = (any.groupUnit as string) || 'MOA';
    return `${any.groupSize.toFixed(2)} ${unit}`;
  }

  // ---------- entry CRUD ----------
  newEntry(): void {
    if (!this.selectedProject) {
      alert('Select a load development first.');
      return;
    }
    this.entryFormVisible = true;
    this.editingEntry = null;
    this.entryForm = this.createEmptyEntryForm();
  }

  editEntry(entry: LoadDevEntry): void {
    this.entryFormVisible = true;
    this.editingEntry = entry;
    const any = entry as any;

    this.entryForm = {
      loadLabel: any.loadLabel ?? '',
      powder: any.powder ?? '',
      chargeGr: any.chargeGr ?? null,
      coal: any.coal ?? '',
      primer: any.primer ?? '',
      bullet: any.bullet ?? '',
      bulletWeightGr: any.bulletWeightGr ?? null,
      bulletBc: any.bulletBc ?? '',
      distanceM: any.distanceM ?? null,
      shotsFired: any.shotsFired ?? null,
      groupSize: any.groupSize ?? null,
      groupUnit: (any.groupUnit as GroupSizeUnit) ?? 'MOA',
      velocityInput: any.velocityInput ?? '',
      poiNote: any.poiNote ?? '',
      notes: any.notes ?? ''
    };
  }

  cancelEntryForm(): void {
    this.entryFormVisible = false;
    this.editingEntry = null;
    this.entryForm = this.createEmptyEntryForm();
  }

  saveEntryForm(): void {
    if (!this.selectedProject) return;

    const f = this.entryForm;
    if (f.chargeGr == null) {
      alert('Charge (gr) is required.');
      return;
    }

    const payload: (Partial<LoadDevEntry> & { velocityInput?: string }) = {
      loadLabel: f.loadLabel.trim() || undefined,
      powder: f.powder.trim() || undefined,
      chargeGr: f.chargeGr,
      coal: f.coal.trim() || undefined,
      primer: f.primer.trim() || undefined,
      bullet: f.bullet.trim() || undefined,
      bulletWeightGr: f.bulletWeightGr ?? undefined,
      bulletBc: f.bulletBc.trim() || undefined,
      distanceM: f.distanceM ?? undefined,
      shotsFired: f.shotsFired ?? undefined,
      groupSize: f.groupSize ?? undefined,
      groupUnit: f.groupUnit ?? 'MOA',
      poiNote: f.poiNote.trim() || undefined,
      notes: f.notes.trim() || undefined,
      velocityInput: f.velocityInput.trim() || undefined
    };

    if (this.editingEntry) {
      const updated = { ...this.editingEntry, ...payload };
      this.data.updateLoadDevEntry(this.selectedProject.id, updated);
    } else {
      const existing = this.selectedProject.entries ?? [];
      const newId = existing.length ? Math.max(...existing.map(x => x.id)) + 1 : 1;
      const newEntry: LoadDevEntry = { id: newId, ...payload } as LoadDevEntry;
      this.data.updateLoadDevEntry(this.selectedProject.id, newEntry);
    }

    this.entryFormVisible = false;
    this.editingEntry = null;
    this.entryForm = this.createEmptyEntryForm();
    this.loadProjects();
  }

  deleteEntry(entry: LoadDevEntry): void {
    if (!this.selectedProject) return;
    if (!confirm('Delete this entry?')) return;
    this.data.deleteLoadDevEntry(this.selectedProject.id, entry.id);
    this.loadProjects();
  }

  entriesForSelectedProject(): LoadDevEntry[] {
    if (!this.selectedProject) return [];
    const list = [...(this.selectedProject.entries ?? [])];

    if (this.selectedProject.type === 'ocw') {
      return this.sortOcwEntriesBySd(list);
    }

    return list.sort((a, b) => (a.chargeGr ?? 0) - (b.chargeGr ?? 0));
  }

  // ---------- velocity stats & parsing ----------
  private parseVelocityInput(raw: string | undefined | null): number[] {
    if (!raw) return [];
    return raw
      .split(/[\s,;]+/)
      .map(x => Number(x))
      .filter(v => Number.isFinite(v));
  }

  statsForEntry(entry: LoadDevEntry): VelocityStats | null {
    const any = entry as any;
    const values = this.parseVelocityInput(any.velocityInput);
    return this.computeVelocityStats(values);
  }

  private computeVelocityStats(values: number[]): VelocityStats | null {
    if (!values.length) return null;

    const n = values.length;
    const avg = values.reduce((a, b) => a + b, 0) / n;
    const sorted = [...values].sort((a, b) => a - b);
    const es = sorted[n - 1] - sorted[0];

    const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / n;
    const sd = Math.sqrt(variance);

    return { avg, es, sd, n };
  }

  // --- OCW ranking helpers ---
  private sortOcwEntriesBySd(entries: LoadDevEntry[]): LoadDevEntry[] {
    const sdCache = new Map<string, number>();
    const getSd = (e: LoadDevEntry): number => {
      const key = String((e as any).id ?? '');
      if (sdCache.has(key)) return sdCache.get(key)!;

      const s = this.statsForEntry(e)?.sd;
      const v = typeof s === 'number' && isFinite(s) ? s : Number.POSITIVE_INFINITY;

      sdCache.set(key, v);
      return v;
    };

    return [...entries].sort((a, b) => {
      const sa = getSd(a);
      const sb = getSd(b);
      if (sa !== sb) return sa - sb;

      const ca = Number((a as any).chargeGr ?? 0);
      const cb = Number((b as any).chargeGr ?? 0);
      if (ca !== cb) return ca - cb;

      const ia = String((a as any).id ?? '');
      const ib = String((b as any).id ?? '');
      return ia.localeCompare(ib);
    });
  }

  ocwRankForEntry(entry: LoadDevEntry): 'best' | 'second' | 'third' | null {
    if (!this.selectedProject || this.selectedProject.type !== 'ocw') return null;

    const ranked = this.sortOcwEntriesBySd(this.selectedProject.entries ?? []).filter(e => {
      const s = this.statsForEntry(e)?.sd;
      return typeof s === 'number' && isFinite(s);
    });

    if (ranked.length < 1) return null;

    const id = String((entry as any).id ?? '');
    if (id === String((ranked[0] as any).id ?? '')) return 'best';
    if (ranked.length >= 2 && id === String((ranked[1] as any).id ?? '')) return 'second';
    if (ranked.length >= 3 && id === String((ranked[2] as any).id ?? '')) return 'third';

    return null;
  }

  ocwSdCssClass(entry: LoadDevEntry): string {
    const r = this.ocwRankForEntry(entry);
    if (r === 'best') return 'bg-emerald-900/30 ring-1 ring-emerald-500/50';
    if (r === 'second') return 'bg-amber-900/25 ring-1 ring-amber-500/40';
    if (r === 'third') return 'bg-rose-900/25 ring-1 ring-rose-500/40';
    return '';
  }

  // ---------- node detection & colouring (ladder) ----------
  private findNodes(entries: LoadDevEntry[]): NodeEntry[] {
    const valid = entries
      .map(e => ({ entry: e, stats: this.statsForEntry(e) }))
      .filter(x => x.stats != null) as NodeEntry[];

    if (valid.length < 3) return [];

    const nodes: NodeEntry[] = [];

    for (let i = 1; i < valid.length - 1; i++) {
      const prev = valid[i - 1];
      const cur = valid[i];
      const next = valid[i + 1];

      const sd = cur.stats.sd;
      const dv1 = Math.abs(cur.stats.avg - prev.stats.avg);
      const dv2 = Math.abs(next.stats.avg - cur.stats.avg);

      if (sd <= 12 && dv1 <= 15 && dv2 <= 15) nodes.push(cur);
    }

    return nodes;
  }

  nodeCssClass(entry: LoadDevEntry): string {
    if (!this.selectedProject || this.selectedProject.type !== 'ladder') return '';
    const nodes = this.findNodes(this.entriesForSelectedProject());
    return nodes.some(n => n.entry.id === entry.id)
      ? 'bg-emerald-900/25 ring-1 ring-emerald-400/40'
      : '';
  }

  // ---------- velocities completeness ----------
  private allEntriesHaveVelocity(): boolean {
    if (!this.selectedProject?.entries?.length) return false;

    return this.selectedProject.entries.every(e => {
      const any = e as any;
      const values = this.parseVelocityInput(any.velocityInput);
      return values.length > 0;
    });
  }

  // ---------- graph data ----------
  private rebuildGraphData(): void {
    this.graphCoords = [];
    this.graphSvgPoints = '';
    this.graphMinVel = 0;
    this.graphMaxVel = 0;

    if (!this.selectedProject || !this.selectedProject.entries?.length) return;

    const pts: { charge: number; avg: number }[] = [];

    for (const e of this.selectedProject.entries) {
      if (e.chargeGr == null) continue;
      const stats = this.statsForEntry(e);
      if (!stats) continue;
      pts.push({ charge: e.chargeGr, avg: stats.avg });
    }

    if (!pts.length) return;

    pts.sort((a, b) => a.charge - b.charge);

    let min = pts[0].avg;
    let max = pts[0].avg;

    for (const p of pts) {
      if (p.avg < min) min = p.avg;
      if (p.avg > max) max = p.avg;
    }

    const padding = (max - min) * 0.1 || 10;
    this.graphMinVel = min - padding;
    this.graphMaxVel = max + padding;

    const n = pts.length;
    const span = this.graphMaxVel - this.graphMinVel || 1;

    const coords: { x: number; y: number; charge: number; avg: number }[] = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const x = n === 1 ? 50 : (i / (n - 1)) * 100;
      const y = 55 - ((p.avg - this.graphMinVel) / span) * 45;
      coords.push({ x, y, charge: p.charge, avg: p.avg });
    }

    this.graphCoords = coords;
    this.graphSvgPoints = coords.map(c => `${c.x},${c.y}`).join(' ');
  }

  toggleGraph(): void {
    if (!this.graphCoords.length) {
      alert('No velocity data to graph yet.');
      return;
    }
    this.showGraph = !this.showGraph;
  }

  // ---------- ladder / OCW wizard ----------
  startLadderWizard(): void {
    if (!this.selectedProject) {
      alert('Select a load development first.');
      return;
    }

    if (this.selectedProject.type !== 'ladder' && this.selectedProject.type !== 'ocw') {
      alert('The velocity wizard is only available for ladder and OCW developments.');
      return;
    }

    if (this.allEntriesHaveVelocity()) {
      alert('All steps already have velocities. Use Edit vel for changes.');
      return;
    }

    const entries = [...(this.selectedProject.entries ?? [])].sort(
      (a, b) => (a.chargeGr ?? 9999) - (b.chargeGr ?? 9999)
    );

    if (!entries.length) {
      alert('No entries created for this development yet.');
      return;
    }

    this.ladderWizardEntries = entries;
    this.ladderWizardIndex = 0;
    this.ladderWizardActive = true;

    this.singleVelocityEditActive = false;

    this.setWizardCurrentEntry();
  }

  private setWizardCurrentEntry(): void {
    if (!this.ladderWizardActive) return;

    if (this.ladderWizardIndex >= this.ladderWizardEntries.length) {
      this.finishLadderWizard();
      return;
    }

    this.velocityEditEntry = this.ladderWizardEntries[this.ladderWizardIndex];
    const any = this.velocityEditEntry as any;
    this.velocityEditValue = any.velocityInput ?? '';

    this.focusVelocityInput(true);
  }

  private finishLadderWizard(): void {
    this.ladderWizardActive = false;
    this.velocityEditEntry = null;
    this.velocityEditValue = '';
    this.ladderWizardEntries = [];
    this.ladderWizardIndex = 0;
  }

  private goToNextWizardEntry(): void {
    if (!this.selectedProject || !this.velocityEditEntry) {
      this.finishLadderWizard();
      return;
    }

    const sorted = [...(this.selectedProject.entries ?? [])].sort(
      (a, b) => (a.chargeGr ?? 9999) - (b.chargeGr ?? 9999)
    );

    const currentIndex = sorted.findIndex(e => e.id === this.velocityEditEntry!.id);

    if (currentIndex < 0 || currentIndex + 1 >= sorted.length) {
      this.finishLadderWizard();
      return;
    }

    this.ladderWizardEntries = sorted;
    this.ladderWizardIndex = currentIndex + 1;

    this.velocityEditEntry = sorted[this.ladderWizardIndex];
    const any = this.velocityEditEntry as any;
    this.velocityEditValue = any.velocityInput ?? '';

    this.focusVelocityInput(true);
  }

  saveVelocityAndNext(): void {
    if (!this.selectedProject || !this.velocityEditEntry) return;

    const raw = this.velocityEditValue ?? '';
    const trimmed = raw.toString().trim();

    if (trimmed) {
      const values = this.parseVelocityInput(trimmed);
      if (!values.length) {
        alert('Enter one or more numeric velocities, separated by spaces or commas.');
        this.focusVelocityInput(true);
        return;
      }

      const any = this.velocityEditEntry as any;
      any.velocityInput = values.join(' ');
      this.velocityEditEntry.shotsFired = values.length;

      this.data.updateLoadDevEntry(this.selectedProject.id, this.velocityEditEntry);
      this.refreshSelectedProject();
    }

    this.goToNextWizardEntry();
  }

  skipVelocityAndNext(): void {
    this.goToNextWizardEntry();
  }

  cancelLadderWizard(): void {
    this.finishLadderWizard();
  }

  // ---------- single-row velocity edit ----------
  editVelocityForEntry(entry: LoadDevEntry): void {
    this.ladderWizardActive = false;

    this.singleVelocityEditActive = true;
    this.velocityEditEntry = entry;

    const any = entry as any;
    this.velocityEditValue = any.velocityInput ?? '';

    this.focusVelocityInput(true);
  }

  saveSingleVelocity(): void {
    if (!this.selectedProject || !this.velocityEditEntry) {
      this.singleVelocityEditActive = false;
      return;
    }

    const raw = this.velocityEditValue ?? '';
    const trimmed = raw.toString().trim();

    if (!trimmed) {
      const any = this.velocityEditEntry as any;
      any.velocityInput = undefined;
      this.velocityEditEntry.shotsFired = undefined;

      this.data.updateLoadDevEntry(this.selectedProject.id, this.velocityEditEntry);
      this.refreshSelectedProject();

      this.singleVelocityEditActive = false;
      this.velocityEditEntry = null;
      this.velocityEditValue = '';
      return;
    }

    const values = this.parseVelocityInput(trimmed);
    if (!values.length) {
      alert('Enter one or more numeric velocities, separated by spaces or commas.');
      this.focusVelocityInput(true);
      return;
    }

    const any = this.velocityEditEntry as any;
    any.velocityInput = values.join(' ');
    this.velocityEditEntry.shotsFired = values.length;

    this.data.updateLoadDevEntry(this.selectedProject.id, this.velocityEditEntry);
    this.refreshSelectedProject();

    this.singleVelocityEditActive = false;
    this.velocityEditEntry = null;
    this.velocityEditValue = '';
  }

  cancelSingleVelocityEdit(): void {
    this.singleVelocityEditActive = false;
    this.velocityEditEntry = null;
    this.velocityEditValue = '';
  }

  // ---------- OCW completeness helper ----------
  private updateOcwValidationWarning(): void {
    const project = this.selectedProject;

    if (!project || project.type !== 'ocw' || !project.entries?.length) {
      this.ocwValidationWarning = null;
      return;
    }

    const entriesWithVel = project.entries.filter(e => {
      const any = e as any;
      const vals = this.parseVelocityInput(any.velocityInput);
      return vals.length > 0;
    });

    if (!entriesWithVel.length) {
      this.ocwValidationWarning = 'No velocities captured yet for OCW groups.';
      return;
    }

    const shotCounts = new Set<number>();
    for (const e of entriesWithVel) {
      const any = e as any;
      const vals = this.parseVelocityInput(any.velocityInput);
      const n = e.shotsFired ?? vals.length;
      if (n > 0) shotCounts.add(n);
    }

    this.ocwValidationWarning =
      shotCounts.size > 1
        ? 'OCW groups do not all have the same number of shots.'
        : null;
  }

  // ---------- back out of load dev tab ----------
  onBackFromLoadDev(): void {
    this.selectedProjectId = null;
    this.selectedProject = null;

    this.projectFormVisible = false;
    this.editingProject = null;

    this.entryFormVisible = false;
    this.editingEntry = null;

    this.hasResultsForSelectedProject = false;
    this.resultsCollapsed = false;

    this.showGraph = false;
    this.graphCoords = [];
    this.graphSvgPoints = '';

    this.singleVelocityEditActive = false;
    this.velocityEditEntry = null;
    this.velocityEditValue = '';

    this.ladderWizardActive = false;
    this.ladderWizardEntries = [];
    this.ladderWizardIndex = 0;

    this.postSaveMessage = null;

    this.resetWizard();
    this.backToMenu.emit();
  }
}
