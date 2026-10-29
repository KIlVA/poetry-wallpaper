import { describe, expect, it } from 'vitest';
import { sampleBrickGrid } from '../engine';

describe('积木照片采样', () => {
  it('透明像素不污染色块，保留平均透明度', () => {
    const grid = sampleBrickGrid(
      {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([189, 46, 51, 255, 0, 0, 0, 0]),
      },
      1,
    );
    expect([grid.columns, grid.rows, ...grid.pixels]).toEqual([1, 1, 189, 46, 51, 128]);
  });

  it('粗网格平均颜色后收色，细网格保留不同色块，且重复采样确定', () => {
    const image = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 255, 255, 255, 165, 7, 39, 255]),
    };
    const coarse = sampleBrickGrid(image, 1);
    expect([...coarse.pixels]).toEqual([210, 131, 147, 255]);
    const fine = sampleBrickGrid(image, 2);
    expect([fine.columns, fine.rows]).toEqual([2, 1]);
    expect([...fine.pixels.slice(0, 3)]).not.toEqual([...fine.pixels.slice(4, 7)]);
    expect(sampleBrickGrid(image, 2)).toEqual(fine);
  });

  it('完全透明区保持透明，大网格有上限并保持图片宽高比', () => {
    const transparent = sampleBrickGrid(
      { width: 2, height: 2, data: new Uint8ClampedArray(16) },
      2,
    );
    expect([...transparent.pixels]).toEqual(new Array(16).fill(0));
    const bounded = sampleBrickGrid(
      { width: 100, height: 200, data: new Uint8ClampedArray(80000) },
      10000,
    );
    expect([bounded.columns, bounded.rows]).toEqual([48, 96]);
  });

  it('拒绝无效尺寸、损坏RGBA和非有限网格，避免无界采样', () => {
    expect(() => sampleBrickGrid({ width: 0, height: 1, data: new Uint8ClampedArray() })).toThrow(
      RangeError,
    );
    expect(() => sampleBrickGrid({ width: 1, height: 1, data: new Uint8ClampedArray(3) })).toThrow(
      RangeError,
    );
    expect(() =>
      sampleBrickGrid({ width: 1, height: 1, data: new Uint8ClampedArray(4) }, Infinity),
    ).toThrow(RangeError);
  });
});
