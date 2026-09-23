// 牌の絵（SVG）。画像ファイルを使わず、図形と文字で描く。
// viewBox は 60 × 80。牌の枠や影は CSS 側で描く。

import { isRedTile, kindOf, type Tile } from '../engine/tile.ts';

const RED = '#c8102e';
const GREEN = '#127a3e';
const BLUE = '#1d3f8f';
const BLACK = '#1a1a1a';

const MINCHO = `'Hiragino Mincho ProN','Yu Mincho','YuMincho','Noto Serif JP','Noto Serif CJK JP',serif`;

const cache = new Map<string, string>();

/** 牌の絵。yoko = true で横向き（リーチ宣言牌・鳴いた牌） */
export function tileSvg(t: Tile, aka: boolean, yoko = false): string {
  const k = kindOf(t);
  const red = aka && isRedTile(t);
  const key = `${k}${red ? 'r' : ''}${yoko ? 'y' : ''}`;
  let svg = cache.get(key);
  if (!svg) {
    svg = yoko
      ? `<svg viewBox="0 0 80 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g transform="translate(0,60) rotate(-90)">${face(k, red)}</g></svg>`
      : `<svg viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${face(k, red)}</svg>`;
    cache.set(key, svg);
  }
  return svg;
}

function face(k: number, red: boolean): string {
  if (k < 9) return manzu(k + 1, red);
  if (k < 18) return pinzu(k - 8, red);
  if (k < 27) return souzu(k - 17, red);
  return honor(k - 27);
}

const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

function manzu(n: number, red: boolean): string {
  const numColor = red ? RED : BLACK;
  return (
    `<text x="30" y="36" font-size="30" font-family="${MINCHO}" font-weight="700" text-anchor="middle" fill="${numColor}">${KANJI[n - 1]}</text>` +
    `<text x="30" y="70" font-size="30" font-family="${MINCHO}" font-weight="700" text-anchor="middle" fill="${RED}">萬</text>`
  );
}

// 筒子の円の位置と色
type Dot = [number, number, string];

function pinLayout(n: number): { r: number; dots: Dot[] } {
  const B = BLUE;
  const G = GREEN;
  const R = RED;
  switch (n) {
    case 1:
      return { r: 20, dots: [[30, 40, R]] };
    case 2:
      return { r: 11, dots: [[30, 22, G], [30, 58, B]] };
    case 3:
      return { r: 9, dots: [[15, 17, B], [30, 40, R], [45, 63, G]] };
    case 4:
      return { r: 10, dots: [[17, 22, B], [43, 22, G], [17, 58, G], [43, 58, B]] };
    case 5:
      return { r: 9, dots: [[16, 18, B], [44, 18, G], [30, 40, R], [16, 62, G], [44, 62, B]] };
    case 6:
      return { r: 8, dots: [[18, 15, G], [42, 15, G], [18, 42, R], [42, 42, R], [18, 65, R], [42, 65, R]] };
    case 7:
      return {
        r: 7,
        dots: [[13, 12, G], [30, 21, G], [47, 30, G], [18, 48, R], [42, 48, R], [18, 67, R], [42, 67, R]],
      };
    case 8:
      return {
        r: 7,
        dots: [[18, 12, B], [42, 12, B], [18, 30, B], [42, 30, B], [18, 49, B], [42, 49, B], [18, 67, B], [42, 67, B]],
      };
    default:
      return {
        r: 7,
        dots: [
          [13, 15, B], [30, 15, B], [47, 15, B],
          [13, 40, R], [30, 40, R], [47, 40, R],
          [13, 65, G], [30, 65, G], [47, 65, G],
        ],
      };
  }
}

function pinzu(n: number, red: boolean): string {
  const { r, dots } = pinLayout(n);
  return dots
    .map(([x, y, c]) => {
      const col = red ? RED : c;
      return (
        `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${col}" stroke-width="${r * 0.28}"/>` +
        `<circle cx="${x}" cy="${y}" r="${r * 0.45}" fill="${col}"/>` +
        (n === 1 ? `<circle cx="${x}" cy="${y}" r="${r * 0.7}" fill="none" stroke="${GREEN}" stroke-width="1.5"/>` : '')
      );
    })
    .join('');
}

// 索子の竹 1 本（中心 x, y、縦向き）
function stick(x: number, y: number, color: string, h = 22): string {
  const w = 7;
  const top = y - h / 2;
  return (
    `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${h}" rx="3" fill="${color}"/>` +
    `<line x1="${x - w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y}" stroke="#fff" stroke-width="1.4"/>` +
    `<line x1="${x}" y1="${top + 2}" x2="${x}" y2="${top + h - 2}" stroke="#fff" stroke-opacity="0.35" stroke-width="1.2"/>`
  );
}

function souzu(n: number, red: boolean): string {
  const G = red ? RED : GREEN;
  const R = RED;
  const B = red ? RED : BLUE;
  switch (n) {
    case 1:
      return bird(red);
    case 2:
      return stick(30, 22, G) + stick(30, 58, B);
    case 3:
      return stick(30, 22, G) + stick(18, 58, B) + stick(42, 58, B);
    case 4:
      return stick(18, 22, G) + stick(42, 22, B) + stick(18, 58, B) + stick(42, 58, G);
    case 5:
      return stick(16, 22, G) + stick(44, 22, B) + stick(30, 40, R) + stick(16, 58, B) + stick(44, 58, G);
    case 6:
      return [14, 30, 46].map((x) => stick(x, 22, G)).join('') + [14, 30, 46].map((x) => stick(x, 58, B)).join('');
    case 7:
      return (
        stick(30, 13, R, 18) +
        [14, 30, 46].map((x) => stick(x, 40, G, 18)).join('') +
        [14, 30, 46].map((x) => stick(x, 67, B, 18)).join('')
      );
    case 8: {
      // 上下に M 字・W 字
      const slant = (x: number, y: number, deg: number, c: string) =>
        `<g transform="rotate(${deg} ${x} ${y})">${stick(x, y, c, 22)}</g>`;
      return (
        stick(10, 22, G) + slant(23, 22, 20, G) + slant(37, 22, -20, G) + stick(50, 22, G) +
        stick(10, 58, B) + slant(23, 58, -20, B) + slant(37, 58, 20, B) + stick(50, 58, B)
      );
    }
    default:
      return (
        [14, 30, 46].map((x) => stick(x, 13, G, 18)).join('') +
        [14, 30, 46].map((x) => stick(x, 40, x === 30 ? R : B, 18)).join('') +
        [14, 30, 46].map((x) => stick(x, 67, G, 18)).join('')
      );
  }
}

/** 一索の鳥（孔雀）。緑の体、青い翼と尾羽、赤いとさか */
function bird(red: boolean): string {
  const G = red ? RED : GREEN;
  const B = red ? RED : BLUE;
  const R = RED;
  const feather = (cx: number, cy: number, deg: number, c: string) =>
    `<g transform="rotate(${deg} ${cx} ${cy})">` +
    `<ellipse cx="${cx}" cy="${cy}" rx="4.6" ry="13" fill="${c}"/>` +
    `<circle cx="${cx}" cy="${cy - 7}" r="2.4" fill="#fff"/>` +
    `<circle cx="${cx}" cy="${cy - 7}" r="1.4" fill="${R}"/>` +
    `</g>`;
  return (
    // 尾羽（扇形）
    feather(47, 30, 38, G) +
    feather(42, 25, 18, B) +
    feather(35, 23, -2, G) +
    // 足
    `<path d="M27 56 L25 69 M34 56 L35 69 M21 69 L29 69 M31 69 L39 69" stroke="${R}" stroke-width="2.2" stroke-linecap="round" fill="none"/>` +
    // 体と翼
    `<ellipse cx="30" cy="47" rx="14" ry="10.5" fill="${G}"/>` +
    `<path d="M22 45 Q32 36 41 47 Q31 54 22 45 Z" fill="${B}"/>` +
    // 首と頭
    `<path d="M22 44 Q16 40 17 31" stroke="${G}" stroke-width="7" stroke-linecap="round" fill="none"/>` +
    `<circle cx="17" cy="28" r="6.2" fill="${G}"/>` +
    // とさか
    `<path d="M15 22 L12 15 M17.5 21.5 L17.5 13.5 M20 22 L23 15.5" stroke="${R}" stroke-width="1.8" stroke-linecap="round"/>` +
    `<circle cx="12" cy="14.5" r="1.7" fill="${R}"/><circle cx="17.5" cy="13" r="1.7" fill="${R}"/><circle cx="23" cy="15" r="1.7" fill="${R}"/>` +
    // 目とくちばし
    `<circle cx="15.5" cy="27" r="1.9" fill="#fff"/><circle cx="15.2" cy="27" r="1" fill="#1a1a1a"/>` +
    `<path d="M11.5 28.5 L5.5 31 L11.8 32 Z" fill="#d9822b"/>`
  );
}

function honor(i: number): string {
  if (i === 4) {
    // 白：青い枠だけ
    return `<rect x="12" y="14" width="36" height="52" rx="4" fill="none" stroke="${BLUE}" stroke-width="3"/>`;
  }
  const chars = ['東', '南', '西', '北', '', '發', '中'];
  const colors = [BLACK, BLACK, BLACK, BLACK, '', GREEN, RED];
  return `<text x="30" y="53" font-size="40" font-family="${MINCHO}" font-weight="700" text-anchor="middle" fill="${colors[i]}">${chars[i]}</text>`;
}
