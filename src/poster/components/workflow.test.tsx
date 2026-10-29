import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypowWorkbench, MaterialSample } from '..';
import { renderTemplate } from '../../engine';

vi.mock('../../engine', () => ({ renderTemplate: vi.fn() }));
vi.mock('../MaterialSample', () => ({
  MaterialSample: vi.fn(() => <span aria-hidden="true" />),
}));
let host: HTMLDivElement;
let root: Root;
let fontFailure = false;
const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
const prepareFonts = () =>
  fontFailure ? Promise.reject(new Error('font failed')) : Promise.resolve();
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
const currentState = () =>
  vi
    .mocked(renderTemplate)
    .mock.calls.filter((call) => call[3] === 640)
    .at(-1)![2];
const upload = async (file: File) => {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
};
const imageFile = () => new File(['photo'], 'photo.png', { type: 'image/png' });

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fontFailure = false;
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-download');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<TypowWorkbench prepareFonts={prepareFonts} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor);
  else Reflect.deleteProperty(document, 'fonts');
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('S3 editing workflow', () => {
  it('文字限长按Unicode字符计数，合成结束再截断，切组和导出保留限长内容', async () => {
    await click(button('文字'));
    const input = [...host.querySelectorAll('label')]
      .find((node) => node.textContent?.includes('第一行'))!
      .querySelector<HTMLInputElement>('input')!;
    const credit = [...host.querySelectorAll('label')]
      .find((node) => node.textContent?.trim().startsWith('署名'))!
      .querySelector<HTMLInputElement>('input')!;
    expect(input).not.toBeNull();
    const enter = async (node: HTMLInputElement, value: string, composing = false) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          node,
          value,
        );
        node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }));
      });
    };
    await enter(input, '😊'.repeat(41));
    expect(input.value).toBe('😊'.repeat(40));
    expect(currentState().texts.get('line-1')).toBe('😊'.repeat(40));
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toContain(
      '40/40',
    );
    expect(host.textContent).toContain('已达上限');
    await act(async () =>
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
    );
    await enter(input, '文'.repeat(42), true);
    expect(input.value).toBe('文'.repeat(42));
    await act(async () =>
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
    );
    expect(input.value).toBe('文'.repeat(40));
    await enter(credit, '署'.repeat(25));
    expect(credit.value).toBe('署'.repeat(24));
    await enter(input, '');
    expect(currentState().texts.get('line-1')).toBe('');
    await enter(input, '短句');
    expect(currentState().texts.get('line-1')).toBe('短句');
    await click(button('照片'));
    await click(button('文字'));
    expect(host.querySelector<HTMLInputElement>('input[aria-label="第一行"]')!.value).toBe('短句');
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob(['png'])),
    );
    await click(button('Download'));
    const exported = vi.mocked(renderTemplate).mock.calls.find((call) => call[3] === 1290)![2];
    expect(exported.texts.get('line-1')).toBe('短句');
    expect(exported.texts.get('credit')).toBe('署'.repeat(24));
  });
  it('选择积木、调整颗粒、切组和换材质后保留参数，并同步到导出', async () => {
    await click(button('照片'));
    await click(button('积木'));
    expect(currentState().photoMaterial).toBe('brickMosaic');
    const range = host.querySelector<HTMLInputElement>('input[type=range]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        range,
        '0.06',
      );
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(currentState().brickSize).toBe(0.06);
    await click(button('文字'));
    await click(button('照片'));
    expect(host.querySelector<HTMLInputElement>('input[type=range]')!.value).toBe('0.06');
    await click(button('玻璃分条'));
    expect(host.querySelector('input[type=range]')).toBeNull();
    await click(button('积木'));
    expect(currentState().brickSize).toBe(0.06);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob(['png'])),
    );
    await click(button('Download'));
    const exported = vi.mocked(renderTemplate).mock.calls.find((call) => call[3] === 1290)![2];
    expect(exported).toMatchObject({ photoMaterial: 'brickMosaic', brickSize: 0.06 });
  });
  it('browses categories without changing the work, picks a real preset only on selection', async () => {
    await click(button('背景'));
    const original = currentState();
    await click(button('双色撞色'));
    expect(currentState()).toBe(original);
    await click(button('红蓝'));
    expect(currentState().gradientOverride).toMatchObject({
      from: '#e60023',
      to: '#1e4fd8',
      mode: 'splitY',
      split: 0.5,
    });
    const selected = currentState();
    await click(button('多色渐变'));
    expect(currentState()).toBe(selected);
    await click(button('文字'));
    expect(host.querySelector('[role=region]')?.textContent).toContain('第一行');
    expect(host.querySelector('[role=region]')?.textContent).not.toMatch(/line-1|credit/);
  });

  it('keeps the previous photo on failed decode, guards busy reentry and rejects empty/non-image files', async () => {
    const old = { width: 100, height: 100, close: vi.fn() };
    const decode = vi.fn().mockResolvedValueOnce(old);
    vi.stubGlobal('createImageBitmap', decode);
    await click(button('照片'));
    await upload(imageFile());
    expect(currentState().photos.get('main-photo')).toBe(old);
    let reject!: (reason: Error) => void;
    decode.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await upload(imageFile());
    await upload(imageFile());
    expect(decode).toHaveBeenCalledTimes(2);
    expect(button('上传中…').disabled).toBe(true);
    await act(async () => reject(new Error('decode failed')));
    expect(currentState().photos.get('main-photo')).toBe(old);
    expect(old.close).not.toHaveBeenCalled();
    expect(host.querySelector('[role=region] [aria-live=polite]')?.textContent).toContain(
      '照片读取失败',
    );
    await upload(new File([], 'empty.png', { type: 'image/png' }));
    await upload(new File(['text'], 'note.txt', { type: 'text/plain' }));
    expect(decode).toHaveBeenCalledTimes(2);
    expect(button('更换照片').disabled).toBe(false);
  });

  it('closes the source after crop decode failure, preserves the previous photo and retries', async () => {
    const old = { width: 100, height: 100, close: vi.fn() };
    const source = { width: 100, height: 200, close: vi.fn() };
    const retrySource = { width: 100, height: 200, close: vi.fn() };
    const cropped = { width: 100, height: 100, close: vi.fn() };
    const drawImage = vi.fn();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const decode = vi
      .fn()
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(source)
      .mockRejectedValueOnce(new Error('crop decode failed'))
      .mockResolvedValueOnce(retrySource)
      .mockResolvedValueOnce(cropped);
    vi.stubGlobal('createImageBitmap', decode);
    await click(button('照片'));
    await upload(imageFile());
    const previous = currentState();
    await upload(imageFile());
    expect(decode).toHaveBeenCalledTimes(3);
    const cropCanvas = decode.mock.calls[2][0] as HTMLCanvasElement;
    expect(cropCanvas).toBeInstanceOf(HTMLCanvasElement);
    expect([cropCanvas.width, cropCanvas.height]).toEqual([100, 100]);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 50, 100, 100, 0, 0, 100, 100);
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(old.close).not.toHaveBeenCalled();
    expect(currentState()).toBe(previous);
    expect(button('更换照片').disabled).toBe(false);
    expect(button('更换照片').getAttribute('aria-busy')).toBe('false');
    expect(host.querySelector('[role=region] [role=status]')?.textContent).toContain(
      '照片读取失败',
    );
    await upload(imageFile());
    expect(decode).toHaveBeenCalledTimes(5);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(retrySource.close).toHaveBeenCalledTimes(1);
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(cropped.close).not.toHaveBeenCalled();
    expect(currentState().photos.get('main-photo')).toBe(cropped);
    expect(button('更换照片').disabled).toBe(false);
    expect(host.querySelector<HTMLElement>('[role=region] [role=status]')?.hidden).toBe(true);
  });

  it('exports without a photo, guards busy repetition, handles null blobs and can retry', async () => {
    let complete!: BlobCallback;
    const blob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      complete = callback;
    });
    await click(button('Download'));
    await click(button('下载中…'));
    expect(blob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderTemplate).mock.calls.filter((call) => call[3] === 1290)).toHaveLength(1);
    expect(currentState().photos.size).toBe(0);
    await act(async () => complete(null));
    expect(button('Download').disabled).toBe(false);
    expect(host.textContent).toContain('下载失败');
    blob.mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })));
    await click(button('Download'));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(vi.mocked(renderTemplate).mock.calls.find((call) => call[3] === 1290)?.[4]).toBe(2293);
    expect(button('Download').disabled).toBe(false);
  });

  it('recovers the Download action from fonts and tainted-canvas errors', async () => {
    const blob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(() => {
      throw new Error('tainted');
    });
    fontFailure = true;
    await click(button('Download'));
    expect(button('Download').disabled).toBe(false);
    expect(blob).not.toHaveBeenCalled();
    fontFailure = false;
    await click(button('Download'));
    expect(button('Download').disabled).toBe(false);
    expect(host.textContent).toContain('下载失败');
    blob.mockImplementation((callback) => callback(new Blob(['png'])));
    await click(button('Download'));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it('cleans a failed download click immediately, preserves the work and retries', async () => {
    vi.useFakeTimers();
    const photo = { width: 100, height: 100, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(photo));
    await click(button('照片'));
    await upload(imageFile());
    const previous = currentState();
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob(['png'], { type: 'image/png' })),
    );
    const anchorClick = vi.mocked(HTMLAnchorElement.prototype.click);
    anchorClick.mockImplementationOnce(() => {
      throw new Error('download click failed');
    });
    await click(button('Download'));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:test-download');
    expect(currentState()).toBe(previous);
    expect(photo.close).not.toHaveBeenCalled();
    expect(button('Download').disabled).toBe(false);
    expect(button('Download').getAttribute('aria-busy')).toBe('false');
    expect(host.querySelector('nav [role=status]')?.textContent).toContain('下载失败');
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    await click(button('Download'));
    expect(anchorClick).toHaveBeenCalledTimes(2);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(currentState()).toBe(previous);
    expect(photo.close).not.toHaveBeenCalled();
    expect(button('Download').disabled).toBe(false);
    expect(host.querySelector<HTMLElement>('nav [role=status]')?.hidden).toBe(true);
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('enters pure proof without changing EditorState or canvas/file identity and Escape restores focus', async () => {
    await click(button('文字'));
    const state = currentState();
    const canvas = host.querySelector('canvas');
    const file = host.querySelector('input[type=file]');
    const trigger = button('纯校样');
    await click(trigger);
    expect((host.firstElementChild as HTMLElement).dataset.proof).toBe('true');
    expect(host.querySelector<HTMLElement>('header')!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('nav')!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('[role=region]')!.hidden).toBe(true);
    expect(document.activeElement).toBe(button('返回编辑'));
    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(trigger);
    expect(currentState()).toBe(state);
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(host.querySelector('input[type=file]')).toBe(file);
  });

  it('keeps selected controls and renderer state synchronized under StrictMode', async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <TypowWorkbench prepareFonts={prepareFonts} />
        </StrictMode>,
      ),
    );
    await click(button('风格'));
    expect(button('噪点').getAttribute('aria-pressed')).toBe('true');
    await click(button('噪点'));
    expect(currentState().textureStyles).toEqual([]);
    expect(button('噪点').getAttribute('aria-pressed')).toBe('false');
    await click(button('噪点'));
    expect(currentState().textureStyles).toEqual(['grain']);
    expect(button('噪点').getAttribute('aria-pressed')).toBe('true');
    await click(button('背景'));
    await click(button('双色撞色'));
    await click(button('自定义双色'));
    const color = host.querySelector<HTMLInputElement>('[aria-label="自定义起始色"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        color,
        '#123456',
      );
      color.dispatchEvent(new Event('input', { bubbles: true }));
      color.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const range = host.querySelector<HTMLInputElement>('input[type=range]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(range, '0.7');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(currentState().gradientOverride).toMatchObject({ from: '#123456', split: 0.7 });
    expect(color.value).toBe('#123456');
    expect(range.value).toBe('0.7');
    expect(button('自定义双色').getAttribute('aria-pressed')).toBe('true');
  });

  it('retains a photo held by export until completion and then releases replaced bitmaps', async () => {
    const old = { width: 100, height: 100, close: vi.fn() };
    const next = { width: 100, height: 100, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(next),
    );
    await click(button('照片'));
    await upload(imageFile());
    let complete!: BlobCallback;
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      complete = callback;
    });
    await click(button('Download'));
    await upload(imageFile());
    expect(currentState().photos.get('main-photo')).toBe(next);
    expect(old.close).not.toHaveBeenCalled();
    await act(async () => complete(new Blob(['png'])));
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(next.close).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(next.close).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-download');
  });

  it('cleans late decode results and does not download after unmount', async () => {
    let decoded!: (photo: ImageBitmap) => void;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        () =>
          new Promise<ImageBitmap>((resolve) => {
            decoded = resolve;
          }),
      ),
    );
    await click(button('照片'));
    await upload(imageFile());
    let complete!: BlobCallback;
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      complete = callback;
    });
    await click(button('Download'));
    await act(async () => root.unmount());
    const late = { width: 100, height: 100, close: vi.fn() };
    await act(async () => {
      decoded(late as ImageBitmap);
      complete(new Blob(['png']));
    });
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it('revokes the download URL only after the browser has time to consume it', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob(['png'])),
    );
    await click(button('Download'));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-download');
  });

  it('keeps swatches text-free and accessible without removing font samples', async () => {
    for (const group of ['照片', '背景', '风格']) {
      await click(button(group));
      const swatches = [...host.querySelectorAll<HTMLButtonElement>('.workbench-recipe')];
      expect(swatches.length).toBeGreaterThan(0);
      for (const swatch of swatches) {
        expect(swatch.textContent).toBe('');
        expect(swatch.getAttribute('aria-label')).toBeTruthy();
        expect(swatch.hasAttribute('aria-pressed')).toBe(true);
      }
    }
    expect(host.querySelector('.workbench-font-preview')).toBeNull();
    await click(button('噪点'));
    expect(currentState().textureStyles).toEqual([]);
    await click(button('盲文'));
    await click(button('玻璃'));
    expect(currentState().textureStyles).toEqual(['braille', 'glassTex']);
    expect(button('盲文').getAttribute('aria-pressed')).toBe('true');
    expect(button('玻璃').getAttribute('aria-pressed')).toBe('true');
    await click(button('文字'));
    expect(host.querySelector('.workbench-font-preview')?.textContent).toBeTruthy();
  });

  it('groups fonts with text and preserves the poem and selected font across groups', async () => {
    await click(button('文字'));
    expect(host.querySelectorAll('.workbench-font-option')).toHaveLength(6);
    const field = host.querySelector<HTMLInputElement>('input:not([type=file])')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(field, 'keep this poem');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const texts = currentState().texts;
    await click(button('VT323'));
    expect(currentState().fontOverride).toBe("400 %SZpx 'VT323', 'Courier New', monospace");
    expect(currentState().texts).toEqual(texts);
    expect(button('VT323').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.workbench-font-preview')?.textContent).toBe('keep this poem');
    await click(button('风格'));
    expect(host.querySelector('.workbench-fonts')).toBeNull();
    expect(host.querySelectorAll('.workbench-recipe')).toHaveLength(9);
    await click(button('文字'));
    expect(button('VT323').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector<HTMLInputElement>('input:not([type=file])')!.value).toBe(
      'keep this poem',
    );
  });

  it('uses only visible fixed recipes for samples, not the edited poem or photos', async () => {
    expect(MaterialSample).not.toHaveBeenCalled();
    await click(button('照片'));
    expect(
      vi
        .mocked(MaterialSample)
        .mock.calls.some(([props]) => props.photoMaterial === 'glassRefract'),
    ).toBe(true);
    vi.mocked(MaterialSample).mockClear();
    await click(button('背景'));
    expect(
      vi
        .mocked(MaterialSample)
        .mock.calls.every(([props]) => !props.gradient || !('custom' in props.gradient)),
    ).toBe(true);
    expect(
      vi.mocked(MaterialSample).mock.calls.some(([props]) => props.gradient?.from === '#b04ef0'),
    ).toBe(true);
    vi.mocked(MaterialSample).mockClear();
    await click(button('风格'));
    expect(
      vi.mocked(MaterialSample).mock.calls.some(([props]) => props.texture === 'glassTex'),
    ).toBe(true);
    expect(
      vi
        .mocked(MaterialSample)
        .mock.calls.every(([props]) => !('photos' in props) && !('texts' in props)),
    ).toBe(true);
  });
});
