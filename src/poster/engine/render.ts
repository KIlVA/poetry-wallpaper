/**
 * 单 renderer 渲染函数（D-003）。
 *
 * 纯函数：给定 template + 编辑状态 + 画布尺寸，把版式画到 ctx 上。
 * 预览与导出走同一代码路径，仅 canvasW/H 不同 —— 预览与导出逐像素一致（AC-05）。
 *
 * 确定性约束（AC-06 / D-002）：渲染路径内禁止 Math.random；
 * shard 形状由 seed 驱动的伪随机生成，同 seed 同形状（导出可复现）。
 *
 * V2 切片模型（反馈 #5/#6）：照片保持完整；
 * 每个 Cutout = 洞（显示 sliceColor）+ 转移块（切下的图贴到色块区）。
 */
import type { Cutout, PhotoMaterial, Template, TextField, TextureDef, TextureStyle } from './types';
import { getShaderCanvas } from './shaders';
import { sampleBrickGrid } from './brick-photo';

/** 用户编辑状态：槽位照片与 pan/zoom、文本内容、镂空列表、质感/文字效果选择 */
export interface EditorState {
  /** slotId -> 已解码 ImageBitmap/HTMLImageElement */
  photos: Map<string, CanvasImageSource>;
  /** slotId -> pan/zoom（zoom 1 = cover 适配槽位） */
  transforms: Map<string, { panX: number; panY: number; zoom: number }>;
  /** textFieldId -> 当前文本 */
  texts: Map<string, string>;
  /** 镂空切片列表（用户点击创建，可多颗） */
  cutouts: Cutout[];
  /** 质感选择（TextureDef.style）；r21 起多选（数组，可同时叠多种质感） */
  textureStyles: string[];
  /** 自定义渐变底色（G9 等 backgroundGradient 模板可覆盖；缺省用模板默认） */
  gradientOverride?: {
    from: string;
    to: string;
    mode?: 'smooth' | 'splitX' | 'splitY' | 'weave' | 'fluid';
    /** 撞色分割线位置（0~1，0.5=中线；smooth/weave/fluid 忽略） */
    split?: number;
    /** r27 多段渐变方向与标志（透传模板同款字段） */
    stops?: { at: number; color: string }[];
    dir?: 'v' | 'h';
    vignette?: boolean;
    dotGrid?: boolean;
    /** 003：程序化 shader 背景（优先于渐变）；r31 dotsBlurBg/corrugated 黑白版 */
    shader?: 'glass' | 'ripple' | 'dotsBlurBg' | 'corrugated';
  };
  /** 照片局部材质（r20）：仅照片槽区域，不影响全局质感 */
  photoMaterial?: PhotoMaterial;
  /** credit 文字颜色覆盖（r20：color picker，仅 credit） */
  creditColor?: string;
  /** 字体覆盖（r35：全局同步——诗句行/sticker 洞块/credit 全走它；%SZ=字号占位符） */
  fontOverride?: string;
  /** 文字效果覆盖（r_fix：textEffect 进 state，替代直接改共享模板常量的写法） */
  textEffectOverride?: 'plain' | 'block' | 'halftone';
  /** 镜面模糊窗口大小（r20 图8：相对照片宽 0~1，固定居中） */
  mirrorWindow?: number;
  /** 积木格宽相对源图宽度；不随预览/导出尺寸改变。 */
  brickSize?: number;
}

/** seed 驱动的确定性伪随机（LCG；同 seed 同序列 → 导出可复现） */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** 星形路径（中心 cx,cy、外接半径 r，画布坐标） */
function traceStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  points: number,
  innerRatio: number,
  rotation: number,
): void {
  const steps = points * 2;
  ctx.beginPath();
  for (let i = 0; i < steps; i++) {
    const rad = i % 2 === 0 ? r : r * innerRatio;
    const a = rotation + (i / steps) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * sparkle：四角闪星（细长菱形四芒，innerRatio 小则芒细长）。
 * 复用 traceStar，points=4 + 默认 innerRatio 0.18。
 */
function traceSparkle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rotation: number,
): void {
  traceStar(ctx, cx, cy, r, 4, 0.18, rotation);
}

/**
 * burst：尖刺爆炸星（G6 von dutch 参考图形状）。
 * traceStar 的变体：外点尖锐、内点半径带 per-point 抖动，产生不规则爆炸感。
 */
function traceBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
): void {
  const rand = seededRandom(seed);
  const points = 7;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const outer = i % 2 === 0;
    const rad = outer ? r * (0.85 + rand() * 0.15) : r * (0.25 + rand() * 0.12);
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * shard：不规则方形路径。以 seed 生成 4~6 个顶点的凸多边形，
 * 在基础方形上做确定性抖动（同 seed 同形状，反馈 #6）。
 * 顶点在半径 [0.55r, r] 的方形极坐标环上取点再连线。
 */
function traceShard(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
): void {
  const rand = seededRandom(seed);
  const corners = 4 + Math.floor(rand() * 3); // 4~6 顶点
  ctx.beginPath();
  for (let i = 0; i < corners; i++) {
    const a = (i / corners) * Math.PI * 2 + rand() * 0.5;
    const rad = r * (0.55 + rand() * 0.45);
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad * 0.9; // 略压扁，偏方形感
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function traceCutout(ctx: CanvasRenderingContext2D, c: Cutout, w: number, h: number): void {
  const cx = c.cx * w;
  const cy = c.cy * h;
  const r = c.r * w;
  if (c.shape === 'star') {
    traceStar(ctx, cx, cy, r, c.points ?? 5, c.innerRatio ?? 0.45, (c.rotation ?? 0) * Math.PI * 2);
  } else if (c.shape === 'sparkle') {
    traceSparkle(ctx, cx, cy, r, (c.rotation ?? 0) * Math.PI * 2);
  } else if (c.shape === 'burst') {
    traceBurst(ctx, cx, cy, r, c.seed ?? 1);
  } else {
    traceShard(ctx, cx, cy, r, c.seed ?? 1);
  }
}

/**
 * 照片绘制：cover 适配 + pan/zoom + 黑白/双色调。
 * （V2 反馈 #1：拖拽由交互层改 transforms 实现，渲染只读。）
 */
function drawPhoto(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  iw: number,
  ih: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  t: { panX: number; panY: number; zoom: number },
  effect: 'grayscale' | 'duotone' | 'none',
  shadowColor: string | undefined,
  lightColor: string | undefined,
): void {
  const base = Math.max(rw / iw, rh / ih) * t.zoom;
  const dw = iw * base;
  const dh = ih * base;
  const ox = rx + (rw - dw) / 2 + t.panX;
  const oy = ry + (rh - dh) / 2 + t.panY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();
  ctx.drawImage(img, ox, oy, dw, dh);

  if (effect === 'grayscale') {
    // 灰色源 + saturation 混合 → 饱和度归零（Canvas 2D 原生混合模式）
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#808080';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.globalCompositeOperation = 'source-over';
  } else if (effect === 'duotone' && shadowColor && lightColor) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#808080';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.globalCompositeOperation = 'lighten';
    ctx.fillStyle = shadowColor;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = lightColor;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

/**
 * r34 质感分组：画在照片图层之下的质感（照片盖在其上）。
 * 其余质感（噪点颗粒/盲文凸点/米白点阵等）画在照片之上（见 renderTemplate 层序）。
 */
const TEXTURES_BELOW_PHOTO = new Set<TextureStyle>([
  'glassTex',
  'rippleTex',
  'dotsBlur',
  'corrugated',
  'halftoneWave',
]);

/**
 * 质感纹理（V2 反馈 #4 + r9 + 003 shader 质感）。全部确定性（seed 固定），无随机源。
 * grain=噪点颗粒；misprint=双色套印；paper=纸纹；r9 新增三种照片纹理感：
 * scanline=扫描线；dots=半调网点整版；glitch=RGB 错位条纹。
 * 003：procedural 名对应 ShaderName 时走 WebGL 灰度光照层（中性灰基准，overlay 叠加），
 * WebGL 不可用静默跳过（jsdom 测试环境自动 no-op）。
 */
function drawTexture(ctx: CanvasRenderingContext2D, def: TextureDef, w: number, h: number): void {
  // 003 shader 质感：灰度光照层直接贴入（外层统一控制 opacity/blend）
  const shaderCanvas = getShaderCanvas(
    def.procedural as Parameters<typeof getShaderCanvas>[0],
    w,
    h,
  );
  if (shaderCanvas) {
    ctx.save();
    ctx.globalAlpha = def.opacity;
    ctx.globalCompositeOperation = def.blend;
    ctx.drawImage(shaderCanvas, 0, 0, w, h);
    ctx.restore();
    return;
  }
  const rand = seededRandom(0xc0ffee);
  ctx.save();
  ctx.globalAlpha = def.opacity;
  ctx.globalCompositeOperation = def.blend;

  if (def.procedural === 'noise') {
    const step = Math.max(2, Math.round(w / 500));
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (rand() < 0.14) {
          ctx.fillStyle = rand() < 0.5 ? '#ffffff' : '#000000';
          ctx.fillRect(x, y, step, step);
        }
      }
    }
  } else if (def.procedural === 'glitchart') {
    // r13 故障风（图2 SEOUL）：局部化——不是全屏均匀，只在确定性 rand 选出的
    // 几条水平条带内画「扫描线 + RGB 错位」，其余区域干净；条带内叠噪点。
    const bandH = Math.max(4, h / 90); // 条带高度
    const bands = 5; // 全图只有 5 条故障带（局部、非全屏）
    for (let i = 0; i < bands; i++) {
      const y = rand() * (h - bandH);
      // 3a) 条带内扫描线（局部）：非均匀细横线
      ctx.fillStyle = '#000000';
      let ly = y;
      while (ly < y + bandH) {
        ctx.globalAlpha = def.opacity * (0.4 + rand() * 0.6);
        ctx.fillRect(0, ly, w, Math.max(1, h / 1000));
        ly += Math.max(2, (h / 300) * (0.5 + rand()));
      }
      ctx.globalAlpha = def.opacity;
      // 3b) 条带内 RGB 错位：红/青水平错开条带（越界自然裁掉）
      const shift = (rand() - 0.5) * w * 0.05;
      ctx.fillStyle = 'rgba(255,0,60,0.55)';
      ctx.fillRect(shift, y, w, bandH * (0.3 + rand() * 0.4));
      ctx.fillStyle = 'rgba(0,255,220,0.4)';
      ctx.fillRect(-shift, y + bandH * 0.4, w, bandH * (0.25 + rand() * 0.35));
      // 3c) 条带内叠噪点（r13：这个效果同样要叠噪点）
      const step = Math.max(2, Math.round(w / 400));
      for (let yy = y; yy < y + bandH; yy += step) {
        for (let xx = 0; xx < w; xx += step) {
          if (rand() < 0.3) {
            ctx.globalAlpha = def.opacity * 0.8;
            ctx.fillStyle = rand() < 0.5 ? '#ffffff' : '#000000';
            ctx.fillRect(xx, yy, step, step);
          }
        }
      }
      ctx.globalAlpha = def.opacity;
    }
  } else if (def.procedural === 'braille') {
    // r12 盲文凸点（图1）：网格点阵，每点 = 亮心 + 深色偏移投影（浮雕感），
    // 密度低于 halftone、点距大，确定性 rand 决定哪些格有点（成簇感）。
    // r21 用户反馈：密集度再降（网格更大、点更稀）
    const cell = Math.max(20, w / 28);
    const dotR = cell * 0.18;
    for (let y = cell / 2; y < h; y += cell) {
      for (let x = cell / 2; x < w; x += cell) {
        if (rand() < 0.55) continue; // 稀疏成簇：略过部分格
        // 投影（右下偏移，深色）
        ctx.globalAlpha = def.opacity * 0.5;
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(x + dotR * 0.5, y + dotR * 0.5, dotR, 0, Math.PI * 2);
        ctx.fill();
        // 亮心（浮雕高光）
        ctx.globalAlpha = def.opacity;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = def.opacity;
      }
    }
  } else if (def.procedural === 'dots') {
    // r9 半调网点：整版网格圆点（每格半径带确定性抖动，避免机械网格感）
    const cell = Math.max(6, w / 90);
    ctx.fillStyle = '#000000';
    for (let y = cell / 2; y < h; y += cell) {
      for (let x = cell / 2; x < w; x += cell) {
        ctx.beginPath();
        ctx.arc(
          x + (rand() - 0.5) * cell * 0.2,
          y + (rand() - 0.5) * cell * 0.2,
          cell * (0.18 + rand() * 0.14),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  } else if (def.procedural === 'dotGrid') {
    // r32 米白点阵：与背景 dotGrid（r27 图15）同款 —— 均匀等距小圆点，无抖动。
    // 点色带透明度（opacity 由外层 globalAlpha 再控），blend=overlay 时透出底色。
    ctx.fillStyle = '#f5f2ea';
    const step = w / 32;
    for (let y = step; y < h; y += step) {
      for (let x = step; x < w; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.8, step * 0.035), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (def.procedural === 'misprint') {
    // 双色套印：整版分别向两侧偏移的半透明红/青罩，模拟错版
    ctx.fillStyle = 'rgba(200,16,46,0.5)';
    ctx.fillRect(-w * 0.006, 0, w, h);
    ctx.fillStyle = 'rgba(40,160,170,0.35)';
    ctx.fillRect(w * 0.006, 0, w, h);
  } else if (def.procedural === 'paper') {
    // 纸纹：横向细纹 + 稀疏斑块
    ctx.fillStyle = '#000000';
    for (let y = 0; y < h; y += Math.max(2, Math.round(h / 700))) {
      ctx.globalAlpha = def.opacity * (0.4 + rand() * 0.6);
      ctx.fillRect(0, y, w, 1);
    }
    ctx.globalAlpha = def.opacity;
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(120,90,60,0.5)' : 'rgba(255,250,240,0.6)';
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, (0.002 + rand() * 0.01) * w, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 网点图案填充（文字 halftone 效果用）：小圆点阵 */
function halftonePattern(
  ctx: CanvasRenderingContext2D,
  cell: number,
  w: number,
): CanvasPattern | null {
  const tile = document.createElement('canvas');
  tile.width = cell;
  tile.height = cell;
  const tctx = tile.getContext('2d');
  if (!tctx) return null;
  tctx.fillStyle = '#000000';
  tctx.beginPath();
  tctx.arc(cell / 2, cell / 2, cell * 0.32, 0, Math.PI * 2);
  tctx.fill();
  void w;
  return ctx.createPattern(tile, 'repeat');
}

/**
 * 文字绘制（槽位制，反馈 #7）：先测宽，超出槽宽则缩字号（下限 40%），
 * 槽位由模板布局保证互不重叠。支持 4 种效果。
 * inlineImage（G9 typow）：把 content 中 [charStart,charEnd) 区间的字符
 * 替换为照片小裁块（前段文字 + 裁块 + 后段文字三段绘制）。
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  content: string,
  rect: { x: number; y: number; w: number; h: number },
  maxFontSize: number,
  color: string,
  align: 'left' | 'right' | 'center',
  textEffect: 'plain' | 'block' | 'halftone',
  blockColor: string | undefined,
  w: number,
  h: number,
  inline?: {
    charStart: number;
    charEnd: number;
    aspect: number;
    img: CanvasImageSource | undefined;
  },
  /** r35 字体覆盖（全局）：font 简写模板（%SZ=字号占位符；缺省 900 Archivo Black） */
  fontOverride?: string,
): void {
  if (!content) return;
  const rx = rect.x * w;
  const ry = rect.y * h;
  const rw = rect.w * w;
  const rh = rect.h * h;

  // G9 嵌图：拆三段（前文 / 挖空块 / 后文）。
  // 挖空块尺寸 = 被挖字符实测量宽（layoutPoemLine 统一排版，
  // 与置换段两侧同一矩形，反馈 #3：1:1 置换不缩放）
  if (inline) {
    const fieldLike = {
      rect,
      fontSize: maxFontSize,
      align,
      inlineImage: inline as NonNullable<TextField['inlineImage']>,
    } as TextField;
    const layout = layoutPoemLine(
      ctx,
      content,
      fieldLike,
      fieldLike.inlineImage ?? inline,
      w,
      h,
      fontOverride,
    );
    if (layout.size <= 0) return;
    const before = content.slice(0, inline.charStart);
    const after = content.slice(inline.charEnd);
    const baseline = ry + rh * 0.78;
    ctx.font = (fontOverride ?? "900 %SZpx 'Archivo Black', 'Arial Black', sans-serif").replace(
      '%SZ',
      String(layout.size),
    );
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const drawSeg = (seg: string, sx: number) => {
      // 实心字：实色直接绘制（r8 反馈：浮雕半透明不要，要实心）
      ctx.fillStyle = color;
      ctx.fillText(seg, sx, baseline);
    };
    let cursor = layout.startX;
    if (before) {
      drawSeg(before, cursor);
      cursor += layout.beforeW;
    }
    // 挖空位：置换段画 1:1 置换块（照片裁块）；无照片时画占位色块
    const ih0 = inline.img && 'height' in inline.img ? (inline.img.height as number) : 0;
    if (!inline.img || !ih0) {
      ctx.fillStyle = '#8ab4f8';
      ctx.fillRect(cursor, baseline - layout.size * 0.98, layout.holeW, layout.size * 0.98);
      ctx.fillStyle = color;
    }
    cursor += layout.holeW + layout.gapW;
    if (after) drawSeg(after, cursor);
    return;
  }

  // 从字号上限量宽缩小，包含字形左右外伸，不再在40%处停止。
  let size = maxFontSize * h;
  const fontTpl = fontOverride ?? "900 %SZpx 'Archivo Black', 'Arial Black', sans-serif";
  ctx.textAlign = 'left';
  const measure = () => {
    ctx.font = fontTpl.replace('%SZ', String(size));
    const metrics = ctx.measureText(content);
    const left = Math.max(0, metrics.actualBoundingBoxLeft ?? 0);
    const right = Math.max(metrics.width, metrics.actualBoundingBoxRight ?? 0);
    return { width: metrics.width, left, right, total: left + right };
  };
  let m = measure();
  // ponytail: 最多64轮量宽，异常字体不继续绘制；需要更精细拟合时再换算法。
  for (let attempt = 0; attempt < 64 && m.total > rw; attempt++) {
    size *= Math.min(0.99, rw / m.total);
    m = measure();
  }
  if (!Number.isFinite(m.total) || m.total > rw || size <= 0) return;

  const baseline = ry + rh * 0.78; // 槽内视觉基线
  const x =
    align === 'left'
      ? rx + m.left
      : align === 'right'
        ? rx + rw + m.width - m.right
        : rx + rw / 2 + (m.left + m.width - m.right) / 2;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';

  if (textEffect === 'block' && blockColor) {
    // 色块衬底（图 7 you wanna take a bite）：测量文本实际宽，画衬底再叠字
    const tw = Math.min(ctx.measureText(content).width, rw);
    const bx = align === 'left' ? x : align === 'right' ? x - tw : x - tw / 2;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = blockColor;
    ctx.fillRect(bx - size * 0.12, baseline - size * 0.82, tw + size * 0.24, size * 1.02);
    ctx.restore();
    ctx.fillStyle = color;
    ctx.fillText(content, x, baseline);
  } else if (textEffect === 'halftone') {
    // 网点挖空（图 8 CATTLE）：先画实心描边层，再以网点图案填充内芯
    const pattern = halftonePattern(ctx, Math.max(4, size * 0.16), w);
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillText(content, x, baseline);
    if (pattern) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = pattern;
      ctx.fillText(content, x, baseline);
    }
    ctx.restore();
  } else {
    ctx.fillStyle = color;
    ctx.fillText(content, x, baseline);
  }
}

/** 诗句行的排版解：字号（含自适应缩放）与各段 x 坐标（画布系） */
interface PoemLineLayout {
  size: number;
  startX: number;
  beforeW: number;
  holeW: number;
  gapW: number;
  afterX: number;
}

/**
 * 诗句行排版（与 drawText inline 分支同规则）：按含字形外伸的总宽自适应，
 * 挖空块宽 = 被挖字符在**缩放后字号**下的实测量宽（两侧块同一尺寸，反馈 #3）。
 * r35 字体全局同步：fontOverride 透传（%SZ 模板，与 drawText 同一字体栈）。
 */
function layoutPoemLine(
  ctx: CanvasRenderingContext2D,
  content: string,
  field: TextField,
  inline: NonNullable<TextField['inlineImage']>,
  w: number,
  h: number,
  fontOverride?: string,
): PoemLineLayout {
  const rw = field.rect.w * w;
  const before = content.slice(0, inline.charStart);
  const frag = content.slice(inline.charStart, inline.charEnd);
  const after = content.slice(inline.charEnd);
  const font = (size: number) =>
    (fontOverride ?? "900 %SZpx 'Archivo Black', 'Arial Black', sans-serif").replace(
      '%SZ',
      String(size),
    );
  let size = field.fontSize * h;
  ctx.textAlign = 'left';
  const measure = () => {
    ctx.font = font(size);
    const beforeMetrics = ctx.measureText(before);
    const fragMetrics = ctx.measureText(frag);
    const afterMetrics = ctx.measureText(after);
    const beforeW = beforeMetrics.width;
    const holeW =
      Math.max(0, fragMetrics.actualBoundingBoxLeft ?? 0) +
      Math.max(fragMetrics.width, fragMetrics.actualBoundingBoxRight ?? 0);
    const gapW = size * 0.12;
    const afterW = afterMetrics.width;
    const left = Math.max(0, beforeMetrics.actualBoundingBoxLeft ?? 0);
    const right = Math.max(0, (afterMetrics.actualBoundingBoxRight ?? afterW) - afterW);
    return {
      beforeW,
      holeW,
      gapW,
      afterW,
      left,
      total: left + beforeW + holeW + gapW + afterW + right,
    };
  };
  let m = measure();
  // 与普通文字一样最多64轮，不以40%字号下限放任长句溢出。
  for (let attempt = 0; attempt < 64 && m.total > rw; attempt++) {
    size *= Math.min(0.99, rw / m.total);
    m = measure();
  }
  if (!Number.isFinite(m.total) || m.total > rw || size <= 0) size = 0;
  const slotX = field.rect.x * w;
  const startX =
    field.align === 'left'
      ? slotX + m.left
      : field.align === 'right'
        ? slotX + rw - m.total + m.left
        : slotX + (rw - m.total) / 2 + m.left;
  return {
    size,
    startX,
    beforeW: m.beforeW,
    holeW: m.holeW,
    gapW: m.gapW,
    afterX: startX + m.beforeW + m.holeW + m.gapW,
  };
}

/**
 * 双色底 paint（r5）：按 mode 生成 fillStyle。
 * smooth=对角渐变；splitX/splitY=撞色分割（split=分割线位置 0~1，默认 0.5）。
 * 坐标系以 (gx,gy) 为整幅画布原点的偏移（离屏洞块采样用）——分割线位置随偏移平移，
 * 保证洞块显示的正是该画布位置的原色。
 */
function dualToneFill(
  ctx: CanvasRenderingContext2D,
  gradDef: {
    from: string;
    to: string;
    mode?: 'smooth' | 'splitX' | 'splitY' | 'weave' | 'fluid';
    split?: number;
    stops?: { at: number; color: string }[];
    dir?: 'v' | 'h';
    vignette?: boolean;
    dotGrid?: boolean;
  },
  w: number,
  h: number,
  gx = 0,
  gy = 0,
): string | CanvasGradient {
  // r23 多段渐变（显式 stops 优先）；r27 dir：v=竖向（默认）/h=横向（图15）
  if (gradDef.stops && gradDef.stops.length >= 2) {
    const g =
      gradDef.dir === 'h'
        ? ctx.createLinearGradient(-gx, 0, w - gx, 0)
        : ctx.createLinearGradient(0, -gy, 0, h - gy);
    for (const s of gradDef.stops) g.addColorStop(Math.min(1, Math.max(0, s.at)), s.color);
    return g;
  }
  const split = Math.min(0.9, Math.max(0.1, gradDef.split ?? 0.5));
  if (gradDef.mode === 'splitX' || gradDef.mode === 'splitY') {
    // 上下分割：上 from 下 to，分割线位置可调。splitX 视作 splitY（一律上下分界）。
    // r18 修复：gradient 跨度 = 全幅画布映射进本地系（global 0 → -gy、global h → h-gy），
    // stop = split → 分割线全局位置恒等于 split*h，主渲染与洞块采样是同一条线：
    // 滑杆居中 → 线落画布中线；线在采样窗口外 → 窗口自然显示对应侧纯色
    const g = ctx.createLinearGradient(0, -gy, 0, h - gy);
    g.addColorStop(split - 0.04, gradDef.from);
    g.addColorStop(split + 0.04, gradDef.to);
    return g;
  }
  if (gradDef.mode === 'weave') {
    // r19 柔性交织（图1 蒂芙尼蓝×卡地亚红）：软对角过渡带 + 色团互渗。
    // 对角大过渡带（宽软、0.42→0.58 渐变）+ 色团（from 侧团落到 to 区/反之）。
    // 离屏采样时 gx/gy 已把窗口原点对到诗句洞位，色团布局随窗口平移——
    // 洞块显示的正是该画布位置的原色（与主渲染同构）。
    // 色团画不进 fillStyle（只能返回一种 paint），团由 renderTemplate 绘制：
    // 这里只给过渡带，色团互渗由 dualToneWeaveBlobs 画（同 seed 确定性）。
    const band = ctx.createLinearGradient(-gx, -gy, w * 0.8 - gx, h * 0.9 - gy);
    band.addColorStop(0, gradDef.from);
    band.addColorStop(0.42, gradDef.from);
    band.addColorStop(0.58, gradDef.to);
    band.addColorStop(1, gradDef.to);
    return band;
  }
  // smooth：原对角渐变
  const g = ctx.createLinearGradient(-gx, -gy, w * 0.35 - gx, h - gy);
  g.addColorStop(0, gradDef.from);
  g.addColorStop(1, gradDef.to);
  return g;
}

/**
 * r22 流体光晕渐变（图1/2 重做）：非周期的径向发光团互渗。
 * 低分辨率离屏（w/6）画 6~8 个径向渐变云团（from/to 交替、确定性随机点位），
 * 整层放大贴回 —— 放大即软化（双线性插值天然互渗），无任何正弦/周期结构。
 * 亮团集中上半（发光感），暗部沉底；再叠噪点由全局质感负责。
 */
function drawFluidGlow(
  ctx: CanvasRenderingContext2D,
  gradDef: { from: string; to: string },
  w: number,
  h: number,
): void {
  // 低分辨率离屏：插值放大自带软化晕染
  const lw = Math.max(32, Math.round(w / 6));
  const lh = Math.max(32, Math.round(h / 6));
  const off = document.createElement('canvas');
  off.width = lw;
  off.height = lh;
  const octx = off.getContext('2d');
  if (!octx) return;
  // 基色（to 侧沉底）
  octx.fillStyle = gradDef.to;
  octx.fillRect(0, 0, lw, lh);
  // 云涡（r28 更像图13）：三色涡卷团（from 橙 / 白 / to 深蓝穿插），
  // 每团双径向叠拉出方向感（涡卷雏形），数量加密互渗
  const rand = seededRandom(0x910d);
  const colors = [gradDef.from, '#ffffff', gradDef.from, gradDef.to, '#ffffff'];
  const blobs = 10;
  for (let i = 0; i < blobs; i++) {
    const color = colors[i % colors.length];
    const isDark = color === gradDef.to;
    const cx = (0.1 + rand() * 0.8) * lw;
    // 亮团偏上半（发光感），暗团沉底
    const cy = isDark ? (0.55 + rand() * 0.4) * lh : (0.06 + rand() * 0.55) * lh;
    const r = lw * (0.2 + rand() * 0.32);
    // 同色双团错位叠（间距 ~r/3）：放大后成方向性拉丝 = 涡卷感
    for (const [dx, dy, rr] of [
      [0, 0, r],
      [r * 0.3, r * 0.18, r * 0.8],
    ]) {
      const g = octx.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, rr);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      octx.fillStyle = g;
      octx.fillRect(0, 0, lw, lh);
    }
  }
  // 放大贴回（插值软化 = 云雾互渗）
  ctx.drawImage(off, 0, 0, w, h);
}

/**
 * r20/r22 照片局部材质（仅照片槽区域，图5/6/7/8）。
 * 在离屏 canvas 上处理照片（cover+pan/zoom 已画好），再整块贴回：
 * 避免逐像素操作主画布（filter/位移采样都在离屏完成）。
 * r22 重做；r31：waterRipple 已删，glassRefract=左→右镂空规律递增；
 * mirrorBlur=模糊区叠轻噪点（非纯高斯）。
 */
function createBrickPhoto(img: CanvasImageSource, brickSize = 0.025): HTMLCanvasElement | null {
  const iw = 'width' in img ? Number(img.width) : 0;
  const ih = 'height' in img ? Number(img.height) : 0;
  if (!Number.isFinite(iw) || !Number.isFinite(ih) || iw <= 0 || ih <= 0) return null;
  const sample = document.createElement('canvas');
  const scale = Math.min(1, 512 / Math.max(iw, ih));
  sample.width = Math.max(1, Math.round(iw * scale));
  sample.height = Math.max(1, Math.round(ih * scale));
  const sctx = sample.getContext('2d');
  if (!sctx) return null;
  let grid: ReturnType<typeof sampleBrickGrid>;
  try {
    sctx.drawImage(img, 0, 0, sample.width, sample.height);
    const size = Number.isFinite(brickSize) ? Math.min(0.08, Math.max(0.0125, brickSize)) : 0.025;
    grid = sampleBrickGrid(sctx.getImageData(0, 0, sample.width, sample.height), 1 / size);
  } catch {
    return null;
  }
  // 固定源贴图分辨率，预览与导出只缩放它，不重新起网格。
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round((iw * 1024) / Math.max(iw, ih)));
  out.height = Math.max(1, Math.round((ih * 1024) / Math.max(iw, ih)));
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  const edge = Math.min(out.width / grid.columns, out.height / grid.rows),
    gap = edge * 0.035,
    radius = edge * 0.31;
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.columns; x++) {
      const i = (y * grid.columns + x) * 4;
      const [r, g, b, alpha] = grid.pixels.subarray(i, i + 4);
      if (!alpha) continue;
      // 整数格界无缝分区，避免 clip 抗锯齿让不透明照片的格缝透底。
      const px = Math.round((x * out.width) / grid.columns),
        py = Math.round((y * out.height) / grid.rows),
        cw = Math.round(((x + 1) * out.width) / grid.columns) - px,
        ch = Math.round(((y + 1) * out.height) / grid.rows) - py,
        cx = px + cw / 2,
        cy = py + ch / 2;
      const color = `rgb(${r},${g},${b})`;
      // 格内先绘制光照，最后统一应用透明度，避免多层叠画把半透明区变实心。
      ctx.save();
      ctx.beginPath();
      ctx.rect(px, py, cw, ch);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fillRect(px, py, cw, ch);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(px, py, cw, ch);
      ctx.fillStyle = color;
      ctx.fillRect(px + gap, py + gap, cw - gap * 2, ch - gap * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(px + gap, py + gap, cw - gap * 2, gap);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.arc(cx + radius * 0.12, cy + radius * 0.2, radius, 0, Math.PI * 2);
      ctx.fill();
      const shine = ctx.createRadialGradient(
        cx - radius * 0.4,
        cy - radius * 0.4,
        0,
        cx,
        cy,
        radius,
      );
      shine.addColorStop(0, 'rgba(255,255,255,0.65)');
      shine.addColorStop(0.4, color);
      shine.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      if (alpha < 255) {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.globalAlpha = alpha / 255;
        ctx.fillStyle = '#000';
        ctx.fillRect(px, py, cw, ch);
      }
      ctx.restore();
    }
  }
  return out;
}

function applyPhotoMaterial(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  material: PhotoMaterial,
  // 照片槽画布矩形 + cover 映射参数
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  dw: number,
  dh: number,
  ox: number,
  oy: number,
  windowScale: number, // mirrorBlur 窗口（相对照片宽 0~1）
): void {
  if (material === 'none') return;
  // 离屏：照片原始适配（不 clip），材质处理后贴回槽位
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.ceil(rw));
  off.height = Math.max(1, Math.ceil(rh));
  const octx = off.getContext('2d');
  if (!octx) return;
  octx.drawImage(img, ox - rx, oy - ry, dw, dh);

  if (material === 'glassRefract') {
    // 图6/7 玻璃分条（r32 修复）：纯切割不缩放——原图原样保留，
    // 每条右段直接挖空（clearRect），镂空宽度左→右等差递增（8%→28%），
    // 视觉是镂空而非形变。条缘叠软高光（模糊亮带）保持玻璃感。
    const strips = 10;
    const stripW = off.width / strips;
    for (let i = 0; i < strips; i++) {
      const x = i * stripW;
      // 镂空占比：8% → 28% 线性递增（规律递进，镂空整体不大）
      const gapRatio = 0.08 + (i / (strips - 1)) * 0.2;
      const gap = stripW * gapRatio;
      // 切割：挖掉条右段（露底色），图像其余部分 1:1 不动
      octx.clearRect(x + stripW - gap, 0, gap, off.height);
    }
    // 条缘软高光：每条左缘叠 1 条模糊半透亮竖带（非硬线）
    octx.save();
    octx.globalAlpha = 0.35;
    for (let i = 0; i <= strips; i++) {
      const x = i * stripW;
      const g = octx.createLinearGradient(x - stripW * 0.06, 0, x + stripW * 0.06, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.7)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      octx.fillStyle = g;
      octx.fillRect(x - stripW * 0.06, 0, stripW * 0.12, off.height);
    }
    octx.restore();
  } else if (material === 'mirrorBlur') {
    // 图8 镜面模糊 + 居中镂空窗口（r22 重做）：blur 层叠轻噪点（颗粒感，非纯高斯）。
    const src = document.createElement('canvas');
    src.width = off.width;
    src.height = off.height;
    src.getContext('2d')?.drawImage(off, 0, 0);
    // blur 层
    octx.save();
    octx.filter = `blur(${Math.max(4, off.width * 0.02)}px)`;
    octx.drawImage(src, 0, 0);
    octx.restore();
    // 模糊区叠噪点（被窗口挖空后只余模糊区颗粒）
    const rand = seededRandom(0x9217);
    const step = Math.max(2, Math.round(off.width / 300));
    octx.save();
    for (let y = 0; y < off.height; y += step) {
      for (let x = 0; x < off.width; x += step) {
        if (rand() < 0.4) {
          octx.globalAlpha = 0.1 + rand() * 0.15;
          octx.fillStyle = rand() < 0.5 ? '#ffffff' : '#000000';
          octx.fillRect(x, y, step, step);
        }
      }
    }
    octx.restore();
    // 窗口（固定居中，尺寸 windowScale × 照片宽；宽高比 0.8）
    const winW = Math.max(8, off.width * Math.min(0.9, Math.max(0.1, windowScale)));
    const winH = winW * 0.8;
    const wx = (off.width - winW) / 2;
    const wy = (off.height - winH) / 2;
    // 挖掉模糊+噪点层窗口区
    octx.globalCompositeOperation = 'destination-out';
    octx.fillRect(wx, wy, winW, winH);
    octx.globalCompositeOperation = 'source-over';
    // 清晰层填回窗口
    octx.drawImage(src, wx, wy, winW, winH, wx, wy, winW, winH);
    // 窗口细白描边（玻璃边感，参考图带框）
    octx.strokeStyle = 'rgba(255,255,255,0.55)';
    octx.lineWidth = Math.max(1, off.width * 0.003);
    octx.strokeRect(wx, wy, winW, winH);
  }

  // 贴回主画布（照片槽位）
  ctx.drawImage(off, rx, ry);
}

/**
 * 渲染入口：把 template + state 画到 ctx（画布尺寸 w×h）。
 * 同一函数服务预览（小尺寸）与导出（全尺寸）—— D-003。
 *
 * 层序：双色底 → 照片（完整）→ 切片（洞填 sliceColor + 转移块画在色块区）→ 质感 → 文字（最上）。
 */
export function renderTemplate(
  ctx: CanvasRenderingContext2D,
  template: Template,
  state: EditorState,
  w: number,
  h: number,
): string | undefined {
  const { layers } = template;
  const photos = state.photoMaterial === 'brickMosaic' ? new Map(state.photos) : state.photos;
  let materialWarning: string | undefined;
  if (state.photoMaterial === 'brickMosaic') {
    for (const [id, img] of photos) {
      const processed = createBrickPhoto(img, state.brickSize);
      if (processed) photos.set(id, processed);
      else materialWarning = '积木材质处理失败，已保留原图。';
    }
  }

  const gradDef = state.gradientOverride ?? template.backgroundGradient;
  // 003：shader 背景优先 —— 离屏 WebGL 渲一帧贴进来；WebGL 不可用回退渐变
  const shaderCanvas = gradDef?.shader ? getShaderCanvas(gradDef.shader, w, h) : null;
  if (shaderCanvas) {
    ctx.drawImage(shaderCanvas, 0, 0, w, h);
  } else {
    ctx.fillStyle = gradDef ? dualToneFill(ctx, gradDef, w, h) : '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }

  // r22 流体光晕：基色铺满后叠低分辨率云团（放大互渗）
  if (gradDef?.mode === 'fluid') {
    drawFluidGlow(ctx, gradDef, w, h);
  }
  // r27 图14：四边暗角（径向黑叠加聚焦中央）
  if (gradDef?.vignette) {
    const R = Math.hypot(w, h) / 2;
    const vg = ctx.createRadialGradient(w / 2, h / 2, R * 0.45, w / 2, h / 2, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }
  // r27 图15：白点网格（等距小圆点，技术感）
  if (gradDef?.dotGrid) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const step = w / 32;
    for (let y = step; y < h; y += step) {
      for (let x = step; x < w; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.8, step * 0.035), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // r19 weave 色团互渗：from 侧团落到 to 区（反之亦然），软模糊边（多层同心圆递减 alpha）
  if (gradDef?.mode === 'weave') {
    const rand = seededRandom(0x3a3b);
    const blob = (cx: number, cy: number, r: number, color: string) => {
      // 软边：3 层同心圆 alpha 递减，模拟未干颜料互渗
      for (let i = 3; i >= 1; i--) {
        ctx.globalAlpha = 0.22 * i * 0.5;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, (r * i) / 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const R = Math.min(w, h);
    const blobs = 10;
    for (let i = 0; i < blobs; i++) {
      // 前半团：from 色落入下半（to 区）；后半团：to 色翻上上半
      const isFrom = i % 2 === 0;
      const color = isFrom ? gradDef.from : gradDef.to;
      const cx = rand() * w;
      const cy = isFrom ? h * (0.55 + rand() * 0.4) : h * (0.05 + rand() * 0.4);
      blob(cx, cy, R * (0.08 + rand() * 0.1), color);
    }
  }

  for (const block of layers.colorBlocks) {
    ctx.fillStyle = block.color;
    ctx.fillRect(block.rect.x * w, block.rect.y * h, block.rect.w * w, block.rect.h * h);
  }

  // 质感层（r34 分两组）：
  // ① 画在图片图层之下的质感 —— 玻璃压花/水波纹/柔点网格/瓦楞光影/半调波：
  //    光效衬在照片后面（照片层之前绘制，照片盖上来只露边缘光效）
  for (const style of state.textureStyles) {
    if (style === 'none' || !TEXTURES_BELOW_PHOTO.has(style as TextureStyle)) continue;
    const texture = template.textures.find((t) => t.style === style);
    if (texture) {
      drawTexture(ctx, texture, w, h);
    }
  }

  // 照片层：完整绘制，不做任何挖除
  for (const slot of layers.photoSlots) {
    const img = photos.get(slot.id);
    if (!img) continue;
    const iw = 'width' in img ? (img.width as number) : 0;
    const ih = 'height' in img ? (img.height as number) : 0;
    if (!iw || !ih) continue;
    const t = state.transforms.get(slot.id) ?? { panX: 0, panY: 0, zoom: 1 };
    const material =
      state.photoMaterial === 'brickMosaic' ? 'none' : (state.photoMaterial ?? 'none');
    if (material === 'none') {
      drawPhoto(
        ctx,
        img,
        iw,
        ih,
        slot.rect.x * w,
        slot.rect.y * h,
        slot.rect.w * w,
        slot.rect.h * h,
        t,
        slot.effect,
        slot.shadowColor,
        slot.lightColor,
      );
    } else {
      // r20 照片局部材质：离屏处理（水波/玻璃分条/镜面模糊）后贴回槽位
      const rx = slot.rect.x * w;
      const ry = slot.rect.y * h;
      const rw = slot.rect.w * w;
      const rh = slot.rect.h * h;
      const base = Math.max(rw / iw, rh / ih) * t.zoom;
      const dw = iw * base;
      const dh = ih * base;
      const ox = rx + (rw - dw) / 2 + t.panX;
      const oy = ry + (rh - dh) / 2 + t.panY;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip(); // 材质效果严格限制在照片槽矩形内
      applyPhotoMaterial(
        ctx,
        img,
        material,
        rx,
        ry,
        rw,
        rh,
        dw,
        dh,
        ox,
        oy,
        state.mirrorWindow ?? 0.5,
      );
      // 照片处理效果（黑白/双色调）同样叠在材质层上
      if (slot.effect === 'grayscale') {
        ctx.globalCompositeOperation = 'saturation';
        ctx.fillStyle = '#808080';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.globalCompositeOperation = 'source-over';
      } else if (slot.effect === 'duotone' && slot.shadowColor && slot.lightColor) {
        ctx.globalCompositeOperation = 'saturation';
        ctx.fillStyle = '#808080';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.globalCompositeOperation = 'lighten';
        ctx.fillStyle = slot.shadowColor;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = slot.lightColor;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
  }

  // 切片层（V2 反馈 #5/#6）：洞 = sliceColor 实心形状盖在照片上；
  // 转移块 = 把照片对应区域重画到色块区预设位置（Q1=A 固定位置）
  for (const slot of layers.photoSlots) {
    const img = photos.get(slot.id);
    if (!img) continue;
    const iw = 'width' in img ? (img.width as number) : 0;
    const ih = 'height' in img ? (img.height as number) : 0;
    if (!iw || !ih) continue;
    const t = state.transforms.get(slot.id) ?? { panX: 0, panY: 0, zoom: 1 };
    const rx = slot.rect.x * w;
    const ry = slot.rect.y * h;
    const rw = slot.rect.w * w;
    const rh = slot.rect.h * h;
    const base = Math.max(rw / iw, rh / ih) * t.zoom;
    const dw = iw * base;
    const dh = ih * base;
    const ox = rx + (rw - dw) / 2 + t.panX;
    const oy = ry + (rh - dh) / 2 + t.panY;

    for (const c of state.cutouts) {
      // 1) 洞：sliceColor 实心盖住照片该区域
      ctx.save();
      traceCutout(ctx, c, w, h);
      ctx.fillStyle = c.sliceColor;
      ctx.fill();
      ctx.restore();

      // 2) 转移块：同形状 clip，把照片对应区域按 transfer 参数画到色块区。
      //    scale=1 即与洞同尺寸；transfer.scale 相对洞尺寸缩放（bug 修复：此前乘 w/r 放大约 1/r 倍）
      if (!c.transfer) continue;
      const tx = c.transfer.x * w;
      const ty = c.transfer.y * h;
      ctx.save();
      ctx.translate(tx, ty);
      if (c.transferRotation) ctx.rotate(c.transferRotation);
      ctx.scale(c.transfer.scale, c.transfer.scale);
      ctx.translate(-c.cx * w, -c.cy * h);
      traceCutout(ctx, c, w, h);
      ctx.clip();
      // 以洞中心的照片映射关系重绘（同 drawPhoto 的 cover 映射）
      ctx.drawImage(img, ox, oy, dw, dh);
      // 恢复照片处理效果（黑白照片的转移块也要黑白）
      if (slot.effect === 'grayscale') {
        ctx.globalCompositeOperation = 'saturation';
        ctx.fillStyle = '#808080';
        ctx.fillRect(c.cx * w - w, c.cy * h - h, w * 2, h * 2);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
  }

  // ② 画在图片图层之上的质感 —— 噪点颗粒/盲文凸点/米白点阵：
  //    颗粒/点阵直接压在照片上（r34 之前的原有层序，照片之文字之下）
  for (const style of state.textureStyles) {
    if (style === 'none' || TEXTURES_BELOW_PHOTO.has(style as TextureStyle)) continue;
    const texture = template.textures.find((t) => t.style === style);
    if (texture) {
      drawTexture(ctx, texture, w, h);
    }
  }

  // 文字层（槽位制 + 效果；inlineImage 从照片槽取材）
  for (const field of layers.texts) {
    // em随实际字号缩放，measureText与绘制共用字距；逐行复位避免串到其它文字。
    ctx.letterSpacing = `${field.letterSpacing ?? 0}em`;
    const content = state.texts.get(field.id) ?? field.default;
    const inline = field.inlineImage
      ? {
          charStart: field.inlineImage.charStart,
          charEnd: field.inlineImage.charEnd,
          aspect: field.inlineImage.aspect,
          sticker: field.inlineImage.sticker,
          photoSlotId: field.inlineImage.photoSlotId,
          img: photos.get(field.inlineImage.photoSlotId ?? 'main-photo'),
        }
      : undefined;
    // r22 credit 颜色覆盖仅 credit；r35 字体全局同步（诗句行 + sticker 洞块 + credit）
    const isCredit = field.id === 'credit';
    const creditColor = isCredit && state.creditColor ? state.creditColor : field.color;
    drawText(
      ctx,
      content,
      field.rect,
      field.fontSize,
      creditColor,
      field.align,
      state.textEffectOverride ?? field.textEffect,
      field.blockColor,
      w,
      h,
      inline,
      state.fontOverride,
    );
    // 1:1 置换（反馈 #3：挖空块 ⇄ 照片洞块是同一对矩形的整块互换）：
    // - 洞块尺寸 = 被挖字符在缩放后字号下的实测量宽 × 行高（两侧同一矩形）
    // - 诗句侧：照片挖洞块（渐变原色采样 + 字母）贴到挖空位
    // - 照片侧：诗句挖空位的照片裁块贴到洞里
    if (inline?.sticker && inline.charEnd > inline.charStart) {
      const frag = content.slice(inline.charStart, inline.charEnd);
      const fragImg = inline.img;
      const iw0 = fragImg && 'width' in fragImg ? (fragImg.width as number) : 0;
      const ih0 = fragImg && 'height' in fragImg ? (fragImg.height as number) : 0;
      if (frag && fragImg && iw0 && ih0) {
        // 照片槽映射参数（同照片层 cover 公式）：画布矩形 ↔ 源图坐标换算
        const photo = layers.photoSlots.find((s) => s.id === (inline.photoSlotId ?? 'main-photo'));
        if (photo && photo.rect.w > 0) {
          const t = state.transforms.get(photo.id) ?? { panX: 0, panY: 0, zoom: 1 };
          const prx = photo.rect.x * w;
          const pry = photo.rect.y * h;
          const prw = photo.rect.w * w;
          const prh = photo.rect.h * h;
          const base = Math.max(prw / iw0, prh / ih0) * t.zoom;
          const dw = iw0 * base;
          const dh = ih0 * base;
          const ox = prx + (prw - dw) / 2 + t.panX;
          const oy = pry + (prh - dh) / 2 + t.panY;

          // 两侧同一矩形：宽 = 被挖字符实测量宽，高 = 行高（drawText 同基准）
          const layout = layoutPoemLine(ctx, content, field, inline, w, h, state.fontOverride);
          if (layout.size <= 0) continue;
          const { holeW } = layout;
          const holeH = layout.size * 0.98;
          const baselineY = field.rect.y * h + field.rect.h * h * 0.78;
          const holeTop = baselineY - holeH;
          // 诗句侧洞块左上 x（挖空位）
          const poemHoleX = layout.startX + layout.beforeW;
          // 照片侧贴纸左上（模板 sticker 矩形）
          const stX = inline.sticker.rect.x * w;
          const stY = inline.sticker.rect.y * h;

          // 1) 照片侧洞：双色底在**诗句洞位**（上半）的原色采样 + 字母叠回。
          //    采样位置 = 洞块若未被换走时所处的画布位置（holeTop 对齐基线）
          const bgGradDef = state.gradientOverride ?? template.backgroundGradient;
          // 在离屏层画洞块（原色 + 字母），再整块平移到照片洞
          const off = document.createElement('canvas');
          off.width = Math.max(1, Math.ceil(holeW));
          off.height = Math.max(1, Math.ceil(holeH));
          const octx = off.getContext('2d');
          if (octx) {
            octx.letterSpacing = ctx.letterSpacing;
            // 离屏画布 = 洞块矩形：在 (0,0) 处画背景在诗句洞位的原色。
            // 双色底以整幅画布为坐标系，洞块采样原点 = (poemHoleX, holeTop)
            const bgShaderCanvas = bgGradDef?.shader
              ? getShaderCanvas(bgGradDef.shader, w, h)
              : null;
            if (bgShaderCanvas) {
              // shader 背景：直接从 shader 底图裁出洞位区域的像素
              octx.drawImage(
                bgShaderCanvas,
                poemHoleX,
                holeTop,
                Math.max(1, holeW),
                Math.max(1, holeH),
                0,
                0,
                off.width,
                off.height,
              );
            } else {
              octx.fillStyle = bgGradDef
                ? dualToneFill(octx, bgGradDef, w, h, poemHoleX, holeTop)
                : '#ffffff';
              octx.fillRect(0, 0, off.width, off.height);
            }
            // 字母居中叠回洞块（字号 = 行字号，宽超洞块则整体缩字号；r35 全局字体同步）
            const font = (size: number) =>
              (
                state.fontOverride ?? "900 %SZpx 'Archivo Black', 'Arial Black', sans-serif"
              ).replace('%SZ', String(size));
            let fs = layout.size;
            octx.font = font(fs);
            while (octx.measureText(frag).width > off.width && fs > layout.size * 0.4) {
              fs *= 0.92;
              octx.font = font(fs);
            }
            octx.textAlign = 'center';
            octx.textBaseline = 'alphabetic';
            // 实心字：实色直接绘制（r8 反馈：浮雕半透明不要，要实心）
            octx.fillStyle = inline.sticker.color;
            octx.fillText(frag, off.width / 2, off.height * 0.82);
            // 整块平移到照片洞（sticker 左上 = 洞块目标位置）
            ctx.drawImage(off, stX, stY);
          }

          // 2) 诗句侧图块 = 照片在贴纸矩形区域的裁块（1:1），贴到挖空位
          const sx0 = ((stX - ox) / dw) * iw0;
          const sy0 = ((stY - oy) / dh) * ih0;
          const sw0 = (holeW / dw) * iw0;
          const sh0 = (holeH / dh) * ih0;
          ctx.drawImage(
            fragImg,
            sx0,
            sy0,
            Math.max(1, sw0),
            Math.max(1, sh0),
            poemHoleX,
            holeTop,
            holeW,
            holeH,
          );
        }
      }
    }
  }
  return materialWarning;
}
