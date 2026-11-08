// 独立美术色板，不对应实体零件库存。
const PALETTE = [
  [245, 243, 232],
  [218, 210, 184],
  [244, 214, 182],
  [228, 186, 147],
  [183, 133, 90],
  [111, 70, 43],
  [55, 35, 29],
  [155, 156, 148],
  [94, 100, 101],
  [40, 45, 49],
  [18, 21, 24],
  [189, 46, 51],
  [115, 30, 42],
  [237, 124, 38],
  [243, 198, 50],
  [133, 184, 151],
  [57, 129, 77],
  [26, 70, 54],
  [61, 157, 172],
  [144, 187, 208],
  [47, 100, 164],
  [29, 48, 86],
  [104, 72, 125],
  [210, 131, 147],
];

/** 源图坐标上的有限色网格；透明区域不混入黑色。 */
export function sampleBrickGrid(image: Pick<ImageData, 'data' | 'width' | 'height'>, columns = 40) {
  const { width, height, data } = image;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(width * height * 4) ||
    data.length !== width * height * 4 ||
    !Number.isFinite(columns) ||
    columns <= 0
  )
    throw new RangeError('积木采样需要有效的 RGBA 图片与网格尺寸');
  // ponytail: 最长边至多 96 格；实测需要更细节时再提高上限。
  const cols = Math.max(
    1,
    Math.min(width, 96, Math.round(columns), Math.floor((96 * width) / height)),
  );
  const rows = Math.max(1, Math.min(height, 96, Math.round((height / width) * cols)));
  const pixels = new Uint8ClampedArray(cols * rows * 4);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const x0 = Math.floor((x * width) / cols),
        x1 = Math.floor(((x + 1) * width) / cols);
      const y0 = Math.floor((y * height) / rows),
        y1 = Math.floor(((y + 1) * height) / rows);
      let alpha = 0,
        red = 0,
        green = 0,
        blue = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * width + sx) * 4,
            a = data[i + 3];
          alpha += a;
          red += data[i] * a;
          green += data[i + 1] * a;
          blue += data[i + 2] * a;
        }
      }
      if (!alpha) continue;
      red /= alpha;
      green /= alpha;
      blue /= alpha;
      let [nearest] = PALETTE;
      let distance = Infinity;
      for (const color of PALETTE) {
        const error = (red - color[0]) ** 2 + (green - color[1]) ** 2 + (blue - color[2]) ** 2;
        if (error < distance) {
          nearest = color;
          distance = error;
        }
      }
      const i = (y * cols + x) * 4;
      pixels.set(nearest, i);
      pixels[i + 3] = alpha / ((x1 - x0) * (y1 - y0));
    }
  }
  return { columns: cols, rows, pixels };
}
