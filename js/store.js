// Todo se guarda en este dispositivo (localStorage). Si el almacenamiento falla
// (modo privado, etc.) la app sigue funcionando en memoria.
const SETTINGS_KEY = 'guion.settings.v1'; // ajustes del teleprompter: son de este teléfono
const LEGACY_SCRIPTS = 'guion.scripts.v1';
const LEGACY_NICHES = 'guion.niches.v1';

// Con cuentas, los datos de cada una van en sus propias claves: guion.u.<id>.…
// Sin cuenta (o antes de las cuentas), en las claves de siempre.
let prefix = 'guion.';
let account = null;
export function setAccount(uid) { account = uid || null; prefix = uid ? `guion.u.${uid}.` : 'guion.'; }
const SCRIPTS_KEY_ = () => prefix + 'scripts.v1';
const NICHES_KEY_ = () => prefix + 'niches.v1';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

// Si lo guardado está dañado, se guarda una copia aparte antes de seguir: nunca se pisa.
function readSafe(key) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch { return { missing: false, value: null }; }
  if (raw == null) return { missing: true, value: null };
  try { return { missing: false, value: JSON.parse(raw) }; } catch {
    try { localStorage.setItem(`${key}.danado.${Date.now()}`, raw); } catch { /* sin espacio */ }
    return { missing: false, value: null };
  }
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
  const { missing, value } = readSafe(SCRIPTS_KEY_());
  if (Array.isArray(value)) return value;
  // El guion de ejemplo solo se crea la primera vez (nunca sobre datos que no se pudieron leer).
  // En una cuenta, lo decide el inicio de sesión (puede que la cuenta ya tenga guiones).
  if (!missing || account) return [];
  const now = Date.now();
  const list = [{ id: uid(), title: 'Guion de prueba', category: '', text: SAMPLE, createdAt: now, updatedAt: now }];
  write(SCRIPTS_KEY_(), list);
  return list;
}

export function saveScripts(list) { return write(SCRIPTS_KEY_(), list); }

export const sampleScript = () => { const now = Date.now(); return { id: uid(), title: 'Guion de prueba', category: '', text: SAMPLE, createdAt: now, updatedAt: now }; };

// Datos de este teléfono de antes de las cuentas (para ofrecer subirlos a una cuenta).
const MIGRATED = 'guion.legacy.migrated';
export function legacyData() {
  try {
    if (localStorage.getItem(MIGRATED)) return null;
    const scripts = JSON.parse(localStorage.getItem(LEGACY_SCRIPTS) || '[]');
    const niches = JSON.parse(localStorage.getItem(LEGACY_NICHES) || '[]');
    const real = Array.isArray(scripts) ? scripts.filter((s) => s.title !== 'Guion de prueba' || s.text !== SAMPLE) : [];
    return real.length || (Array.isArray(niches) && niches.length) ? { scripts: Array.isArray(scripts) ? scripts : [], niches: Array.isArray(niches) ? niches : [] } : null;
  } catch { return null; }
}
export function markLegacyMigrated(uid) { try { localStorage.setItem(MIGRATED, uid); } catch { /* nada */ } }
// Una vez que todo quedó en la cuenta, la copia vieja ya no hace falta (libera espacio).
export function dropLegacyIfMigrated(uid) {
  try {
    if (localStorage.getItem(MIGRATED) !== uid) return;
    localStorage.removeItem(LEGACY_SCRIPTS);
    localStorage.removeItem(LEGACY_NICHES);
  } catch { /* nada */ }
}

// Al cerrar sesión se borra la copia local de esa cuenta (queda en el servidor).
export function forgetAccount(uid) {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(`guion.u.${uid}.`)) localStorage.removeItem(k); } catch { /* nada */ }
}

// Nichos creados por el usuario (con o sin guiones): [{ name, perDay, layout }]
export function loadNiches() {
  const list = read(NICHES_KEY_(), []);
  return Array.isArray(list) ? list : [];
}
export function saveNiches(list) { return write(NICHES_KEY_(), list); }

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

// Computadora: mouse o trackpad y pantalla grande. La webcam está arriba, en el centro.
export const isDesktop = () => matchMedia('(hover: hover) and (pointer: fine)').matches && Math.max(screen.width, window.innerWidth) >= 900;
// En la compu, el equivalente a la isla: una columna angosta (~440 px) debajo de la webcam.
const DESK_BOX = 440;
const DESK_LAYOUT = 1;

export function defaultSettings() {
  const wide = Math.min(window.innerWidth, window.innerHeight) > 700;
  const desk = isDesktop();
  return {
    layoutVersion: LAYOUT_VERSION,
    deskLayout: desk ? DESK_LAYOUT : 0,
    mode: 'voice',
    fontSize: wide ? 22 : 14,
    speed: 5,
    // Algo más ancho que la isla de la cámara, con 5 líneas: se ve más texto por adelantado.
    boxWidth: desk ? Math.round(Math.min(60, Math.max(20, (DESK_BOX / window.innerWidth) * 100))) : wide ? 50 : 46,
    lines: 5,
    readPos: 22,
    margin: 8,
    boxOpacity: 60,
    mirrorText: false,
    camera: true,
    mirrorPreview: true,
    safeZone: 'none',
    // Compu: la toma sale vertical como en el iPhone. 'vertical' = la imagen entera, sin zoom;
    // 'fill' = recortada al centro (con zoom); 'camera' = como filma la webcam.
    videoShape: 'vertical',
    faceGuide: false,
    countdown: 3,
    lang: guessLang(),
    showHeard: true,
    lead: 2, // adelanto del texto en modo voz (0 = no, 3 = mucho)
  };
}

export function loadSettings() {
  const stored = read(SETTINGS_KEY, {});
  const saved = stored && typeof stored === 'object' ? stored : {};
  if (saved.layoutVersion !== LAYOUT_VERSION) {
    for (const k of [...LAYOUT_KEYS, 'boxHeight', 'layoutVersion']) delete saved[k];
  }
  // Primera vez con el diseño de computadora: el texto pasa a la columna debajo de la webcam.
  if (isDesktop() && saved.deskLayout !== DESK_LAYOUT) {
    for (const k of [...LAYOUT_KEYS, 'deskLayout']) delete saved[k];
  }
  return { ...defaultSettings(), ...saved };
}
export function saveSettings(s) { write(SETTINGS_KEY, s); }
