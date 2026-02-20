import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

type Resource = { title: string; href: string; tag?: string };

@Component({
  selector: 'app-menu-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './menu.page.html',
})
export class MenuPage {
  resources: Resource[] = [
    { title: 'Acronyms', href: 'assets/documents/Acronyms.pdf', tag: 'PDF' },
    { title: 'Ladder Explained (GS)', href: 'assets/documents/Ladder_Explained_GS.pdf', tag: 'PDF' },
    { title: 'OCW Explained (GS)', href: 'assets/documents/OCW_Explained_GS.pdf', tag: 'PDF' },
    { title: 'Mirage Effects', href: 'assets/documents/Mirage_Effects5.pdf', tag: 'PDF' },
    { title: 'Seating Depth Explained (GS)', href: 'assets/documents/Seating_Depth_Explained_GS.pdf', tag: 'PDF' },
    { title: 'The Whole Shabang (GS)', href: 'assets/documents/The_Whole_Shabang_GS.pdf', tag: 'PDF' },
    { title: 'Wind Effects on Bullets', href: 'assets/documents/Wind_Effects_on_Bullets.pdf', tag: 'PDF' },
    { title: 'Load Development Workflow (GS)', href: 'assets/documents/Load_Development_Workflow_GS.pdf', tag: 'PDF' },
  ];
}
