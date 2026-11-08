/**
 * 程序化 shader 背景（003-poetry-wallpaper S3）。
 *
 * 零依赖：fragment shader 内联为字符串，离屏 WebGL canvas 渲一帧，
 * 再由 renderTemplate 用 drawImage 贴进 2D 管线。结果按 名称+尺寸 缓存，
 * 预览与导出（同尺寸）复用同一张底图 —— 确定性满足 AC-06。
 *
 * 来源：figcraft0/figcraft/glass-shader.html、ripple-shader.html（纯 WebGL，无外部资源）。
 */

/**
 * ShaderName：glass/ripple/dotsBlurBg/corrugated = 背景底色（全彩/黑白不透明）；
 * glassTex/rippleTex/dotsBlur/corrugated/halftoneWave = 整版质感（灰度光照层，overlay 叠加）。
 */
export type ShaderName =
  | 'glass'
  | 'ripple'
  | 'dotsBlurBg'
  | 'glassTex'
  | 'rippleTex'
  | 'dotsBlur'
  | 'corrugated'
  | 'halftoneWave';

const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

/** glass：压花玻璃色斑 —— 色斑场 + Voronoi 压花凹凸 + 法线光照 + 细颗粒（静态） */
const GLASS_FS = `precision highp float;
uniform vec2 u_res;

float hash1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec2 hash2(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
float vnoise(vec2 p){
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash1(i),hash1(i+vec2(1.,0.)),f.x),
             mix(hash1(i+vec2(0.,1.)),hash1(i+vec2(1.,1.)),f.x),f.y);
}
float vor(vec2 p){
  vec2 i=floor(p),f=fract(p); float d=8.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y));
    vec2 o=0.5+0.4*hash2(i+g);
    d=min(d,length(g+o-f));
  }
  return d;
}
float bump(vec2 p){
  float d1=vor(p*13.0);
  float d2=vor(p*27.0+7.3);
  return pow(clamp(1.0-d1,0.,1.),0.8)*0.75 + pow(clamp(1.0-d2,0.,1.),0.8)*0.25;
}
vec3 blobcol(vec2 q){
  vec3 c=vec3(0.97,0.99,1.0);
  c=mix(c,vec3(0.93,0.77,0.22),smoothstep(0.36,0.10,length(q-vec2(0.16,0.82))));
  c=mix(c,vec3(0.36,0.76,0.95),smoothstep(0.32,0.08,length(q-vec2(0.60,0.94))));
  c=mix(c,vec3(1.00,0.87,0.90),smoothstep(0.20,0.05,length(q-vec2(0.02,0.56))));
  c=mix(c,vec3(0.55,0.86,0.96),smoothstep(0.36,0.12,length(q-vec2(0.24,0.38))));
  c=mix(c,vec3(0.76,0.90,0.47),smoothstep(0.24,0.08,length(q-vec2(0.13,0.12))));
  c=mix(c,vec3(0.10,0.38,0.85),smoothstep(0.32,0.10,length(q-vec2(0.52,0.04))));
  c=mix(c,vec3(0.22,0.58,0.95),smoothstep(0.28,0.10,length(q-vec2(0.78,0.20))));
  return c;
}
void main(){
  vec2 p=gl_FragCoord.xy/u_res;
  vec2 q=p+0.13*vec2(vnoise(p*3.0),vnoise(p*3.0+4.2))-0.065;
  vec3 col=blobcol(q);
  col=mix(col,vec3(0.80,0.90,0.94),0.10);
  float e=0.004;
  float hx=bump(p+vec2(e,0.))-bump(p-vec2(e,0.));
  float hy=bump(p+vec2(0.,e))-bump(p-vec2(0.,e));
  vec3 n=normalize(vec3(-hx*1.6,-hy*1.6,1.0));
  vec3 L=normalize(vec3(-0.45,0.55,0.6));
  float diff=0.55+0.45*dot(n,L);
  float spec=pow(max(dot(n,normalize(L+vec3(0.,0.,1.))),0.0),24.0);
  col*=0.72+0.45*diff;
  col=mix(col,vec3(1.0),spec*0.35);
  col+=(hash1(gl_FragCoord.xy)-0.5)*0.06;
  gl_FragColor=vec4(col,1.0);
}`;

/** ripple：水波纹波场 —— 多波源正弦环 + 法线光照 + 薄荷青调色（u_time 固定取快照） */
const RIPPLE_FS = `precision highp float;
uniform vec2 u_res;
uniform float u_time;

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}

float ripple(vec2 p, vec2 c, float freq, float decay, float amp,
             float dirBias, vec2 dir, float t){
  vec2 d = p - c;
  float r = length(d);
  float ph = r*freq - t;
  float w = sin(ph) + 0.45*sin(2.0*ph + 1.3);
  float env = exp(-r*decay);
  float face = 0.55 + 0.45*dot(d/max(r,1e-4), dir);
  return amp * w * env * mix(1.0, face, dirBias);
}

float field(vec2 p, float t){
  float h = 0.0;
  h += ripple(p, vec2(-0.06, 0.05), 80.0, 5.0, 0.60, 0.0, vec2(1,0), t*2.2);
  h += ripple(p, vec2(-0.015,0.105),165.0, 9.0, 0.35, 0.0, vec2(1,0), t*2.9);
  h += ripple(p, vec2(-0.105,0.015),140.0, 9.0, 0.30, 0.0, vec2(1,0), t*1.8);
  h += ripple(p, vec2( 0.005,-0.01),185.0,10.0, 0.30, 0.0, vec2(1,0), t*2.4);
  h += ripple(p, vec2( 0.13, 0.27), 34.0, 2.2, 1.10, 0.75, normalize(vec2(0.75,-0.45)), t*1.5);
  return h;
}

void main(){
  // 全幅铺满（壁纸用，去掉原 demo 的 4:5 画框与画框外底色）；
  // 等比坐标（不再 x*1.25 拉伸）→ 波圈正圆（r31 反馈：圆圈改圆）
  vec2 c0 = (gl_FragCoord.xy - 0.5*u_res)/u_res.y;
  vec2 p = c0;
  float t = u_time * 0.4;

  float e = 0.002;
  float hx = field(p+vec2(e,0),t) - field(p-vec2(e,0),t);
  float hy = field(p+vec2(0,e),t) - field(p-vec2(0,e),t);
  vec3 n = normalize(vec3(-hx*6.0, -hy*6.0, 1.0));

  vec3 L = normalize(vec3(-0.35, 0.55, 0.75));
  vec3 H = normalize(L + vec3(0,0,1));
  float spec = pow(max(dot(n,H),0.0), 60.0);
  float diff = 0.5 + 0.5*dot(n,L);

  // 调色（回退原薄荷青；r31 反馈：多色背景全部回退上一版）
  float sh = field(p,t)*1.4 + (n.x+n.y)*0.5;
  vec3 col = mix(vec3(0.87,0.96,0.95), vec3(0.45,0.83,0.81), smoothstep(-0.3,0.4,sh));
  col = mix(col, vec3(0.13,0.62,0.63), smoothstep(0.2,0.9,sh));
  col *= 0.9 + 0.2*diff;
  col = mix(col, vec3(1.0), spec*0.9);
  col = mix(col, vec3(1.0,0.93,0.80), spec*exp(-length(p-vec2(-0.03,0.02))*4.0)*0.8);

  float mott = sin(p.x*23.0+1.7)*sin(p.y*19.0-0.6)*0.5 + sin(dot(p,vec2(11.0,13.0)))*0.5;
  col += mott*0.025;
  float g = hash(gl_FragCoord.xy);
  col += (g-0.5)*0.20;
  col += vec3(-0.015,0.005,0.02)*(g-0.5)*2.0;

  gl_FragColor = vec4(col,1.0);
}`;

/** ripple 动画快照时刻：预览与导出共用同一值（静态导出的确定性） */
const RIPPLE_TIME = 1;

/**
 * 整版质感 shader：输出灰度光照层（中性灰 0.5 = 无效果，overlay 下不改变底色；
 * 亮 = 高光，暗 = 阴影），不带调色 —— 底色由用户所选渐变决定。
 */
const GLASS_TEX_FS = `precision highp float;
uniform vec2 u_res;

float hash1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec2 hash2(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
float vor(vec2 p){
  vec2 i=floor(p),f=fract(p); float d=8.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y));
    vec2 o=0.5+0.4*hash2(i+g);
    d=min(d,length(g+o-f));
  }
  return d;
}
float bump(vec2 p){
  float d1=vor(p*13.0);
  float d2=vor(p*27.0+7.3);
  return pow(clamp(1.0-d1,0.,1.),0.8)*0.75 + pow(clamp(1.0-d2,0.,1.),0.8)*0.25;
}
void main(){
  vec2 p=gl_FragCoord.xy/min(u_res.x,u_res.y);
  float e=0.004;
  float hx=bump(p+vec2(e,0.))-bump(p-vec2(e,0.));
  float hy=bump(p+vec2(0.,e))-bump(p-vec2(0.,e));
  vec3 n=normalize(vec3(-hx*1.6,-hy*1.6,1.0));
  vec3 L=normalize(vec3(-0.45,0.55,0.6));
  float diff=0.55+0.45*dot(n,L);
  float spec=pow(max(dot(n,normalize(L+vec3(0.,0.,1.))),0.0),24.0);
  // 光照 → 中性灰偏移：0.5 基准，diff/spec 只做明暗
  float lum=0.5+(diff-0.775)*0.55+spec*0.35;
  lum+=(hash1(gl_FragCoord.xy)-0.5)*0.06;
  gl_FragColor=vec4(vec3(clamp(lum,0.,1.)),1.0);
}`;

const RIPPLE_TEX_FS = `precision highp float;
uniform vec2 u_res;
uniform float u_time;

float hash1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}

float ripple(vec2 p, vec2 c, float freq, float decay, float amp,
             float dirBias, vec2 dir, float t){
  vec2 d = p - c;
  float r = length(d);
  float ph = r*freq - t;
  float w = sin(ph) + 0.45*sin(2.0*ph + 1.3);
  float env = exp(-r*decay);
  float face = 0.55 + 0.45*dot(d/max(r,1e-4), dir);
  return amp * w * env * mix(1.0, face, dirBias);
}
float field(vec2 p, float t){
  float h = 0.0;
  h += ripple(p, vec2(-0.06, 0.05), 80.0, 5.0, 0.60, 0.0, vec2(1,0), t*2.2);
  h += ripple(p, vec2(-0.015,0.105),165.0, 9.0, 0.35, 0.0, vec2(1,0), t*2.9);
  h += ripple(p, vec2(-0.105,0.015),140.0, 9.0, 0.30, 0.0, vec2(1,0), t*1.8);
  h += ripple(p, vec2( 0.005,-0.01),185.0,10.0, 0.30, 0.0, vec2(1,0), t*2.4);
  h += ripple(p, vec2( 0.13, 0.27), 34.0, 2.2, 1.10, 0.75, normalize(vec2(0.75,-0.45)), t*1.5);
  return h;
}
void main(){
  // 等比坐标（与 rippleTex 背景一致的正圆波圈）
  vec2 c0 = (gl_FragCoord.xy - 0.5*u_res)/u_res.y;
  vec2 p = c0;
  float t = u_time * 0.4;

  float e = 0.002;
  float hx = field(p+vec2(e,0),t) - field(p-vec2(e,0),t);
  float hy = field(p+vec2(0,e),t) - field(p-vec2(0,e),t);
  vec3 n = normalize(vec3(-hx*6.0, -hy*6.0, 1.0));
  vec3 L = normalize(vec3(-0.35, 0.55, 0.75));
  vec3 H = normalize(L + vec3(0,0,1));
  float spec = pow(max(dot(n,H),0.0), 60.0);
  float diff = 0.5 + 0.5*dot(n,L);
  float lum=0.5+(diff-0.75)*0.5+spec*0.9;
  lum+=(hash1(gl_FragCoord.xy)-0.5)*0.18;
  gl_FragColor=vec4(vec3(clamp(lum,0.,1.)),1.0);
}`;

const DOTS_BLUR_FS = `precision highp float;
uniform vec2 u_res;
float hash1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  // r32 统一柔点：与背景版（dotsBlurBg）同尺寸同分布 ——
  // 网格 5、点半径 0.48（原径向衰减的最大值），均匀分布无衰减。
  vec2 p=(gl_FragCoord.xy-0.5*u_res)/u_res.y;
  vec2 f=fract(p*5.0)-0.5;
  float d=length(f);
  float dot_=smoothstep(0.48,0.48-0.14,d);
  float lum=0.5-dot_*0.45;
  lum+=(hash1(gl_FragCoord.xy)-0.5)*0.06;
  gl_FragColor=vec4(vec3(clamp(lum,0.,1.)),1.0);
}`;

/** 柔点网格背景版（r32）：米白灰调底 + 均匀黑点真实颜色输出（非灰度层）——
 *  与整版质感 dotsBlur 同尺寸同分布（网格 5、半径 0.48）；纯白底改米白 beige。 */
const DOTS_BLUR_BG_FS = `precision highp float;
uniform vec2 u_res;
void main(){
  vec2 p=(gl_FragCoord.xy-0.5*u_res)/u_res.y;
  vec2 f=fract(p*5.0)-0.5;
  float d=length(f);
  float dot_=smoothstep(0.48,0.48-0.14,d);
  // 底色米白灰调（原纯白 1.0 压到 beige）；点深灰（非纯黑，柔感）
  vec3 base=vec3(0.93,0.91,0.87);
  vec3 dotCol=vec3(0.12);
  vec3 col=mix(base,dotCol,dot_);
  gl_FragColor=vec4(clamp(col,0.,1.),1.0);
}`;

const CORRUGATED_FS = `precision highp float;
uniform vec2 u_res;
float hash1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash1(i),hash1(i+vec2(1.,0.)),f.x),
             mix(hash1(i+vec2(0.,1.)),hash1(i+vec2(1.,1.)),f.x),f.y);
}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vnoise(p);p=p*2.1+vec2(1.7,4.1);a*=.5;}return v;}
void main(){
  vec2 p=gl_FragCoord.xy/u_res.y;
  float fx=p.x*46.0;
  float ph=fract(fx);
  float slope=ph;
  float groove=smoothstep(0.0,0.10,ph)*smoothstep(1.0,0.90,ph);
  float rib=slope*0.75+0.25*groove;
  float light=fbm(p*vec2(1.6,1.1)+vec2(3.3,7.7));
  light=smoothstep(0.20,0.85,light);
  float shade=mix(0.15,1.15,light);
  // 棱纹亮度（0~1）→ 中性灰偏移：谷暗棱亮
  float lum=0.5+(rib*shade-0.55)*0.6;
  lum+=(hash1(gl_FragCoord.xy)-0.5)*0.14;
  gl_FragColor=vec4(vec3(clamp(lum,0.,1.)),1.0);
}`;

const HALFTONE_WAVE_FS = `precision highp float;
uniform vec2 u_res;
float hash1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash1(i),hash1(i+vec2(1.,0.)),f.x),
             mix(hash1(i+vec2(0.,1.)),hash1(i+vec2(1.,1.)),f.x),f.y);
}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vnoise(p);p=p*2.1+vec2(1.7,4.1);a*=.5;}return v;}
void main(){
  vec2 p=gl_FragCoord.xy/u_res.y;
  vec2 q=vec2(p.x*3.2, p.y*1.0);
  float a1=2.2*fbm(q*1.1+vec2(0.0,3.1));
  q=mat2(cos(a1),-sin(a1),sin(a1),cos(a1))*q;
  float a2=1.6*fbm(q*1.4+vec2(7.2,5.5));
  q=mat2(cos(a2),-sin(a2),sin(a2),cos(a2))*q;
  float g=fbm(vec2(q.x*2.4,q.y*0.8)+vec2(2.2,8.8));
  g=smoothstep(0.15,0.85,g);
  float ang=0.26;
  mat2 R=mat2(cos(ang),-sin(ang),sin(ang),cos(ang));
  vec2 hg=R*p*95.0;
  vec2 f=fract(hg)-0.5;
  float d=length(f);
  float r=0.15+0.42*g;
  // r31 二轮风格化：更锐的硬边点（smoothstep 带 0.04 窄过渡）
  float dot_=smoothstep(r,r-0.04,d);
  // 黑白对撞：点近全亮 0.96，空白近全暗 0.04（overlay 下强对比）
  float lum=0.04+dot_*0.92;
  lum+=(hash1(gl_FragCoord.xy)-0.5)*0.06;
  gl_FragColor=vec4(vec3(clamp(lum,0.,1.)),1.0);
}`;

const cache = new Map<string, HTMLCanvasElement>();

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(String(gl.getShaderInfoLog(sh)));
  }
  return sh;
}

/** ShaderName → fragment shader 源码 */
const FRAGMENTS: Record<ShaderName, string> = {
  glass: GLASS_FS,
  ripple: RIPPLE_FS,
  dotsBlurBg: DOTS_BLUR_BG_FS,
  glassTex: GLASS_TEX_FS,
  rippleTex: RIPPLE_TEX_FS,
  dotsBlur: DOTS_BLUR_FS,
  corrugated: CORRUGATED_FS,
  halftoneWave: HALFTONE_WAVE_FS,
};

/**
 * 渲染 shader 背景到离屏 canvas（同名同尺寸命中缓存）。
 * WebGL 不可用返回 null，调用方回退纯色底。
 */
export function getShaderCanvas(name: ShaderName, w: number, h: number): HTMLCanvasElement | null {
  // 调用方（drawTexture）以 TextureDef.procedural 断言传入，非 shader 名直接回退 2D 路径
  if (!FRAGMENTS[name]) return null;
  const key = `${name}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const gl = canvas.getContext('webgl');
  if (!gl) return null;
  try {
    const pr = gl.createProgram();
    if (!pr) return null;
    gl.attachShader(pr, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, compile(gl, gl.FRAGMENT_SHADER, FRAGMENTS[name]));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(pr, 'a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(pr, 'u_res');
    gl.uniform2f(uRes, w, h);
    if (name === 'ripple' || name === 'rippleTex') {
      const uT = gl.getUniformLocation(pr, 'u_time');
      if (uT) gl.uniform1f(uT, RIPPLE_TIME);
    }
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 缓存必须存 2D 拷贝而非 WebGL canvas 本身：每张缓存各持一个活 GL context，
    // 页面累计 10+ 个会被浏览器按上限强制 lost（最老的最先丢）→ 瓦楞等默认质感
    // 间歇性变空白且命中缓存永不重渲，只有刷新才恢复。渲染后同 task 内拷贝
    // （drawing buffer compositing 后会被清空，不能拖到下一帧再拷）并主动释放。
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    if (!octx) return null;
    octx.drawImage(canvas, 0, 0);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    cache.set(key, out);
    return out;
  } catch {
    return null;
  }
}
