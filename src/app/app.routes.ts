import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Menu',
    loadComponent: () =>
      import('./pages/menu/menu.page').then(m => m.MenuPage),
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
    loadComponent: () =>
      import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'tools/settings',
    title: 'System & Settings',
    data: { panel: 'settings' },
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
