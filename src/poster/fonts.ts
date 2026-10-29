/**
 * canvas 字体加载：@font-face 不随 canvas ctx.font 触发下载
 * （浏览器只给 DOM 文本用到的字体发起请求），canvas 静默回退后备栈。
 * 渲染前显式 document.fonts.load 一次；结果缓存，失败静默走后备栈。
 */
const FAMILIES = [
 'Archivo Black',
 'VT323',
 'Montserrat',
 'Climate Crisis',
 'Limelight',
 'Zen Tokyo Zoo',
] as const;

let pending: Promise<unknown> | null = null;

export function ensureCanvasFonts(): Promise<unknown> {
 pending ??= Promise.all(FAMILIES.map((f) => document.fonts.load(`16px '${f}'`))).catch(() => {
 pending = null; // 失败可重试（离线恢复后）
 });
 return pending;
}
