import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  shotsPerGroup: number | null; // OCW: how many shots per step
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
  @Output() backToMenu = new EventEmitter<void>();

  // ---- navigation back from history/footer button ----
  onBackFromHistory(): void {
    this.backToMenu.emit();
  }

  // ---- simple legacy "export project to PDF" used earlier (kept for compatibility) ----
  exportProjectToPdf(): void {
    if (!this.selectedProject) {
      return;
    }

    const project: any = this.selectedProject;
    const rifle =
      this.rifles && this.selectedRifleId
        ? this.rifles.find((r: any) => r.id === this.selectedRifleId)
        : null;

    const doc = new jsPDF();

    let y = 14;

    // Title
    doc.setFontSize(14);
    doc.text('Load development', 14, y);
    y += 8;

    // Meta info
    doc.setFontSize(10);
    doc.text(`Rifle: ${rifle?.name || '—'}`, 14, y);
    y += 5;

    if (project.name) {
      doc.text(`Load: ${project.name}`, 14, y);
      y += 5;
    }

    if (project.type) {
      const typeLabel =
        project.type === 'ladder'
          ? 'Ladder'
          : project.type === 'ocw'
          ? 'OCW'
          : project.type;
      doc.text(`Type: ${typeLabel}`, 14, y);
      y += 5;
    }

    if (project.dateStarted) {
      const dateText = this.shortDate(project.dateStarted);
      doc.text(`Started: ${dateText}`, 14, y);
      y += 5;
    }

    y += 4;

    // Optional velocity vs charge chart using existing graphCoords
    this.rebuildGraphData();
    if (this.graphCoords && this.graphCoords.length) {
      const chartLeft = 14;
      const chartTop = y;
      const chartWidth = 180;
      const chartHeight = 50;

      doc.setFontSize(10);
      doc.text('Velocity vs charge', chartLeft, chartTop - 2);

      doc.setDrawColor(200);
      doc.rect(chartLeft, chartTop, chartWidth, chartHeight);

      if (this.graphCoords.length > 1) {
        doc.setDrawColor(34, 197, 94);
        for (let i = 1; i < this.graphCoords.length; i++) {
          const prev = this.graphCoords[i - 1];
          const curr = this.graphCoords[i];

          const prevX = chartLeft + (prev.x / 100) * chartWidth;
          const prevY = chartTop + (prev.y / 60) * chartHeight;

          const currX = chartLeft + (curr.x / 100) * chartWidth;
          const currY = chartTop + (curr.y / 60) * chartHeight;

          doc.line(prevX, prevY, currX, currY);
        }
      }

      doc.setFillColor(250, 204, 21);
      for (const pt of this.graphCoords) {
        const px = chartLeft + (pt.x / 100) * chartWidth;
        const py = chartTop + (pt.y / 60) * chartHeight;
        doc.circle(px, py, 1.2, 'F');
      }

      y = chartTop + chartHeight + 8;
    }

    const entries = this.entriesForSelectedProject();
    const rows = entries.map((entry: any) => {
      const stats = this.statsForEntry(entry);
      const avg = stats && stats.avg != null ? stats.avg.toFixed(0) : '—';
      const es = stats && stats.es != null ? stats.es.toFixed(0) : '—';
      const sd = stats && stats.sd != null ? stats.sd.toFixed(1) : '—';
      const shots =
        entry.shotsFired != null ? String(entry.shotsFired) : '—';

      return [String(entry.chargeGr ?? ''), avg, es, sd, shots];
    });

    if (!rows.length) {
      doc.text('No velocity data captured yet.', 14, y);
      doc.save(this.buildProjectFilename(project));
      return;
    }

    autoTable(doc, {
      startY: y,
      head: [['Charge (gr)', 'Avg fps', 'ES', 'SD', 'Shots']],
      body: rows,
      styles: {
        fontSize: 8
      },
      headStyles: {
        fillColor: [34, 197, 94],
        textColor: [0, 0, 0]
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245]
      }
    });

    doc.save(this.buildProjectFilename(project));
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

  // Post-save yellow banner
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

  private buildProjectFilename(project: any): string {
    const base = (project?.name || 'load-development').toString();
    const safe = base.replace(/[^\w\d\-]+/g, '_');
    return safe + '.pdf';
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

  asDateString(value: string | Date | null | undefined): string {
    return this.shortDate(value);
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

  getSelectedRifleName(): string {
    if (!this.selectedRifleId) {
      return 'No rifle selected';
    }
    const rifle = this.rifles.find(r => r.id === this.selectedRifleId);
    if (rifle && rifle.name) return rifle.name;
    return 'Rifle ' + this.selectedRifleId;
  }

  getSuggestedProjectName(): string {
    const rifleName =
      this.rifles.find(r => r.id === this.selectedRifleId)?.name || 'Load';
    const typeLabel =
      this.projectForm.type === 'ladder'
        ? 'Ladder'
        : this.projectForm.type === 'ocw'
        ? 'OCW'
        : 'Dev';

    const powder = this.projectForm.powder?.trim()
      ? ` ${this.projectForm.powder.trim()}`
      : '';
    const bulletPart =
      this.projectForm.bulletWeightGr && this.projectForm.bullet?.trim()
        ? ` ${this.projectForm.bulletWeightGr}gr ${this.projectForm.bullet.trim()}`
        : '';

    return `${rifleName} ${typeLabel}${powder}${bulletPart}`.trim();
  }

  get devTypeDescription(): string | null {
    switch (this.projectForm.type) {
      case 'ladder':
        return 'Ladder test: single shots with small powder charge steps. You look for a "flat spot" in velocity (low SD/ES) across 3 or more neighbouring charges – that usually indicates a stable node.';
      case 'ocw':
        return 'OCW (Optimal Charge Weight): 3–5 shot groups over a small charge window. You look for a range of charges where point of impact stays very similar while groups remain tight – that indicates a forgiving accuracy node.';
      default:
        return null;
    }
  }

  toggleNotesPanel(): void {
    this.showNotesPanel = !this.showNotesPanel;
  }

  private async savePdfNative(doc: jsPDF, filename: string): Promise<void> {
    try {
      const dataUrl = doc.output('datauristring');
      const base64 = dataUrl.split(',')[1];
      const path = `gunstuff/${filename}`;

      const result = await Filesystem.writeFile({
  path,
  data: base64,
  directory: Directory.Data,   // ✔ Works on Android 13+
  recursive: true
});


await Share.share({
  title: filename,
  text: 'Gunstuff Load Development Backup',
  url: result.uri
});

    } catch (err) {
      console.error('Native PDF save failed:', err);
      doc.save(filename);
    }
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
      this.rebuildGraphData();
      this.resetWizard();
      this.availablePowders = [];
      this.availableBullets = [];
      this.filteredProjects = null;
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
    } else {
      this.selectedProject =
        this.projects.find(p => p.id === this.selectedProjectId) ?? null;
      this.updateHasResultsFlag();
      this.rebuildGraphData();
      if (!this.graphCoords.length) this.showGraph = false;
      this.resetWizard();
    }
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
        if (any.powder && typeof any.powder === 'string') {
          powders.add(any.powder.trim());
        }
        if (any.bullet && typeof any.bullet === 'string') {
          bullets.add(any.bullet.trim());
        }
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

    const { distanceM, startChargeGr, endChargeGr, stepGr, shotsPerGroup } =
      this.planner;

    if (
      startChargeGr == null ||
      endChargeGr == null ||
      stepGr == null ||
      stepGr <= 0
    ) {
      this.plannerError =
        'Enter start, end and a positive step size for the charge ladder.';
      return;
    }

    if (endChargeGr < startChargeGr) {
      this.plannerError = 'End charge must be greater than start charge.';
      return;
    }

    const span = endChargeGr - startChargeGr;
    const stepsFloat = span / stepGr;
    const stepsInt = Math.round(stepsFloat);
    if (Math.abs(stepsFloat - stepsInt) > 1e-6) {
      this.plannerError =
        'Warning: step does not divide evenly into the window – last charge may be partial.';
    }

    const dist = distanceM ?? undefined;
    const defaultShots: number | undefined =
      type === 'ocw' ? shotsPerGroup ?? undefined : 1;

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

    const type: LoadDevType =
      (this.projectForm.type as LoadDevType) || 'ladder';

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

      this.postSaveMessage =
        'Load development updated. Use the wizard to enter velocities, view the graph and see the highlighted nodes.';
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

      this.postSaveMessage =
        type === 'ocw'
          ? 'OCW planned and saved. Go shoot your groups, then come back here and use the OCW wizard or Edit buttons to enter velocities.'
          : 'Ladder test planned and saved. Go shoot the ladder, then come back here and use the wizard or Edit buttons to enter velocities and view the graph with node highlights.';
    }

    setTimeout(() => {
      this.postSaveMessage = null;
    }, 15000);

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

  // ---------- EXPORT PDF (enhanced shot chart) ----------

  exportSelectedProjectToPdf(): void {
    if (!this.selectedProject) {
      alert('Select a load development first.');
      return;
    }

    const project: any = this.selectedProject;
    const rifle =
      this.rifles && this.selectedRifleId
        ? this.rifles.find(r => r.id === this.selectedRifleId)
        : null;

    const entries: any[] = this.entriesForSelectedProject() || [];
    if (!entries.length) {
      alert('No entries to export yet.');
      return;
    }

    const allShotValues: number[] = [];

    entries.forEach(e => {
      const values = this.parseVelocityInput((e as any).velocityInput);
      values.forEach(v => allShotValues.push(v));
    });

    if (!allShotValues.length) {
      alert('No velocity data captured yet.');
      return;
    }

    const minV = Math.min(...allShotValues);
    const maxV = Math.max(...allShotValues);
    const rangeV = maxV - minV || 1;

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();

    // Brand bar
    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, pageWidth, 10, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.text('GUNSTUFF', 8, 6);
    doc.setFontSize(8);
    doc.text('Ballistics', 8, 9);

    doc.setTextColor(0, 0, 0);
    let y = 18;

    // Meta
    doc.setFontSize(13);
    doc.text(project.name || 'Load development', 14, y);
    y += 7;

    doc.setFontSize(10);
    doc.text(`Rifle: ${rifle?.name || '—'}`, 14, y);
    y += 5;

    doc.text(`Type: ${(project.type as string).toUpperCase()}`, 14, y);
    y += 5;

    if (project.dateStarted) {
      doc.text(`Date: ${this.shortDate(project.dateStarted)}`, 14, y);
      y += 6;
    }

    y += 4;

    // Main chart
    const chartLeft = 18;
    const chartWidth = pageWidth - 36;
    const chartTop = y;
    const chartHeight = 55;

    doc.setDrawColor(200);
    doc.rect(chartLeft, chartTop, chartWidth, chartHeight);
    doc.setFontSize(10);
    doc.text('Velocity vs Charge (RAW SHOTS)', chartLeft, chartTop - 3);

    const n = entries.length;
    const innerPadX = 10;
    const usableWidth = Math.max(chartWidth - innerPadX * 2, 0);
    const xStep = n > 1 ? usableWidth / (n - 1) : 0;

    const palette = [
      { r: 255, g: 99, b: 132 },
      { r: 54, g: 162, b: 235 },
      { r: 255, g: 206, b: 86 },
      { r: 75, g: 192, b: 192 },
      { r: 153, g: 102, b: 255 }
    ];

    entries.forEach((entry, i) => {
      const any = entry as any;
      const values = this.parseVelocityInput(any.velocityInput);
      if (!values.length) return;

      const baseX = chartLeft + innerPadX + i * xStep;
      const colour = palette[i % palette.length];

      doc.setDrawColor(colour.r, colour.g, colour.b);
      doc.setFillColor(colour.r, colour.g, colour.b);

      let minY: number | null = null;
      let maxY: number | null = null;
      let sum = 0;

      values.forEach(v => {
        const yVal =
          chartTop + chartHeight - ((v - minV) / rangeV) * chartHeight;

        doc.circle(baseX, yVal, 0.7, 'F');

        const label = String(Math.round(v));
        doc.setFontSize(7);
        doc.text(label, baseX + 1.5, yVal - 1.5);

        sum += v;

        minY = minY === null ? yVal : Math.min(minY, yVal);
        maxY = maxY === null ? yVal : Math.max(maxY, yVal);
      });

      if (minY !== null && maxY !== null && maxY > minY) {
        const centerY = (minY + maxY) / 2;
        const radius = (maxY - minY) / 2 + 1.5;

        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.3);
        doc.circle(baseX, centerY, radius, 'S');
      }

      if (typeof any.groupSize === 'number' && any.groupSize > 0) {
        const maxGroupVisual = 12;
        const groupVisual = Math.min(any.groupSize, maxGroupVisual);

        doc.setLineWidth(2);
        doc.setDrawColor(colour.r, colour.g, colour.b);

        doc.line(
          baseX,
          chartTop + chartHeight + 6,
          baseX,
          chartTop + chartHeight + 6 + groupVisual
        );
      }

      if (any.poiNote) {
        doc.setFontSize(7);
        doc.setTextColor(colour.r, colour.g, colour.b);

        const poiText = `POI: ${any.poiNote}`;
        const textWidth = doc.getTextWidth(poiText);

        doc.text(poiText, baseX - textWidth / 2, chartTop - 5);
        doc.setTextColor(0, 0, 0);
      }

      if (i > 0) {
        const prevEntry = entries[i - 1] as any;
        const prevValues = this.parseVelocityInput(prevEntry.velocityInput);

        if (prevValues.length) {
          const prevAvg =
            prevValues.reduce((a: number, b: number) => a + b, 0) /
            prevValues.length;
          const currAvg = sum / values.length;

          const prevX = chartLeft + innerPadX + (i - 1) * xStep;
          const currX = baseX;

          const prevY =
            chartTop +
            chartHeight -
            ((prevAvg - minV) / rangeV) * chartHeight;

          const currY =
            chartTop +
            chartHeight -
            ((currAvg - minV) / rangeV) * chartHeight;

          doc.setLineWidth(0.6);
          doc.setDrawColor(colour.r, colour.g, colour.b);
          doc.line(prevX, prevY, currX, currY);
        }
      }

      if (typeof any.chargeGr === 'number') {
        const chargeText = any.chargeGr.toFixed(1);
        doc.text(
          chargeText,
          baseX - doc.getTextWidth(chargeText) / 2,
          chartTop + chartHeight + 4
        );
      }
    });

    y = chartTop + chartHeight + 16;

    const tableBody = entries.map((entry: any, idx: number) => {
      const stats = this.statsForEntry(entry);
      return [
        idx + 1,
        entry.chargeGr ?? '',
        stats?.avg ? Math.round(stats.avg) : '',
        stats?.es ?? '',
        stats?.sd ? stats.sd.toFixed(3) : '',
        entry.shotsFired ?? ''
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [['#', 'Charge (gr)', 'Avg', 'ES', 'SD', 'Shots']],
      body: tableBody,
      styles: { fontSize: 8 }
    });

    const filename =
      (project.name || 'load-development')
        .toString()
        .replace(/[^a-z0-9\-]+/gi, '_') + '.pdf';

    if (Capacitor.isNativePlatform()) {
      this.savePdfNative(doc, filename);
    } else {
      doc.save(filename);
    }
  }

  // ---------- entry CRUD ----------

  cancelEntryForm(): void {
    this.entryFormVisible = false;
    this.editingEntry = null;
    this.entryForm = this.createEmptyEntryForm();
  }

  saveEntry(): void {
    if (!this.selectedProject) return;

    const f = this.entryForm;

    const payload: any = {
      loadLabel: f.loadLabel || undefined,
      powder: f.powder || undefined,
      chargeGr: f.chargeGr ?? undefined,
      coal: f.coal || undefined,
      primer: f.primer || undefined,
      bullet: f.bullet || undefined,
      bulletWeightGr: f.bulletWeightGr ?? undefined,
      bulletBc: f.bulletBc || undefined,
      distanceM: f.distanceM ?? undefined,
      shotsFired: f.shotsFired ?? undefined,
      groupSize: f.groupSize ?? undefined,
      groupUnit: f.groupUnit,
      poiNote: f.poiNote || undefined,
      notes: f.notes || undefined,
      velocityInput: f.velocityInput.trim() || undefined
    };

    if (this.editingEntry) {
      const updated = { ...this.editingEntry, ...payload };
      this.data.updateLoadDevEntry(this.selectedProject.id, updated);
    } else {
      const existing = this.selectedProject.entries ?? [];
      const newId = existing.length
        ? Math.max(...existing.map(x => x.id)) + 1
        : 1;
      const newEntry: LoadDevEntry = { id: newId, ...payload };
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
    const list = [...this.selectedProject.entries];

    switch (this.entrySortMode) {
      case 'chargeAsc':
        return list.sort(
          (a, b) => (a.chargeGr ?? 9999) - (b.chargeGr ?? 9999)
        );
      case 'groupAsc':
        return list.sort(
          (a, b) => (a.groupSize ?? 9999) - (b.groupSize ?? 9999)
        );
      case 'groupDesc':
        return list.sort(
          (a, b) => (b.groupSize ?? -9999) - (a.groupSize ?? -9999)
        );
      default:
        return list;
    }
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
    const variance =
      values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / n;
    const sd = Math.sqrt(variance);

    return { avg, es, sd, n };
  }

  private computeSimpleSd(values: number[]): number {
    if (!values.length) return 0;
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance =
      values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    return Math.sqrt(variance);
  }

  // ---------- node detection & colouring ----------

  private computeNodesForSelectedProject(): Map<number, number> {
    const map = new Map<number, number>();
    const project = this.selectedProject;

    if (!project || project.type !== 'ladder') {
      return map;
    }

    const entries = project.entries ?? [];
    if (entries.length < 3) {
      return map;
    }

    const withStats: NodeEntry[] = entries
      .map(e => {
        const stats = this.statsForEntry(e);
        return stats ? { entry: e, stats } : null;
      })
      .filter((x): x is NodeEntry => !!x);

    if (withStats.length < 3) {
      return map;
    }

    const sorted = [...withStats].sort(
      (a, b) => (a.entry.chargeGr ?? 9999) - (b.entry.chargeGr ?? 9999)
    );

    const NODE_SD_THRESHOLD = 10;
    const groups: number[][] = [];
    let i = 0;

    while (i + 2 < sorted.length) {
      let window = [sorted[i], sorted[i + 1], sorted[i + 2]];
      let vals = window.map(w => w.stats.avg);
      let sd = this.computeSimpleSd(vals);

      if (sd >= NODE_SD_THRESHOLD) {
        i++;
        continue;
      }

      let j = i + 3;
      while (j < sorted.length) {
        const extended = [...window, sorted[j]];
        const extVals = extended.map(w => w.stats.avg);
        const extSd = this.computeSimpleSd(extVals);

        if (extSd < NODE_SD_THRESHOLD) {
          window = extended;
          vals = extVals;
          sd = extSd;
          j++;
        } else {
          break;
        }
      }

      const ids = window.map(w => w.entry.id);
      groups.push(ids);

      i = j;
    }

    groups.forEach((ids, index) => {
      ids.forEach(id => map.set(id, index));
    });

    return map;
  }

  nodeCssClass(entry: LoadDevEntry) {
    const map = this.computeNodesForSelectedProject();
    const idx = entry && entry.id != null ? map.get(entry.id) : undefined;

    if (idx == null) {
      return {};
    }

    return {
      'bg-black text-white ring-4 ring-[#00ff00] shadow-[0_0_12px_#00ff00]':
        idx === 0,
      'bg-black text-white ring-4 ring-[#ff9900] shadow-[0_0_12px_#ff9900]':
        idx === 1,
      'bg-black text-white ring-4 ring-[#ff0000] shadow-[0_0_12px_#ff0000]':
        idx === 2
    };
  }

  // ---------- helpers for wizard / velocity input ----------

  allEntriesHaveVelocity(): boolean {
    if (!this.selectedProject || !this.selectedProject.entries?.length) {
      return false;
    }

    return this.selectedProject.entries.every(e => {
      const any = e as any;
      const values = this.parseVelocityInput(any.velocityInput);
      return values.length > 0;
    });
  }

  private appendVelocityToEntry(entry: LoadDevEntry, value: number): void {
    if (!this.selectedProject) return;

    const any = entry as any;
    const existing = this.parseVelocityInput(any.velocityInput);
    const updated = [...existing, value];

    any.velocityInput = updated.join(' ');
    entry.shotsFired = updated.length;

    this.data.updateLoadDevEntry(this.selectedProject.id, entry);
    this.refreshSelectedProject();
  }

  // ---------- graph data ----------

  private rebuildGraphData(): void {
    this.graphCoords = [];
    this.graphSvgPoints = '';
    this.graphMinVel = 0;
    this.graphMaxVel = 0;

    if (!this.selectedProject || !this.selectedProject.entries?.length) {
      return;
    }

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
    const coords: {
      x: number;
      y: number;
      charge: number;
      avg: number;
    }[] = [];

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

    if (
      this.selectedProject.type !== 'ladder' &&
      this.selectedProject.type !== 'ocw'
    ) {
      alert(
        'The velocity wizard is only available for ladder and OCW developments.'
      );
      return;
    }

    if (this.allEntriesHaveVelocity()) {
      alert(
        'All steps already have velocities. Use the Edit buttons for changes.'
      );
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

    const currentIndex = sorted.findIndex(
      e => e.id === this.velocityEditEntry!.id
    );

    if (currentIndex < 0 || currentIndex + 1 >= sorted.length) {
      this.finishLadderWizard();
      return;
    }

    this.ladderWizardEntries = sorted;
    this.ladderWizardIndex = currentIndex + 1;
    this.velocityEditEntry = sorted[this.ladderWizardIndex];
    const any = this.velocityEditEntry as any;
    this.velocityEditValue = any.velocityInput ?? '';
  }

  saveVelocityAndNext(): void {
    if (!this.selectedProject || !this.velocityEditEntry) return;

    const raw = this.velocityEditValue ?? '';
    const trimmed = raw.toString().trim();

    if (trimmed) {
      const values = this.parseVelocityInput(trimmed);
      if (!values.length) {
        alert(
          'Enter one or more numeric velocities, separated by spaces or commas.'
        );
        return;
      }

      if (this.selectedProject.type === 'ocw') {
        const plannedShots =
          this.velocityEditEntry.shotsFired ??
          this.planner.shotsPerGroup ??
          null;

        if (plannedShots && values.length !== plannedShots) {
          alert(
            `You planned ${plannedShots} shots for this charge. Enter exactly ${plannedShots} velocities, or leave the field blank and press Skip if you have not shot this group yet.`
          );
          return;
        }
      }

      const any = this.velocityEditEntry as any;
      any.velocityInput = values.join(' ');
      this.velocityEditEntry.shotsFired = values.length;

      this.data.updateLoadDevEntry(
        this.selectedProject.id,
        this.velocityEditEntry
      );
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
      this.data.updateLoadDevEntry(
        this.selectedProject.id,
        this.velocityEditEntry
      );
      this.refreshSelectedProject();
      this.singleVelocityEditActive = false;
      this.cancelVelocityEdit();
      return;
    }

    const values = this.parseVelocityInput(trimmed);
    if (!values.length) {
      alert(
        'Enter one or more numeric velocities, separated by spaces or commas.'
      );
      return;
    }

    const any = this.velocityEditEntry as any;
    any.velocityInput = values.join(' ');
    this.velocityEditEntry.shotsFired = values.length;

    this.data.updateLoadDevEntry(
      this.selectedProject.id,
      this.velocityEditEntry
    );
    this.refreshSelectedProject();

    this.singleVelocityEditActive = false;
    this.cancelVelocityEdit();
  }

  cancelSingleVelocityEdit(): void {
    this.singleVelocityEditActive = false;
    this.cancelVelocityEdit();
  }

  private cancelVelocityEdit(): void {
    if (this.ladderWizardActive) {
      this.finishLadderWizard();
    } else {
      this.velocityEditEntry = null;
      this.velocityEditValue = '';
    }
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
      this.ocwValidationWarning =
        'No velocities captured yet for OCW groups.';
      return;
    }

    const shotCounts = new Set<number>();
    for (const e of entriesWithVel) {
      const any = e as any;
      const vals = this.parseVelocityInput(any.velocityInput);
      const n = e.shotsFired ?? vals.length;
      if (n > 0) shotCounts.add(n);
    }

    if (shotCounts.size > 1) {
      this.ocwValidationWarning =
        'OCW groups do not all have the same number of shots. For good OCW analysis, keep group sizes consistent (e.g. 3 or 5 shots per charge).';
    } else {
      this.ocwValidationWarning = null;
    }
  }

  isProjectComplete(project: LoadDevProject): boolean {
    if (!project.entries || !project.entries.length) {
      return false;
    }

    return project.entries.every(e => {
      const any = e as any;
      const vals = this.parseVelocityInput(any.velocityInput);
      return vals.length > 0;
    });
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
  }
}
