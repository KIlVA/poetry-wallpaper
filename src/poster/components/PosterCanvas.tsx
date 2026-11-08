/**
 * 海报画布组件：预览即小尺寸 Canvas（D-003）。
 * V2 交互：点击照片创建镂空（反馈 #3）、拖拽照片（反馈 #1）、滚轮缩放。
 * 点击/拖拽坐标 → 归一化 → 回调给页面层改 state。
 */
import { useCallback, useEffect, useRef } from 'react';
import { renderTemplate, type EditorState, type Template } from '../engine';

type Cutout = EditorState['cutouts'][number];

interface PosterCanvasProps {
  template: Template;
  state: EditorState;
  /** 预览渲染分辨率（导出时同函数放大重跑） */
  width?: number;
  /** 字体准备完成后在同一画布重绘；独立调用默认可绘制。 */
  fontsReady?: boolean;
  /** 照片材质回退提示；绘制成功时清空。 */
  onMaterialStatus?: (message: string) => void;
  /** 点击照片区：传归一化坐标（相对画布） */
  onCanvasClick?: (nx: number, ny: number) => void;
  /** 拖拽照片：归一化位移（相对画布宽/高） */
  onPhotoDrag?: (dx: number, dy: number) => void;
  /** 滚轮缩放照片 */
  onPhotoZoom?: (delta: number) => void;
  /** 选中镂空（用于删除/调大小），null = 无选中 */
  selectedCutoutId?: string | null;
  onSelectCutout?: (id: string | null) => void;
}

/** 判断点是否在任一镂空内（用外包圆近似，交互够用） */
function hitCutout(cutouts: Cutout[], nx: number, ny: number, aspect: number): Cutout | null {
  for (let i = cutouts.length - 1; i >= 0; i--) {
    const c = cutouts[i];
    const dx = nx - c.cx;
    const dy = (ny - c.cy) * aspect; // y 按画布比例换算，半径基于宽
    if (dx * dx + dy * dy <= c.r * c.r) return c;
  }
  return null;
}

export function PosterCanvas({
  template,
  state,
  width = 640,
  fontsReady = true,
  onMaterialStatus,
  onCanvasClick,
  onPhotoDrag,
  onPhotoZoom,
  selectedCutoutId,
  onSelectCutout,
}: PosterCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  /** pointerdown 起点坐标（用于区分拖拽与点击创建） */
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const h = Math.round((width * template.canvasH) / template.canvasW);
    canvas.width = width;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx || !fontsReady) return;
    const warning = renderTemplate(ctx, template, state, width, h);
    onMaterialStatus?.(warning ?? '');
    // 选中镂空的高亮描边（仅预览层，导出不含 —— 导出走纯 renderTemplate）
    const sel = state.cutouts.find((c) => c.id === selectedCutoutId);
    if (sel) {
      const r = sel.r * width;
      ctx.save();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(sel.cx * width, sel.cy * h, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }, [template, state, width, selectedCutoutId, fontsReady, onMaterialStatus]);

  const toNorm = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      nx: (e.clientX - rect.left) / rect.width,
      ny: (e.clientY - rect.top) / rect.height,
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const p = toNorm(e);
      if (!p) return;
      const aspect = template.canvasH / template.canvasW;
      // 命中镂空 → 选中（不启动拖拽）；否则进入照片拖拽
      const hit = hitCutout(state.cutouts, p.nx, p.ny, aspect);
      onSelectCutout?.(hit ? hit.id : null);
      if (!hit && (onPhotoDrag || onCanvasClick)) {
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        if (onPhotoDrag) {
          dragRef.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }
      }
    },
    [state.cutouts, template, toNorm, onSelectCutout, onPhotoDrag, onCanvasClick],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const d = dragRef.current;
      if (!d || !onPhotoDrag) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dx = (e.clientX - d.x) / rect.width;
      const dy = (e.clientY - d.y) / rect.height;
      dragRef.current = { x: e.clientX, y: e.clientY };
      onPhotoDrag(dx, dy);
    },
    [onPhotoDrag],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onPhotoZoom) return;
    // React 的 wheel 委托可能是 passive；仅有缩放回调时注册可取消监听。
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      onPhotoZoom(event.deltaY > 0 ? 0.95 : 1.05);
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, [onPhotoZoom]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      endDrag();
      // 位移极小（非拖拽）且未命中镂空 → 在照片上创建切片
      if (dragStartRef.current) {
        const moved =
          Math.abs(e.clientX - dragStartRef.current.x) +
          Math.abs(e.clientY - dragStartRef.current.y);
        if (moved <= 3) {
          const p = toNorm(e);
          if (p && !hitCutout(state.cutouts, p.nx, p.ny, template.canvasH / template.canvasW)) {
            onCanvasClick?.(p.nx, p.ny);
          }
        }
      }
      dragStartRef.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [endDrag, state.cutouts, template, toNorm, onCanvasClick],
  );

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="诗句壁纸预览"
      style={{
        width: 'auto',
        height: 'auto',
        maxWidth: '100%',
        maxHeight: '100%',
        aspectRatio: `${template.canvasW / template.canvasH}`,
        display: 'block',
        cursor: onCanvasClick
          ? 'crosshair'
          : onPhotoDrag
            ? 'grab'
            : onSelectCutout
              ? 'pointer'
              : 'default',
        touchAction: onPhotoDrag ? 'none' : onCanvasClick || onSelectCutout ? 'pan-y' : 'auto',
      }}
      onPointerDown={onPhotoDrag || onCanvasClick || onSelectCutout ? handlePointerDown : undefined}
      onPointerMove={onPhotoDrag ? handlePointerMove : undefined}
      onPointerUp={onPhotoDrag || onCanvasClick ? handlePointerUp : undefined}
      onPointerCancel={() => {
        endDrag();
        dragStartRef.current = null;
      }}
      onLostPointerCapture={() => {
        endDrag();
        dragStartRef.current = null;
      }}
      onPointerLeave={(event) => {
        if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          endDrag();
          dragStartRef.current = null;
        }
      }}
    />
  );
}
