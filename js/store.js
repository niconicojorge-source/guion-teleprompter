// Todo se guarda en este dispositivo (localStorage). Si el almacenamiento falla
// (modo privado, etc.) la app sigue funcionando en memoria.
const SCRIPTS_KEY = 'guion.scripts.v1';
const SETTINGS_KEY = 'guion.settings.v1';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const SAMPLE = `Hola. Este es un guion de prueba para que veas cómo funciona el teleprompter. En el modo voz, el texto avanza mientras vos hablás. Si hacés una pausa, el texto también espera.

Probá leer este párrafo en voz alta, a tu ritmo, y mirá cómo las palabras que ya dijiste se van apagando. Si te salteás una parte o querés volver atrás, tocá cualquier palabra y el teleprompter salta ahí.

Cuando estés listo, apretá el botón rojo para grabar. Hay una cuenta regresiva y después empieza la grabación. Al terminar, podés guardar el video en tus fotos o compartirlo directamente.

Ahora sí: creá un guion nuevo, pegá tu texto y a grabar.`;

export function loadScripts() {
  let list = read(SCRIPTS_KEY, null);
  if (!Array.isArray(list)) {
    const now = Date.now();
    list = [{ id: uid(), title: 'Guion de prueba', category: '', text: SAMPLE, createdAt: now, updatedAt: now }];
    write(SCRIPTS_KEY, list);
  }
  return list;
}

export function saveScripts(list) { return write(SCRIPTS_KEY, list); }

// Nichos creados por el usuario (con o sin guiones): [{ name, perDay }]
const NICHES_KEY = 'guion.niches.v1';
export function loadNiches() {
  const list = read(NICHES_KEY, []);
  return Array.isArray(list) ? list : [];
}
export function saveNiches(list) { return write(NICHES_KEY, list); }

const LANGS = ['es-AR', 'es-ES', 'es-MX', 'es-US', 'en-US', 'pt-BR'];
function guessLang() {
  const l = navigator.language || 'es-AR';
  if (LANGS.includes(l)) return l;
  if (l.startsWith('en')) return 'en-US';
  if (l.startsWith('pt')) return 'pt-BR';
  return 'es-AR';
}

// Cambia cuando cambia el diseño del área de texto: los ajustes de tamaño/posición
// guardados con un diseño anterior se reemplazan por los nuevos valores por defecto.
const LAYOUT_VERSION = 4;
export const LAYOUT_KEYS = ['fontSize', 'boxWidth', 'lines', 'readPos', 'margin', 'boxOpacity'];

export function defaultSettings() {
  const wide = Math.min(window.innerWidth, window.innerHeight) > 700;
  return {
    layoutVersion: LAYOUT_VERSION,
    mode: 'voice',
    fontSize: wide ? 22 : 14,
    speed: 5,
    // Algo más ancho que la isla de la cámara, con 5 líneas: se ve más texto por adelantado.
    boxWidth: wide ? 50 : 46,
    lines: 5,
    readPos: 22,
    margin: 8,
    boxOpacity: 60,
    mirrorText: false,
    camera: true,
    mirrorPreview: true,
    safeZone: 'none',
    faceGuide: false,
    countdown: 3,
    lang: guessLang(),
    showHeard: true,
  };
}

export function loadSettings() {
  const saved = read(SETTINGS_KEY, {});
  if (saved.layoutVersion !== LAYOUT_VERSION) {
    for (const k of [...LAYOUT_KEYS, 'boxHeight', 'layoutVersion']) delete saved[k];
  }
  return { ...defaultSettings(), ...saved };
}
export function saveSettings(s) { write(SETTINGS_KEY, s); }
