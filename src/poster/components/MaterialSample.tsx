import { useEffect, useState } from 'react';
import { renderTemplate, type EditorState, type Template } from '../engine';
import { TYPOW_POEM } from '../templates';

type Recipe = {
  gradient?: EditorState['gradientOverride'];
  texture?: EditorState['textureStyles'][number];
  photoMaterial?: EditorState['photoMaterial'];
};
type Props = Recipe & { label: string; className?: string };
const samples = new Map<string, string>();
const width = 128;
const height = 80;
const template: Template = {
  ...TYPOW_POEM,
  id: 'material-sample',
  canvasW: width,
  canvasH: height,
  layers: { colorBlocks: [], photoSlots: [], texts: [] },
};

function sample(key: string): string {
  if (samples.has(key)) return samples.get(key)!;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const { gradient, texture, photoMaterial } = JSON.parse(key) as Recipe;
  const state: EditorState = {
    photos: new Map(),
    transforms: new Map(),
    texts: new Map(),
    cutouts: [],
    textureStyles: texture ? [texture] : [],
    gradientOverride: gradient,
    photoMaterial,
    mirrorWindow: 0.5,
  };
  let preview = template;
  if (photoMaterial && photoMaterial !== 'none') {
    const background = document.createElement('canvas');
    background.width = width;
    background.height = height;
    const backgroundCtx = background.getContext('2d');
    if (!backgroundCtx) throw new Error('Canvas unavailable');
    renderTemplate(backgroundCtx, template, { ...state, textureStyles: [] }, width, height);
    state.photos = new Map([['main-photo', background]]);
    preview = {
      ...template,
      layers: {
        ...template.layers,
        photoSlots: [{ id: 'main-photo', rect: { x: 0, y: 0, w: 1, h: 1 }, effect: 'none' }],
      },
    };
  }
  renderTemplate(ctx, preview, state, width, height);
  const src = canvas.toDataURL('image/png');
  samples.set(key, src);
  return src;
}

export function MaterialSample({ className, gradient, texture, photoMaterial }: Props) {
  const key = JSON.stringify({ gradient, texture, photoMaterial });
  const [result, setResult] = useState<{ key: string; src?: string; error?: boolean }>();
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => sample(key))
      .then(
        (src) => {
          if (active) setResult({ key, src });
        },
        () => {
          if (active) setResult({ key, error: true });
        },
      );
    return () => {
      active = false;
    };
  }, [key]);
  const current = result?.key === key ? result : undefined;
  return current?.src ? (
    <img src={current.src} alt="" width={width} height={height} className={className} />
  ) : (
    <span className={className} role="status" style={{ display: 'block', width, height }}>
      <span className="sr-only">{current?.error ? '小样生成失败' : '小样加载中'}</span>
    </span>
  );
}
