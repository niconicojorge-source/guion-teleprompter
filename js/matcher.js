// Alinea lo que el reconocimiento de voz escuchó con las palabras del guion.
// Funciones puras: se pueden probar con Node.

const STOP = new Set([
  'a', 'al', 'de', 'del', 'el', 'la', 'las', 'los', 'lo', 'un', 'una', 'y', 'e', 'o', 'u',
  'que', 'en', 'es', 'se', 'te', 'me', 'mi', 'tu', 'su', 'no', 'si', 'con', 'por', 'le',
  'les', 'ya', 'yo', 'ni', 'the', 'and', 'of', 'to', 'is', 'it', 'in', 'on', 'at', 'an',
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

// ¿La palabra dicha es esta palabra del guion? Estricto a propósito: las palabras cortas
// tienen que ser idénticas ("esto" no es "este"); en las largas se tolera un error del
// reconocimiento. `partial`: la última palabra de un resultado provisional puede estar a
// medio decir.
export function similar(spoken, word, partial = false) {
  if (!spoken || !word) return false;
  if (spoken === word) return true;
  if (spoken + 's' === word || word + 's' === spoken) return word.length >= 4;
  if (partial && spoken.length >= 4 && word.startsWith(spoken)) return true;
  const len = Math.max(spoken.length, word.length);
  if (len < 6) return false;
  const tol = len >= 9 ? 2 : 1;
  if (Math.abs(spoken.length - word.length) > tol) return false;
  return lev(spoken, word) <= tol;
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
 * Seguimiento palabra por palabra desde `start`: cada palabra dicha tiene que ser una de las
 * que siguen en el guion (se toleran hasta `window - 1` palabras salteadas o no reconocidas).
 * Lo que no está en el guion (muletillas, comentarios) no mueve nada.
 * Las coincidencias débiles necesitan que las palabras siguientes también sigan el guion:
 *  - palabra corta ("el", "de") justo a continuación: 1 palabra más que confirme;
 *  - saltando 1 palabra del guion: 1 palabra más;
 *  - saltando 2 o más: 2 palabras más.
 * Y entre las confirmadas tiene que haber al menos una palabra con contenido.
 * Devuelve { pos, stuck }: stuck = palabras dichas seguidas sin poder ubicarlas en el guion.
 */
export function follow(words, tokens, start, { partialLast = false, window = 5 } = {}) {
  let p = start;
  let stuck = 0;
  const last = tokens.length - 1;
  for (let i = 0; i < tokens.length; i++) {
    let hit = -1;
    for (let k = 1; k <= window && p + k < words.length; k++) {
      if (similar(tokens[i], words[p + k], partialLast && i === last && k === 1)) { hit = p + k; break; }
    }
    if (hit < 0) { stuck++; continue; }
    const skip = hit - p - 1;
    let need = skip >= 2 ? 2 : skip === 1 ? 1 : weight(words[hit]) === 1 ? 0 : 1;
    let content = weight(words[hit]) === 1;
    let cur = hit;
    for (let c = 1; c <= need; c++) {
      if (cur >= words.length - 1) break; // fin del guion: no queda nada que confirme
      const t = tokens[i + c];
      const partial = partialLast && i + c === last;
      const nxt = t == null ? -1 : similar(t, words[cur + 1], partial) ? cur + 1 : similar(t, words[cur + 2]) ? cur + 2 : -1;
      if (nxt < 0) { need = -1; break; }
      cur = nxt;
      if (weight(words[cur]) === 1) content = true;
    }
    if (need >= 0 && content) { p = hit; stuck = 0; continue; }
    stuck++;
  }
  return { pos: p, stuck };
}
