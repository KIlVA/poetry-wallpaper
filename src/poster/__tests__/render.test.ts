/**
 * 引擎自检：Poetry 确定性与布局；局部测试模板覆盖共享照片、切片和纸纹能力。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());
import { renderTemplate, type EditorState, type Template } from '../engine';
import { TYPOW_POEM } from '../templates';

// gradient/pattern stub 必须模块级共享：每个 mock 实例各建一个的话，
// 同输入两次渲染的调用序列结构相同但 stub 引用不同 → toEqual 判不等
const gradStub = { addColorStop: () => {} };

/** 记录全部方法调用与属性赋值的 mock 2D context */
function recordingCtx(
  measure?: (
    text: string,
    font: string,
  ) => Pick<TextMetrics, 'width' | 'actualBoundingBoxLeft' | 'actualBoundingBoxRight'>,
) {
  const calls: Array<[string, ...unknown[]]> = [];
  const store: Record<string, unknown> = { font: '10px sans-serif' };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (
        prop === 'createLinearGradient' ||
        prop === 'createRadialGradient' ||
        prop === 'createPattern'
      )
        return () => gradStub;
      if (prop === 'getImageData')
        return (_x: number, _y: number, width: number, height: number) => ({
          width,
          height,
          data: new Uint8ClampedArray(width * height * 4).fill(255),
        });
      if (prop === 'measureText')
        return (text: string) => measure?.(text, String(store.font)) ?? { width: 10 };
      if (prop in store) return store[prop];
      return (...args: unknown[]) => {
        calls.push([prop, ...args]);
        return undefined;
      };
    },
    set(_target, prop: string, value: unknown) {
      store[prop] = value;
      calls.push([prop, value]);
      return true;
    },
  };
  const ctx = new Proxy(
    {} as CanvasRenderingContext2D,
    handler as unknown as ProxyHandler<CanvasRenderingContext2D>,
  );
  return { ctx, calls };
}

function baseState(): EditorState {
  return {
    photos: new Map(),
    transforms: new Map(),
    texts: new Map(),
    cutouts: [],
    textureStyles: ['grain'],
  };
}

// 共享能力用局部模板验证，不依赖已退役的生产版式。
const TEST_TEMPLATE: Template = {
  id: 'render-test',
  name: '渲染测试',
  canvasW: 1024,
  canvasH: 1820,
  controls: [],
  textures: [{ style: 'paper', procedural: 'paper', opacity: 0.2, blend: 'multiply' }],
  layers: {
    colorBlocks: [],
    photoSlots: [{ id: 'main-photo', rect: { x: 0, y: 0, w: 1, h: 1 }, effect: 'none' }],
    texts: [],
  },
};

function photoState(): EditorState {
  const photo = document.createElement('canvas');
  photo.width = 100;
  photo.height = 100;
  return {
    ...baseState(),
    photos: new Map([['main-photo', photo]]),
    textureStyles: [],
  };
}

describe('renderTemplate 确定性', () => {
  it('积木预览和导出使用相同源网格与光照配方，换图不复用旧贴图', () => {
    const contexts = new Map<HTMLCanvasElement, ReturnType<typeof recordingCtx>>();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      function (this: HTMLCanvasElement) {
        if (!contexts.has(this)) contexts.set(this, recordingCtx());
        return contexts.get(this)!.ctx;
      },
    );
    const state = photoState();
    state.photoMaterial = 'brickMosaic';
    state.brickSize = 0.06;
    const preview = recordingCtx();
    const exported = recordingCtx();
    renderTemplate(preview.ctx, TEST_TEMPLATE, state, 640, 1138);
    renderTemplate(exported.ctx, TEST_TEMPLATE, state, 1290, 2293);
    const a = preview.calls.find(([name]) => name === 'drawImage')![1] as HTMLCanvasElement;
    const b = exported.calls.find(([name]) => name === 'drawImage')![1] as HTMLCanvasElement;
    expect(a).not.toBe(b);
    expect(contexts.get(a)!.calls).toEqual(contexts.get(b)!.calls);
    const next = photoState();
    next.photoMaterial = 'brickMosaic';
    const changed = recordingCtx();
    renderTemplate(changed.ctx, TEST_TEMPLATE, next, 640, 1138);
    expect(changed.calls.find(([name]) => name === 'drawImage')![1]).not.toBe(a);
  });

  it('积木像素读回失败时保留原照并报告回退，无照片仍能渲染', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          drawImage: () => {},
          getImageData: () => {
            throw new DOMException('像素读取被拒绝', 'SecurityError');
          },
        }) as unknown as CanvasRenderingContext2D,
    );
    const state = photoState();
    state.photoMaterial = 'brickMosaic';
    const { ctx, calls } = recordingCtx();
    expect(renderTemplate(ctx, TEST_TEMPLATE, state, 640, 1138)).toContain('已保留原图');
    expect(calls.find(([name]) => name === 'drawImage')![1]).toBe(state.photos.get('main-photo'));
    expect(
      renderTemplate(
        recordingCtx().ctx,
        TEST_TEMPLATE,
        { ...baseState(), photoMaterial: 'brickMosaic' },
        640,
        1138,
      ),
    ).toBeUndefined();
  });
  it('积木主图、转移切片和诗句嵌图共享处理结果，不再读取原照', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => recordingCtx().ctx,
    );
    const state = photoState();
    state.photoMaterial = 'brickMosaic';
    state.cutouts = [
      {
        id: 'brick-cut',
        shape: 'star',
        cx: 0.4,
        cy: 0.65,
        r: 0.1,
        sliceColor: '#13579b',
        transfer: { x: 0.7, y: 0.4, scale: 1 },
      },
    ];
    const { ctx, calls } = recordingCtx();
    renderTemplate(ctx, TYPOW_POEM, state, 640, 1138);
    const images = calls.filter(([name]) => name === 'drawImage');
    const source = images[0][1];
    expect(source).not.toBe(state.photos.get('main-photo'));
    expect(images.some(([, img]) => img === state.photos.get('main-photo'))).toBe(false);
    expect(images.filter(([, img]) => img === source).length).toBeGreaterThanOrEqual(3);
  });
  it('同一输入两次渲染调用序列完全一致（无随机源）', () => {
    const a = recordingCtx();
    const b = recordingCtx();
    renderTemplate(a.ctx, TYPOW_POEM, baseState(), 300, 533);
    renderTemplate(b.ctx, TYPOW_POEM, baseState(), 300, 533);
    expect(b.calls).toEqual(a.calls);
  });

  it('shard 路径非空，同 seed 可复现、不同 seed 改变顶点', () => {
    const state = photoState();
    state.cutouts = [
      { id: 's1', shape: 'shard', cx: 0.4, cy: 0.3, r: 0.15, seed: 42, sliceColor: '#13579b' },
    ];
    const a = recordingCtx();
    const b = recordingCtx();
    renderTemplate(a.ctx, TEST_TEMPLATE, state, 300, 533);
    renderTemplate(b.ctx, TEST_TEMPLATE, state, 300, 533);
    const path = a.calls.filter(([name]) => name === 'moveTo' || name === 'lineTo');
    expect(path.length).toBeGreaterThan(0);
    expect(b.calls).toEqual(a.calls);

    state.cutouts = state.cutouts.map((cutout) => ({ ...cutout, seed: 43 }));
    const different = recordingCtx();
    renderTemplate(different.ctx, TEST_TEMPLATE, state, 300, 533);
    expect(different.calls.filter(([name]) => name === 'moveTo' || name === 'lineTo')).not.toEqual(
      path,
    );
  });

  it('洞以 sliceColor 填充，且画在照片之后', () => {
    const state = photoState();
    state.cutouts = [{ id: 's1', shape: 'star', cx: 0.5, cy: 0.3, r: 0.2, sliceColor: '#13579b' }];
    const { ctx, calls } = recordingCtx();
    renderTemplate(ctx, TEST_TEMPLATE, state, 300, 533);
    const photoIndex = calls.findIndex(([name]) => name === 'drawImage');
    const colorIndex = calls.findIndex(
      ([name, value]) => name === 'fillStyle' && value === '#13579b',
    );
    expect(photoIndex).toBeGreaterThanOrEqual(0);
    expect(colorIndex).toBeGreaterThan(photoIndex);
    expect(calls[colorIndex + 1]).toEqual(['fill']);
  });

  it('转移块按指定位置、旋转和比例裁剪重绘照片', () => {
    const state = photoState();
    state.cutouts = [
      {
        id: 's1',
        shape: 'star',
        cx: 0.5,
        cy: 0.3,
        r: 0.2,
        sliceColor: '#13579b',
        transfer: { x: 0.7, y: 0.8, scale: 0.6 },
        transferRotation: 0.25,
      },
    ];
    const { ctx, calls } = recordingCtx();
    renderTemplate(ctx, TEST_TEMPLATE, state, 300, 533);
    const transferIndex = calls.findIndex(([name]) => name === 'translate');
    expect(transferIndex).toBeGreaterThanOrEqual(0);
    expect(calls.slice(transferIndex, transferIndex + 4)).toEqual([
      ['translate', 0.7 * 300, 0.8 * 533],
      ['rotate', 0.25],
      ['scale', 0.6, 0.6],
      ['translate', -0.5 * 300, -0.3 * 533],
    ]);
    const images = calls.filter(([name]) => name === 'drawImage');
    expect(images).toHaveLength(2);
    expect(images[1]).toEqual(images[0]);
    const transferClip = calls.findIndex(
      ([name], index) => index > transferIndex && name === 'clip',
    );
    expect(transferClip).toBeGreaterThan(transferIndex);
    expect(calls[transferClip + 1]).toEqual(images[1]);
  });

  it('grayscale 照片绘制后以 saturation 混合去饱和，并恢复混合模式', () => {
    const template: Template = {
      ...TEST_TEMPLATE,
      layers: {
        ...TEST_TEMPLATE.layers,
        photoSlots: TEST_TEMPLATE.layers.photoSlots.map((slot) => ({
          ...slot,
          effect: 'grayscale' as const,
        })),
      },
    };
    const { ctx, calls } = recordingCtx();
    renderTemplate(ctx, template, photoState(), 300, 533);
    const photoIndex = calls.findIndex(([name]) => name === 'drawImage');
    const effectIndex = calls.findIndex(
      ([name, value]) => name === 'globalCompositeOperation' && value === 'saturation',
    );
    expect(photoIndex).toBeGreaterThanOrEqual(0);
    expect(effectIndex).toBeGreaterThan(photoIndex);
    expect(calls.slice(effectIndex, effectIndex + 4)).toEqual([
      ['globalCompositeOperation', 'saturation'],
      ['fillStyle', '#808080'],
      ['fillRect', 0, 0, 300, 533],
      ['globalCompositeOperation', 'source-over'],
    ]);
  });

  it('图文保持红框左右8%边距，方图保持底边，文字字段声明字符上限', () => {
    const { photoSlots, texts } = TYPOW_POEM.layers;
    const photo = photoSlots[0].rect;
    expect([photo.x, photo.w]).toEqual([0.08, 0.84]);
    expect(photo.y + photo.h).toBeCloseTo(0.8951208791208791, 8);
    expect(photo.w * TYPOW_POEM.canvasW).toBeCloseTo(photo.h * TYPOW_POEM.canvasH, 8);
    expect(1 - photo.x - photo.w).toBeCloseTo(0.08, 8);
    expect(1 - photo.y - photo.h).toBeGreaterThan(0.06);
    const poem = texts.filter((text) => text.id !== 'credit');
    expect(poem.map((text) => text.rect.y)).toEqual([0.17, 0.225, 0.36]);
    expect(poem.map((text) => text.maxChars)).toEqual([40, 40, 40]);
    for (const text of poem) {
      expect(text.fontSize).toBe(0.032);
      expect(text.rect.h).toBe(0.05);
      expect(text.align).toBe('left');
    }
    for (const text of poem) {
      expect(text.rect.x).toBe(photo.x);
      expect(text.rect.w).toBe(photo.w);
      expect(text).toMatchObject({ letterSpacing: 0.06 });
    }
    const creditField = texts.find((text) => text.id === 'credit')!;
    expect(creditField.fontSize).toBe(0.012);
    expect(creditField.maxChars).toBe(24);
    const credit = creditField.rect;
    // credit 底边与照片底边齐平，右缘距照片右缘留 0.028
    expect(credit.x + credit.w).toBeCloseTo(0.92 - 0.028, 8);
    // credit 文字底距照片底 0.012（视觉在照片底上方一点）
    expect(photo.y + photo.h - credit.y - credit.h).toBeCloseTo(0.012, 8);
    const stickers = texts.flatMap((text) =>
      text.inlineImage?.sticker ? [text.inlineImage.sticker.rect] : [],
    );
    stickers.forEach((rect, index) => {
      expect((rect.x - photo.x) / photo.w).toBeCloseTo(([0.42, 0.2, 0.64][index] - 0.04) / 0.92, 8);
      expect((rect.y - photo.y) / photo.h).toBeCloseTo(
        [0.19802989, 0.39121943, 0.58440897][index],
        8,
      );
    });
    for (const text of texts) {
      if (text.id === 'credit') continue; // credit 底距照片底 0.012，在照片框内
      const rect = text.inlineImage?.sticker?.rect;
      if (rect) {
        expect(rect.x).toBeGreaterThanOrEqual(photo.x);
        expect(rect.x + rect.w).toBeLessThanOrEqual(photo.x + photo.w);
        expect(rect.y).toBeGreaterThanOrEqual(photo.y);
        expect(rect.y + rect.h).toBeLessThanOrEqual(photo.y + photo.h);
      } else expect(text.rect.y + text.rect.h).toBeLessThanOrEqual(photo.y);
    }
  });

  it('长中文普通文字与嵌图诗句继续缩小，完整字形不越框；短句与空句保持正常', () => {
    const measure = (text: string, font: string) => {
      const size = Number(font.match(/([\d.]+)px/)![1]);
      const width = Array.from(text).length * size;
      return {
        width,
        actualBoundingBoxLeft: text ? size * 0.1 : 0,
        actualBoundingBoxRight: width + (text ? size * 0.1 : 0),
      };
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => recordingCtx(measure).ctx,
    );
    for (const inline of [false, true]) {
      const field = {
        ...TYPOW_POEM.layers.texts[0],
        inlineImage: inline ? TYPOW_POEM.layers.texts[0].inlineImage : undefined,
      };
      const template: Template = {
        ...TYPOW_POEM,
        layers: { ...TYPOW_POEM.layers, texts: [field] },
      };
      for (const [width, height] of [
        [640, 1138],
        [1290, 2293],
      ]) {
        for (const content of ['文'.repeat(40), '短', '']) {
          const { ctx, calls } = recordingCtx(measure);
          renderTemplate(
            ctx,
            template,
            { ...photoState(), texts: new Map([[field.id, content]]) },
            width,
            height,
          );
          let font = '';
          const rendered: string[] = [];
          for (const [name, value, x] of calls) {
            if (name === 'font') font = String(value);
            if (name !== 'fillText' || !value) continue;
            const metrics = measure(String(value), font);
            rendered.push(String(value));
            expect(Number(x) - metrics.actualBoundingBoxLeft).toBeGreaterThanOrEqual(
              width * 0.08 - 0.001,
            );
            expect(Number(x) + metrics.actualBoundingBoxRight).toBeLessThanOrEqual(
              width * 0.92 + 0.001,
            );
            if (content.length === 40)
              expect(Number(font.match(/([\d.]+)px/)![1])).toBeLessThan(height * 0.032 * 0.4);
          }
          expect(rendered.join('')).toBe(
            inline ? content.slice(0, 10) + content.slice(12) : content,
          );
        }
      }
    }
  });

  it('字距同步至诗句与照片内字母，未配置的文字恢复零字距', () => {
    const offscreens: ReturnType<typeof recordingCtx>[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const offscreen = recordingCtx();
      offscreens.push(offscreen);
      return offscreen.ctx;
    });
    const template: Template = {
      ...TYPOW_POEM,
      layers: {
        ...TYPOW_POEM.layers,
        texts: TYPOW_POEM.layers.texts.map((field, index) => ({
          ...field,
          letterSpacing: index === 0 ? 0.06 : undefined,
        })),
      },
    };
    for (const [width, height] of [
      [640, 1138],
      [1290, 2293],
    ]) {
      const { ctx, calls } = recordingCtx();
      renderTemplate(ctx, template, photoState(), width, height);
      expect(calls.filter(([name]) => name === 'letterSpacing')).toEqual([
        ['letterSpacing', '0.06em'],
        ['letterSpacing', '0em'],
        ['letterSpacing', '0em'],
        ['letterSpacing', '0em'],
      ]);
    }
    expect(offscreens).toHaveLength(6);
    offscreens.forEach(({ calls }, index) => {
      expect(calls).toContainEqual(['letterSpacing', index % 3 === 0 ? '0.06em' : '0em']);
    });
  });

  it('Poetry 词槽矩形互不重叠（模板布局约束）', () => {
    const texts = TYPOW_POEM.layers.texts;
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i].rect;
        const b = texts[j].rect;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${texts[i].id} 与 ${texts[j].id} 重叠`).toBe(false);
      }
    }
  });

  it('paper 配方启用时绘制斑点，无纹理时不绘制', () => {
    const paper = recordingCtx();
    renderTemplate(
      paper.ctx,
      TEST_TEMPLATE,
      { ...baseState(), textureStyles: ['paper'] },
      300,
      533,
    );
    const none = recordingCtx();
    renderTemplate(none.ctx, TEST_TEMPLATE, { ...baseState(), textureStyles: [] }, 300, 533);
    expect(paper.calls.some(([name]) => name === 'arc')).toBe(true);
    expect(none.calls.some(([name]) => name === 'arc')).toBe(false);
  });

  it('质感无配方时静默跳过不崩（r31：glitchArt 已从模板删配）', () => {
    // textureStyles 里的 style 在模板 textures 找不到 def → drawTexture 不执行
    //（WebGL 质感同理：无 WebGL 静默跳过）。渲染应照常完成且确定性。
    const norm = (calls: Array<[string, ...unknown[]]>) =>
      JSON.stringify(calls, (_k, v) => (typeof v === 'function' ? 'fn' : v));
    const state = { ...baseState(), textureStyles: ['glitchArt'] };
    const a = recordingCtx();
    const b = recordingCtx();
    renderTemplate(a.ctx, TYPOW_POEM, state, 300, 533);
    renderTemplate(b.ctx, TYPOW_POEM, state, 300, 533);
    expect(norm(b.calls)).toBe(norm(a.calls));
  });

  it('诗句嵌图：盲文质感渲染路径存在且确定性（r12）', () => {
    // 序列规范化（函数折叠成 'fn'）：比较调用序列，不比较潜在闭包引用。
    const norm = (calls: Array<[string, ...unknown[]]>) =>
      JSON.stringify(calls, (_k, v) => (typeof v === 'function' ? 'fn' : v));
    const state = { ...baseState(), textureStyles: ['braille'] };
    const a = recordingCtx();
    const b = recordingCtx();
    renderTemplate(a.ctx, TYPOW_POEM, state, 300, 533);
    renderTemplate(b.ctx, TYPOW_POEM, state, 300, 533);
    // 同输入两次渲染一致（确定性）+ 路径非空（arc=盲文圆点）
    expect(norm(b.calls)).toBe(norm(a.calls));
    expect(
      a.calls.some(([name]) => name === 'arc'),
      'braille 无绘制调用',
    ).toBe(true);
  });

  it('shader 背景（003）：无 WebGL 时回退渐变且渲染确定性', () => {
    // mock 环境（happy-dom/Proxy ctx）无 WebGL → getShaderCanvas 返回 null，
    // 应走 dualToneFill 渐变回退，且同输入调用序列一致
    const norm = (calls: Array<[string, ...unknown[]]>) =>
      JSON.stringify(calls, (_k, v) => (typeof v === 'function' ? 'fn' : v));
    const state = baseState();
    state.gradientOverride = { from: '#cfe4ea', to: '#7db8d4', shader: 'glass' };
    const a = recordingCtx();
    const b = recordingCtx();
    renderTemplate(a.ctx, TYPOW_POEM, state, 300, 533);
    renderTemplate(b.ctx, TYPOW_POEM, state, 300, 533);
    expect(norm(b.calls)).toBe(norm(a.calls));
    // 回退路径生效：画了整幅底（fillRect 0,0,w,h 存在）
    expect(
      a.calls.some(([name, ...args]) => name === 'fillRect' && args[0] === 0 && args[1] === 0),
    ).toBe(true);
  });

  it('shader 质感（003）：无 WebGL 时静默跳过且渲染确定性', () => {
    // mock 环境无 WebGL → drawTexture 的 shader 分支 no-op，
    // 不应抛错；同输入两次渲染调用序列一致（与背景回退同构）
    const norm = (calls: Array<[string, ...unknown[]]>) =>
      JSON.stringify(calls, (_k, v) => (typeof v === 'function' ? 'fn' : v));
    const state = { ...baseState(), textureStyles: ['glassTex'] };
    const a = recordingCtx();
    const b = recordingCtx();
    renderTemplate(a.ctx, TYPOW_POEM, state, 300, 533);
    renderTemplate(b.ctx, TYPOW_POEM, state, 300, 533);
    expect(norm(b.calls)).toBe(norm(a.calls));
  });

  it('字体全局同步（r35）：fontOverride 改变渲染路径且确定性', () => {
    // 全局字体换 VT323 → ctx.font 赋值串里出现 VT323（诗句行/credit 全走它）；
    // 同输入两次渲染调用序列一致
    const norm = (calls: Array<[string, ...unknown[]]>) =>
      JSON.stringify(calls, (_k, v) => (typeof v === 'function' ? 'fn' : v));
    const state = {
      ...baseState(),
      fontOverride: "400 %SZpx 'VT323', 'Courier New', monospace",
    };
    const a = recordingCtx();
    const b = recordingCtx();
    renderTemplate(a.ctx, TYPOW_POEM, state, 300, 533);
    renderTemplate(b.ctx, TYPOW_POEM, state, 300, 533);
    expect(norm(b.calls)).toBe(norm(a.calls));
    // font 赋值经 ctx.font setter 进 calls：全局同步后非 credit 行也用 VT323
    const fontSet = a.calls.filter(([name]) => name === 'font').map((c) => String(c[1]));
    expect(fontSet.some((f) => f.includes('VT323'))).toBe(true);
    expect(
      fontSet.some((f) => f.includes("'Archivo Black'") && f.includes('VT323') === false),
    ).toBe(false);
  });

  it('credit 颜色仅 credit（r35 回归）：非 credit 行仍走模板色', () => {
    const state = { ...baseState(), creditColor: '#123456' };
    const { ctx, calls } = recordingCtx();
    renderTemplate(ctx, TYPOW_POEM, state, 300, 533);
    // credit 行 fillStyle 出现覆盖色，诗句行 fillStyle 仍是模板白 #ffffff
    const fills = calls.filter(([name]) => name === 'fillStyle').map((c) => c[1]);
    expect(fills).toContain('#123456');
    expect(fills).toContain('#ffffff');
  });
});
