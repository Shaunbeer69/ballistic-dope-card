import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FileOpener } from '@capacitor-community/file-opener';

@Component({
  selector: 'app-targets-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './targets.page.html',
})
export class TargetsPage {
  private readonly router = inject(Router);

  readonly TARGETS = [
    { id: 'ocw-ladder-a4', label: 'OCW / Ladder (A4)', file: 'assets/targets/ocw-ladder-a4.pdf' },
    { id: 'Target_Square_Green', label: 'Target Square Green', file: 'assets/targets/Target_Square_Green.pdf' },
    { id: 'Target_Square_Single', label: 'Target Square Single', file: 'assets/targets/Target_Square_Single.pdf' },
  ] as const;

  back(): void {
    this.router.navigateByUrl('/tools');
  }

  async downloadTarget(type: (typeof this.TARGETS)[number]['id']): Promise<void> {
    try {
      const t = this.TARGETS.find((x) => x.id === type);
      if (!t) throw new Error(`Unknown target type: ${type}`);

      const url = t.file;

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Target not found: ${url} (${response.status})`);

      const blob = await response.blob();
      const base64 = await this.blobToBase64(blob);

      const filename = url.split('/').pop() ?? `target-${type}.pdf`;

      await Filesystem.requestPermissions();

      const safeName = this.sanitizeFileName(filename.replace(/\.pdf$/i, ''));
      const cachePath = `gstargets/${safeName}.pdf`;

      await Filesystem.writeFile({
        path: cachePath,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      });

      const uri = await Filesystem.getUri({ path: cachePath, directory: Directory.Cache });
      const shareUrl = uri.uri;

      try {
        await Share.share({
          title: filename,
          text: 'Save this target to Downloads / Files',
          url: shareUrl,
        });
      } catch {
        const filePath = shareUrl.startsWith('file://') ? shareUrl.slice('file://'.length) : shareUrl;
        await FileOpener.open({ filePath, contentType: 'application/pdf' });
      }
    } catch (err) {
      console.error('downloadTarget failed', err);
      alert(`Download failed: ${(err as any)?.message ?? err}`);
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.onload = () => {
        const result = reader.result as string;
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(blob);
    });
  }

  private sanitizeFileName(name: string): string {
    return (name || 'document')
      .trim()
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 80);
  }
}
