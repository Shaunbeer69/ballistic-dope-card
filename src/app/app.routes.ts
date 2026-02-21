import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Menu',
    loadComponent: () => import('./pages/menu/menu.page').then((m) => m.MenuPage),
  },

  {
    path: 'tools',
    title: 'Tools',
    loadComponent: () => import('./pages/tools/tools.page').then((m) => m.ToolsPage),
  },

  // Hubs
  {
    path: 'tools/utilities',
    title: 'Utilities',
    loadComponent: () => import('./pages/utilities/utilities.page').then((m) => m.UtilitiesPage),
  },
  {
    path: 'tools/settings',
    title: 'Settings',
    loadComponent: () => import('./pages/settings/settings.page').then((m) => m.SettingsPage),
  },

  // Utilities (each function has its own page)
  {
    path: 'tools/utilities/converter',
    title: 'Unit Converter',
    loadComponent: () =>
      import('./pages/utilities/converter/converter.page').then((m) => m.ConverterPage),
  },
  {
    path: 'tools/utilities/kestrel',
    title: 'Kestrel env',
    loadComponent: () => import('./pages/utilities/kestrel/kestrel.page').then((m) => m.KestrelPage),
  },
  {
    path: 'tools/utilities/targets',
    title: 'Targets',
    loadComponent: () => import('./pages/utilities/targets/targets.page').then((m) => m.TargetsPage),
  },
  {
    path: 'tools/utilities/backup',
    title: 'Backup',
    loadComponent: () => import('./pages/utilities/backup/backup.page').then((m) => m.BackupPage),
  },
  {
    path: 'tools/utilities/export',
    title: 'Export',
    loadComponent: () => import('./pages/utilities/export/export.page').then((m) => m.ExportPage),
  },
  {
    path: 'tools/utilities/documents',
    title: 'Documents',
    loadComponent: () =>
      import('./pages/utilities/documents/documents.page').then((m) => m.DocumentsPage),
  },
    {
    path: 'tools/wind-effect',
    title: 'Wind Effect',
    loadComponent: () =>
      import('./pages/wind-effect/wind-effect-tool.component').then(m => m.WindEffectToolComponent),
  },
  {
    path: 'load-dev',
    title: 'Load Development',
    loadComponent: () =>
      import('./pages/load-dev-tab/load-dev-tab.component').then(m => m.LoadDevTabComponent),
  },
    {
    path: 'rifles',
    title: 'Rifles',
    loadComponent: () =>
      import('./pages/rifles-tab/rifles-tab.component').then(m => m.RiflesTabComponent),
  },
  {
    path: 'venues',
    title: 'Venues',
    loadComponent: () =>
      import('./pages/venues-tab/venues-tab.component').then(m => m.VenuesTabComponent),
  },
  {
    path: 'session',
    title: 'Session',
    loadComponent: () =>
      import('./pages/session-tab/session-tab.component').then(m => m.SessionTabComponent),
  },
  {
    path: 'history',
    title: 'History',
    loadComponent: () =>
      import('./pages/history-tab/history-tab.component').then(m => m.HistoryTabComponent),
  },
  // Settings pages
  {
    path: 'tools/settings/preferences',
    title: 'Preferences',
    loadComponent: () =>
      import('./pages/settings/preferences/preferences.page').then((m) => m.PreferencesPage),
  },

  // Fallback
  { path: '**', redirectTo: '' },
];
