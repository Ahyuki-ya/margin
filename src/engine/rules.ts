// ルール設定。標準的な日本のリーチ麻雀（天鳳・雀魂に近いもの）を既定値にしている。

export interface Rules {
  /** 'hanchan': 半荘戦（南4局まで）, 'tonpuu': 東風戦（東4局まで） */
  length: 'hanchan' | 'tonpuu';
  /** 赤ドラ（各色の 5 に 1 枚ずつ） */
  aka: boolean;
  /** 配給原点 */
  startPoints: number;
  /** 返し点（これに届かないとオーラス後に延長。オカの計算にも使う） */
  returnPoints: number;
  /** ウマ（1位, 2位, 3位, 4位 の順。単位は千点） */
  uma: [number, number, number, number];
  /** 喰いタン */
  kuitan: boolean;
  /** 0 点未満で終了 */
  tobi: boolean;
  /** 返し点に届かなければ延長戦（西入・南入） */
  extension: boolean;
  /** 流し満貫 */
  nagashiMangan: boolean;
  /** 途中流局（九種九牌・四風連打・四家立直・四開槓・三家和） */
  abortiveDraws: boolean;
  /** 複数の役満の複合（例：大三元＋字一色でダブル役満） */
  yakumanCompound: boolean;
}

export const DEFAULT_RULES: Rules = {
  length: 'hanchan',
  aka: true,
  startPoints: 25000,
  returnPoints: 30000,
  uma: [20, 10, -10, -20],
  kuitan: true,
  tobi: true,
  extension: true,
  nagashiMangan: true,
  abortiveDraws: true,
  yakumanCompound: true,
};

export function withDefaults(partial?: Partial<Rules>): Rules {
  return { ...DEFAULT_RULES, ...(partial ?? {}) };
}
