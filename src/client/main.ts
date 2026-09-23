// タイトル画面と各モードへの入口

import { savedName, startLan } from './lan.ts';
import { startLocalGame, type CpuLevel } from './local.ts';
import { TIME_LABELS, type TimeKey } from '../ai/prompt.ts';
import { helpHtml } from './help.ts';
import {
  autoFullscreen,
  getOrientation,
  initDisplay,
  installTipHtml,
  isTouchDevice,
  setOrientation,
  type Orientation,
} from './display.ts';

const app = document.getElementById('app')!;

const PREF_KEY = 'margin.prefs';

interface Prefs {
  length: 'hanchan' | 'tonpuu';
  aka: boolean;
  cpu: CpuLevel;
  speed: 'slow' | 'normal' | 'fast';
  time: TimeKey;
}

function loadPrefs(): Prefs {
  const def: Prefs = { length: 'hanchan', aka: true, cpu: 'strong', speed: 'normal', time: 'none' };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') };
  } catch {
    return def;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // 保存できない環境では無視
  }
}


/** LAN サーバーから配信されているか（GitHub Pages では false） */
async function detectLan(): Promise<boolean> {
  try {
    const res = await fetch('api/info', { cache: 'no-store' });
    if (!res.ok) return false;
    const info = await res.json();
    return info?.lan === true;
  } catch {
    return false;
  }
}

const radio = (name: string, value: string, label: string, checked: boolean) =>
  `<label><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}> ${label}</label>`;

async function showTitle() {
  const prefs = loadPrefs();
  app.innerHTML = `
    <div class="screen title-screen">
      <div class="card">
        <h1 class="logo">margin <span>麻雀</span></h1>
        <p class="note">4人打ちリーチ麻雀</p>
        <div class="form-row"><span>対局</span>
          ${radio('len', 'hanchan', '半荘戦', prefs.length === 'hanchan')}
          ${radio('len', 'tonpuu', '東風戦', prefs.length === 'tonpuu')}</div>
        <div class="form-row"><span>赤ドラ</span>
          ${radio('aka', '1', 'あり', prefs.aka)}
          ${radio('aka', '0', 'なし', !prefs.aka)}</div>
        <div class="form-row"><span>CPU</span>
          ${radio('cpu', 'random', 'よわい', prefs.cpu === 'random')}
          ${radio('cpu', 'greedy', 'ふつう', prefs.cpu === 'greedy')}
          ${radio('cpu', 'strong', 'つよい', prefs.cpu === 'strong')}</div>
        <div class="form-row"><span>速さ</span>
          ${radio('speed', 'slow', 'ゆっくり', prefs.speed === 'slow')}
          ${radio('speed', 'normal', 'ふつう', prefs.speed === 'normal')}
          ${radio('speed', 'fast', 'はやい', prefs.speed === 'fast')}</div>
        <div class="form-row wide"><span>持ち時間</span>
          ${(Object.keys(TIME_LABELS) as TimeKey[]).map((k) => radio('time', k, TIME_LABELS[k], prefs.time === k)).join('')}</div>
        <p class="note small">持ち時間「15+30秒」は、1 手ごとに 15 秒（毎回元に戻る）と、対局全体で使い切る予備の 30 秒です。</p>
        ${
          isTouchDevice()
            ? `<div class="form-row"><span>画面</span>
          ${radio('orient', 'landscape', '横向き', getOrientation() === 'landscape')}
          ${radio('orient', 'portrait', '縦向き', getOrientation() === 'portrait')}</div>`
            : ''
        }
        ${installTipHtml()}
        <button class="btn big" id="start-cpu">CPU と対戦</button>
        <div id="lan-area"></div>
        <button class="btn ghost help-btn" id="show-help">遊び方・LAN 対戦のやり方</button>
      </div>
      <div class="menu hidden" id="help-overlay">
        <div class="menu-panel wide" role="dialog" aria-label="遊び方">
          ${helpHtml()}
          <div class="menu-buttons"><button class="btn" id="close-help">閉じる</button></div>
        </div>
      </div>
      <p class="footer-note">ルール：25000点持ち30000点返し・喰いタンあり・後付けあり・ダブロンあり</p>
    </div>`;

  const read = (): Prefs => ({
    length: (app.querySelector('input[name="len"]:checked') as HTMLInputElement).value as Prefs['length'],
    aka: (app.querySelector('input[name="aka"]:checked') as HTMLInputElement).value === '1',
    cpu: (app.querySelector('input[name="cpu"]:checked') as HTMLInputElement).value as CpuLevel,
    speed: (app.querySelector('input[name="speed"]:checked') as HTMLInputElement).value as Prefs['speed'],
    time: (app.querySelector('input[name="time"]:checked') as HTMLInputElement).value as TimeKey,
  });

  app.querySelectorAll<HTMLInputElement>('input[name="orient"]').forEach((el) =>
    el.addEventListener('change', () => setOrientation(el.value as Orientation)),
  );

  const overlay = app.querySelector<HTMLElement>('#help-overlay')!;
  app.querySelector('#show-help')!.addEventListener('click', () => overlay.classList.remove('hidden'));
  app.querySelector('#close-help')!.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });

  app.querySelector('#start-cpu')!.addEventListener('click', () => {
    const p = read();
    savePrefs(p);
    autoFullscreen();
    startLocalGame(app, {
      rules: { length: p.length, aka: p.aka },
      cpu: p.cpu,
      speed: p.speed,
      time: p.time,
      onExit: showTitle,
      onSpeedChange: (speed) => savePrefs({ ...loadPrefs(), speed }),
    });
  });

  if (await detectLan()) {
    const area = app.querySelector('#lan-area');
    if (!area) return;
    area.innerHTML = `
      <hr>
      <h3>LAN 対戦</h3>
      <div class="form-row"><span>名前</span><input type="text" id="lan-name" maxlength="16" placeholder="名前を入力"></div>
      <button class="btn big" id="start-lan">LAN 対戦に参加</button>`;
    const input = area.querySelector<HTMLInputElement>('#lan-name')!;
    input.value = savedName();
    area.querySelector('#start-lan')!.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        input.classList.add('error');
        return;
      }
      autoFullscreen();
      startLan(app, name, showTitle);
    });
  }
}

initDisplay();
showTitle();
