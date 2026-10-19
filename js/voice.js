import { tokenize, locate } from './matcher.js?v=1.6';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

// Registro de lo que pasa con el reconocimiento (para diagnosticar desde el celular).
const LOG_MAX = 500;
export const voiceLog = [];
function note(type, data = '') {
  voiceLog.push(`${(performance.now() / 1000).toFixed(2)} ${type}${data === '' ? '' : ' ' + data}`);
  if (voiceLog.length > LOG_MAX) voiceLog.splice(0, voiceLog.length - LOG_MAX);
}

// Saltos que necesitan confirmarse con una segunda frase antes de aplicarse.
const FAR_AHEAD = 12;
// Si una sesión no da señales en este tiempo, se reinicia (en iPhone a veces queda colgada).
const STALL_MS = 6000;

// Escucha de forma continua y avisa (onMove) cuando avanza la posición en el guion.
// El navegador corta la sesión de reconocimiento en cada pausa larga: se reinicia sola.
export class VoiceFollower {
  constructor(opts = {}) {
    this.lang = 'es-AR';
    this.words = [];
    this.pos = -1;
    this.paused = false;
    this.active = false;
    this.onMove = null;
    this.onHeard = null;
    this.onError = null;
    Object.assign(this, opts);
    this.session = 0;
    this.rec = null;
    this.timer = 0;
    this.watch = 0;
    this.errorStreak = 0;
    this.pending = null;
    this.lastKey = '';
    this.lastEventAt = 0;
  }

  start() {
    if (!SR || this.active) return;
    this.active = true;
    this.errorStreak = 0;
    this.pending = null;
    note('start', `${this.lang} pos=${this.pos}`);
    this.spawn();
    clearInterval(this.watch);
    this.watch = setInterval(() => this.checkStalled(), 1000);
  }

  stop() {
    if (this.active) note('stop');
    this.active = false;
    clearTimeout(this.timer);
    clearInterval(this.watch);
    this.kill();
  }

  // Descarta lo escuchado hasta ahora (por ejemplo después de un salto manual).
  resetSession() {
    if (!this.active) return;
    note('reset', `pos=${this.pos}`);
    this.pending = null;
    clearTimeout(this.timer);
    this.kill();
    this.timer = setTimeout(() => this.spawn(), 60);
  }

  kill() {
    this.session++;
    const r = this.rec;
    this.rec = null;
    try { r?.abort(); } catch { /* ya estaba cerrada */ }
  }

  checkStalled() {
    if (!this.active || !this.rec) return;
    if (performance.now() - this.lastEventAt > STALL_MS) {
      note('stalled → reinicio');
      this.kill();
      this.spawn();
    }
  }

  spawn() {
    if (!this.active) return;
    const id = ++this.session;
    let r;
    try { r = new SR(); } catch (err) { note('init-fail', err.name); this.active = false; this.onError?.('init'); return; }
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    const alive = () => { if (id === this.session) this.lastEventAt = performance.now(); };
    r.onstart = alive;
    r.onaudiostart = alive;
    r.onspeechstart = alive;
    r.onresult = (e) => {
      if (id !== this.session) return;
      alive();
      this.errorStreak = 0;
      this.handle(e);
    };
    r.onerror = (e) => {
      if (id !== this.session) return;
      const code = e.error;
      note('error', code);
      if (code === 'no-speech' || code === 'aborted') return;
      this.errorStreak++;
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'language-not-supported') this.active = false;
      this.onError?.(code);
    };
    r.onend = () => {
      if (id !== this.session || !this.active) return;
      // Fin normal (pausa): reiniciar ya mismo para no perder las primeras palabras.
      // Solo esperamos más si se repiten errores, para no entrar en un bucle.
      const delay = this.errorStreak > 2 ? 1000 : 30;
      note('end', `reinicio en ${delay}ms`);
      this.rec = null;
      this.timer = setTimeout(() => this.spawn(), delay);
    };
    this.rec = r;
    this.lastKey = '';
    this.sessionStartPos = this.pos;
    this.lastEventAt = performance.now();
    try {
      r.start();
      note('listen', `#${id}`);
    } catch (err) {
      note('start-fail', err.name);
      this.rec = null;
      this.timer = setTimeout(() => this.spawn(), 300);
    }
  }

  // Últimas palabras escuchadas en esta sesión. iOS a veces manda resultados acumulados
  // ("hola", "hola che", "hola che cómo"): si uno contiene al anterior, el anterior se descarta.
  static tail(results, max = 8) {
    const segs = [];
    for (let i = 0; i < results.length; i++) {
      const toks = tokenize(results[i][0].transcript);
      if (!toks.length) continue;
      const prev = segs[segs.length - 1];
      if (prev && toks.join(' ').startsWith(prev.join(' '))) segs[segs.length - 1] = toks;
      else segs.push(toks);
    }
    return segs.flat().slice(-max);
  }

  handle(e) {
    const res = e.results;
    if (!res?.length) return;
    const lastRes = res[res.length - 1];
    const lastText = lastRes[0].transcript;
    let tail = VoiceFollower.tail(res);
    // Al principio de cada sesión (después de una pausa) hay pocas palabras para comparar:
    // sumamos como contexto las 3 palabras leídas justo antes de que empezara la sesión.
    // (Fijas al inicio de la sesión: si se tomaran de la posición actual, una palabra recién
    // dicha contaría dos veces y el texto se adelantaría solo.)
    const start = this.sessionStartPos;
    if (tail.length < 4 && start >= 0) {
      tail = this.words.slice(Math.max(0, start - 2), start + 1).concat(tail);
    }
    this.onHeard?.(lastText);

    const key = tail.join(' ');
    if (key === this.lastKey) return; // repetición de lo mismo (iOS reenvía el resultado final)
    this.lastKey = key;
    note(lastRes.isFinal ? 'final' : 'heard', `"${lastText.trim().slice(-50)}"`);
    if (this.paused || !tail.length) return;

    const m = locate(this.words, tail, this.pos);
    if (!m) return;
    const dist = m.j - this.pos;
    if (dist === 0) { this.pending = null; return; }

    // Un salto hacia atrás, muy adelante o a otra parte del guion solo se aplica si
    // la frase siguiente lo confirma. Así una coincidencia suelta no te manda a otro lado.
    if (m.global || dist < 0 || dist > FAR_AHEAD) {
      if (this.pending === null || Math.abs(this.pending - m.j) > 3) {
        this.pending = m.j;
        note('salto en espera', `${this.pos}→${m.j}${m.global ? ' (global)' : ''}`);
        return;
      }
    }
    this.pending = null;
    note('move', `${this.pos}→${m.j}`);
    this.pos = m.j;
    this.onMove?.(m.j);
  }
}
