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
import jsPDF from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

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

// ---- OCW graph data (screen) ----
interface OcwShotPoint {
  x: number;          // svg coords (0..100)
  y: number;          // svg coords (0..60)
  charge: number;
  v: number;
  entryId: number;
  shotIndex: number;  // 0..n-1
}

interface OcwGroupEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  charge: number;
  entryId: number;
}

@Component({
  selector: 'app-load-dev-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './load-dev-tab.component.html'
})
export class LoadDevTabComponent implements OnInit {
  @ViewChild('velocityInputEl') velocityInputEl?: ElementRef<HTMLInputElement>;
  @ViewChild('pdfContent') pdfContent?: ElementRef<HTMLElement>;

  @Output() backToMenu = new EventEmitter<void>();

  // ----------------------------
  // Focus / highlight behaviour
  // ----------------------------
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

  // ---- navigation back from history/footer button ----
  onBackFromHistory(): void {
    this.backToMenu.emit();
  }

  // ==========================
  // MIC (future feature only)
  // ==========================
  // Shown next to the MIC button in HTML (NOT the top banner)
  micInlineMessage: string | null = null;

  onMicFuture(event?: Event): void {
    try {
      event?.preventDefault();
      event?.stopPropagation();
    } catch {
      // ignore
    }

    // Future feature only — NO recording code.
    this.micInlineMessage = '🎤 Voice notes: coming soon';

    // Clear after a moment so it doesn’t stick
    setTimeout(() => {
      this.micInlineMessage = null;
    }, 2200);
  }

  // ---------- PDF export (Graph + table inside #pdfContent) ----------
  async exportPdf(): Promise<void> {
    try {
      if (!this.selectedProject) {
        alert('Select a load development first.');
        return;
      }

      // Always rebuild graph data for export (even if the UI graph is hidden)
      this.rebuildGraphData();

      // Export the graph if we have at least 2 points (a real line)
      // NOTE: We keep using graphCoords (avg line) for PDF to avoid breaking ladder export.
      const includeGraph = (this.graphCoords?.length ?? 0) >= 2;

      this.postSaveMessage = 'Building PDF...';

      const doc = new jsPDF({ unit: 'pt', format: 'a4' });

      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const marginTop = 28;
      const marginRight = 28;
      const holePunchOffset = 56; // ~20mm for file holes
      const marginLeft = 28 + holePunchOffset;
      let y = marginTop;

      // Header
      const rifleName =
        this.rifles?.find(r => r.id === this.selectedRifleId)?.name ??
        `Rifle ${this.selectedRifleId ?? ''}`;
      const projectName = this.selectedProject.name ?? 'Load development';

      doc.setFontSize(14);
      doc.text(`${projectName}`, marginLeft, y);
      y += 16;

      doc.setFontSize(10);
      doc.text(`Rifle: ${rifleName}`, marginLeft, y);
      y += 12;

      doc.text(`Type: ${this.projectTypeLabel(this.selectedProject.type)}`, marginLeft, y);
      y += 18;

      // ----- Graph (vector drawn) -----
      const isOcwProject = this.selectedProject.type === 'ocw';

      if (includeGraph) {
        const chartX = marginLeft;
        const chartW = pageW - marginLeft - marginRight;
        const chartH = 210;

        const chartY = y;
        y += chartH + 10;

        const innerPad = 8;
        const xMin = chartX + innerPad;
        const xMax = chartX + chartW - innerPad;
        const yMin = chartY + innerPad;
        const yMax = chartY + chartH - innerPad;

        // Frame
        doc.setLineWidth(1);
        doc.rect(chartX, chartY, chartW, chartH);

        doc.setFontSize(11);
        doc.text(isOcwProject ? 'OCW: velocities (all shots) vs charge' : 'Velocity vs charge', chartX, chartY - 6);

        let minXv = 0, maxXv = 1;
        let minYv = 0, maxYv = 1;

        if (isOcwProject && (this.ocwShotPoints?.length ?? 0) >= 2) {
          const xs = this.ocwShotPoints.map(p => p.charge);
          const ys = this.ocwShotPoints.map(p => p.v);
          minXv = Math.min(...xs);
          maxXv = Math.max(...xs);
          minYv = Math.min(...ys);
          maxYv = Math.max(...ys);
        } else {
          const xs = (this.graphCoords ?? []).map(p => p.x);
          const ys = (this.graphCoords ?? []).map(p => p.y);
          minXv = Math.min(...xs);
          maxXv = Math.max(...xs);
          minYv = Math.min(...ys);
          maxYv = Math.max(...ys);
        }

        const sx = (x: number) => xMin + ((x - minXv) / (maxXv - minXv || 1)) * (xMax - xMin);
        const sy = (yv: number) => yMax - ((yv - minYv) / (maxYv - minYv || 1)) * (yMax - yMin);

        // Plot
        if (isOcwProject) {
          // Scatter all shots
          doc.setLineWidth(0.6);

          for (const p of this.ocwShotPoints) {
            const px = Math.max(xMin, Math.min(xMax, sx(p.charge)));
            const py = Math.max(yMin, Math.min(yMax, sy(p.v)));
            doc.circle(px, py, 1.6, 'F');
          }

          // Avg line
          if ((this.graphCoords?.length ?? 0) >= 2) {
            doc.setLineWidth(1.5);
            for (let i = 0; i < this.graphCoords.length - 1; i++) {
              const a = this.graphCoords[i];
              const b = this.graphCoords[i + 1];
              doc.line(sx(a.x), sy(a.y), sx(b.x), sy(b.y));
            }
          }

          // Label a few things (min/max)
          doc.setFontSize(9);
          doc.text(`${minXv.toFixed(1)} gr`, chartX, chartY + chartH + 12);
          doc.text(`${maxXv.toFixed(1)} gr`, chartX + chartW - 45, chartY + chartH + 12);
          doc.text(`${Math.round(maxYv)} fps`, chartX + chartW - 55, chartY + 10);

          y += 26;
        } else {
          // Line plot
          doc.setLineWidth(1.5);
          for (let i = 0; i < this.graphCoords.length - 1; i++) {
            const a = this.graphCoords[i];
            const b = this.graphCoords[i + 1];
            doc.line(sx(a.x), sy(a.y), sx(b.x), sy(b.y));
          }

          doc.setFontSize(9);
          doc.text(`${minXv.toFixed(1)} gr`, chartX, chartY + chartH + 12);
          doc.text(`${maxXv.toFixed(1)} gr`, chartX + chartW - 45, chartY + chartH + 12);
          doc.text(`${Math.round(maxYv)} fps`, chartX + chartW - 55, chartY + 10);

          y += 26;
        }
      }

      // ----- Table (real data) -----
      const entries = this.entriesForSelectedProject();
      doc.setFontSize(11);
      doc.text('Data', marginLeft, y);
      y += 12;

      doc.setFontSize(9);

      const colsBase = isOcwProject
        ? ['Charge', 'Avg', 'SD', 'ES', 'Group']
        : ['Charge', 'Avg', 'Shots'];
      const cols = [...colsBase, 'Notes'];

      const tableLeft = marginLeft;
      const tableRight = pageW - marginRight;
      const availW = tableRight - tableLeft;

      const widths = isOcwProject
        ? [0.12, 0.12, 0.12, 0.12, 0.14, 0.38]
        : [0.16, 0.16, 0.12, 0.56];

      const colX: number[] = [];
      let cx = tableLeft;
      for (let i = 0; i < widths.length; i++) {
        colX.push(cx);
        cx += availW * widths[i];
      }

      const trunc = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

      cols.forEach((c, i) => doc.text(c, colX[i], y));
      y += 10;
      doc.setLineWidth(0.5);
      doc.line(marginLeft, y, pageW - marginRight, y);
      y += 12;

      const lineH = 12;

      for (const e of entries) {
        if (y > doc.internal.pageSize.getHeight() - 50) {
          doc.addPage();
          y = marginTop;
        }

        const s = this.statsForEntry(e);

        doc.text(`${e.chargeGr ?? ''}`, colX[0], y);
        doc.text(s ? `${Math.round(s.avg)}` : '—', colX[1], y);

        if (isOcwProject) {
          doc.text(s ? `${s.sd.toFixed(1)}` : '—', colX[2], y);
          doc.text(s ? `${Math.round(s.es)}` : '—', colX[3], y);
          doc.text(this.formatGroupSize(e), colX[4], y);
        } else {
          doc.text(`${(e as any).shotsFired ?? '—'}`, colX[2], y);
        }

        // Notes (single-line, truncated so it doesn't overflow)
        const notesRaw = (e as any).notes ?? '';
        const notesCol = isOcwProject ? 5 : 3;
        const notesTxt = trunc(String(notesRaw ?? ''), 70);
        (doc as any).text(notesTxt, colX[notesCol], y, { maxWidth: tableRight - colX[notesCol] });

        y += lineH;
      }

      // ----- Extra space for handwritten notes (filed / printed) -----
      y += 10;
      if (y > pageH - 220) {
        doc.addPage();
        y = marginTop;
      }

      doc.setFontSize(11);
      doc.text('Comments', marginLeft, y);
      y += 10;

      doc.setLineWidth(0.3);
      const commentLineGap = 14;
      for (let i = 0; i < 15; i++) {
        doc.line(marginLeft, y + i * commentLineGap, pageW - marginRight, y + i * commentLineGap);
      }
      y += 15 * commentLineGap + 8;

      const safe = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

      const fileName = `loaddev-${safe(rifleName)}-${safe(projectName)}.pdf`;
      const pdfBase64 = doc.output('datauristring').split(',')[1];

      if (Capacitor.isNativePlatform()) {
        const res = await Filesystem.writeFile({
          path: fileName,
          data: pdfBase64,
          directory: Directory.Documents
        });

        await Share.share({
          title: 'Load development PDF',
          text: fileName,
          url: res.uri
        });

        this.postSaveMessage = 'Saved & shared ✅';
        setTimeout(() => (this.postSaveMessage = null), 2000);
      } else {
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        this.postSaveMessage = 'Downloaded ✅';
        setTimeout(() => (this.postSaveMessage = null), 2000);
      }
    } catch (e) {
      console.error('PDF export failed', e);
      this.postSaveMessage = 'Export failed (check console).';
      setTimeout(() => (this.postSaveMessage = null), 4000);
    }
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

  // Post-save banner (top)
  postSaveMessage: string | null = null;

  // Ladder/OCW wizard
  ladderWizardActive = false;
  ladderWizardEntries: LoadDevEntry[] = [];
  ladderWizardIndex = 0;
  velocityEditEntry: LoadDevEntry | null = null;
  velocityEditValue: string | number = '';

  // Single-row velocity edit
  singleVelocityEditActive = false;

  // Graph (existing ladder/avg line)
  showGraph = false;
  graphCoords: { x: number; y: number; charge: number; avg: number }[] = [];
  graphSvgPoints = '';
  graphMinVel = 0;
  graphMaxVel = 0;

  // OCW shot scatter + group circles (screen)
  ocwShotPoints: OcwShotPoint[] = [];
  ocwGroupEllipses: OcwGroupEllipse[] = [];

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
        return `Ladder test: single shots with small powder charge steps. You look for a "flat spot" in velocity (low SD/ES) across 3 or more neighbouring charges – that usually indicates a stable node.`;
      case 'ocw':
        return `OCW (Optimal Charge Weight): 3–5 shot groups over a small charge window. You look for a range of charges where point of impact stays very similar while groups remain tight – that indicates a forgiving accuracy node.`;
      default:
        return null;
    }
  }

  toggleNotesPanel(): void {
    this.showNotesPanel = !this.showNotesPanel;
  }

  // Save notes for the currently selected project (called by HTML)
  saveSelectedProjectNotes(): void {
    if (!this.selectedProject) return;

    const notes = (this.selectedProject.notes ?? '').toString().trim();

    this.data.updateLoadDevProject({
      ...this.selectedProject,
      notes: notes || undefined
    });

    this.postSaveMessage = 'Notes saved ✅';
    setTimeout(() => (this.postSaveMessage = null), 2000);

    // Collapse notes after saving
    this.showNotesPanel = false;

    this.refreshSelectedProject();
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

    this.ocwShotPoints = [];
    this.ocwGroupEllipses = [];

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
    if (!this.graphCoords.length && !this.ocwShotPoints.length) this.showGraph = false;

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
    if (!this.graphCoords.length && !this.ocwShotPoints.length) this.showGraph = false;
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
    if (!this.graphCoords.length && !this.ocwShotPoints.length) this.showGraph = false;

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
        if (typeof any.powder === 'string' && any.powder.trim())
          powders.add(any.powder.trim());
        if (typeof any.bullet === 'string' && any.bullet.trim())
          bullets.add(any.bullet.trim());
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

    this.ocwShotPoints = [];
    this.ocwGroupEllipses = [];

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
const type: LoadDevType = (this.projectForm.type as LoadDevType) || 'ladder';
this.postSaveMessage = null;

// ✅ ADD THIS GUARD (prevents empty ladder/ocw projects)
if (type === 'ladder' || type === 'ocw') {
  const { startChargeGr, endChargeGr, stepGr } = this.planner;

  if (startChargeGr == null || endChargeGr == null || stepGr == null || stepGr <= 0) {
    alert('Please enter Start, End and a positive Step to plan the ladder/OCW charges.');
    return;
  }
}
if (type === 'ladder' || type === 'ocw') {
  const { startChargeGr, endChargeGr } = this.planner;
  if (startChargeGr != null && endChargeGr != null && endChargeGr < startChargeGr) {
    alert('End charge must be greater than start charge.');
    return;
  }
}

    
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
          ? 'OCW planned and saved. Load and "Go Shoot" your groups, then come back here and use the OCW wizard or Edit buttons to enter velocities.'
          : 'Ladder test planned and saved. Load as per table: Go shoot the ladder, then come back here and use the wizard or Edit buttons to enter velocities and view the graph with node highlights.';
    }

    setTimeout(() => (this.postSaveMessage = null), 15000);

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

  // MUST be public (template calls this)
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

    switch (this.entrySortMode) {
      case 'chargeAsc':
        return list.sort((a, b) => (a.chargeGr ?? 0) - (b.chargeGr ?? 0));
      case 'groupAsc':
        return list.sort((a, b) => (a.groupSize ?? 0) - (b.groupSize ?? 0));
      case 'groupDesc':
        return list.sort((a, b) => (b.groupSize ?? 0) - (a.groupSize ?? 0));
      case 'default':
      default:
        return list.sort((a, b) => (a.chargeGr ?? 0) - (b.chargeGr ?? 0));
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

  // only fixes obvious paste duplication like "a b c a b c"
  private fixObviousRepeatedPaste(values: number[]): number[] {
    const n = values.length;
    if (n < 6) return values;

    for (const factor of [2, 3, 4]) {
      if (n % factor !== 0) continue;

      const chunkLen = n / factor;
      if (chunkLen < 3) continue;

      let ok = true;
      for (let f = 1; f < factor; f++) {
        for (let i = 0; i < chunkLen; i++) {
          if (values[i] !== values[f * chunkLen + i]) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }

      if (ok) return values.slice(0, chunkLen);
    }

    return values;
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

  private sortOcwEntriesBySd(entries: LoadDevEntry[]): LoadDevEntry[] {
    const sdCache = new Map<string, number>();
    const getSd = (e: LoadDevEntry): number => {
      const key = String((e as any).id ?? '');
      if (sdCache.has(key)) return sdCache.get(key)!;

      const s = this.statsForEntry(e)?.sd;
      const v =
        typeof s === 'number' && isFinite(s)
          ? s
          : Number.POSITIVE_INFINITY;

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

    const ranked = this.sortOcwEntriesBySd(this.selectedProject.entries ?? []).filter(
      e => {
        const s = this.statsForEntry(e)?.sd;
        return typeof s === 'number' && isFinite(s);
      }
    );

    if (ranked.length < 1) return null;

    const id = String((entry as any).id ?? '');
    if (id === String((ranked[0] as any).id ?? '')) return 'best';
    if (ranked.length >= 2 && id === String((ranked[1] as any).id ?? ''))
      return 'second';
    if (ranked.length >= 3 && id === String((ranked[2] as any).id ?? ''))
      return 'third';

    return null;
  }

  ocwSdCssClass(entry: LoadDevEntry): string {
    const r = this.ocwRankForEntry(entry);
    if (r === 'best') return 'bg-emerald-900/30 ring-1 ring-emerald-500/50';
    if (r === 'second') return 'bg-amber-900/25 ring-1 ring-amber-500/40';
    if (r === 'third') return 'bg-rose-900/25 ring-1 ring-rose-500/40';
    return '';
  }

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

    const entries = this.entriesForSelectedProject();
    const nodes = this.findNodes(entries);

    if (!nodes.length) return '';

    const idx = entries.findIndex(e => e.id === entry.id);
    if (idx < 0) return '';

    const nodeIndices = nodes
      .map(n => entries.findIndex(e => e.id === n.entry.id))
      .filter(i => i >= 0);

    const isInNodeBand = nodeIndices.some(i => Math.abs(i - idx) <= 1);

    return isInNodeBand
      ? 'bg-emerald-900/25 ring-1 ring-emerald-400/40'
      : '';
  }

  private allEntriesHaveVelocity(): boolean {
    if (!this.selectedProject?.entries?.length) return false;

    return this.selectedProject.entries.every(e => {
      const any = e as any;
      const values = this.parseVelocityInput(any.velocityInput);
      return values.length > 0;
    });
  }

  // ---- OCW shot plotting + group ellipses (ALL SHOTS) ----
  private buildOcwShotAndGroupGeometry(entries: LoadDevEntry[]): void {
    this.ocwShotPoints = [];
    this.ocwGroupEllipses = [];

    const groups: { entryId: number; charge: number; velocities: number[] }[] = [];

    for (const e of entries) {
      const charge = e.chargeGr;
      if (charge == null) continue;

      const any = e as any;
      const rawVals = this.parseVelocityInput(any.velocityInput);
      if (!rawVals.length) continue;

      const cleaned = this.fixObviousRepeatedPaste(rawVals);

      groups.push({
        entryId: (e as any).id ?? 0,
        charge,
        velocities: cleaned
      });
    }

    if (!groups.length) return;

    const charges = groups.map(g => g.charge);
    const minX = Math.min(...charges);
    const maxX = Math.max(...charges);

    const allVels: number[] = [];
    for (const g of groups) allVels.push(...g.velocities);

    let minV = Math.min(...allVels);
    let maxV = Math.max(...allVels);

    const padY = (maxV - minV) * 0.1 || 10;
    minV -= padY;
    maxV += padY;

    const x0 = 10;
    const x1 = 95;
    const yTop = 8;
    const yBot = 56;

    const sx = (charge: number) =>
      x0 + ((charge - minX) / (maxX - minX || 1)) * (x1 - x0);

    const sy = (v: number) =>
      yBot - ((v - minV) / (maxV - minV || 1)) * (yBot - yTop);

    const pts: OcwShotPoint[] = [];
    for (const g of groups) {
      const baseX = sx(g.charge);

      for (let i = 0; i < g.velocities.length; i++) {
        const v = g.velocities[i];

        const jitter = ((i % 7) - 3) * 0.75;
        const px = Math.max(x0, Math.min(x1, baseX + jitter));
        const py = Math.max(yTop, Math.min(yBot, sy(v)));

        pts.push({
          x: px,
          y: py,
          charge: g.charge,
          v,
          entryId: g.entryId,
          shotIndex: i
        });
      }
    }

    this.ocwShotPoints = pts;

    const ellipses: OcwGroupEllipse[] = [];
    for (const g of groups) {
      const gPts = pts.filter(p => p.entryId === g.entryId);
      if (!gPts.length) continue;

      let minPx = gPts[0].x, maxPx = gPts[0].x, minPy = gPts[0].y, maxPy = gPts[0].y;
      for (const p of gPts) {
        if (p.x < minPx) minPx = p.x;
        if (p.x > maxPx) maxPx = p.x;
        if (p.y < minPy) minPy = p.y;
        if (p.y > maxPy) maxPy = p.y;
      }

      const padX = 2.2;
      const padY2 = 2.8;

      const cx = (minPx + maxPx) / 2;
      const cy = (minPy + maxPy) / 2;
      const rx = Math.max(3.2, (maxPx - minPx) / 2 + padX);
      const ry = Math.max(3.2, (maxPy - minPy) / 2 + padY2);

      ellipses.push({
        cx,
        cy,
        rx,
        ry,
        charge: g.charge,
        entryId: g.entryId
      });
    }

    this.ocwGroupEllipses = ellipses;
  }

  private rebuildGraphData(): void {
    this.graphCoords = [];
    this.graphSvgPoints = '';
    this.graphMinVel = 0;
    this.graphMaxVel = 0;

    this.ocwShotPoints = [];
    this.ocwGroupEllipses = [];

    if (!this.selectedProject || !this.selectedProject.entries?.length) return;

    const entries = this.selectedProject.entries;

    const pts: { charge: number; avg: number }[] = [];

    for (const e of entries) {
      if (e.chargeGr == null) continue;
      const stats = this.statsForEntry(e);
      if (!stats) continue;
      pts.push({ charge: e.chargeGr, avg: stats.avg });
    }

    if (pts.length) {
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

    if (this.selectedProject.type === 'ocw') {
      const sorted = [...entries].sort((a, b) => (a.chargeGr ?? 9999) - (b.chargeGr ?? 9999));
      this.buildOcwShotAndGroupGeometry(sorted);
    }
  }

  toggleGraph(): void {
    const canShow = this.graphCoords.length > 0 || this.ocwShotPoints.length > 0;

    if (!canShow) {
      alert('No velocity data to graph yet.');
      return;
    }
    this.showGraph = !this.showGraph;
  }

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
      alert('All steps already have velocities. Use the Edit buttons for changes.');
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
      this.finishLadderWizard(true);
      return;
    }

    this.velocityEditEntry = this.ladderWizardEntries[this.ladderWizardIndex];
    const any = this.velocityEditEntry as any;
    this.velocityEditValue = any.velocityInput ?? '';

    this.focusVelocityInput(true);
  }

  private finishLadderWizard(showSavedToast = false): void {
    this.ladderWizardActive = false;
    this.velocityEditEntry = null;
    this.velocityEditValue = '';
    this.ladderWizardEntries = [];
    this.ladderWizardIndex = 0;

    if (showSavedToast) {
      this.postSaveMessage = 'Saved ✅';
      setTimeout(() => (this.postSaveMessage = null), 2000);
    }
  }

  private goToNextWizardEntry(): void {
    if (!this.selectedProject || !this.velocityEditEntry) {
      this.finishLadderWizard(false);
      return;
    }

    const sorted = [...(this.selectedProject.entries ?? [])].sort(
      (a, b) => (a.chargeGr ?? 9999) - (b.chargeGr ?? 9999)
    );

    const currentIndex = sorted.findIndex(e => e.id === this.velocityEditEntry!.id);

    if (currentIndex < 0 || currentIndex + 1 >= sorted.length) {
      this.finishLadderWizard(true);
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

      if (this.selectedProject.type === 'ocw') {
        const plannedShots =
          this.velocityEditEntry.shotsFired ?? this.planner.shotsPerGroup ?? null;

        if (plannedShots && values.length !== plannedShots) {
          alert(
            `You planned ${plannedShots} shots for this charge. Enter exactly ${plannedShots} velocities, or leave the field blank and press Skip if you have not shot this group yet.`
          );
          this.focusVelocityInput(true);
          return;
        }
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
    this.finishLadderWizard(false);
  }

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
        ? 'OCW groups do not all have the same number of shots. For good OCW analysis, keep group sizes consistent (e.g. 3 or 5 shots per charge).'
        : null;
  }

  isProjectComplete(project: LoadDevProject): boolean {
    if (!project.entries || !project.entries.length) return false;

    return project.entries.every(e => {
      const any = e as any;
      const vals = this.parseVelocityInput(any.velocityInput);
      return vals.length > 0;
    });
  }

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

    this.ocwShotPoints = [];
    this.ocwGroupEllipses = [];

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
















