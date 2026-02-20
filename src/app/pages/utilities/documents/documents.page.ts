import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FileOpener } from '@capacitor-community/file-opener';

@Component({
  selector: 'app-documents-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './documents.page.html',
})
export class DocumentsPage implements OnInit {
  private readonly router = inject(Router);

  private readonly documentsKey = 'gs_documents_v1';
  documents: Array<{ id: string; title: string; tags: string[]; link?: string | null; createdAt: number }> = [];

  documentsSearch = '';
  documentsSort: 'az' | 'za' | 'new' | 'old' = 'az';
  documentsListExpanded = false;

  ngOnInit(): void {
    this.loadDocuments();
  }

  back(): void {
    this.router.navigateByUrl('/tools');
  }

  loadDocuments(): void {
      try {
        const raw = localStorage.getItem(this.documentsKey);
        if (!raw) {
          this.documents = [];
          return;
        }
        const parsed = JSON.parse(raw);
        this.documents = Array.isArray(parsed) ? parsed : [];
      } catch {
        this.documents = [];
      }
    }

  saveDocuments(): void {
      try {
        localStorage.setItem(this.documentsKey, JSON.stringify(this.documents || []));
      } catch {
        // ignore storage failure
      }
    }
  addDocument(titleRaw: string, tagsRaw: string, linkRaw: string): void {
    const title = (titleRaw || '').trim();
    if (!title) return;

    const tags = (tagsRaw || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const link = (linkRaw || '').trim();

    const id = (crypto as any)?.randomUUID ? (crypto as any).randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);

    this.documents = [
      {
        id,
        title,
        tags,
        link: link || null,
        createdAt: Date.now(),
      },
      ...(this.documents || []),
    ];

    this.saveDocuments();
  }

  deleteDocument(id: string): void {
      this.documents = (this.documents || []).filter((d) => d.id !== id);
      this.saveDocuments();
    }

  toAbsoluteUrl(url: string): string {
      return url && url.includes('://') ? url : new URL(url || '', window.location.origin).toString();
    }

  sanitizeFileName(name: string): string {
      return (name || 'document')
        .trim()
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .slice(0, 80);
    }

  arrayBufferToBase64(buffer: ArrayBuffer): string {
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      let binary = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...Array.from(chunk));
      }
      return btoa(binary);
    }

  get filteredDocuments(): Array<{
      id: string;
      title: string;
      tags: string[];
      link?: string | null;
      createdAt: number;
    }> {
      const q = (this.documentsSearch || '').trim().toLowerCase();
      let items = [...(this.documents || [])];

      if (q) {
        items = items.filter((d) => {
          const t = (d.title || '').toLowerCase();
          const g = (d.tags || []).join(' ').toLowerCase();
          const l = (d.link || '').toLowerCase();
          return t.includes(q) || g.includes(q) || l.includes(q);
        });
      }

      items.sort((a, b) => {
        if (this.documentsSort === 'new') return (b.createdAt || 0) - (a.createdAt || 0);
        if (this.documentsSort === 'old') return (a.createdAt || 0) - (b.createdAt || 0);
        if (this.documentsSort === 'za') return (b.title || '').localeCompare(a.title || '');
        return (a.title || '').localeCompare(b.title || '');
      });

      return items;
    }

  get documentsHasSearch(): boolean {
      return (this.documentsSearch || '').trim().length > 0;
    }

  async openDocument(doc: {
      id: string;
      title: string;
      tags: string[];
      link?: string | null;
      createdAt: number;
    }): Promise<void> {
      if (!doc.link) {
        alert('No file link for this document.');
        return;
      }

      const rawLink = doc.link;
      const absoluteUrl = rawLink.includes('://')
        ? rawLink
        : new URL(rawLink, window.location.origin).toString();

      try {
        // Browser
        if (!Capacitor.isNativePlatform()) {
          window.open(absoluteUrl, '_blank');
          return;
        }

        // Native asset → write to cache
        const isAsset = rawLink.startsWith('assets/') || absoluteUrl.includes('/assets/');
        if (isAsset) {
          const response = await fetch(absoluteUrl, { cache: 'no-store' });
          if (!response.ok) throw new Error(`Document not found (${response.status})`);

          const blob = await response.blob();
          const base64 = await this.blobToBase64(blob);

          const filename = rawLink.split('/').pop() || 'document.pdf';
          const path = `gsdocs/${filename}`;

          await Filesystem.writeFile({
            path,
            data: base64,
            directory: Directory.Cache,
            recursive: true,
          });

          const uri = await Filesystem.getUri({ path, directory: Directory.Cache });

          // ✅ Open with Android system PDF viewer (FileOpener expects a filesystem path on many builds)
          const filePath = uri.uri.startsWith('file://') ? uri.uri.slice('file://'.length) : uri.uri;
          await FileOpener.open({ filePath, contentType: 'application/pdf' });

          return;
        }

        // Native non-asset
        window.open(absoluteUrl, '_blank');
      } catch (err) {
        console.error('openDocument failed', err);
        alert('Could not open document.');
      }
    }

  async shareDocument(doc: {
      id: string;
      title: string;
      tags: string[];
      link?: string | null;
      createdAt: number;
    }): Promise<void> {
      if (!doc.link) {
        alert('No file link for this document.');
        return;
      }

      const rawLink = doc.link;
      const absoluteUrl = rawLink.includes('://')
        ? rawLink
        : new URL(rawLink, window.location.origin).toString();

      try {
        // Native: if it's an app asset, save to Cache and share the file:// uri
        const isAsset = rawLink.startsWith('assets/') || absoluteUrl.includes('/assets/');
        if (Capacitor.isNativePlatform() && isAsset) {
          const response = await fetch(absoluteUrl, { cache: 'no-store' });
          if (!response.ok) throw new Error(`Document not found (${response.status})`);

          const blob = await response.blob();
          const base64 = await this.blobToBase64(blob);

          const filename = rawLink.split('/').pop() || 'document.pdf';

          await Filesystem.requestPermissions();

          const saved = await Filesystem.writeFile({
            path: filename,
            data: base64,
            directory: Directory.Cache,
          });

          await Share.share({
            title: doc.title,
            text: doc.title,
            url: saved.uri,
          });

          return;
        }

        // Browser OR non-asset link: share the absolute URL
        await Share.share({
          title: doc.title,
          text: doc.title,
          url: absoluteUrl,
        });
      } catch (err) {
        console.error('shareDocument failed', err);
        alert('Could not share document.');
      }
    }

    blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return reject(new Error('Unexpected FileReader result'));

      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };

    reader.readAsDataURL(blob);
  });
}
}
