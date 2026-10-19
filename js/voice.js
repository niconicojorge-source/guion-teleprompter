import { tokenize, locate, follow } from './matcher.js?v=2.1';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

// Registro de lo que pasa con el reconocimiento (para diagnosticar desde el celular).
const LOG_MAX = 500;
export const voiceLog = [];
function note(type, data = '') {
  voiceLog.push(`${(performance.now() / 1000).toFixed(2)} ${type}${data === '' ? '' : ' ' + data}`);
  if (voiceLog.length > LOG_MAX) voiceLog.splice(0, voiceLog.length - LOG_MAX);
}
export const logVoice = note;

// Palabras dichas seguidas sin ubicar en el guion antes de buscar dónde estás.
const LOST_AFTER = 3;
// Si una sesión no da señales en este tiempo, se reinicia (en iPhone a veces queda colgada).
const STALL_MS = 4000;

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
    this.base = -1;   // posición desde la que se sigue palabra por palabra en esta sesión
    this.offset = 0;  // palabras de la sesión ya consumidas antes de `base`
    this.carry = [];  // palabras dichas antes de la pausa que todavía esperaban confirmación
    this.trail = [];
    this.gentle = false;      // grabando: no cortar sesiones de golpe
    this.flow = false;        // ¿venías leyendo el guion en orden?
    this.sessionFlow = false; // estado "en marcha" con el que arrancó esta sesión
  }

  start() {
    if (!SR || this.active) return;
    this.active = true;
    this.errorStreak = 0;
    this.pending = null;
    note('start', `${this.lang} pos=${this.pos}`);
    this.spawn(false);
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
    this.timer = setTimeout(() => this.spawn(false), 60);
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
      if (this.gentle) {
        // Grabando: se le pide que termine (sin cortarla de golpe, que en iPhone puede apagar
        // el micrófono de la toma); al terminar, onend abre una sesión nueva.
        note('stalled → cierre suave');
        this.lastEventAt = performance.now();
        try { this.rec.stop(); } catch { /* ya estaba cerrada */ }
        return;
      }
      note('stalled → reinicio');
      this.kill();
      this.spawn();
    }
  }

  // keepTrail: al reabrir tras una pausa, las últimas palabras sin confirmar de la sesión
  // anterior se siguen teniendo en cuenta (no tras un salto manual ni al arrancar).
  spawn(keepTrail = true) {
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
    this.base = this.pos;
    this.offset = 0;
    if (!keepTrail) { this.trail = []; this.flow = false; }
    this.carry = this.trail;
    // Tras una pausa entre frases seguís "en marcha": la primera palabra ya avanza.
    this.sessionFlow = this.flow;
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

  // Palabras escuchadas en esta sesión. iOS a veces manda resultados acumulados
  // ("hola", "hola che", "hola che cómo"): si uno contiene al anterior, el anterior se descarta.
  static tokens(results) {
    const segs = [];
    for (let i = 0; i < results.length; i++) {
      const toks = tokenize(results[i][0].transcript);
      if (!toks.length) continue;
      const prev = segs[segs.length - 1];
      if (prev && toks.join(' ').startsWith(prev.join(' '))) segs[segs.length - 1] = toks;
      else segs.push(toks);
    }
    return segs.flat();
  }

  handle(e) {
    const res = e.results;
    if (!res?.length) return;
    const lastRes = res[res.length - 1];
    const lastText = lastRes[0].transcript;
    const tokens = VoiceFollower.tokens(res);
    this.onHeard?.(lastText);

    const key = tokens.join(' ') + (lastRes.isFinal ? ' ·' : '');
    if (key === this.lastKey) return; // repetición de lo mismo (iOS reenvía el resultado final)
    this.lastKey = key;
    note(lastRes.isFinal ? 'final' : 'heard', `"${lastText.trim().slice(-50)}"`);

    // En pausa (cuenta regresiva) lo que digas no cuenta: se sigue desde acá al arrancar.
    if (this.paused) { this.base = this.pos; this.offset = tokens.length; this.carry = []; this.sessionFlow = false; return; }

    // 1) Seguimiento normal: solo avanza con palabras que son las que siguen en el guion.
    const fresh = this.carry.concat(tokens.slice(this.offset));
    if (!fresh.length) return;
    const r = follow(this.words, fresh, this.base, { partialLast: !lastRes.isFinal, flow: this.sessionFlow });
    this.trail = r.stuck ? fresh.slice(-Math.min(r.stuck, 6)) : [];
    this.flow = r.flow;
    if (r.pos > this.pos) {
      if (this.pending) note('salto descartado', `→${this.pending.j}`);
      this.pending = null;
      this.moveTo(r.pos, 'sigue');
      return;
    }
    // Hay un salto en espera: se confirma solo si después seguiste leyendo desde ese lugar
    // (2 palabras más del guion a partir de ahí). Si no, se descarta.
    if (this.pending) {
      const after = tokens.slice(this.pending.offset);
      const c = follow(this.words, after, this.pending.j, { partialLast: !lastRes.isFinal });
      if (c.pos >= this.pending.j + 2) {
        this.base = this.pending.j;
        this.offset = this.pending.offset;
        this.carry = [];
        this.sessionFlow = true;
        this.flow = true;
        this.pending = null;
        this.moveTo(c.pos, 'reubicado');
        return;
      }
      if (after.length < 8) return;
      note('salto descartado', `→${this.pending.j}`);
      this.pending = null;
    }
    if (r.stuck < LOST_AFTER) return;

    // Varias palabras seguidas sin ubicar: puede ser charla fuera del guion (no se mueve)
    // o que saltaste a otra parte. Se propone un lugar solo si al menos 3 palabras dichas
    // coinciden en orden con otra parte del guion.
    const m = locate(this.words, tokens.slice(-8), this.pos);
    if (!m || m.j === this.pos) return;
    this.pending = { j: m.j, offset: tokens.length };
    note('salto en espera', `${this.pos}→${m.j}${m.global ? ' (global)' : ''}`);
  }

  moveTo(p, why) {
    note('move', `${this.pos}→${p} ${why}`);
    this.pos = p;
    this.onMove?.(p);
  }
}
