import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypowWorkbench, PosterCanvas } from '..';
import { TYPOW_POEM } from '../../templates';
import { renderTemplate, type EditorState } from '../../engine';

vi.mock('../../engine', () => ({ renderTemplate: vi.fn() }));

const state: EditorState = {
  photos: new Map(),
  transforms: new Map(),
  texts: new Map(),
  cutouts: [],
  textureStyles: [],
};
let host: HTMLDivElement;
let root: Root;
let desktop = false;
const prepareFonts = () => Promise.resolve();
const button = (label: string) =>
  [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label || node.getAttribute('aria-label') === label,
  )!;
const click = async (node: HTMLElement) => {
  await act(async () => {
    node.focus();
    node.click();
  });
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  desktop = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: desktop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mountWorkbench = async () => {
  await act(async () => root.render(<TypowWorkbench prepareFonts={prepareFonts} />));
};

describe('S1/S2 workbench', () => {
  it('redraws the same canvas when fonts finish, and keeps export metadata outside it', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    vi.mocked(renderTemplate).mockClear();
    let ready!: () => void;
    const fonts = new Promise<void>((resolve) => {
      ready = resolve;
    });
    await act(async () => root.render(<TypowWorkbench prepareFonts={() => fonts} />));
    const canvas = host.querySelector('canvas');
    const draws = vi.mocked(renderTemplate).mock.calls.length;
    await act(async () => ready());
    expect(vi.mocked(renderTemplate).mock.calls.length).toBeGreaterThan(draws);
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(host.querySelector('h1')?.textContent).toBe('Poetry Wallpaper');
  });
  it('keeps one dock, region, file input and canvas through grouping and close', async () => {
    await mountWorkbench();
    const canvas = host.querySelector('canvas');
    const file = host.querySelector('input[type=file]');
    expect(file).not.toBeNull();
    expect(host.querySelectorAll('nav[aria-label="编辑工具"]')).toHaveLength(1);
    expect(host.querySelectorAll('[role=region]')).toHaveLength(1);
    await click(button('照片'));
    await click(button('文字'));
    const field = host.querySelector<HTMLInputElement>('input:not([type=file])')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(field, 'keep this poem');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('风格'));
    await click(button('文字'));
    expect(host.querySelector<HTMLInputElement>('input:not([type=file])')!.value).toBe(
      'keep this poem',
    );
    await click(button('收起面板'));
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(host.querySelector('input[type=file]')).toBe(file);
    expect(host.querySelectorAll('input[type=file]')).toHaveLength(1);
  });

  it('opens with a labelled region, Escape hides immediately and returns focus without locking background', async () => {
    await mountWorkbench();
    const trigger = button('文字');
    await click(trigger);
    const region = host.querySelector<HTMLElement>('[role=region]')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(region.id);
    expect(region.querySelector('h2')?.id).toBe(region.getAttribute('aria-labelledby'));
    expect(document.activeElement).toBe(region);
    host.querySelector<HTMLInputElement>('input:not([type=file])')!.focus();
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(region.hidden).toBe(true);
    expect(region.style.display).toBe('none');
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('main')?.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).not.toBe('hidden');
    await click(trigger);
    await click(button('收起面板'));
    expect(document.activeElement).toBe(trigger);
  });

  it('starts the desktop inspector in photo without duplicating controls', async () => {
    desktop = true;
    await mountWorkbench();
    expect(host.querySelector<HTMLElement>('[role=region]')!.hidden).toBe(false);
    expect(button('照片').getAttribute('aria-expanded')).toBe('true');
    expect(button('上传照片')).toBeTruthy();
    expect(host.querySelectorAll('input[type=file]')).toHaveLength(1);
  });

  it('updates available viewport geometry on resize/scroll and removes listeners on unmount', async () => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 640, width: 375, offsetTop: 0 });
    const add = vi.spyOn(viewport, 'addEventListener');
    const remove = vi.spyOn(viewport, 'removeEventListener');
    vi.stubGlobal('visualViewport', viewport);
    await mountWorkbench();
    const workbench = host.firstElementChild as HTMLElement;
    expect(workbench.style.getPropertyValue('--workbench-height')).toBe('640px');
    Object.assign(viewport, { height: 320, width: 360, offsetTop: 88 });
    await act(async () => {
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    });
    expect(workbench.style.getPropertyValue('--workbench-height')).toBe('320px');
    expect(workbench.style.getPropertyValue('--workbench-width')).toBe('360px');
    expect(workbench.style.getPropertyValue('--workbench-offset-top')).toBe('88px');
    expect(workbench.dataset.compact).toBe('true');
    await act(async () => root.unmount());
    for (const [event, listener] of add.mock.calls)
      expect(remove).toHaveBeenCalledWith(event, listener);
    root = createRoot(host);
    vi.stubGlobal('visualViewport', undefined);
    await mountWorkbench();
    expect(
      (host.firstElementChild as HTMLElement).style.getPropertyValue('--workbench-height'),
    ).toBe('');
  });
});

describe('S1 canvas conditional interaction', () => {
  it('lets an ordinary preview scroll, and enables zoom only with its callback', async () => {
    await act(async () => root.render(<PosterCanvas template={TYPOW_POEM} state={state} />));
    const canvas = host.querySelector('canvas')!;
    expect(canvas.style.touchAction).toBe('auto');
    expect(canvas.style.cursor).toBe('default');
    const previewWheel = new WheelEvent('wheel', { deltaY: 10, cancelable: true, bubbles: true });
    canvas.dispatchEvent(previewWheel);
    expect(previewWheel.defaultPrevented).toBe(false);
    const zoom = vi.fn();
    const remove = vi.spyOn(canvas, 'removeEventListener');
    await act(async () =>
      root.render(<PosterCanvas template={TYPOW_POEM} state={state} onPhotoZoom={zoom} />),
    );
    const wheel = new WheelEvent('wheel', { deltaY: 10, cancelable: true, bubbles: true });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(zoom).toHaveBeenCalledWith(0.95);
    await act(async () => root.render(<PosterCanvas template={TYPOW_POEM} state={state} />));
    expect(remove).toHaveBeenCalledWith('wheel', expect.any(Function));
    const after = new WheelEvent('wheel', { cancelable: true, bubbles: true });
    canvas.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('allows click-only pan-y, supports drag and clears it on pointercancel', async () => {
    const onClick = vi.fn();
    const drag = vi.fn();
    await act(async () =>
      root.render(<PosterCanvas template={TYPOW_POEM} state={state} onCanvasClick={onClick} />),
    );
    const canvas = host.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 200,
      width: 100,
      height: 200,
      toJSON: () => ({}),
    });
    expect(canvas.style.touchAction).toBe('pan-y');
    const pointer = (name: string, x: number, y: number) =>
      canvas.dispatchEvent(
        new PointerEvent(name, { clientX: x, clientY: y, pointerId: 1, bubbles: true }),
      );
    pointer('pointerdown', 10, 20);
    pointer('pointerup', 10, 20);
    expect(onClick).toHaveBeenCalledWith(0.1, 0.1);
    await act(async () =>
      root.render(<PosterCanvas template={TYPOW_POEM} state={state} onPhotoDrag={drag} />),
    );
    expect(canvas.style.touchAction).toBe('none');
    pointer('pointerdown', 10, 20);
    pointer('pointermove', 20, 40);
    expect(drag).toHaveBeenCalledWith(0.1, 0.1);
    pointer('pointercancel', 20, 40);
    pointer('pointermove', 30, 60);
    expect(drag).toHaveBeenCalledTimes(1);
  });
});
