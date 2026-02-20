import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { BleClient } from '@capacitor-community/bluetooth-le';

import { KestrelDataSnapshot, KestrelService } from '../../../shared/services/kestrel-bluetooth.service';

@Component({
  selector: 'app-kestrel-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kestrel.page.html',
})
export class KestrelPage implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  readonly kestrel = inject(KestrelService);

  kestrelData: KestrelDataSnapshot | null = null;
  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.kestrel.kestrelData$.subscribe((snapshot) => {
      this.kestrelData = snapshot;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async connect(): Promise<void> {
    try {
      await BleClient.initialize();
    } catch {
      // ignore
    }
    await this.kestrel.connectKestrelBluetooth();
    this.kestrelData = this.kestrel.kestrelData$.getValue();
  }

  async disconnect(): Promise<void> {
    await this.kestrel.disconnect();
    this.kestrelData = null;
  }

  back(): void {
    this.router.navigateByUrl('/tools');
  }
}
