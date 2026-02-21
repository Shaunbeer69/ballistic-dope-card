import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VenuesTab } from './venues-tab';

describe('VenuesTab', () => {
  let component: VenuesTab;
  let fixture: ComponentFixture<VenuesTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VenuesTab]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VenuesTab);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
