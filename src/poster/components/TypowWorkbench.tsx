/**
 * Poetry Wallpaper：深色单实例工作台；编辑控件与作品 renderer 隔离。
 * ≥1024 为舞台 + 320px inspector；手机编辑区占布局行，低高度恢复文档滚动。
 */
import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { Button, Input } from '@/ui';
import { renderTemplate, type EditorState } from '../engine';
import { TYPOW_POEM } from '../templates';
import { PosterCanvas } from './PosterCanvas';
import { ToolDock, type DockGroup } from './ToolDock';
import { EditorSheet, SheetLabel } from './EditorSheet';
import { MaterialSample } from './MaterialSample';
// 真字体（fontsource 本地打包，canvas 可用）： 删 Titan One，加五款 display 字体
import '@fontsource/archivo-black';
import '@fontsource/vt323';
import '@fontsource/montserrat';
import '@fontsource/climate-crisis';
import '@fontsource/limelight';
import '@fontsource/zen-tokyo-zoo';

// 单一竖版导出：按 1024×1820 模板等比输出 1290×2293，不提供正方形。
const EXPORT_W = 1290;
const EXPORT_H = Math.round((EXPORT_W * TYPOW_POEM.canvasH) / TYPOW_POEM.canvasW);
type PhotoMaterial = NonNullable<EditorState['photoMaterial']>;
type TextureStyle = NonNullable<EditorState['textureStyles']>[number];

// 照片局部材质（仅照片区域效果）； 删水波纹
const PHOTO_MATERIALS: { value: PhotoMaterial; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'glassRefract', label: '玻璃分条' },
  { value: 'mirrorBlur', label: '镜面模糊' },
  { value: 'brickMosaic', label: '积木' },
];

// 字体选择器（全局同步：诗句行 + sticker 洞块 + credit 全走 fontOverride）。
// value = canvas font 简写模板，%SZ 为字号占位符（引擎替换）。
const FONT_OPTIONS = [
  { value: "900 %SZpx 'Archivo Black', 'Arial Black', sans-serif", label: 'Archivo Black' },
  { value: "400 %SZpx 'VT323', 'Courier New', monospace", label: 'VT323' },
  { value: "900 %SZpx 'Montserrat', 'Helvetica Neue', sans-serif", label: 'Montserrat' },
  { value: "400 %SZpx 'Climate Crisis', 'Arial Black', sans-serif", label: 'Climate Crisis' },
  { value: "400 %SZpx 'Limelight', 'Georgia', serif", label: 'Limelight' },
  { value: "400 %SZpx 'Zen Tokyo Zoo', 'Impact', sans-serif", label: 'Zen Tokyo Zoo' },
] as const;

// 盲文； shader 质感 5 项； 二轮删故障风（glitchArt）； 删网点、加米白点阵
const TEXTURE_OPTIONS: { value: TextureStyle; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'grain', label: '噪点' },
  { value: 'braille', label: '盲文' },
  { value: 'glassTex', label: '玻璃' },
  { value: 'rippleTex', label: '水波' },
  { value: 'dotsBlur', label: '柔点' },
  { value: 'corrugated', label: '瓦楞' },
  { value: 'halftoneWave', label: '半调' },
  { value: 'dotGrid', label: '点阵' },
];

/**
 * 背景预设（ 改版）：① 单色渐变（同色系深浅 + Custom 自选双色）
 * ② 双色撞色（硬分界线）③ 多色渐变（深邃，白字可读）④ shader 程序化底。
 */
type GradientPreset = {
  label: string;
  from: string;
  to: string;
  mode?: 'splitX' | 'splitY' | 'fluid';
  split?: number;
  stops?: { at: number; color: string }[];
  vignette?: boolean;
  dotGrid?: boolean;
  shader?: 'glass' | 'ripple' | 'dotsBlurBg' | 'corrugated';
  custom?: boolean;
  group?: string;
};

// 三轮：粉回归；删香芋紫；custom（五彩按钮）放第一
const GRADIENT_SOFT: GradientPreset[] = [
  { label: 'custom', from: '#8fc3f7', to: '#d0e7ff', custom: true },
  { label: '粉', from: '#b04ef0', to: '#ff5f8f' },
  { label: '蓝绿', from: '#43cea2', to: '#185a9d' },
  { label: '黄橙', from: '#ffe200', to: '#ff7a00' },
  { label: '灰黑', from: '#6e6e73', to: '#0a0a0a' },
  { label: '淡蓝', from: '#d0e7ff', to: '#8fc3f7' },
];

// 三轮：撞色组也加 custom（放第一）
const GRADIENT_SPLIT: GradientPreset[] = [
  { label: 'custom', from: '#e60023', to: '#1e4fd8', mode: 'splitY', split: 0.5, custom: true },
  { label: '红蓝', from: '#e60023', to: '#1e4fd8', mode: 'splitY', split: 0.5 },
  { label: '紫金', from: '#5b2ee0', to: '#f5b301', mode: 'splitY', split: 0.5 },
  { label: '黄天蓝', from: '#fcda03', to: '#96d6ef', mode: 'splitY', split: 0.5 },
  { label: '橙青', from: '#ff6a00', to: '#00c8ff', mode: 'splitY', split: 0.5 },
];

const GRADIENT_MULTI: GradientPreset[] = [
  {
    label: '蓝粉三段',
    from: '#9ed8ff',
    to: '#1b3b8f',
    stops: [
      { at: 0, color: '#9ed8ff' },
      { at: 0.45, color: '#ff7ad9' },
      { at: 1, color: '#1b3b8f' },
    ],
  },
  {
    label: '暗角·落日',
    from: '#ff8c1a',
    to: '#0d2b6d',
    vignette: true,
    stops: [
      { at: 0, color: '#ff8c1a' },
      { at: 0.3, color: '#ffd23f' },
      { at: 0.6, color: '#7ec8e3' },
      { at: 1, color: '#0d2b6d' },
    ],
  },
  {
    label: '点阵·青绿',
    from: '#a8e05f',
    to: '#ffffff',
    dotGrid: true,
    stops: [
      { at: 0, color: '#a8e05f' },
      { at: 0.35, color: '#7fd9e0' },
      { at: 0.65, color: '#fdf3b0' },
      { at: 1, color: '#ffffff' },
    ],
  },
 // ── shader 程序化底：WebGL fragment shader 渲染的整幅底图 ──
  { label: '压花玻璃', from: '#cfe4ea', to: '#7db8d4', shader: 'glass' },
  { label: '水波纹', from: '#87d4d0', to: '#219e9e', shader: 'ripple' },
  { label: '柔点黑白', from: '#ffffff', to: '#ffffff', shader: 'dotsBlurBg' },
  { label: '瓦楞黑白', from: '#e8e8e8', to: '#c8c8c8', shader: 'corrugated' },
];

// ：dock 分组 → sheet 标题
const GROUP_TITLES: Record<Exclude<DockGroup, null>, string> = {
  photo: '照片',
  bg: '背景',
  text: '文字',
  style: '风格',
};

export function TypowWorkbench({ prepareFonts }: { prepareFonts: () => Promise<unknown> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef(false);
  const [desktop, setDesktop] = useState(
    () => globalThis.matchMedia?.('(min-width: 1024px)').matches ?? false,
  );
  const [editor, setEditor] = useState<{ group: Exclude<DockGroup, null>; open: boolean }>(() => ({
    group: 'photo',
    open: desktop,
  }));
  const activeGroup = editor.group;
  const openGroup = editor.open ? editor.group : null;

  useEffect(() => {
    const media = globalThis.matchMedia?.('(min-width: 1024px)');
    if (!media) return;
    const update = () => {
      setDesktop(media.matches);
      if (media.matches)
        setEditor((current) => (current.open ? current : { ...current, open: true }));
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const viewport = globalThis.visualViewport;
    if (!root || !viewport) return; // 无 API：由 100dvh 与低高度 CSS 降级。
    const update = () => {
      root.style.setProperty('--workbench-height', `${viewport.height}px`);
      root.style.setProperty('--workbench-width', `${viewport.width}px`);
      root.style.setProperty('--workbench-offset-top', `${Math.max(0, viewport.offsetTop)}px`);
      root.dataset.compact = String(viewport.height < 520);
      const field = document.activeElement;
      if (field instanceof HTMLInputElement && root.contains(field)) {
        const rect = field.getBoundingClientRect();
        if (rect.top < viewport.offsetTop || rect.bottom > viewport.offsetTop + viewport.height) {
          field.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
      }
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    globalThis.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      globalThis.removeEventListener('resize', update);
    };
  }, []);
  const [state, setState] = useState<EditorState>(() => ({
    photos: new Map(),
    transforms: new Map(),
    texts: new Map(),
    cutouts: [],
 // 质感多选：默认噪点
    textureStyles: ['grain'],
  }));
 // 选中态直接来自作品状态，避免 StrictMode 下两份质感状态失同步。
  const textureStyles = new Set(state.textureStyles);
  const [gradient, setGradient] = useState<GradientPreset | undefined>(undefined);
 // ：照片材质 / credit 颜色 / credit 效果 / 镜面模糊窗口
  const [photoMaterial, setPhotoMaterial] = useState<PhotoMaterial>('none');
  const [creditColor, setCreditColor] = useState<string>(
    TYPOW_POEM.layers.texts.find((t) => t.id === 'credit')?.color ?? '#7de0d3',
  );
 // 字体全局同步：fontOverride 驱动全部文字层；默认 Archivo Black（与模板一致）
  const [font, setFont] = useState<string>(FONT_OPTIONS[0].value);
  const [mirrorWindow, setMirrorWindow] = useState(0.5);
  const fileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const uploadBusyRef = useRef(false);
  const downloadBusyRef = useRef(false);
  const ownedPhotos = useRef(new Set<ImageBitmap>());
  const exportPhotoRef = useRef<ReturnType<EditorState['photos']['get']>>(undefined);
  const currentPhotoRef = useRef<ImageBitmap | null>(null);
  const downloadUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [materialWarning, setMaterialWarning] = useState('');
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [proof, setProof] = useState(false);
  const proofTriggerRef = useRef<HTMLButtonElement>(null);
  const proofExitRef = useRef<HTMLButtonElement>(null);
  const proofReturnRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    const photos = ownedPhotos.current;
    const urls = downloadUrls.current;
    return () => {
      mountedRef.current = false;
      for (const photo of photos) photo.close();
      photos.clear();
      for (const [url, timer] of urls) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);
 // React 已提交新照片后才释放旧图；进行中的导出快照继续保留。
  useEffect(() => {
    for (const photo of ownedPhotos.current) {
      if (photo !== state.photos.get('main-photo') && photo !== exportPhotoRef.current) {
        photo.close();
        ownedPhotos.current.delete(photo);
      }
    }
  }, [state.photos]);
  useLayoutEffect(() => {
    if (proof) proofExitRef.current?.focus({ preventScroll: true });
    else if (proofReturnRef.current) {
      proofTriggerRef.current?.focus({ preventScroll: true });
      proofReturnRef.current = false;
    }
  }, [proof]);
  const exitProof = () => {
    proofReturnRef.current = true;
    setProof(false);
  };
 // 单一编辑状态保留当前组；关闭不从 ref 读取渲染数据。
  const onOpen = (group: DockGroup, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setEditor({ group: group ?? editor.group, open: desktop || group !== null });
  };
  const closePanel = () => {
    if (!triggerRef.current) {
      triggerRef.current =
        rootRef.current?.querySelector<HTMLButtonElement>(
          'button[aria-controls][aria-expanded="true"]',
        ) ?? null;
    }
    const group = desktop ? 'photo' : editor.group;
    if (editor.open === desktop && editor.group === group) {
      triggerRef.current?.focus({ preventScroll: true });
    } else {
      returnFocusRef.current = true;
      setEditor({ group, open: desktop });
    }
  };
  useLayoutEffect(() => {
    if (returnFocusRef.current) {
      triggerRef.current?.focus({ preventScroll: true });
      returnFocusRef.current = false;
    }
  });
 // canvas 字体：@font-face 不随 ctx.font 下载，显式 load 后重渲（首次挂载即可见）
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let active = true;
    const finish = () => {
      if (active) setFontsReady(true);
    };
    void prepareFonts().then(finish, finish);
    return () => {
      active = false;
    };
  }, [prepareFonts]);

 // ：把照片材质/credit 覆盖/镜面窗口合进 state（驱动 PosterCanvas 重渲）
  const syncExtras = useCallback(
    (patch: Partial<EditorState>) => setState((s) => ({ ...s, ...patch })),
    [],
  );

  const setText = useCallback((id: string, value: string, composing = false) => {
    const limit = TYPOW_POEM.layers.texts.find((field) => field.id === id)?.maxChars;
    const text = composing ? value : (value.match(/./gsu) ?? []).slice(0, limit).join('');
    setState((s) => ({ ...s, texts: new Map(s.texts).set(id, text) }));
  }, []);

 // 照片比例规则：竖图（高>宽，如 9:16）上传时垂直居中预裁为 1:1；
 // 16:9 / 1:1 / 横图原样进渲染（contain 整图适配长条区）
  const onFile = useCallback((file: File) => {
    if (uploadBusyRef.current) return;
    if (!file.size || !file.type.startsWith('image/')) {
      setUploadError('请选择有效图片文件');
      return;
    }
    uploadBusyRef.current = true;
    setUploadBusy(true);
    setUploadError('');
    return decodePhoto(file)
      .then((nextPhoto) => {
        if (!mountedRef.current) {
          nextPhoto.close();
          return;
        }
        ownedPhotos.current.add(nextPhoto);
        currentPhotoRef.current = nextPhoto;
        setState((s) => ({ ...s, photos: new Map(s.photos).set('main-photo', nextPhoto) }));
      })
      .catch(() => {
        if (mountedRef.current) setUploadError('照片读取失败，请换一张图片重试');
      })
      .finally(() => {
        uploadBusyRef.current = false;
        if (mountedRef.current) setUploadBusy(false);
      });
  }, []);

 // credit/材质变更即同步 state（与渐变/质感控件同模式）
  const pickCreditColor = useCallback(
    (c: string) => {
      setCreditColor(c);
      syncExtras({ creditColor: c });
    },
    [syncExtras],
  );
 // 字体选择器：全局同步（诗句行 + credit 同一 fontOverride）
  const pickFont = useCallback(
    (f: string) => {
      setFont(f);
      syncExtras({ fontOverride: f });
    },
    [syncExtras],
  );
  const pickPhotoMaterial = useCallback(
    (m: PhotoMaterial) => {
      setPhotoMaterial(m);
      syncExtras({ photoMaterial: m });
    },
    [syncExtras],
  );

  const exportPng = useCallback(
    (w: number) => {
      if (downloadBusyRef.current) return;
      downloadBusyRef.current = true;
      exportPhotoRef.current = state.photos.get('main-photo');
      setDownloadBusy(true);
      setDownloadError('');
      return downloadPng(state, prepareFonts, w, () => mountedRef.current, downloadUrls.current)
        .catch(() => {
          if (mountedRef.current) setDownloadError('下载失败，请重试');
        })
        .finally(() => {
          exportPhotoRef.current = undefined;
          for (const photo of ownedPhotos.current) {
            if (photo !== currentPhotoRef.current) {
              photo.close();
              ownedPhotos.current.delete(photo);
            }
          }
          downloadBusyRef.current = false;
          if (mountedRef.current) setDownloadBusy(false);
        });
    },
    [state, prepareFonts],
  );

 // 四轮：带组名 pick（单色/撞色 custom 解耦，选中态按组判）
  const pickGradient = useCallback((g: GradientPreset, group: string) => {
    setGradient({ ...g, group });
    setState((s) => ({ ...s, gradientOverride: g }));
  }, []);

 // custom 双色：改色即同步渲染（保持选中 custom 预设）
  const pickCustomColor = useCallback(
    (which: 'from' | 'to', color: string) => {
      if (!gradient) return;
      const next = { ...gradient, [which]: color };
      setGradient(next);
      setState((s) => ({ ...s, gradientOverride: next }));
    },
    [gradient],
  );

 // ：分界线滑杆（UI state + 渲染 state 同步，原 section 版同逻辑）
  const onSplitChange = (v: number) => {
    if (!gradient) return;
    const next = { ...gradient, split: v };
    setGradient(next);
    setState((s) => ({ ...s, gradientOverride: next }));
  };
 // ：质感多选 toggle（UI state + 渲染 state 同步）
  const onToggleTexture = (value: TextureStyle) => {
    setState((s) => {
      const next = new Set(s.textureStyles);
      if (value === 'none') next.clear();
      else if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...s, textureStyles: [...next] };
    });
  };
  const setMirrorWindowSync = (v: number) => {
    setMirrorWindow(v);
    syncExtras({ mirrorWindow: v });
  };

 // 同一份分组面板（手机 sheet / 桌面右栏共用；props 完全一致）
  const groupPanels = (
    <GroupPanels
      group={activeGroup}
      visible={openGroup !== null && !proof}
      uploadBusy={uploadBusy}
      uploadError={uploadError || materialWarning}
      state={state}
      textureStyles={textureStyles}
      photoMaterial={photoMaterial}
      creditColor={creditColor}
      gradient={gradient}
      font={font}
      mirrorWindow={mirrorWindow}
      onUpload={() => fileRef.current?.click()}
      setText={setText}
      pickGradient={pickGradient}
      pickCustomColor={pickCustomColor}
      pickFont={pickFont}
      pickPhotoMaterial={pickPhotoMaterial}
      pickCreditColor={pickCreditColor}
      setMirrorWindow={setMirrorWindowSync}
      setBrickSize={(brickSize) => syncExtras({ brickSize })}
      onSplitChange={onSplitChange}
      onToggleTexture={onToggleTexture}
    />
  );

  return (
    <div
      ref={rootRef}
      className="poster-workbench"
      data-proof={proof}
      style={{ '--proof-ratio': TYPOW_POEM.canvasW / TYPOW_POEM.canvasH } as React.CSSProperties}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (proof) {
            event.preventDefault();
            exitProof();
          } else if (openGroup) {
            event.preventDefault();
            closePanel();
          }
        }
      }}
    >
      <input
        ref={fileRef}
        style={{ display: 'none' }}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ''; // 输入常驻后，仍允许再次选择同一文件。
          if (file) void onFile(file);
        }}
      />
      {/* 顶栏：LOGO + 切片转移（A24：hairline 下边、无阴影） */}
      <header className="workbench-header" hidden={proof}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 md:px-8">
          <div className="flex items-center gap-3">
            {/* LOGO：诗行嵌图的抽象形，单色近黑 */}
            <svg width="30" height="30" viewBox="0 0 34 34" aria-hidden className="shrink-0">
              <circle
                cx="17"
                cy="17"
                r="15.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <rect x="7" y="12" width="4.5" height="4.5" fill="currentColor" />
              <rect x="13.5" y="12" width="7" height="4.5" fill="currentColor" opacity="0.45" />
              <rect x="22.5" y="12" width="4.5" height="4.5" fill="currentColor" />
              <rect x="7" y="18.5" width="20" height="1.6" fill="currentColor" opacity="0.55" />
              <rect x="7" y="22" width="13" height="1.6" fill="currentColor" opacity="0.35" />
            </svg>
            <div>
              <h1 className="workbench-brand">Poetry Wallpaper</h1>
            </div>
          </div>
          <Button
            ref={proofTriggerRef}
            type="button"
            variant="ghost"
            className="workbench-proof-toggle"
            onClick={() => setProof(true)}
          >
            纯校样
          </Button>
        </div>
      </header>

      <ToolDock
        open={openGroup}
        onOpen={onOpen}
        panelId={panelId}
        onDownload={() => void exportPng(EXPORT_W)}
        hidden={proof}
        downloadBusy={downloadBusy}
        downloadError={downloadError}
      />
      <main className="workbench-main">
        <div className="workbench-proof">
          <div className="workbench-proof-sheet">
            <div className="workbench-stage">
              <PosterCanvas
                template={TYPOW_POEM}
                state={state}
                fontsReady={fontsReady}
                onMaterialStatus={setMaterialWarning}
              />
            </div>
            <div className="workbench-proof-caption" hidden={proof}>
              <span>校样</span>
              <span>
                {EXPORT_W}×{EXPORT_H}
              </span>
            </div>
          </div>
        </div>
        <EditorSheet
          id={panelId}
          open={openGroup !== null && !proof}
          title={GROUP_TITLES[activeGroup]}
          onClose={closePanel}
        >
          {groupPanels}
        </EditorSheet>
      </main>
      <div className="workbench-proof-exit" hidden={!proof}>
        <Button ref={proofExitRef} type="button" variant="outline" onClick={exitProof}>
          返回编辑
        </Button>
      </div>
    </div>
  );
}

/** 浏览器资源操作留在模块函数内，组件负责即时忙态与卸载边界。 */
async function decodePhoto(file: File): Promise<ImageBitmap> {
  let image: ImageBitmap | undefined;
  try {
    image = await createImageBitmap(file);
    if (image.height > image.width) {
      const side = image.width;
      const off = document.createElement('canvas');
      off.width = off.height = side;
      const ctx = off.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(image, 0, (image.height - side) / 2, side, side, 0, 0, side, side);
      const cropped = await createImageBitmap(off);
      image.close();
      image = cropped;
    }
    const result = image;
    image = undefined;
    return result;
  } finally {
    image?.close();
  }
}

async function downloadPng(
  state: EditorState,
  prepareFonts: () => Promise<unknown>,
  w: number,
  isActive: () => boolean,
  urls: Map<string, ReturnType<typeof setTimeout>>,
): Promise<void> {
  let url: string | undefined;
  try {
    await prepareFonts();
    await document.fonts.ready;
    if (!isActive()) return;
    const h = Math.round((w * TYPOW_POEM.canvasH) / TYPOW_POEM.canvasW);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    renderTemplate(ctx, TYPOW_POEM, state, w, h);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('Empty PNG'))),
        'image/png',
      );
    });
    if (!isActive()) return;
    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poetry-wallpaper-${w}x${h}.png`;
    document.body.append(a);
    try {
      a.click();
    } finally {
      a.remove();
    }
    const downloadUrl = url;
 // 不在 click 后立即 revoke；卸载时也清理尚未回收的 URL。
    const timer = setTimeout(() => {
      URL.revokeObjectURL(downloadUrl);
      urls.delete(downloadUrl);
    }, 60_000);
    urls.set(downloadUrl, timer);
    url = undefined;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/** 当前编辑组保留字段状态；小样仅在可见组生成。 */
function GroupPanels({
  group,
  visible,
  uploadBusy,
  uploadError,
  state,
  textureStyles,
  photoMaterial,
  creditColor,
  gradient,
  font,
  mirrorWindow,
  onUpload,
  setText,
  pickGradient,
  pickCustomColor,
  pickFont,
  pickPhotoMaterial,
  pickCreditColor,
  setMirrorWindow,
  setBrickSize,
  onSplitChange,
  onToggleTexture,
}: {
  group: Exclude<DockGroup, null>;
  visible: boolean;
  uploadBusy: boolean;
  uploadError: string;
  state: EditorState;
  textureStyles: Set<TextureStyle>;
  photoMaterial: PhotoMaterial;
  creditColor: string;
  gradient: GradientPreset | undefined;
  font: string;
  mirrorWindow: number;
  onUpload: () => void;
  setText: (id: string, v: string, composing?: boolean) => void;
  pickGradient: (g: GradientPreset, group: string) => void;
  pickCustomColor: (which: 'from' | 'to', color: string) => void;
  pickFont: (f: string) => void;
  pickPhotoMaterial: (m: PhotoMaterial) => void;
  pickCreditColor: (c: string) => void;
  setMirrorWindow: (v: number) => void;
  setBrickSize: (v: number) => void;
  onSplitChange: (v: number) => void;
  onToggleTexture: (v: TextureStyle) => void;
}) {
  const textId = useId();
  if (group === 'photo') {
    return (
      <div className="flex flex-col gap-4">
        <Button
          type="button"
          variant="ghost"
          onClick={onUpload}
          disabled={uploadBusy}
          aria-busy={uploadBusy}
          className="workbench-upload"
        >
          {uploadBusy ? '上传中…' : state.photos.has('main-photo') ? '更换照片' : '上传照片'}
        </Button>
        <p role="status" aria-live="polite" className="workbench-feedback" hidden={!uploadError}>
          {uploadError}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          竖图（9:16）自动居中裁为 1:1；16:9 整图显示；1:1 贴合区域高度。
        </p>
        {/* 照片材质并入照片组（就近原则：同一张照片的事） */}
        <SheetLabel>照片材质</SheetLabel>
        <div className="workbench-recipes">
          {PHOTO_MATERIALS.map((opt) => (
            <Button
              type="button"
              variant="ghost"
              key={opt.value}
              aria-label={opt.label}
              aria-pressed={photoMaterial === opt.value}
              onClick={() => pickPhotoMaterial(opt.value)}
              className="workbench-recipe"
            >
              {visible && (
                <span className="workbench-sample">
                  <MaterialSample label={opt.label} photoMaterial={opt.value} />
                </span>
              )}
            </Button>
          ))}
        </div>
        {photoMaterial === 'brickMosaic' && (
          <RangeRow
            label="颗粒大小"
            value={state.brickSize ?? 0.025}
            min={0.015}
            max={0.08}
            step={0.005}
            onChange={setBrickSize}
          />
        )}
        {photoMaterial === 'mirrorBlur' && (
          <RangeRow
            label="窗口大小"
            value={mirrorWindow}
            min={0.15}
            max={0.9}
            step={0.05}
            onChange={setMirrorWindow}
          />
        )}
      </div>
    );
  }

  if (group === 'bg') {
    return (
      <BGPanel
        visible={visible}
        gradient={gradient}
        pickGradient={pickGradient}
        pickCustomColor={pickCustomColor}
        onSplitChange={onSplitChange}
      />
    );
  }

  if (group === 'text') {
    return (
      <div className="flex flex-col gap-4">
        <SheetLabel>诗句与署名</SheetLabel>
        {TYPOW_POEM.layers.texts.map((field, index) => {
          const value = state.texts.get(field.id) ?? field.default;
          const count = value.match(/./gsu)?.length ?? 0;
          const label = field.id === 'credit' ? '署名' : ['第一行', '第二行', '第三行'][index];
          const countId = `${textId}-${field.id}-count`;
          return (
            <label key={field.id} className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <Input
                aria-label={label}
                aria-describedby={field.maxChars ? countId : undefined}
                value={value}
                onCompositionStart={(e) => {
                  e.currentTarget.dataset.composing = 'true';
                }}
                onCompositionEnd={(e) => {
                  delete e.currentTarget.dataset.composing;
                  setText(field.id, e.currentTarget.value);
                }}
                onChange={(e) =>
                  setText(
                    field.id,
                    e.currentTarget.value,
                    e.currentTarget.dataset.composing === 'true' ||
                      (e.nativeEvent as InputEvent).isComposing,
                  )
                }
                className="workbench-input"
              />
              {field.maxChars && (
                <span id={countId} aria-live="polite" className="text-xs text-muted-foreground">
                  {count}/{field.maxChars}
                  {count > field.maxChars
                    ? ' · 已超限，请缩短'
                    : count === field.maxChars
                      ? ' · 已达上限，超出部分不接收'
                      : ''}
                </span>
              )}
            </label>
          );
        })}
        <SheetLabel>署名颜色</SheetLabel>
        <div className="flex items-center gap-3 text-xs">
          <Input
            type="color"
            aria-label="署名颜色"
            value={creditColor}
            onChange={(e) => pickCreditColor(e.target.value)}
            className="workbench-color"
          />
          <span className="text-muted-foreground">仅改变署名</span>
        </div>
        <div className="flex flex-col gap-2">
          <SheetLabel>字体 · 全局同步</SheetLabel>
          <div className="workbench-fonts">
            {FONT_OPTIONS.map((opt) => {
              const [firstLine] = TYPOW_POEM.layers.texts;
              const preview = (state.texts.get(firstLine.id) ?? firstLine.default).slice(0, 20);
              return (
                <Button
                  key={opt.label}
                  type="button"
                  variant="ghost"
                  aria-label={opt.label}
                  aria-pressed={font === opt.value}
                  onClick={() => pickFont(opt.value)}
                  className="workbench-font-option"
                >
                  <span
                    className="workbench-font-preview"
                    style={{
                      fontFamily: opt.value.split('%SZpx')[1].trim(),
                      fontWeight: Number(opt.value.split(' ')[0]),
                    }}
                  >
                    {preview || '诗句预览'}
                  </span>
                  <span className="workbench-option-label">
                    <span aria-hidden>{font === opt.value ? '●' : '○'}</span>
                    {opt.label}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

 // group === 'style'：整版质感
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <SheetLabel>整版质感 · 可多选</SheetLabel>
        <div className="workbench-recipes">
          {TEXTURE_OPTIONS.map((opt) => {
            const selected =
              opt.value === 'none' ? !textureStyles.size : textureStyles.has(opt.value);
            return (
              <Button
                key={opt.value}
                type="button"
                variant="ghost"
                aria-label={opt.label}
                aria-pressed={selected}
                onClick={() => onToggleTexture(opt.value)}
                className="workbench-recipe"
              >
                {visible && (
                  <span className="workbench-sample">
                    <MaterialSample label={opt.label} texture={opt.value} />
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 直角小按钮（A24：直角、hairline 描边、选中近黑实底；≥44px 触达由外层 grid 保证） */
function Chip({
  active,
  onClick,
  children,
  style,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
  style?: React.CSSProperties;
}) {
  return (
    <Button
      variant="ghost"
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={style}
      className="workbench-chip"
    >
      {children}
    </Button>
  );
}

/** 滑杆行：label + range + 百分比（A24：极简，无框） */
function RangeRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-xs">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <Input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit?.(value)}
        className="workbench-range"
      />
      <span className="w-9 text-right text-muted-foreground">{Math.round(value * 100)}%</span>
    </label>
  );
}

/**
 * 背景分类采用局部浏览状态；具体配方选择才同步作品。
 * 固定小样不接收编辑中的照片、文字或实时滑杆值。
 */
function BGPanel({
  visible,
  gradient,
  pickGradient,
  pickCustomColor,
  onSplitChange,
}: {
  visible: boolean;
  gradient: GradientPreset | undefined;
  pickGradient: (g: GradientPreset, group: string) => void;
  pickCustomColor: (which: 'from' | 'to', color: string) => void;
  onSplitChange: (v: number) => void;
}) {
  const TABS = [
    { title: '单色渐变', presets: GRADIENT_SOFT },
    { title: '双色撞色', presets: GRADIENT_SPLIT },
    { title: '多色渐变', presets: GRADIENT_MULTI },
  ] as const;
 // 分类只浏览，不替用户选择或改作品。
  const [category, setCategory] = useState(() => gradient?.group ?? TABS[0].title);
  const activeTab = TABS.find((t) => t.title === category) ?? TABS[0];
  return (
    <div className="flex flex-col gap-4">
      {/* 组内 tab：A24 直角小按钮，hairline 描边，选中近黑实底 */}
      <div className="grid grid-cols-3 gap-1.5">
        {TABS.map((tab) => (
          <Chip
            key={tab.title}
            active={activeTab.title === tab.title}
            onClick={() => setCategory(tab.title)}
          >
            {tab.title}
          </Chip>
        ))}
      </div>
      <div className="workbench-recipes">
        {activeTab.presets.map((g) => {
          const selected = gradient?.group === activeTab.title && gradient?.label === g.label;
          const label = g.custom ? '自定义双色' : g.label;
          const { label: _label, custom: _custom, group: _group, ...recipe } = g;
          return (
            <Button
              variant="ghost"
              key={`${activeTab.title}:${g.label}`}
              type="button"
              aria-label={label}
              onClick={() => pickGradient(g, activeTab.title)}
              aria-pressed={selected}
              className="workbench-recipe"
            >
              {g.custom ? (
                <span className="workbench-custom-color" aria-hidden />
              ) : (
                visible && (
                  <span className="workbench-sample">
                    <MaterialSample label={label} gradient={recipe} />
                  </span>
                )
              )}
            </Button>
          );
        })}
      </div>
      {gradient?.mode && (gradient.mode === 'splitX' || gradient.mode === 'splitY') && (
        <RangeRow
          label="分界线"
          value={gradient.split ?? 0.5}
          min={0.15}
          max={0.85}
          step={0.05}
          onChange={onSplitChange}
        />
      )}
      {gradient?.custom && (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">自定义</span>
          <label className="flex items-center gap-1.5">
            <Input
              type="color"
              aria-label="自定义起始色"
              value={gradient.from}
              onChange={(e) => pickCustomColor('from', e.target.value)}
              className="workbench-color"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <Input
              type="color"
              aria-label="自定义结束色"
              value={gradient.to}
              onChange={(e) => pickCustomColor('to', e.target.value)}
              className="workbench-color"
            />
          </label>
          <span className="text-muted-foreground">
            {gradient.mode ? '双色硬分界' : '双色对角渐变'}
          </span>
        </div>
      )}
    </div>
  );
}
