# 海报引擎回归测试

测试使用 happy-dom 与记录型 Canvas 2D context，验证绘制调用和顺序，不代替浏览器像素、字体与 WebGL 目检。

- [渲染回归：红框8%边距、方图底边和元素包含关系、字符上限配置、长中文普通／嵌图文字继续缩字号与字形边界、短／空文本、字距同步与复位、积木同源与失败回退](render.test.ts)
- [积木采样：有限配色、透明度、确定性、网格上限与输入验证](brick-photo.test.ts)

覆盖 Poetry 确定性与词槽布局、字体与 credit 颜色覆盖、纹理路径及 shader 不可用时的处理。共享 shard、洞填色、transfer、grayscale 和 paper 由测试文件内的局部模板验证，不依赖退役的生产版式。
