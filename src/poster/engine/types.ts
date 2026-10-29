/**
 * 版式模板 schema —— 三件套共用引擎的类型定义。
 *
 * 设计约束（
 * - D-控件全部 preset/slider/enum，自由输入仅限文案字段
 * - D-单 renderer —— 渲染函数以画布尺寸参数化，预览与导出共用同一代码路径
 * - 风格配方全部来自模板 JSON + 资源，渲染代码不含模板专属硬编码
 * - 切片=「抠走+转移到色块区」（照片保持完整），镂空洞显示切片底色
 *
 * 模板坐标统一使用 0~1 归一化值（相对画布宽/高），同一份 JSON
 * 可在任意分辨率下渲染（预览小图 / 导出 3000²）。
 */

/** 归一化矩形：x/y 为左上角（相对画布宽高 0~1），w/h 同理 */
export interface NormRect {
 x: number;
 y: number;
 w: number;
 h: number;
}

/** 控件类型：schema 声明每个可调项用什么控件表达 */
export type ControlKind = 'preset' | 'slider' | 'enum' | 'text';

/** 控件描述：模板作者声明「用户能调什么」 */
export interface Control {
 id: string;
 kind: ControlKind;
 label: string;
 min?: number;
 max?: number;
 step?: number;
 options?: { value: string; label: string }[];
 default: string | number;
}

/** 照片槽位：用户上传图片的落位，含 pan/zoom 状态 */
export interface PhotoSlot {
 id: string;
 rect: NormRect;
 /** 照片处理配方（模板定义，用户不可调部分） */
 effect: 'grayscale' | 'duotone' | 'none';
 shadowColor?: string;
 lightColor?: string;
}

/**
 * 镂空切片（V2：抠走+转移）。用户点击照片创建，可缩放；
 * 洞里显示 sliceColor，切下来的图块转移到 transferRect。
 */
export interface Cutout {
 id: string;
 /**
 * star = 经典五角星；sparkle = 四角闪星；burst = 尖刺爆炸星（von dutch 并入）；
 * shard = 不规则方形（seed 决定形状）
 */
 shape: 'star' | 'sparkle' | 'burst' | 'shard';
 /** 中心（相对照片槽位归一化） */
 cx: number;
 cy: number;
 /** 外接半径（相对画布宽） */
 r: number;
 /** star: 角数/内半径比/旋转；shard: 随机种子 */
 points?: number;
 innerRatio?: number;
 rotation?: number;
 seed?: number;
 /** 洞里露出的颜色（模板默认，UI 可改） */
 sliceColor: string;
 /** 切下的块贴到色块区的位置（相对色块区归一化）；省略 = 不转移显示 */
 transfer?: { x: number; y: number; scale: number };
 /** 转移块旋转（弧度） */
 transferRotation?: number;
}

/**
 * 文字段（V2：槽位制防重叠）。
 * 每词一个固定槽（rect），文字在槽内自适应：超长自动缩字号，
 * 槽位互不重叠由模板布局保证（槽宽 = 1/词数 或显式矩形）。
 * fontSize 为归一化值（相对画布高），是槽内最大字号。
 */
export interface TextField {
 id: string;
 /** 文字槽：约束文字边界，防 overlap（#7） */
 rect: NormRect;
 fontSize: number;
 /** 字距，相对实际字号的 em；缺省为0。 */
 letterSpacing?: number;
 /** 输入字符上限（Unicode码点），不改写已有超限文本。 */
 maxChars?: number;
 color: string;
 align: 'left' | 'right' | 'center';
 /** 文字效果：plain=无，block=色块衬底，halftone=网点挖空（#4） */
 textEffect: 'plain' | 'block' | 'halftone';
 /** block 效果的衬底色 */
 blockColor?: string;
 default: string;
 /**
 * typow 式嵌图位（新生成器 G9）：在词内挖空并嵌入照片小裁块。
 * 定义哪个字符区间被替换（charStart/charEnd 为字符索引，含头不含尾），
 * 裁块从用户照片取（photoRect 相对照片归一化）。
 */
 inlineImage?: {
 charStart: number;
 charEnd: number;
 /** 裁块宽高比（宽/高），决定嵌入块形状 */
 aspect: number;
 /**
 * 1:1 置换的贴纸落位（相对画布）：诗句挖掉 [charStart,charEnd) 的字母，
 * 照片上该矩形挖洞露底色 + 字母叠回，诗句侧图块 = 照片该矩形的裁块。
 */
 sticker?: { rect: NormRect; color: string };
 /** 取材的照片槽 id（缺省 main-photo） */
 photoSlotId?: string;
 };
}

/** 质感纹理选项（shader 质感）：整版叠加，用户枚举选择 */
export type TextureStyle =
 | 'none'
 | 'grain'
 | 'misprint'
 | 'paper'
 | 'glitchArt' // 故障风：扫描线+RGB 错位融合，局部条带+噪点
 | 'halftone'
 | 'braille' // 盲文凸点
 | 'glassTex' // 压花玻璃光照层（Voronoi 凹凸，中性灰 overlay）
 | 'rippleTex' // 水波纹光照层（波场法线高光）
 | 'dotsBlur' // 柔点网格（软边圆点+局部失焦）
 | 'corrugated' // 瓦楞光影（竖向棱纹+大尺度光斑）
 | 'halftoneWave' // 半调波纹（域扭曲 AM 网点）
 | 'dotGrid'; // 米白点阵（多色背景 dotGrid 同款，均匀小点）

/** 整版纹理叠加定义（模板内全部质感选项的配方，按 state.textureStyles 多选启用） */
export interface TextureDef {
 style: TextureStyle;
 /** procedural 名与 shaders.ts 的 ShaderName 对应时走 WebGL 通道，其余走 2D 程序化 */
 procedural:
 | 'noise'
 | 'misprint'
 | 'paper'
 | 'glitchart'
 | 'dots'
 | 'braille'
 | 'glassTex'
 | 'rippleTex'
 | 'dotsBlur'
 | 'corrugated'
 | 'halftoneWave'
 | 'dotGrid';
 opacity: number;
 blend: GlobalCompositeOperation;
}

/** 色块：矩形纯色区域（切片转移的目的地） */
export interface ColorBlock {
 id: string;
 rect: NormRect;
 color: string;
}

/**
 * 照片局部材质：仅作用在照片槽区域内的程序化效果，
 * 不影响全局质感（噪点/halftone 等照旧叠在最上层）。
 * glassRefract=玻璃折射分条；
 * mirrorBlur=镜面模糊+居中镂空窗口。
 */
export type PhotoMaterial = 'none' | 'glassRefract' | 'mirrorBlur' | 'brickMosaic';

/** 浮雕文字参数 */
export interface EmbossOptions {
 /** 亮面偏移方向（归一化，相对字号） */
 dx: number;
 dy: number;
 /** 亮/暗面透明度 */
 strength: number;
}

/**
 * 模板：一份 JSON/常量描述完整版式。
 * canvasW/H 是设计基准（归一化坐标的参照系），渲染可任意放大。
 */
export interface Template {
 id: string;
 name: string;
 canvasW: number;
 canvasH: number;
 controls: Control[];
 /** 质感配方表：style -> 纹理参数（模板提供全部选项） */
 textures: TextureDef[];
 layers: {
 colorBlocks: ColorBlock[];
 photoSlots: PhotoSlot[];
 texts: TextField[];
 };
 /**
 * 渐变底色（可选）：typow 式生成器的双色底；缺省 = 纯白底。
 * mode：smooth=渐变过渡；splitX/splitY=撞色分割；
 * weave=柔性交织；
 * fluid=流体光晕。
 * split：撞色分割线位置 0~1（默认 0.5 中线，可调；weave/fluid 忽略）。
 */
 backgroundGradient?: {
 from: string;
 to: string;
 mode?: 'smooth' | 'splitX' | 'splitY' | 'weave' | 'fluid';
 split?: number;
 /** 多段垂直渐变（图1 蓝粉三段/图4 黑白）：显式 stop 列表，优先于 from/to */
 stops?: { at: number; color: string }[];
 /** stops 渐变方向：v=竖向（默认）| h=横向（图15 白→黄→青→绿） */
 dir?: 'v' | 'h';
 /** 图14：四边暗角（径向黑叠加，聚焦中央） */
 vignette?: boolean;
 /** 图15：白点网格叠加（等距小圆点） */
 dotGrid?: boolean;
 /** 程序化 shader 背景（优先于渐变；WebGL 不可用时回退 from/to 渐变），加黑白版 */
 shader?: 'glass' | 'ripple' | 'dotsBlurBg' | 'corrugated';
 };
}
