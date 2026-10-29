# PoetryWallpaper

诗句嵌图壁纸工作台：上传照片，配上三行诗句，导出竖版壁纸 PNG（1290×2293）。

- 照片：竖图（9:16）自动居中裁为 1:1；可换玻璃分条 / 镜面模糊 / 积木颗粒材质
- 文字：三行诗句（每行 40 字符）+ 署名（24 字符），全局字体同步
- 背景：单色渐变 / 双色撞色 / 多色渐变与程序化 shader 底
- 风格：噪点、盲文、玻璃、水波、瓦楞等整版质感，可多选
- 纯校样模式全屏预览；导出走与预览同一渲染路径

技术栈：Vite + React 19 + TypeScript + Tailwind CSS v4 + Canvas 2D / WebGL。测试用 Vitest + happy-dom。

## 使用

```bash
bun install        # 或 npm install
bun run dev        # 本地开发
bun run test       # 运行测试
bun run build      # 构建 dist/
```
