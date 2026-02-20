import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { DataService } from '../../../data.service';

type Prefs = {
  distanceUnit: 'm' | 'yd';
  velocityUnit: 'mps' | 'fps';
  loadDevOalUnit: 'mm' | 'in';
  loadDevBcModel: 'g7' | 'g1';
  temperatureUnit: 'c' | 'f';
  pressureUnit: 'hpa' | 'inhg' | 'mmhg' | 'kpa';
  windSpeedUnit: 'kmh' | 'mph' | 'ms' | 'kn';
  angleDisplay: 'clock' | 'degrees';
  scopeAdjust: 'mil' | 'moa';
};

@Component({
  selector: 'app-preferences-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './preferences.page.html',
})
export class PreferencesPage implements OnInit {
  private readonly router = inject(Router);
  private readonly dataService = inject(DataService);

  private readonly prefsKey = 'gs_prefs_v1';

  prefs: Prefs = {
    distanceUnit: 'm',
    velocityUnit: 'mps',
    loadDevOalUnit: 'mm',
    loadDevBcModel: 'g7',
    temperatureUnit: 'c',
    pressureUnit: 'hpa',
    windSpeedUnit: 'kmh',
    angleDisplay: 'clock',
    scopeAdjust: 'mil',
  };
  preferencesSavedMsg: string = '';

  ngOnInit(): void {
    this.loadPreferences();
  }

  back(): void {
    this.router.navigateByUrl('/tools');
  }

  saveAndBack(): void {
    this.savePreferences();

    // Persist subset to DataService preference store (used by other features)
    this.dataService.updatePreferences({
      loadDev: { oalUnit: this.prefs.loadDevOalUnit },
      onboarding: { completed: true },
    });

    this.back();
  }

  loadPreferences(): void {
      try {
        const raw = localStorage.getItem(this.prefsKey);
        if (!raw) return;

        const parsed: any = JSON.parse(raw);

        // Migration from old profile-style prefs
        if (parsed && typeof parsed === 'object' && !parsed.distanceUnit) {
          const units = (parsed.units ?? '').toString().toLowerCase();

          if (units === 'imperial') {
            parsed.distanceUnit = 'yd';
            parsed.velocityUnit = 'fps';
            parsed.temperatureUnit = 'f';
            parsed.pressureUnit = 'inhg';
            parsed.windSpeedUnit = 'mph';
            parsed.angleDisplay = 'clock';
            parsed.scopeAdjust = 'moa';
          } else {
            parsed.distanceUnit = 'm';
            parsed.velocityUnit = 'mps';
            parsed.temperatureUnit = 'c';
            parsed.pressureUnit = 'hpa';
            parsed.windSpeedUnit = 'kmh';
            parsed.angleDisplay = 'clock';
            parsed.scopeAdjust = 'mil';
          }
        }

        this.prefs = {
          distanceUnit: parsed.distanceUnit === 'yd' ? 'yd' : 'm',
          velocityUnit: parsed.velocityUnit === 'fps' ? 'fps' : 'mps',
          loadDevOalUnit:
            String(
              parsed.loadDevOalUnit ??
                parsed.loadDev?.oalUnit ??
                this.dataService.getDefaultLoadDevOalUnit?.(),
            ).toLowerCase() === 'in'
              ? 'in'
              : 'mm',
          loadDevBcModel: parsed.loadDevBcModel === 'g1' ? 'g1' : 'g7',

          temperatureUnit: parsed.temperatureUnit === 'f' ? 'f' : 'c',
          pressureUnit: ['hpa', 'inhg', 'mmhg', 'kpa'].includes(parsed.pressureUnit)
            ? parsed.pressureUnit
            : 'hpa',
          windSpeedUnit: ['kmh', 'mph', 'ms', 'kn'].includes(parsed.windSpeedUnit)
            ? parsed.windSpeedUnit
            : 'kmh',
          angleDisplay: parsed.angleDisplay === 'degrees' ? 'degrees' : 'clock',
          scopeAdjust: parsed.scopeAdjust === 'moa' ? 'moa' : 'mil',
        };
      } catch {
        // ignore parse errors
      }
    }

  savePreferences(): void {
      try {
        localStorage.setItem(this.prefsKey, JSON.stringify(this.prefs));
      } catch {
        // ignore storage failure for UX
      }
      // Also save Load Dev COAL/Ogive unit into the structured prefs used by components
      try {
        this.dataService.updatePreferences({
          loadDev: { oalUnit: this.prefs.loadDevOalUnit },
        });
      } catch {
        // ignore (keep UI save working even if storage blocked)
      }

      // Simple “Saved” feedback (no Capacitor Toast dependency)
      this.preferencesSavedMsg = 'Saved';
      setTimeout(() => (this.preferencesSavedMsg = ''), 1200);

      // Collapse/close the preferences panel
      this.closePreferences();
    }

    closePreferences(): void {
  this.router.navigate(['/tools']);
}
}
