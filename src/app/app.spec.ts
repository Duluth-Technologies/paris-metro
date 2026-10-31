import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the Paris map with initially unchecked network and walking controls', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.leaflet-container')).toBeTruthy();
    const controls = [...compiled.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(controls).toHaveLength(4);
    expect(controls.every((control) => !control.checked)).toBe(true);
    expect(compiled.querySelector('fieldset')?.textContent).toContain('Métro');
    expect(compiled.querySelector('fieldset')?.textContent).toContain('RER');
    expect(compiled.querySelector('fieldset')?.textContent).toContain('Tramway');
  });
});
