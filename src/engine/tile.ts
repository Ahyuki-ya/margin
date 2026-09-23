// 牌の表現
//
// Tile: 物理的な牌 1 枚を表す 0..135 の ID。同じ種類の牌が 4 枚ずつ並ぶ（id >> 2 が種類）。
// Kind: 牌の種類 0..33。
//   0-8   萬子 1-9
//   9-17  筒子 1-9
//   18-26 索子 1-9
//   27-30 東南西北
//   31-33 白發中
// 赤ドラは各 5 の 1 枚目（ID 16, 52, 88）。赤ドラなしのルールでは普通の 5 として扱う。

export type Tile = number;
export type Kind = number;

export const NUM_KINDS = 34;
export const NUM_TILES = 136;

export const EAST = 27;
export const SOUTH = 28;
export const WEST = 29;
export const NORTH = 30;
export const HAKU = 31;
export const HATSU = 32;
export const CHUN = 33;

export const RED_TILES: readonly Tile[] = [16, 52, 88];

export const kindOf = (t: Tile): Kind => t >> 2;
export const isRedTile = (t: Tile): boolean => t === 16 || t === 52 || t === 88;

/** 0: 萬子, 1: 筒子, 2: 索子, 3: 字牌 */
export const suitOf = (k: Kind): number => (k < 27 ? Math.floor(k / 9) : 3);
/** 数牌の数字 1-9。字牌では 0 */
export const numOf = (k: Kind): number => (k < 27 ? (k % 9) + 1 : 0);
export const isHonor = (k: Kind): boolean => k >= 27;
export const isWind = (k: Kind): boolean => k >= 27 && k <= 30;
export const isDragon = (k: Kind): boolean => k >= 31;
export const isTerminal = (k: Kind): boolean => k < 27 && (k % 9 === 0 || k % 9 === 8);
export const isYaochu = (k: Kind): boolean => isHonor(k) || isTerminal(k);
export const isSimple = (k: Kind): boolean => !isYaochu(k);

/** ドラ表示牌からドラの種類を求める */
export function doraFromIndicator(indicator: Kind): Kind {
  if (indicator < 27) {
    const base = indicator - (indicator % 9);
    return base + ((indicator % 9) + 1) % 9;
  }
  if (indicator <= NORTH) return EAST + ((indicator - EAST + 1) % 4);
  return HAKU + ((indicator - HAKU + 1) % 3);
}

export const YAOCHU_KINDS: readonly Kind[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

const SUIT_CHARS = ['m', 'p', 's'];
const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];
const NUM_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 短い表記（1m, 5p, 7z など。字牌は 1z=東 … 7z=中） */
export function kindCode(k: Kind): string {
  if (k < 27) return `${numOf(k)}${SUIT_CHARS[suitOf(k)]}`;
  return `${k - 26}z`;
}

/** 日本語表記（一萬, 5筒, 東 など） */
export function kindName(k: Kind): string {
  if (k < 9) return `${NUM_KANJI[k]}萬`;
  if (k < 18) return `${numOf(k)}筒`;
  if (k < 27) return `${numOf(k)}索`;
  return HONOR_NAMES[k - 27];
}

export function tileCode(t: Tile, aka = true): string {
  const k = kindOf(t);
  if (aka && isRedTile(t)) return `0${SUIT_CHARS[suitOf(k)]}`;
  return kindCode(k);
}

export const WIND_NAMES = ['東', '南', '西', '北'];

/**
 * "123m456p789s11z" のような表記を牌 ID 列に変換する（主にテスト用）。
 * 0 は赤 5。同じ種類は ID の若い順に割り当て、赤 5 は普通の 5 では使わない。
 */
export function parseTiles(s: string): Tile[] {
  const used = new Set<Tile>();
  const out: Tile[] = [];
  let digits: string[] = [];
  for (const ch of s.replace(/\s+/g, '')) {
    if (/[0-9]/.test(ch)) {
      digits.push(ch);
      continue;
    }
    const suit = 'mpsz'.indexOf(ch);
    if (suit < 0) throw new Error(`不正な牌表記: ${s}`);
    for (const d of digits) {
      const n = Number(d);
      let kind: Kind;
      let red = false;
      if (suit === 3) {
        if (n < 1 || n > 7) throw new Error(`不正な字牌: ${d}z`);
        kind = 26 + n;
      } else if (n === 0) {
        kind = suit * 9 + 4;
        red = true;
      } else {
        kind = suit * 9 + n - 1;
      }
      let tile = -1;
      if (red) {
        tile = kind * 4;
        if (used.has(tile)) throw new Error('赤 5 は 1 枚まで');
      } else {
        for (let c = 0; c < 4; c++) {
          const cand = kind * 4 + c;
          if (!used.has(cand) && !isRedTile(cand)) {
            tile = cand;
            break;
          }
        }
        if (tile < 0) throw new Error(`${kindCode(kind)} が多すぎます`);
      }
      used.add(tile);
      out.push(tile);
    }
    digits = [];
  }
  if (digits.length) throw new Error(`種類が指定されていない数字: ${s}`);
  return out;
}

export function tilesToString(tiles: readonly Tile[], aka = true): string {
  const groups: Record<string, string> = { m: '', p: '', s: '', z: '' };
  for (const t of [...tiles].sort((a, b) => a - b)) {
    const c = tileCode(t, aka);
    groups[c[1]] += c[0];
  }
  return (['m', 'p', 's', 'z'] as const).map((g) => (groups[g] ? groups[g] + g : '')).join('');
}

/** 並べ替え用の比較関数（種類順、同種なら赤を先に） */
export function compareTiles(a: Tile, b: Tile): number {
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka !== kb) return ka - kb;
  return a - b;
}
