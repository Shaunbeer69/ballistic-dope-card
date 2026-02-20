import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { Location } from '@angular/common';
import { filter } from 'rxjs/operators';
import { APP_VERSION } from './environments/version';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  appTitle = 'GS Dope App';
  appSubtitle = 'Field log for rifles, venues & sessions';
  appVersion = APP_VERSION;
  title = 'Ballistic Dope Card';
  showBack = false;

  private previousUrl: string | null = null;
  private currentUrl: string = this.router.url;

  constructor() {


    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e) => {
        const nav = e as NavigationEnd;
        this.previousUrl = this.currentUrl;
        this.currentUrl = nav.urlAfterRedirects;
        this.syncTitleAndBack();
      });
    this.syncTitleAndBack();
  }

  back(): void {
    // Prefer in-app navigation history (avoids jumping out of the SPA on mobile PWAs).
    if (this.previousUrl && this.previousUrl !== this.currentUrl) {
      this.router.navigateByUrl(this.previousUrl);
      return;
    }

    // Fallback: try browser history; if none, go home.
    if (window.history.length > 1) this.location.back();
    else this.router.navigateByUrl('/');
  }

  private syncTitleAndBack(): void {
    let route = this.router.routerState.root;
    let title: unknown = undefined;

    while (route.firstChild) {
      route = route.firstChild;
      const t = route.snapshot.title;
      if (t) title = t;
    }

    this.title = (typeof title === 'string' && title.trim().length) ? title : 'Ballistic Dope Card';
    this.showBack = this.router.url !== '/' && this.router.url !== '';
  }
}
