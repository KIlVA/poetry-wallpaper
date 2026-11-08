/**
 * 海报工具页：仅 Poetry Wallpaper 一个工作台（GrungeWorkbench 已删除，见 git 历史）。
 */
import { TypowWorkbench } from './components';
import { ensureCanvasFonts } from './fonts';

export function PosterPage() {
  return <TypowWorkbench prepareFonts={ensureCanvasFonts} />;
}
