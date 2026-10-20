import { openMic } from './camera.js?v=3.0';

// Audio de la toma. En iPhone, cuando algo vuelve a abrir el micrófono (por ejemplo el
// reconocimiento de voz de Siri), el uso anterior queda silenciado o se corta. Por eso la
// grabación no toma el micrófono directo: graba de una salida fija de Web Audio a la que se
// "enchufa" el micrófono de turno. Si se lo sacan, se enchufa uno nuevo sin cortar la toma.
const CHECK_MS = 250;
const SILENT_MS = 1500;   // silencio absoluto (ceros) = micrófono silenciado por el sistema
const MAX_REOPENS = 4;    // reaperturas en REOPEN_WINDOW antes de rendirse con la voz
const REOPEN_WINDOW = 20000;

export class AudioBridge {
  constructor({ log = () => {}, onFight = null } = {}) {
    this.log = log;
    this.onFight = onFight; // el iPhone sigue sacándole el micrófono: conviene pausar la voz
    this.ctx = null;
    this.track = null;
    this.src = null;
    this.timer = 0;
    this.reopening = false;
    this.reopens = [];
    this.stats = { checks: 0, silent: 0 };
    this.owned = null; // micrófono que abrió el puente (el de la cámara lo maneja la cámara)
  }

  // Tiene que llamarse dentro del toque del usuario: iOS solo deja arrancar el audio así.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.dest = this.ctx.createMediaStreamDestination();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.buf = new Float32Array(this.analyser.fftSize);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  // Pista que se graba: siempre la misma, aunque cambie el micrófono de atrás.
  get output() { return this.dest.stream.getAudioTracks()[0]; }

  plug(track) {
    try { this.src?.disconnect(); } catch { /* ya estaba desconectado */ }
    if (this.owned && this.owned !== track) { this.owned.stop(); this.owned = null; }
    this.track = track;
    this.src = this.ctx.createMediaStreamSource(new MediaStream([track]));
    this.src.connect(this.dest);
    this.src.connect(this.analyser);
    this.silentSince = 0;
  }

  alive(track) { return !!track && track.readyState === 'live' && !track.muted; }

  // Antes de la toma: usa el micrófono que hay si funciona; si no, abre uno nuevo.
  async prepare(current) {
    if (this.alive(current)) { this.plug(current); this.log('mic', 'toma con el micrófono actual'); return true; }
    return this.reopen('antes de la toma');
  }

  async reopen(why) {
    if (this.reopening) return false;
    this.reopening = true;
    try {
      const t = await openMic();
      this.owned = t;
      t.onended = () => this.log('mic', 'la pista de audio se cortó');
      t.onmute = () => this.log('mic', 'silenciado por el sistema');
      this.plug(t);
      this.log('mic', `reabierto (${why})`);
      return true;
    } catch (e) {
      this.log('mic', `no se pudo reabrir: ${e.name}`);
      return false;
    } finally {
      this.reopening = false;
    }
  }

  level() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let peak = 0;
    for (const v of this.buf) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  // Vigila el micrófono durante la toma y lo reemplaza si el sistema se lo saca.
  start() {
    this.stats = { checks: 0, silent: 0 };
    this.reopens = [];
    clearInterval(this.timer);
    this.timer = setInterval(() => this.check(), CHECK_MS);
  }

  stop() { clearInterval(this.timer); }

  // Fin de la toma o salida del teleprompter: suelta el micrófono propio y duerme el audio
  // (si no, el iPhone sigue mostrando el micrófono en uso y gasta batería).
  release() {
    clearInterval(this.timer);
    try { this.src?.disconnect(); } catch { /* nada */ }
    this.src = null;
    this.owned?.stop();
    this.owned = null;
    this.track = null;
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  check() {
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    const now = performance.now();
    const silent = this.level() === 0;
    this.stats.checks++;
    if (silent) this.stats.silent++;
    if (silent && !this.silentSince) this.silentSince = now;
    if (!silent) this.silentSince = 0;

    const t = this.track;
    const dead = !t || t.readyState === 'ended' ? 'cortado'
      : t.muted ? 'silenciado'
        : this.silentSince && now - this.silentSince > SILENT_MS ? 'sin señal' : '';
    if (!dead || this.reopening) return;

    this.reopens = this.reopens.filter((x) => now - x < REOPEN_WINDOW);
    this.reopens.push(now);
    if (this.reopens.length > MAX_REOPENS) this.onFight?.();
    this.reopen(dead);
  }

  // Proporción de la toma en silencio absoluto (micrófono silenciado por el sistema).
  silentRatio() { return this.stats.checks ? this.stats.silent / this.stats.checks : 0; }
}
