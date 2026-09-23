import type { Action } from '../engine/types.ts';

/** 行動に合わせて卓に出す吹き出しの文字（なければ null） */
export function announceText(a: Action): string | null {
  switch (a.type) {
    case 'discard':
      return a.riichi ? 'リーチ' : null;
    case 'tsumo':
      return 'ツモ';
    case 'ron':
      return 'ロン';
    case 'pon':
      return 'ポン';
    case 'chi':
      return 'チー';
    case 'minkan':
    case 'ankan':
    case 'kakan':
      return 'カン';
    case 'kyuushu':
      return '九種九牌';
    default:
      return null;
  }
}
