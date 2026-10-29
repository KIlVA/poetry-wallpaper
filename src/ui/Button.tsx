import type { ButtonHTMLAttributes } from 'react';

/** 按钮变体：视觉差异由 .poster-workbench 样式层覆写，这里只收窄类型。 */
export type ButtonVariant = 'default' | 'ghost' | 'outline' | 'secondary' | 'destructive' | 'link';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
 variant?: ButtonVariant;
};

/** 原生 button 薄封装：透传全部属性（含 ref，React 19）。 */
export function Button({ type, ...props }: ButtonProps) {
 return <button type={type ?? 'button'} {...props} />;
}
