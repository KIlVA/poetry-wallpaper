/** 非模态编辑区：手机占真实布局行；关闭立即隐藏，不依赖动画。 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/ui';

interface EditorSheetProps {
 id: string;
 open: boolean;
 title: string;
 onClose: () => void;
 children: ReactNode;
}

export function EditorSheet({ id, open, title, onClose, children }: EditorSheetProps) {
 const regionRef = useRef<HTMLElement>(null);
 const wasOpen = useRef(false);
 const previousTitle = useRef(title);
 useLayoutEffect(() => {
 if (open && (!wasOpen.current || previousTitle.current !== title)) {
 regionRef.current?.focus({ preventScroll: true });
 }
 wasOpen.current = open;
 previousTitle.current = title;
 }, [open, title]);

 return (
 <section
 ref={regionRef}
 id={id}
 role="region"
 aria-labelledby={`${id}-title`}
 tabIndex={-1}
 hidden={!open}
 style={{ display: open ? undefined : 'none' }}
 className="workbench-editor"
 onKeyDown={(event) => {
 if (event.key === 'Escape') {
 event.preventDefault();
 event.stopPropagation();
 onClose();
 }
 }}
 onFocusCapture={(event) => {
 // 键盘压缩视口时允许文档正常滚动，让当前字段可到达。
 if (event.target instanceof HTMLInputElement) {
 const viewport = window.visualViewport;
 const rect = event.target.getBoundingClientRect();
 const top = viewport?.offsetTop ?? 0;
 const bottom = top + (viewport?.height ?? window.innerHeight);
 if (rect.top < top || rect.bottom > bottom) {
 event.target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
 }
 }
 }}
 >
 <div className="mb-4 flex items-center justify-between">
 <h2 id={`${id}-title`} className="workbench-region-title">
 {title}
 </h2>
 <Button
 type="button"
 variant="ghost"
 onClick={onClose}
 aria-label="收起面板"
 className="workbench-close"
 >
 <svg
 viewBox="0 0 24 24"
 className="h-5 w-5"
 fill="none"
 stroke="currentColor"
 strokeWidth="1.5"
 aria-hidden
 >
 <path d="M6 6l12 12M18 6L6 18" />
 </svg>
 </Button>
 </div>
 <div key={title} className="workbench-group">
 {children}
 </div>
 </section>
 );
}

export function SheetLabel({ children }: { children: string }) {
 return <h3 className="workbench-label">{children}</h3>;
}
