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

/** タッチ操作の端末か（PC では回転しない） */
export function isTouchDevice(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

/** 画面の向きに合わせて #app を回転し、幅・高さとレイアウトのクラスを付ける */
export function applyDisplay() {
  const app = document.getElementById('app');
  if (!app) return;
  const want = current ?? (current = getOrientation());
  const pw = window.innerWidth;
  const ph = window.innerHeight;
  const physPortrait = ph > pw;
  const rotate = isTouchDevice() && (want === 'landscape') === physPortrait;
  const w = rotate ? ph : pw;
  const h = rotate ? pw : ph;

  app.classList.toggle('rotated', rotate);
  if (rotate) {
    app.style.width = `${w}px`;
    app.style.height = `${h}px`;
    // 横向きで表示：時計回りに 90 度（端末を左に倒して持つ）
    // 縦向きで表示：反時計回りに 90 度
    app.style.transform = want === 'landscape' ? `translateX(${pw}px) rotate(90deg)` : `translateY(${ph}px) rotate(-90deg)`;
  } else {
    app.style.width = '';
    app.style.height = '';
    app.style.transform = '';
  }
  app.style.setProperty('--vw', `${w}px`);
  app.style.setProperty('--vh', `${h}px`);
  app.classList.toggle('land', w > h && h <= 600);
  app.classList.toggle('narrow', w <= 420);
}

export function initDisplay() {
  applyDisplay();
  window.addEventListener('resize', applyDisplay);
  window.addEventListener('orientationchange', applyDisplay);
  window.visualViewport?.addEventListener('resize', applyDisplay);
}
