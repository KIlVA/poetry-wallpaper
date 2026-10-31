/**
 * G9 typow 诗句嵌图模板（参考：A kaleidoscope { }of { }painted wings dance…）。
 *
 * 版式：紫粉渐变底 + 紧行距宽字距诗句列 + 居中方形照片，图文限制在统一区域。
 * 部分行的词中字符被替换为照片裁块（inlineImage，r6 修正挖空区间），
 * 照片区右下角为署名小字；主图与裁块共享照片来源。
 * 归一化坐标基准 1024×1820。
 */
import type { Template } from '../engine';

export const TYPOW_POEM: Template = {
  id: 'typow-poem',
  name: '诗句嵌图',
  canvasW: 1024,
  canvasH: 1820,
  controls: [],
  backgroundGradient: { from: '#b04ef0', to: '#ff5f8f' },
  // r12 盲文凸点；r31 二轮删故障风（glitchArt）；r32 删网点（halftone）、加米白点阵（dotGrid）
  // 003 shader 质感：灰度光照层整版叠加（中性灰基准 + overlay，底色透出）
  textures: [
    { style: 'none', procedural: 'noise', opacity: 0, blend: 'source-over' },
    { style: 'grain', procedural: 'noise', opacity: 0.14, blend: 'overlay' },
    { style: 'braille', procedural: 'braille', opacity: 0.5, blend: 'overlay' },
    { style: 'glassTex', procedural: 'glassTex', opacity: 0.5, blend: 'overlay' },
    { style: 'rippleTex', procedural: 'rippleTex', opacity: 0.45, blend: 'overlay' },
    { style: 'dotsBlur', procedural: 'dotsBlur', opacity: 0.3, blend: 'overlay' },
    { style: 'corrugated', procedural: 'corrugated', opacity: 0.35, blend: 'overlay' },
    { style: 'halftoneWave', procedural: 'halftoneWave', opacity: 0.3, blend: 'multiply' },
    { style: 'dotGrid', procedural: 'dotGrid', opacity: 0.75, blend: 'source-over' },
  ],
  layers: {
    colorBlocks: [],
    photoSlots: [
      // r42 方图收至84%宽，左右各8%；保持原底边，顶边由1:1比例反算。
      {
        id: 'main-photo',
        rect: {
          x: 0.08,
          y: 0.40 + (0.04 * 1024) / 1820,
          w: 0.84,
          h: (0.84 * 1024) / 1820,
        },
        effect: 'none',
      },
    ],
    texts: [
      // r42 图文共用红框边界；字号作为自适应上限，每行最多40字符。
      // 照片内裁块按旧照片框的相对位置同步缩放，保持0.055行距和0.06em字距。
      {
        // 第 1 行：A kaleido[挖 co]scope of painted wings dance（挖 co）
        id: 'line-1',
        rect: { x: 0.08, y: 0.17, w: 0.84, h: 0.05 },
        fontSize: 0.032,
        letterSpacing: 0.06,
        maxChars: 40,
        color: '#ffffff',
        align: 'left',
        textEffect: 'plain',
        default: 'A kaleidoscope of painted wings dance',
        inlineImage: {
          charStart: 10,
          charEnd: 12,
          aspect: 1.1,
          sticker: {
            rect: {
              x: 0.08 + ((0.42 - 0.04) * 0.84) / 0.92,
              y: 0.40 + (0.04 * 1024) / 1820 + ((0.08 + (0.04 * 1024) / 1820) * 0.84) / 0.92,
              w: (0.14 * 0.84) / 0.92,
              h: (0.05 * 0.84) / 0.92,
            },
            color: '#ffffff',
          },
        },
      },
      {
        // 第 2 行：across the vast and [挖 ran]quil（tranquil 挖 ran）
        id: 'line-2',
        rect: { x: 0.08, y: 0.225, w: 0.84, h: 0.05 },
        fontSize: 0.032,
        letterSpacing: 0.06,
        maxChars: 40,
        color: '#ffffff',
        align: 'left',
        textEffect: 'plain',
        default: 'across the vast and tranquil',
        inlineImage: {
          charStart: 21,
          charEnd: 24,
          aspect: 1.1,
          sticker: {
            rect: {
              x: 0.08 + ((0.2 - 0.04) * 0.84) / 0.92,
              y: 0.40 + (0.04 * 1024) / 1820 + ((0.18 + (0.04 * 1024) / 1820) * 0.84) / 0.92,
              w: (0.14 * 0.84) / 0.92,
              h: (0.05 * 0.84) / 0.92,
            },
            color: '#ffffff',
          },
        },
      },
      {
        // 第 3 行：cerulean [挖 sky]（sky 挖全词）
        // 第 3 行下移贴近照片顶边（照片顶 ≈0.4625，行底 0.45 留 0.0125 间隙）
        id: 'line-3',
        rect: { x: 0.08, y: 0.36, w: 0.84, h: 0.05 },
        fontSize: 0.032,
        letterSpacing: 0.06,
        maxChars: 40,
        color: '#ffffff',
        align: 'left',
        textEffect: 'plain',
        default: 'cerulean sky.',
        inlineImage: {
          charStart: 9,
          charEnd: 13,
          aspect: 0.9,
          sticker: {
            rect: {
              x: 0.08 + ((0.64 - 0.04) * 0.84) / 0.92,
              y: 0.40 + (0.04 * 1024) / 1820 + ((0.28 + (0.04 * 1024) / 1820) * 0.84) / 0.92,
              w: (0.12 * 0.84) / 0.92,
              h: (0.05 * 0.84) / 0.92,
            },
            color: '#ffffff',
          },
        },
      },
      {
        // 署名最多24字符；credit 下移贴照片 margin：底边距照片底 0.028 气口，
        // 右缘与照片右缘（x+w=0.92）对齐留 0.028 呼吸边，文字右对齐。
        id: 'credit',
        rect: { x: 0.08, y: 0.44 + (0.88 * 1024) / 1820 - 0.028 - 0.03, w: 0.812, h: 0.03 },
        fontSize: 0.012,
        letterSpacing: 0.06,
        maxChars: 24,
        color: '#7de0d3',
        align: 'right',
        textEffect: 'plain',
        default: 'Clupea harengus',
      },
    ],
  },
};
