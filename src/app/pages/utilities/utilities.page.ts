import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-utilities-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './utilities.page.html',
})
export class UtilitiesPage {}
