import { tokenize, locate } from './matcher.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

// Escucha de forma continua y avisa (onMove) cuando avanza la posición en el guion.
// El navegador corta la sesión de reconocimiento cada tanto: se reinicia sola.
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
    this.restarts = [];
    this.rec = null;
    this.timer = 0;
  }

  start() {
    if (!SR || this.active) return;
    this.active = true;
    this.spawn();
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.kill();
  }

  // Descarta lo escuchado hasta ahora (por ejemplo después de un salto manual).
  resetSession() {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.kill();
    this.timer = setTimeout(() => this.spawn(), 120);
  }

  kill() {
    this.session++;
    const r = this.rec;
    this.rec = null;
    try { r?.abort(); } catch { /* ya estaba cerrada */ }
  }

  spawn() {
    if (!this.active) return;
    const id = ++this.session;
    let r;
    try { r = new SR(); } catch { this.active = false; this.onError?.('init'); return; }
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => { if (id === this.session) this.handle(e); };
    r.onerror = (e) => {
      if (id !== this.session) return;
      const code = e.error;
      if (code === 'no-speech' || code === 'aborted') return;
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'language-not-supported') this.active = false;
      this.onError?.(code);
    };
    r.onend = () => {
      if (id !== this.session || !this.active) return;
      this.timer = setTimeout(() => this.spawn(), this.nextDelay());
    };
    this.rec = r;
    try { r.start(); } catch { this.timer = setTimeout(() => this.spawn(), 500); }
  }

  nextDelay() {
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 4000);
    this.restarts.push(now);
    return this.restarts.length > 5 ? 1200 : 150;
  }

  handle(e) {
    const res = e.results;
    if (!res.length) return;
    const last = res[res.length - 1][0].transcript;
    let tail = tokenize(last);
    for (let i = res.length - 2; i >= 0 && tail.length < 8; i--) tail = tokenize(res[i][0].transcript).concat(tail);
    tail = tail.slice(-8);
    // Al principio de cada sesión (por ejemplo después de una pausa) hay pocas palabras
    // para comparar: sumamos como contexto las últimas palabras ya leídas del guion,
    // así la primera palabra que digas alcanza para retomar.
    if (tail.length < 4 && this.pos >= 0) {
      tail = this.words.slice(Math.max(0, this.pos - 2), this.pos + 1).concat(tail);
    }
    this.onHeard?.(last);
    if (this.paused || !tail.length) return;
    const p = locate(this.words, tail, this.pos);
    if (p !== null && p !== this.pos) {
      this.pos = p;
      this.onMove?.(p);
    }
  }
}
