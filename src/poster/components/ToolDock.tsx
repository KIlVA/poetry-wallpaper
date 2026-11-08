/** 单实例编辑导航：手机底行，桌面标题下方；安全区由根消费。 */
import { Button } from '@/ui';

export type DockGroup = 'photo' | 'bg' | 'text' | 'style' | null;

interface ToolDockProps {
  open: DockGroup;
  onOpen: (g: DockGroup, trigger: HTMLButtonElement) => void;
  panelId: string;
  onDownload: () => void;
  hidden?: boolean;
  downloadBusy?: boolean;
  downloadError?: string;
}

// 24px 线性图标（内联 SVG，无依赖；A24：单一 icon family，stroke 1.5）
const icons = {
  photo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M4 17l4.5-4.5 3.5 3.5 3-3 5 5" />
    </svg>
  ),
  bg: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="1.5" />
      <path d="M3 15c4-6 8 4 12-2 3-4 6 3 6 3" />
    </svg>
  ),
  text: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M4 6h16M4 12h10M4 18h13" />
    </svg>
  ),
  style: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="7" cy="8" r="2" />
      <circle cx="12" cy="14" r="2.4" />
      <circle cx="17.5" cy="7.5" r="1.6" />
      <circle cx="6.5" cy="16.5" r="1.2" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M12 4v11m0 0l-4-4m4 4l4-4" />
      <path d="M4 19h16" />
    </svg>
  ),
};

const dockItems: {
  id: Exclude<DockGroup, null>;
  label: string;
  icon: keyof typeof icons;
}[] = [
  { id: 'photo', label: '照片', icon: 'photo' },
  { id: 'bg', label: '背景', icon: 'bg' },
  { id: 'text', label: '文字', icon: 'text' },
  { id: 'style', label: '风格', icon: 'style' },
];

export function ToolDock({
  open,
  onOpen,
  onDownload,
  panelId,
  hidden = false,
  downloadBusy = false,
  downloadError = '',
}: ToolDockProps) {
  return (
    <nav aria-label="编辑工具" className="workbench-dock" hidden={hidden}>
      <div className="workbench-dock-items">
        {dockItems.map((item) => (
          <Button
            key={item.id}
            type="button"
            variant="ghost"
            aria-expanded={open === item.id}
            aria-controls={panelId}
            onClick={(event) => onOpen(open === item.id ? null : item.id, event.currentTarget)}
            className="workbench-tool"
          >
            {icons[item.icon]}
            <span>{item.label}</span>
          </Button>
        ))}
        {/* 唯一主动作：生成期间立即禁重入，错误恢复后可重试。 */}
        <Button
          type="button"
          onClick={onDownload}
          disabled={downloadBusy}
          aria-busy={downloadBusy}
          className="workbench-download"
        >
          <span className="flex items-center [&>svg]:h-4 [&>svg]:w-4">
            {icons.download}
            {downloadBusy ? '下载中…' : 'Download'}
          </span>
        </Button>
      </div>
      <p role="status" aria-live="polite" className="workbench-feedback" hidden={!downloadError}>
        {downloadError}
      </p>
    </nav>
  );
}
