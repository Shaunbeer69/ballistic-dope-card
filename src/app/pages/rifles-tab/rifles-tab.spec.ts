import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RiflesTab } from './rifles-tab';

describe('RiflesTab', () => {
  let component: RiflesTab;
  let fixture: ComponentFixture<RiflesTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RiflesTab]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RiflesTab);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
