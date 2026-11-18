export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      lobby: $('lobby'),
      code: $('code'),
      name: $('name'),
      join: $('join'),
      lobbyHint: $('lobby-hint'),
      waiting: $('waiting'),
      waitCode: $('wait-code'),
      waitStatus: $('wait-status'),
      hud: $('hud'),
      crosshair: $('crosshair'),
      objective: $('objective'),
      timer: $('timer'),
      staminaBar: $('stamina-bar').firstElementChild,
      emf: $('emf'),
      emfReading: $('emf-reading'),
      emfBars: $('emf-bars'),
      prompt: $('prompt'),
      hideConfirm: $('hide-confirm'),
      result: $('result'),
      resultKicker: $('result-kicker'),
      resultTitle: $('result-title'),
      resultReason: $('result-reason'),
      resultYou: $('result-you'),
      resultPeer: $('result-peer'),
      again: $('again'),
      overlay: $('overlay'),
      overlayMsg: $('overlay-msg'),
      toast: $('toast'),
      sprintEdge: $('sprint-edge'),
      dmg: $('dmg'),
      fade: $('fade'),
      note: $('settings-note'),
    };

    this.bars = [];
    for (let i = 0; i < 5; i++) {
      const b = document.createElement('i');
      this.el.emfBars.appendChild(b);
      this.bars.push(b);
    }

    this.onJoin = null;
    this.onAgain = null;
    this.toastTimer = 0;

    this.el.join.addEventListener('click', () => {
      const code = this.el.code.value.trim();
      const name = this.el.name.value.trim();
      this.onJoin?.(code, name);
    });
    this.el.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.el.join.click();
    });
    this.el.again.addEventListener('click', () => {
      this.onAgain?.();
    });

    setTimeout(() => this.el.fade.classList.add('clear'), 250);
  }

  hideAll() {
    this.el.lobby.classList.add('hidden');
    this.el.waiting.classList.add('hidden');
    this.el.result.classList.add('hidden');
    this.el.hud.classList.add('hidden');
  }

  showLobby(message) {
    this.el.overlay.classList.remove('on');
    this.hideAll();
    this.el.lobby.classList.remove('hidden');
    this.el.lobby.classList.add('fade-in');
    this.el.hud.classList.add('hidden');
    if (message) {
      this.el.lobbyHint.textContent = message;
      this.el.lobbyHint.style.color = '#c96a5c';
    }
  }

  showWaiting(code) {
    this.el.overlay.classList.remove('on');
    this.hideAll();
    this.el.waiting.classList.remove('hidden');
    this.el.waitCode.textContent = code;
    this.el.waitStatus.textContent = '等待另一位病人进入…';
  }

  setWaitingStatus(text) {
    this.el.waitStatus.textContent = text;
  }

  showHud() {
    this.el.overlay.classList.remove('on');
    this.hideAll();
    this.el.hud.classList.remove('hidden');
    this.el.fade.classList.add('clear');
  }

  setObjective(html) {
    this.el.objective.innerHTML = html;
  }

  setTimer(sec, suffix = '') {
    if (sec == null) {
      this.el.timer.textContent = '--:--';
      this.el.timer.classList.remove('low');
      return;
    }
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    this.el.timer.textContent = `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}${suffix}`;
    this.el.timer.classList.toggle('low', s <= 30);
  }

  setStamina(v) {
    this.el.staminaBar.style.transform = `scaleX(${Math.max(0, Math.min(1, v / 100))})`;
  }

  setSprint(enabled, running) {
    const state = !enabled ? 'off' : running ? 'running' : 'ready';
    if (this.el.sprintEdge.dataset.state !== state) this.el.sprintEdge.dataset.state = state;
  }

  setEmf(level, on) {
    this.el.emf.classList.toggle('on', !!on);
    this.bars.forEach((b, i) => b.classList.toggle('on', on && i < level));
    this.el.emfReading.textContent = on ? (1 + level * 0.9).toFixed(1) : '1.0';
  }

  setPrompt(text) {
    if (text) {
      this.el.prompt.textContent = text;
      this.el.prompt.classList.add('on');
    } else {
      this.el.prompt.classList.remove('on');
    }
  }

  setCrosshair(hot) {
    this.el.crosshair.classList.toggle('hot', !!hot);
  }

  toast(text, ms = 2400) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('on'), ms);
  }

  setDamage(v) {
    this.el.dmg.style.opacity = String(Math.max(0, Math.min(1, v)));
  }

  setHideConfirm(show) {
    this.el.hideConfirm.classList.toggle('hidden', !show);
  }

  overlayOn(text) {
    this.el.overlayMsg.textContent = text || '';
    this.el.overlay.classList.add('on');
  }

  overlayOff() {
    this.el.overlay.classList.remove('on');
  }

  showResult({ win, title, reason, youName, peerName }) {
    this.hideAll();
    this.el.result.classList.remove('hidden');
    this.el.result.classList.add('fade-in');
    this.el.resultKicker.textContent = win ? 'SURVIVED · 你赢了' : 'LOST · 你输了';
    this.el.resultTitle.textContent = title;
    this.el.resultReason.textContent = reason;
    this.el.resultYou.textContent = `你 · ${youName || '病人'}`;
    this.el.resultPeer.textContent = `对方 · ${peerName || '病人'}`;
    this.el.hud.classList.add('hidden');
    this.el.fade.classList.add('clear');
  }

  hideResult() {
    this.el.result.classList.add('hidden');
  }

  setNote(text) {
    this.el.note.textContent = text;
  }
}
