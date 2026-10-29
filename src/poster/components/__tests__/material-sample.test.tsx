import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MaterialSample } from '../MaterialSample';
import { TYPOW_POEM } from '../../templates';
import type { EditorState, Template } from '../../engine';

const { renderTemplate } = vi.hoisted(() => ({ renderTemplate: vi.fn() }));
vi.mock('../../engine', () => ({ renderTemplate }));
let host: HTMLDivElement;
let root: Root;
const load = vi.fn();
const context = {} as CanvasRenderingContext2D;
const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
const mount = async (props: Parameters<typeof MaterialSample>[0]) => {
  await act(async () => root.render(<MaterialSample {...props} />));
};
const remount = async (props: Parameters<typeof MaterialSample>[0]) => {
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount(props);
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  renderTemplate.mockReset();
  load.mockReset().mockRejectedValue(new Error('Font unavailable'));
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load, ready: Promise.resolve() },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,sample',
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor);
  else Reflect.deleteProperty(document, 'fonts');
});

it('renders a text-free background with the real recipe and caches independently of label', async () => {
  const props = {
    label: '材质 A',
    gradient: { from: '#123456', to: '#abcdef', mode: 'splitX' as const },
    texture: 'grain',
    className: 'sample',
  };
  await mount(props);
  expect(load).not.toHaveBeenCalled();
  expect(renderTemplate).toHaveBeenCalledTimes(1);
  const [ctx, template, state, width, height] = renderTemplate.mock.calls[0] as [
    CanvasRenderingContext2D,
    Template,
    EditorState,
    number,
    number,
  ];
  expect([ctx, width, height]).toEqual([context, 128, 80]);
  expect(template.layers).toEqual({ colorBlocks: [], photoSlots: [], texts: [] });
  expect(template.textures).toBe(TYPOW_POEM.textures);
  expect(state.photos).toEqual(new Map());
  expect(state.texts).toEqual(new Map());
  expect(state.cutouts).toEqual([]);
  expect(state).toMatchObject({ gradientOverride: props.gradient, textureStyles: ['grain'] });
  expect(state.fontOverride).toBeUndefined();
  expect(host.querySelector('img')?.getAttribute('alt')).toBe('');
  expect(host.querySelector('img')?.className).toBe('sample');
  expect(host.textContent).toBe('');
  await remount({ ...props, gradient: { ...props.gradient }, label: '再次挂载' });
  expect(renderTemplate).toHaveBeenCalledTimes(1);
  await mount({ ...props, texture: 'braille' });
  expect(renderTemplate).toHaveBeenCalledTimes(2);
  expect(renderTemplate.mock.calls[1][2].textureStyles).toEqual(['braille']);
  expect(renderTemplate.mock.calls[0][2].textureStyles).toEqual(['grain']);
});

it('uses only a full-frame pure background as the photo-material input', async () => {
  await mount({ label: '玻璃分条', photoMaterial: 'glassRefract' });
  expect(renderTemplate).toHaveBeenCalledTimes(2);
  const [, baseTemplate, baseState] = renderTemplate.mock.calls[0];
  expect(baseTemplate.layers).toEqual({ colorBlocks: [], photoSlots: [], texts: [] });
  expect(baseState.photos.size).toBe(0);
  const [, template, state] = renderTemplate.mock.calls[1];
  expect(template.layers.texts).toEqual([]);
  expect(template.layers.photoSlots).toEqual([
    { id: 'main-photo', rect: { x: 0, y: 0, w: 1, h: 1 }, effect: 'none' },
  ]);
  const source = state.photos.get('main-photo') as HTMLCanvasElement;
  expect(source).toBeInstanceOf(HTMLCanvasElement);
  expect([source.width, source.height]).toEqual([128, 80]);
  expect(state.texts.size).toBe(0);
  expect(state.photoMaterial).toBe('glassRefract');
  expect(load).not.toHaveBeenCalled();
});

it('retries drawing failures without caching them or showing visible error text', async () => {
  const props = { label: '绘制重试', texture: 'rippleTex' };
  renderTemplate.mockImplementationOnce(() => {
    throw new Error('draw failed');
  });
  await mount(props);
  expect(host.querySelector('[role=status] .sr-only')?.textContent).toBe('小样生成失败');
  expect(host.querySelector('img')).toBeNull();
  expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
  await remount(props);
  expect(host.querySelector('img')).not.toBeNull();
  expect(renderTemplate).toHaveBeenCalledTimes(2);
});
