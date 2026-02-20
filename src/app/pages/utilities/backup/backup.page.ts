import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

import { DataService } from '../../../data.service';

@Component({
  selector: 'app-backup-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './backup.page.html',
})
export class BackupPage {
  private readonly router = inject(Router);
  private readonly dataService = inject(DataService);

  back(): void {
    this.router.navigateByUrl('/tools');
  }

  async exportFullBackup(): Promise<void> {
    await this.exportLoadDevBackup(true);
  }

  async importBackup(): Promise<void> {
    await this.importBackupFromJson();
  }

  async exportLoadDevBackup(shareAfterSave: boolean = true): Promise<void> {
      // Export the REAL persisted store (includes nested data under every section)
      const payload = this.dataService.exportFullBackup?.();

      if (!payload?.store) {
        alert('Export failed: no store data found.');
        return;
      }

      const hasAnyData =
        (payload.store.rifles?.length ?? 0) +
          (payload.store.venues?.length ?? 0) +
          (payload.store.sessions?.length ?? 0) +
          (payload.store.loadDevProjects?.length ?? 0) >
        0;

      if (!hasAnyData) {
        alert('No data found – nothing to backup yet.');
        return;
      }

      // ✅ IMPORTANT: embed load-dev photos from Directory.Data into the JSON payload
      await this.attachLoadDevMediaToBackupPayload(payload);

      const json = JSON.stringify(payload, null, 2);
      const filename = 'gunstuff-full-backup-' + new Date().toISOString().slice(0, 10) + '.json';

      if (Capacitor.isNativePlatform()) {
        try {
          await Filesystem.requestPermissions();

          const path = filename;

          await Filesystem.writeFile({
            path,
            data: json,
            directory: Directory.Documents,
            encoding: Encoding.UTF8,
          });

          const { uri } = await Filesystem.getUri({
            path,
            directory: Directory.Documents,
          });

          if (shareAfterSave) {
            await Share.share({
              title: 'GS Backup',
              text: 'GS Ballistics backup file',
              url: uri,
            });

            alert('Backup saved. Choose an app (e.g. Files) to store or send it.');
          } else {
            alert('Backup saved to app Documents on this device.');
          }
        } catch (err) {
          console.error('Native backup export failed:', err);
          alert('Backup export failed on this device.');
        }
      } else {
        // Browser – download as a JSON file
        try {
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (err) {
          console.error('Browser backup export failed:', err);
          alert('Browser backup export failed.');
        }
      }
    }

  private async attachLoadDevMediaToBackupPayload(payload: any): Promise<void> {
      try {
        const projects: any[] = payload?.store?.loadDevProjects ?? [];
        if (!Array.isArray(projects) || projects.length === 0) return;

        payload.loadDevMedia = payload.loadDevMedia ?? {};
        payload.loadDevMedia.files = payload.loadDevMedia.files ?? {};

        const files: Record<string, { base64: string; mime: string }> = payload.loadDevMedia.files;

        const addPath = async (pathRaw: any, mimeRaw: any) => {
          const path = (pathRaw ?? '').toString().trim();
          if (!path) return;
          if (files[path]) return;

          const mime = (mimeRaw ?? 'image/jpeg').toString().trim() || 'image/jpeg';

          try {
            const res = await Filesystem.readFile({ path, directory: Directory.Data });
            const base64 = (res?.data ?? '').toString().trim();
            if (!base64) return;

            files[path] = { base64, mime };
          } catch {
            // ignore missing file on disk
          }
        };

        for (const p of projects) {
          // Project-level overview photo
          await addPath((p as any)?.targetPhotoPath, (p as any)?.targetPhotoMime);

          // Entry-level photos
          const entries: any[] = (p as any)?.entries ?? [];
          if (Array.isArray(entries)) {
            for (const e of entries) {
              const tp = (e as any)?.targetPhoto;
              await addPath(tp?.path, tp?.mime);
            }
          }
        }
      } catch {
        // no-throw export
      }
    }

  private async rehydrateLoadDevMediaFromImport(parsed: any): Promise<void> {
      try {
        const files: Record<string, { base64: string; mime?: string }> =
          parsed?.loadDevMedia?.files ?? {};

        const paths = Object.keys(files || {});
        if (!paths.length) return;

        for (const path of paths) {
          const item = files[path];
          const base64 = (item?.base64 ?? '').toString().trim();
          if (!base64) continue;

          try {
            await Filesystem.writeFile({
              path,
              data: base64,
              directory: Directory.Data,
              recursive: true,
            });
          } catch {
            // ignore write failures
          }
        }
      } catch {
        // no-throw import
      }
    }

  private async sha256Text(text: string): Promise<string> {
      const data = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

  private async importBackupFromJson(): Promise<void> {
      // Let user pick a .json file (works in browser + Capacitor WebView)
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';

      const file = await new Promise<File | null>((resolve) => {
        input.onchange = () => resolve(input.files && input.files.length ? input.files[0] : null);
        input.click();
      });

      if (!file) return;

      const text = await file.text();
      // --- Exact-file detection (content hash) ---
      let fileHash = '';
      try {
        fileHash = await this.sha256Text(text);
        const key = 'gs_import_hashes_v1';
        const prev = JSON.parse(localStorage.getItem(key) || '[]') as string[];
        const seen = new Set(prev);

        if (seen.has(fileHash)) {
          const again = confirm(
            'This exact backup file was already imported on this device.\n\n' +
              'OK = import anyway (merge again)\nCancel = stop',
          );
          if (!again) return;
        }
      } catch {
        // If hashing fails, do not block import
      }

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        alert('Import failed: selected file is not valid JSON.');
        return;
      }

      // Safety prompt (import overwrites local data)
      const ok = confirm(
        'Import will ADD/merge data into this device (it will not delete existing data).\n\nContinue?',
      );
      if (!ok) return;

      // ✅ NEW: add this ONE line (do not re-declare result)
      await this.rehydrateLoadDevMediaFromImport(parsed);

      const result = this.dataService.importFromBackupMerge(parsed);

      if (!result.ok) {
        alert(`Import failed: ${result.message}`);
        return;
      }

      // Refresh menus/counts
          // --- Remember imported file hash (last 50) ---
      if (fileHash) {
        const key = 'gs_import_hashes_v1';
        const prev = JSON.parse(localStorage.getItem(key) || '[]') as string[];
        const next = [fileHash, ...prev.filter((h) => h !== fileHash)].slice(0, 50);
        localStorage.setItem(key, JSON.stringify(next));
      }

      alert(`Import complete.\n\n${result.message}`);
    }
}
