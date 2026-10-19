// Alinea lo que el reconocimiento de voz escuchó con las palabras del guion.
// Funciones puras: se pueden probar con Node.

const STOP = new Set([
  'a', 'al', 'de', 'del', 'el', 'la', 'las', 'los', 'lo', 'un', 'una', 'y', 'e', 'o', 'u',
  'que', 'en', 'es', 'se', 'te', 'me', 'mi', 'tu', 'su', 'no', 'si', 'con', 'por', 'le',
  'les', 'ya', 'yo', 'ni', 'the', 'and', 'of', 'to', 'is', 'it', 'in', 'on', 'at', 'an',
  'este', 'esta', 'esto', 'estos', 'estas', 'ese', 'esa', 'eso', 'esos', 'esas', 'pero', 'mas',
  'muy', 'hay', 'son', 'fue', 'era', 'ser', 'va', 'vas', 'voy', 'sin', 'para', 'como', 'bueno',
]);

export function norm(word) {
  return String(word)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function tokenize(text) {
  return String(text).split(/\s+/).map(norm).filter(Boolean);
}

function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Cómo suena la palabra (español): b/v, c/s/z, qu/k, ll/y y h muda dan lo mismo,
// y las letras dobles cuentan como una. "quepa", "kepa" y "queepa" suenan igual.
export function phon(w) {
  return w
    .replace(/qu/g, 'k').replace(/c([ei])/g, 's$1').replace(/c/g, 'k').replace(/z/g, 's')
    .replace(/v/g, 'b').replace(/ll/g, 'y').replace(/ch/g, 'x').replace(/h/g, '')
    .replace(/(.)\1+/g, '$1');
}

// ¿La palabra dicha es esta palabra del guion? Se compara cómo suenan y se tolera un error
// proporcional al largo (el reconocimiento no siempre escribe igual que el guion).
// `partial`: la última palabra de un resultado provisional puede estar a medio decir.
export function similar(spoken, word, partial = false) {
  if (!spoken || !word) return false;
  if (spoken === word) return true;
  const a = phon(spoken);
  const b = phon(word);
  if (a === b) return true;
  if (a + 's' === b || b + 's' === a) return b.length >= 3;
  if (partial && a.length >= 3 && b.startsWith(a)) return true;
  const len = Math.max(a.length, b.length);
  if (len < 4) return false;
  const tol = len >= 10 ? 3 : len >= 7 ? 2 : 1;
  if (Math.abs(a.length - b.length) > tol) return false;
  return lev(a, b) <= tol;
}

const weight = (w) => (w.length < 3 || STOP.has(w) ? 0.4 : 1);

// LCS ponderado entre spoken[sStart..sEnd] y words[wStart..wEnd].
function lcs(spoken, sStart, sEnd, words, wStart, wEnd) {
  const n = sEnd - sStart + 1;
  const m = wEnd - wStart + 1;
  if (n <= 0 || m <= 0) return { score: 0, count: 0 };
  let prevS = new Float32Array(m + 1);
  let prevC = new Uint8Array(m + 1);
  for (let i = 1; i <= n; i++) {
    const curS = new Float32Array(m + 1);
    const curC = new Uint8Array(m + 1);
    for (let j = 1; j <= m; j++) {
      let bs = prevS[j];
      let bc = prevC[j];
      if (curS[j - 1] > bs) { bs = curS[j - 1]; bc = curC[j - 1]; }
      const w = words[wStart + j - 1];
      if (similar(spoken[sStart + i - 1], w)) {
        const s = prevS[j - 1] + weight(w);
        if (s > bs) { bs = s; bc = prevC[j - 1] + 1; }
      }
      curS[j] = bs;
      curC[j] = bc;
    }
    prevS = curS;
    prevC = curC;
  }
  return { score: prevS[m], count: prevC[m] };
}

/**
 * Devuelve { j, global }: j es el índice de la última palabra del guion que se dijo y
 * global indica que se encontró buscando en todo el guion (no cerca de la posición).
 * Devuelve null si no hay una coincidencia confiable.
 * @param {string[]} words  palabras normalizadas del guion
 * @param {string[]} spoken últimas palabras escuchadas (normalizadas)
 * @param {number} pos      posición actual (-1 = antes de empezar)
 */
export function locate(words, spoken, pos, { back = 8, ahead = 24 } = {}) {
  const n = spoken.length;
  if (!n || !words.length) return null;

  const search = (lo, hi, global) => {
    let best = null;
    for (let j = lo; j <= hi; j++) {
      let a = -1;
      if (similar(spoken[n - 1], words[j], true)) a = n - 1;
      else if (n >= 2 && similar(spoken[n - 2], words[j])) a = n - 2;
      if (a < 0) continue;

      const dist = j - pos;
      // Para retroceder solo cuentan las últimas palabras dichas: así el contexto viejo
      // que sigue en el buffer no arrastra la posición hacia atrás.
      const sStart = dist < 0 ? Math.max(0, a - 3) : 0;
      const r = lcs(spoken, sStart, a - 1, words, Math.max(0, j - (a - sStart + 4)), j - 1);
      const score = r.score + weight(words[j]);
      const count = r.count + 1;

      let ok;
      if (global) ok = count >= 4 && score >= 3.2;
      else if (dist < 0) ok = count >= 3 && score >= 2.4 && weight(words[j]) === 1;
      else ok = count >= 3 && score >= 2.4;
      if (!ok) continue;

      const value = score
        - 0.04 * Math.max(0, dist - 1)
        - (dist < 0 ? 0.6 + 0.05 * -dist : 0)
        + (a === n - 1 ? 0.2 : 0);
      if (!best || value > best.value) best = { j, value };
    }
    return best;
  };

  const near = search(Math.max(0, pos - back), Math.min(words.length - 1, pos + ahead), false);
  if (near) return { j: near.j, global: false };
  const far = n >= 4 ? search(0, words.length - 1, true) : null;
  return far ? { j: far.j, global: true } : null;
}

/**
 * Seguimiento palabra por palabra desde `start`.
 * - "En marcha" (ya venís leyendo el guion en orden): cada palabra que suena como la que
 *   sigue avanza al instante. Si el reconocimiento no entendió una palabra, se saltea
 *   (palabras con contenido pueden saltar 1 del guion; las cortas como "el" solo la inmediata).
 *   Una palabra suelta fuera del guion no corta la marcha; dos seguidas sí.
 * - Para arrancar (o retomar después de charla fuera del guion) hace falta más evidencia:
 *   palabra con contenido justo a continuación, o una coincidencia que las palabras
 *   siguientes confirmen (1 más si se saltea 1 palabra del guion, 2 si se saltean 2 o más).
 * Lo que no está en el guion (muletillas, comentarios) no mueve nada.
 * Devuelve { pos, stuck, flow }: stuck = palabras dichas seguidas sin ubicar en el guion;
 * flow = si al final quedó "en marcha".
 */
export function follow(words, tokens, start, { partialLast = false, window = 5, flow = false } = {}) {
  let p = start;
  let stuck = 0;
  let misses = 0;
  let inFlow = flow && start >= 0;
  const last = tokens.length - 1;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const partial = partialLast && i === last;

    if (inFlow) {
      let hit = -1;
      for (let k = 1; k <= 2 && p + k < words.length; k++) {
        const w = words[p + k];
        // Saltar 1 palabra del guion: si justo antes hubo una palabra no entendida, es la que
        // faltaba (vale cualquiera); si no, solo con palabras con contenido.
        if (k === 2 && misses === 0 && (weight(w) < 1 || weight(tok) < 1)) break;
        if (similar(tok, w, partial && k === 1)) { hit = p + k; break; }
      }
      if (hit >= 0) { p = hit; stuck = 0; misses = 0; continue; }
      stuck++;
      if (++misses >= 2) inFlow = false;
      continue;
    }

    let hit = -1;
    for (let k = 1; k <= window && p + k < words.length; k++) {
      if (similar(tok, words[p + k], partial && k === 1)) { hit = p + k; break; }
    }
    if (hit < 0) { stuck++; continue; }
    const skip = hit - p - 1;
    let need = skip >= 2 ? 2 : skip === 1 ? 1 : weight(words[hit]) === 1 ? 0 : 1;
    let content = weight(words[hit]) === 1;
    let cur = hit;
    for (let c = 1; c <= need; c++) {
      if (cur >= words.length - 1) break; // fin del guion: no queda nada que confirme
      const t = tokens[i + c];
      const tPartial = partialLast && i + c === last;
      const nxt = t == null ? -1 : similar(t, words[cur + 1], tPartial) ? cur + 1 : similar(t, words[cur + 2]) ? cur + 2 : -1;
      if (nxt < 0) { need = -1; break; }
      cur = nxt;
      if (weight(words[cur]) === 1) content = true;
    }
    if (need >= 0 && content) { p = hit; stuck = 0; misses = 0; inFlow = true; continue; }
    stuck++;
  }
  return { pos: p, stuck, flow: inFlow };
}
