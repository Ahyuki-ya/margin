// 画面の向き
//
// スマホは画面の回転をロックしていることが多いので、端末が縦向きのままでも
// 画面全体を 90 度回して横向きで表示できるようにする（既定は横向き）。
// レイアウトは「表示したい向きでの幅・高さ」（--vw, --vh）から決める。

export type Orientation = 'landscape' | 'portrait';

const KEY = 'margin.display';

export function getOrientation(): Orientation {
  try {
    return localStorage.getItem(KEY) === 'portrait' ? 'portrait' : 'landscape';
  } catch {
    return 'landscape';
  }
}

export function setOrientation(o: Orientation) {
  try {
    localStorage.setItem(KEY, o);
  } catch {
    // 保存できない環境では、この画面を開いている間だけ有効
  }
  current = o;
  applyDisplay();
}

let current: Orientation | null = null;

/** 回転するのは対局画面だけ（タイトル・ロビーは端末の向きのまま） */
let inGame = false;

export function setInGame(v: boolean) {
  inGame = v;
  applyDisplay();
}

/** タッチ操作の端末か（PC では回転しない） */
export function isTouchDevice(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

/** 画面端の余白（ノッチ・ホームバーなど）を測る */
function measureSafeArea(): { t: number; r: number; b: number; l: number } {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const r = {
    t: parseFloat(cs.paddingTop) || 0,
    r: parseFloat(cs.paddingRight) || 0,
    b: parseFloat(cs.paddingBottom) || 0,
    l: parseFloat(cs.paddingLeft) || 0,
  };
  el.remove();
  return r;
}

/** 画面の向きに合わせて #app を回転し、使える幅・高さとレイアウトのクラスを付ける */
export function applyDisplay() {
  const app = document.getElementById('app');
  if (!app) return;
  const want = current ?? (current = getOrientation());
  // ページの幅・高さ（ブラウザのバーを除く）。visualViewport は拡大するとも小さくなるので使わない
  const pw = document.documentElement.clientWidth || window.innerWidth;
  const ph = document.documentElement.clientHeight || window.innerHeight;
  const physPortrait = ph > pw;
  const rotate = inGame && isTouchDevice() && (want === 'landscape') === physPortrait;
  const w = rotate ? ph : pw;
  const h = rotate ? pw : ph;

  // 余白を、回転後の画面から見た上下左右に置き換える
  const s = measureSafeArea();
  let safe = s;
  if (rotate && want === 'landscape') safe = { t: s.r, r: s.b, b: s.l, l: s.t }; // 時計回り
  else if (rotate) safe = { t: s.l, r: s.t, b: s.r, l: s.b }; // 反時計回り
  for (const [k, v] of Object.entries(safe)) app.style.setProperty(`--safe-${k}`, `${v}px`);

  app.classList.toggle('rotated', rotate);
  if (rotate) {
    app.style.width = `${w}px`;
    app.style.height = `${h}px`;
    app.style.minHeight = '';
    // 横向きで表示：時計回りに 90 度（端末を左に倒して持つ）
    // 縦向きで表示：反時計回りに 90 度
    app.style.transform = want === 'landscape' ? `translateX(${pw}px) rotate(90deg)` : `translateY(${ph}px) rotate(-90deg)`;
  } else {
    app.style.width = '';
    app.style.height = '';
    app.style.minHeight = `${h}px`;
    app.style.transform = '';
  }
  const uw = w - safe.l - safe.r;
  const uh = h - safe.t - safe.b;
  app.style.setProperty('--vw', `${uw}px`);
  app.style.setProperty('--vh', `${uh}px`);
  // 横長の画面（スマホの横向き・PC）では、横長の卓と点数表の配置にする
  app.classList.toggle('land', uw >= uh * 1.25 || (uw > uh && uh <= 600));
  app.classList.toggle('narrow', uw <= 420);
}

/** ホーム画面から開いた（ブラウザのバーがない）状態か */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    !!document.fullscreenElement
  );
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** ページから全画面にできるか（Android の Chrome など。iPhone の Safari は不可） */
export function canRequestFullscreen(): boolean {
  return !!document.fullscreenEnabled && !document.fullscreenElement;
}

/** 全画面にする（タップなどの操作の中で呼ぶ必要がある） */
export async function enterFullscreen() {
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    // 対応していない端末では何もしない
  }
}

/** スマホで対局を始めるときは、できれば自動で全画面にする */
export function autoFullscreen() {
  if (isTouchDevice() && canRequestFullscreen()) void enterFullscreen();
}

// ───────────── 文字の大きさ ─────────────

export type TextSize = 'S' | 'M' | 'L' | 'XL';

export const TEXT_SIZES: { key: TextSize; label: string; scale: number }[] = [
  { key: 'S', label: '小', scale: 0.9 },
  { key: 'M', label: '中', scale: 1 },
  { key: 'L', label: '大', scale: 1.2 },
  { key: 'XL', label: '特大', scale: 1.4 },
];

const TEXT_KEY = 'margin.textSize';

export function getTextSize(): TextSize {
  try {
    const v = localStorage.getItem(TEXT_KEY);
    return TEXT_SIZES.some((t) => t.key === v) ? (v as TextSize) : 'M';
  } catch {
    return 'M';
  }
}

/** 文字の大きさの倍率を #app の --fs に入れる（画面のすべての文字がこれを使う） */
export function applyTextSize() {
  const scale = TEXT_SIZES.find((t) => t.key === getTextSize())?.scale ?? 1;
  document.getElementById('app')?.style.setProperty('--fs', String(scale));
}

export function setTextSize(size: TextSize) {
  try {
    localStorage.setItem(TEXT_KEY, size);
  } catch {
    // 保存できない環境では、この画面を開いている間だけ有効
  }
  applyTextSize();
}

export function initDisplay() {
  applyTextSize();
  applyDisplay();
  window.addEventListener('resize', applyDisplay);
  window.addEventListener('orientationchange', applyDisplay);
  document.addEventListener('fullscreenchange', () => setTimeout(applyDisplay, 100));
}

/** iPhone の Safari で開いているときに出す「ホーム画面に追加」の案内（それ以外は空） */
export function installTipHtml(): string {
  if (!isIOS() || isStandalone()) return '';
  return `<p class="install-tip">下の検索バーを消して全画面で遊ぶには、Safari の共有ボタン（□↑）→「ホーム画面に追加」を選び、ホーム画面のアイコンから開いてください。</p>`;
}
