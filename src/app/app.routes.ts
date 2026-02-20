import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Menu',
    loadComponent: () =>
      import('./pages/menu/menu.page').then(m => m.MenuPage),
  },

  // Tools deep-links (must be BEFORE the hub routes; hub routes are pathMatch: 'full')
  {
    path: 'tools/utilities/converter',
    title: 'Unit Converter',
    data: { panel: 'utilities', tool: 'converter' },
    loadComponent: () =>
      import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'tools/utilities/kestrel',
    title: 'Kestrel env',
    data: { panel: 'utilities', tool: 'kestrel' },
    loadComponent: () =>
      import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'tools/utilities/targets',
    title: 'Target downloads',
    data: { panel: 'utilities', tool: 'targets' },
    loadComponent: () =>
      import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'tools/utilities/backup',
    title: 'Backup / Restore',
    data: { panel: 'utilities', tool: 'backup' },
    loadComponent: () =>
      import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'tools/utilities/export',
    title: 'Export File / PDF',
    data: { panel: 'utilities', tool: 'export' },
    loadComponent: () =>
      import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'tools/utilities/documents',
    title: 'Documents',
    data: { panel: 'utilities', tool: 'documents' },
    loadComponent: () =>
      import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'tools/settings/preferences',
    title: 'Preferences',
    data: { panel: 'settings', tool: 'preferences' },
    loadComponent: () =>
      import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'rifles',
    title: 'Rifles',
    loadComponent: () =>
      import('./rifles-tab/rifles-tab.component').then(m => m.RiflesTabComponent),
  },
  {
    path: 'venues',
    title: 'Venues',
    loadComponent: () =>
      import('./venues-tab/venues-tab.component').then(m => m.VenuesTabComponent),
  },
  {
    path: 'session',
    title: 'Session',
    loadComponent: () =>
      import('./session-tab/session-tab.component').then(m => m.SessionTabComponent),
  },
  {
    path: 'history',
    title: 'History',
    loadComponent: () =>
      import('./history-tab/history-tab.component').then(m => m.HistoryTabComponent),
  },
  {
    path: 'load-dev',
    title: 'Load Development',
    loadComponent: () =>
      import('./load-dev-tab/load-dev-tab.component').then(m => m.LoadDevTabComponent),
  },
  {
    path: 'tools/utilities',
    title: 'Utilities',
    data: { panel: 'utilities' },
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'tools/settings',
    title: 'System & Settings',
    data: { panel: 'settings' },
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'tools',
    title: 'Tools',
    loadComponent: () =>
      import('./pages/tools/tools.page').then(m => m.ToolsPage),
  },
  {
    path: 'tools/wind-effect',
    title: 'Wind Effect',
    loadComponent: () =>
      import('./wind-effect-tool.component').then(m => m.WindEffectToolComponent),
  },
  { path: '**', redirectTo: '' },
];
