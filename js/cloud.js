// Cuentas y sincronización con Supabase, sin librerías (fetch directo a su API).
// Cada guion es una fila de la tabla "scripts" con el user_id de su dueño. La base tiene
// reglas (RLS) que solo dejan leer y escribir las filas propias: aunque alguien modifique
// esta app, el servidor no le devuelve nada que no sea suyo.
//
// La app trabaja primero en el teléfono (funciona sin internet) y sube los cambios sola.

// Datos públicos del proyecto (la clave "anon/publishable" está pensada para ir en la app).
// Vacíos = la app funciona como antes, sin cuentas.
export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';
export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_KEY);

const SESSION_KEY = 'guion.session.v1';
const APP_URL = new URL('./', location.href).href;

// ---------- Sesión ----------
function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
function writeSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* sin espacio: la sesión dura lo que la pestaña */ }
}

let session = cloudEnabled ? readSession() : null;
export const currentUser = () => (session?.user ? { id: session.user.id, email: session.user.email } : null);

function keep(data) {
  // Respuesta de /token: guardamos solo lo necesario.
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: { id: data.user.id, email: data.user.email },
  };
  writeSession(session);
  return currentUser();
}

// Mensajes de error del servidor, en castellano.
function authError(body, status) {
  const raw = `${body?.error_code || body?.code || ''} ${body?.msg || body?.error_description || body?.message || body?.error || ''}`.toLowerCase();
  const msg =
    /invalid.*(credentials|grant)|invalid login/.test(raw) ? 'Email o contraseña incorrectos.'
      : /not.*confirmed/.test(raw) ? 'Todavía no confirmaste tu email. Revisá tu correo (y la carpeta de spam).'
        : /already.*(registered|exists)/.test(raw) ? 'Ya existe una cuenta con ese email. Entrá con tu contraseña.'
          : /password.*(at least|short|weak)|weak_password/.test(raw) ? 'La contraseña tiene que tener al menos 8 caracteres.'
            : /rate|too many|security purposes/.test(raw) ? 'Demasiados intentos. Esperá un minuto y probá de nuevo.'
              : /invalid.*email|email.*invalid/.test(raw) ? 'Ese email no es válido.'
                : status >= 500 ? 'El servidor no responde. Probá de nuevo en un rato.'
                  : 'No se pudo completar. Revisá los datos y probá de nuevo.';
  const err = new Error(msg);
  err.status = status;
  return err;
}

async function authCall(path, body, token) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new Error('Sin conexión a internet.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw authError(data, res.status);
  return data;
}

export async function signIn(email, password) {
  return keep(await authCall('token?grant_type=password', { email, password }));
}

// Devuelve el usuario si quedó adentro, o null si hace falta confirmar el email primero.
export async function signUp(email, password) {
  const data = await authCall(`signup?redirect_to=${encodeURIComponent(APP_URL)}`, { email, password });
  if (data.access_token) return keep(data);
  if (data.user?.identities?.length === 0 || data.identities?.length === 0) throw new Error('Ya existe una cuenta con ese email. Entrá con tu contraseña.');
  return null;
}

export async function resetPassword(email) {
  await authCall(`recover?redirect_to=${encodeURIComponent(APP_URL)}`, { email });
}

export async function setPassword(password) {
  const token = await accessToken();
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password }),
    });
  } catch { throw new Error('Sin conexión a internet.'); }
  if (!res.ok) throw authError(await res.json().catch(() => ({})), res.status);
}

export async function signOut() {
  const token = session?.access_token;
  session = null;
  writeSession(null);
  if (token) authCall('logout', {}, token).catch(() => {});
}

// Los links del mail (confirmar cuenta, recuperar contraseña) vuelven con la sesión en el #.
// Devuelve 'recovery' si hay que pedir una contraseña nueva.
export function takeSessionFromUrl() {
  if (!cloudEnabled) return null;
  const hash = location.hash.slice(1);
  if (!/access_token=|error_description=/.test(hash)) return null;
  const p = new URLSearchParams(hash);
  history.replaceState(null, '', location.pathname + location.search + '#/');
  if (p.get('error_description')) return { error: p.get('error_description').replace(/\+/g, ' ') };
  const token = p.get('access_token');
  let user = null;
  try { user = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
  keep({
    access_token: token,
    refresh_token: p.get('refresh_token'),
    expires_at: Number(p.get('expires_at')) || undefined,
    expires_in: Number(p.get('expires_in')) || 3600,
    user: { id: user.sub, email: user.email },
  });
  return { type: p.get('type') };
}

export class SessionExpired extends Error {}

let refreshing = null;
async function accessToken() {
  if (!session) throw new SessionExpired('Sin sesión');
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  refreshing ||= (async () => {
    try {
      keep(await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token }));
    } catch (e) {
      // 4xx = la sesión ya no vale (cerrada en otro lado, contraseña cambiada). Sin red: reintentar luego.
      if (e.status >= 400 && e.status < 500) { session = null; writeSession(null); throw new SessionExpired(e.message); }
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  await refreshing;
  return session.access_token;
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const token = await accessToken();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { session = null; writeSession(null); throw new SessionExpired('Sesión vencida'); }
  if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
  // Las escrituras con "return=minimal" responden 201 sin cuerpo.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------- Sincronización ----------
// Se guarda, por cuenta, una "huella" de cada guion tal como quedó en el servidor. Lo que
// difiere de su huella cambió en este teléfono y hay que subirlo.
// JSON con las claves ordenadas: la base de datos reordena las claves y la huella tiene que
// dar igual para el mismo contenido.
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));
const print = (v) => hash(stable(v));
const hash = (s) => {
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36) + s.length.toString(36);
};

const PAGE = 500;
const CHUNK = 40;

export class Sync {
  constructor({ uid, getScripts, setScripts, getNiches, setNiches, onStatus = () => {}, onChange = () => {}, onExpired = () => {} }) {
    Object.assign(this, { uid, getScripts, setScripts, getNiches, setNiches, onStatus, onChange, onExpired });
    this.key = `guion.u.${uid}.sync`;
    this.meta = this.load();
    this.timer = 0;
    this.busy = null;
    this.again = false;
    this.status = 'ok';
    this.lastOk = 0;
  }

  load() {
    try { return { ids: {}, niches: '', cursor: '', ...JSON.parse(localStorage.getItem(this.key)) }; } catch { return { ids: {}, niches: '', cursor: '' }; }
  }
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.meta)); } catch { /* sin espacio */ } }

  set(status) { this.status = status; this.onStatus(status); }

  // Cambios locales que todavía no están en el servidor.
  pending() {
    const list = this.getScripts();
    const seen = new Set();
    const up = [];
    for (const s of list) {
      seen.add(s.id);
      const hs = print(s);
      if (this.meta.ids[s.id] !== hs) up.push({ s, hs });
    }
    const gone = Object.keys(this.meta.ids).filter((id) => !seen.has(id));
    const nj = JSON.stringify(this.getNiches());
    const niches = print(this.getNiches()) !== this.meta.niches ? nj : null;
    return { up, gone, niches };
  }

  count() { const p = this.pending(); return p.up.length + p.gone.length + (p.niches ? 1 : 0); }

  schedule(ms = 1500) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), ms);
  }

  // Bajar lo nuevo del servidor y subir lo cambiado acá. Una sola corrida a la vez.
  run() {
    if (this.busy) { this.again = true; return this.busy; }
    this.busy = (async () => {
      this.set('syncing');
      try {
        await this.pull();
        await this.push();
        this.lastOk = Date.now();
        this.set(this.count() ? 'pending' : 'ok');
      } catch (e) {
        if (e instanceof SessionExpired) { this.set('expired'); this.onExpired(); }
        else this.set(navigator.onLine === false || /fetch|network|conexión/i.test(e.message) ? 'offline' : 'error');
      } finally {
        this.busy = null;
        if (this.again) { this.again = false; this.schedule(300); }
      }
    })();
    return this.busy;
  }

  async pull() {
    let changed = false;
    // Nichos (una fila por cuenta).
    const st = await rest('user_state?select=niches,updated_at');
    if (st?.length) {
      const remote = st[0].niches || [];
      const localDirty = print(this.getNiches()) !== this.meta.niches;
      if (print(remote) !== this.meta.niches && !localDirty) { this.setNiches(remote); changed = true; }
      if (!localDirty) this.meta.niches = print(remote);
    }
    // Guiones cambiados desde la última vez.
    let cursor = this.meta.cursor;
    for (;;) {
      const q = `scripts?select=id,data,deleted,updated_at&order=updated_at.asc&limit=${PAGE}` + (cursor ? `&updated_at=gt.${encodeURIComponent(cursor)}` : '');
      const rows = await rest(q);
      if (!rows.length) break;
      const list = this.getScripts();
      const byId = new Map(list.map((s) => [s.id, s]));
      for (const r of rows) {
        const local = byId.get(r.id);
        const localDirty = local ? print(local) !== this.meta.ids[r.id] : r.id in this.meta.ids;
        if (localDirty && local) continue; // lo de este teléfono es más nuevo: se sube después
        if (!r.deleted && local && print(r.data) === this.meta.ids[r.id]) continue; // es lo mismo que ya hay
        if (r.deleted) {
          if (local) { byId.delete(r.id); changed = true; }
          delete this.meta.ids[r.id];
        } else {
          byId.set(r.id, r.data);
          this.meta.ids[r.id] = print(r.data);
          changed = true;
        }
      }
      if (changed) this.setScripts([...byId.values()]);
      cursor = rows[rows.length - 1].updated_at;
      this.meta.cursor = cursor;
      this.save();
      if (rows.length < PAGE) break;
    }
    this.save();
    if (changed) this.onChange();
  }

  async push() {
    const { up, gone, niches } = this.pending();
    for (let i = 0; i < up.length; i += CHUNK) {
      const part = up.slice(i, i + CHUNK);
      await rest('scripts?on_conflict=user_id,id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: part.map(({ s }) => ({ user_id: this.uid, id: s.id, data: s, deleted: false })),
      });
      for (const { s, hs } of part) this.meta.ids[s.id] = hs;
      this.save();
    }
    for (let i = 0; i < gone.length; i += CHUNK) {
      const part = gone.slice(i, i + CHUNK);
      await rest('scripts?on_conflict=user_id,id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: part.map((id) => ({ user_id: this.uid, id, data: {}, deleted: true })),
      });
      for (const id of part) delete this.meta.ids[id];
      this.save();
    }
    if (niches) {
      await rest('user_state?on_conflict=user_id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: [{ user_id: this.uid, niches: JSON.parse(niches) }],
      });
      this.meta.niches = print(JSON.parse(niches));
      this.save();
    }
  }

  // ¿La cuenta ya tiene algo en el servidor? (para decidir si se ofrecen los datos del teléfono)
  static async remoteEmpty() {
    const rows = await rest('scripts?select=id&deleted=eq.false&limit=1');
    const st = await rest('user_state?select=niches');
    return !rows.length && !(st?.[0]?.niches?.length);
  }
}
