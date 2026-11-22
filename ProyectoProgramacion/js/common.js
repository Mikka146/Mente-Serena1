/* ============================================================
   COMMON.JS — Mente Serena
   Helpers y acceso a localStorage compartidos por las tres
   páginas del sitio: index.html (usuario), login.html (acceso
   de usuario) y admin.html (panel profesional).
   Cargar SIEMPRE antes que cualquier otro script del sistema.
   ============================================================ */

/* ── Storage genérico ─────────────────────────────────────── */
const ls = {
  get: (k, def = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

/* ── Utilidades ───────────────────────────────────────────── */
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
/** Tiempo relativo corto estilo red social: "ahora", "6 h", "3 d" */
function fmtRel(ts) {
  const t = new Date(ts).getTime();
  if (isNaN(t)) return '';
  const seg = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seg < 60)     return 'ahora';
  const min = Math.floor(seg / 60);   if (min < 60) return min + ' min';
  const hs  = Math.floor(min / 60);   if (hs  < 24) return hs  + ' h';
  const dias = Math.floor(hs / 24);   if (dias < 7) return dias + ' d';
  const sem = Math.floor(dias / 7);   if (sem < 5)  return sem + ' sem';
  return new Date(ts).toLocaleDateString('es-AR', { day:'2-digit', month:'short' });
}

/** Número compacto para los contadores del feed: 2500 -> "2,5 K" */
function fmtNum(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace('.', ',') + ' K';
  return (n / 1000000).toFixed(1).replace('.', ',') + ' M';
}

/** Usuario corto para mostrar debajo del nombre: "Lic. Ana Paz" -> "@anapaz" */
function handleDe(nombre) {
  const base = String(nombre || 'menteserena').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/lic\.?\s*/g, '').replace(/[^a-z0-9]/g, '');
  return '@' + (base || 'menteserena');
}

/* ── Iconos SVG de línea usados en las tarjetas del feed ───── */
const ICO = {
  corazon: (lleno) => `<svg class="ico" viewBox="0 0 24 24" fill="${lleno ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 8.6c0 5.3-8.8 10.4-8.8 10.4S3.2 13.9 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9z"/></svg>`,
  comentario: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l2-5.7a8.4 8.4 0 0 1-.9-3.8 8.4 8.4 0 0 1 8.4-8.4h.5a8.4 8.4 0 0 1 8 8z"/></svg>`,
  compartir: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14"/></svg>`,
  guardar: `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v17l-6-4-6 4z"/></svg>`
};

function getArgNow() {
  const now = new Date();
  return new Date(now.getTime() + now.getTimezoneOffset() * 60000 + -3 * 3600000);
}

/** Muestra un mensaje en un contenedor de alerta genérico */
function showAlert(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'alert ' + type;
}

/* ── Contenido del sitio (posts / comentarios / turnos) ──────
   Misma clave que usaban las versiones anteriores del sistema,
   así que los datos ya guardados en el dispositivo no se pierden.*/
const getPosts    = () => ls.get('ms_posts', []);
const getComments = () => ls.get('ms_comments', []);
const getTurnos   = () => ls.get('ms_turnos', []);
const savePosts   = (v) => ls.set('ms_posts', v);
const saveComments= (v) => ls.set('ms_comments', v);
const saveTurnos  = (v) => ls.set('ms_turnos', v);

/* ════════════════════════════════════════════════════════════
   §CUENTAS — Registro y sesión de usuarios (no profesionales)
   NOTA: es un prototipo sin backend; las cuentas y contraseñas
   se guardan en el localStorage del propio navegador y no
   ofrecen seguridad real. No usar con datos sensibles.
   ════════════════════════════════════════════════════════════ */
const USERS_KEY   = 'ms_users';
const SESSION_KEY = 'ms_sesion_user';

const getUsers  = () => ls.get(USERS_KEY, []);
const saveUsers = (v) => ls.set(USERS_KEY, v);

/** Sesión activa del usuario logueado, o null si nadie inició sesión */
function getSesion() { return ls.get(SESSION_KEY, null); }
function setSesion(v) { ls.set(SESSION_KEY, v); }
function clearSesion() { try { localStorage.removeItem(SESSION_KEY); } catch {} }
function estaLogueado() { return !!getSesion(); }

/** Busca una cuenta por usuario o correo (sin distinguir mayúsculas) */
function buscarCuenta(valor) {
  const v = String(valor || '').trim().toLowerCase();
  if (!v) return null;
  return getUsers().find(u => u.usuario.toLowerCase() === v || u.correo.toLowerCase() === v) || null;
}

/** Lleva a login.html conservando a dónde volver luego de iniciar sesión */
function irALogin(redirect) {
  const url = redirect ? `login.html?redirect=${encodeURIComponent(redirect)}` : 'login.html';
  window.location.href = url;
}
