import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-tools-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './tools.page.html',
})
export class ToolsPage {}
