import type { InputHTMLAttributes } from 'react';

/** 原生 input 薄封装：透传全部属性（含 ref，React 19）。 */
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
 return <input {...props} />;
}
