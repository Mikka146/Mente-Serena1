/* ============================================================
   ADMIN.JS — Mente Serena
   Login (clave con hash PBKDF2) y panel profesional. Usado sólo por admin.html.
   Depende de common.js (esc, fmtDate, getArgNow, getTurnos, showAlert)
   y de turnos.js (renderTurnosAdmin, confirmarTurnoAdmin,
   liberarTurno, que se cargan antes que este archivo).
   ============================================================ */

// ── Estado del profesional logueado ──────────────────────────
let sesionAdmin = null;
const ADMIN_SESSION_KEY = 'ms_sesion_admin';   // clave LEGADA (localStorage). Ya no se usa: se borra al cargar.
const ADMIN_SESS_KEY    = 'ms_admin_sess';     // sesión actual (sessionStorage: muere al cerrar la pestaña)
const ADMIN_CRED_KEY    = 'ms_admin_cred';     // { "Nombre": { salt, hash, iter } }  — nunca la clave en texto plano
const ADMIN_LOCK_KEY    = 'ms_admin_lock';     // { "Nombre": { fails, until } }

const PBKDF2_ITER      = 210000;               // costo del hash (OWASP 2023 para PBKDF2-SHA256)
const MAX_INTENTOS     = 5;                    // intentos antes de bloquear
const BLOQUEO_BASE_MS  = 30 * 1000;            // 30 s, se duplica en cada nuevo fallo (tope 15 min)
const BLOQUEO_MAX_MS   = 15 * 60 * 1000;
const SESION_INACT_MS  = 30 * 60 * 1000;       // cierre por inactividad
const SESION_MAX_MS    = 8 * 60 * 60 * 1000;   // duración máxima absoluta
const CLAVES_COMUNES   = ['12345678','123456789','1234567890','password','contrasena','contraseña','qwertyui','11111111','00000000','menteserena','mente1234'];

let _loginBusy = false;
let _lockTimer = null;

/* ── Utilidades de cripto ─────────────────────────────────── */
const b64 = {
  enc: (u8) => btoa(String.fromCharCode(...u8)),
  dec: (s)  => Uint8Array.from(atob(s), c => c.charCodeAt(0))
};
async function derivarHash(clave, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64.dec(saltB64), iterations: iter }, base, 256);
  return b64.enc(new Uint8Array(bits));
}
/** Comparación en tiempo constante (evita filtrar cuántos caracteres coinciden) */
function igualesCT(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const getCreds = () => ls.get(ADMIN_CRED_KEY, {});
const getLocks = () => ls.get(ADMIN_LOCK_KEY, {});
const nombresValidos = () =>
  [...document.querySelectorAll('#admin-name option')].map(o => o.value).filter(Boolean);

/* ── Bloqueo por intentos fallidos ────────────────────────── */
function segundosBloqueo(nombre) {
  const l = getLocks()[nombre];
  return l && l.until > Date.now() ? Math.ceil((l.until - Date.now()) / 1000) : 0;
}
function registrarFallo(nombre) {
  const locks = getLocks();
  const l = locks[nombre] || { fails: 0, until: 0 };
  l.fails += 1;
  if (l.fails >= MAX_INTENTOS) {
    l.until = Date.now() + Math.min(BLOQUEO_MAX_MS, BLOQUEO_BASE_MS * 2 ** (l.fails - MAX_INTENTOS));
  }
  locks[nombre] = l;
  ls.set(ADMIN_LOCK_KEY, locks);
  return l;
}
function limpiarFallos(nombre) {
  const locks = getLocks();
  delete locks[nombre];
  ls.set(ADMIN_LOCK_KEY, locks);
}
function mostrarBloqueo(nombre) {
  clearInterval(_lockTimer);
  const btn = document.getElementById('admin-submit');
  const tick = () => {
    const s = segundosBloqueo(nombre);
    if (s <= 0) {
      clearInterval(_lockTimer);
      btn.disabled = false;
      document.getElementById('alert-admin').className = 'alert';
      return;
    }
    btn.disabled = true;
    const txt = s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
    showAlert('alert-admin', `🔒 Demasiados intentos. Probá de nuevo en ${txt}.`, 'error');
  };
  tick();
  _lockTimer = setInterval(tick, 1000);
}

/* ── Modo del formulario: ingresar / crear clave ──────────── */
function actualizarModoLogin() {
  const nombre = document.getElementById('admin-name').value;
  const setup  = !!nombre && !getCreds()[nombre];
  document.getElementById('admin-confirm-group').hidden = !setup;
  document.getElementById('admin-pass-label').textContent = setup ? 'Creá tu clave (mín. 8 caracteres, con letras y números)' : 'Clave de acceso';
  document.getElementById('admin-pass').autocomplete = setup ? 'new-password' : 'current-password';
  document.getElementById('admin-submit').textContent = setup ? 'Crear clave e ingresar' : 'Ingresar al panel';
  document.getElementById('admin-first-note').hidden = !setup;
  document.getElementById('alert-admin').className = 'alert';
  clearInterval(_lockTimer);
  document.getElementById('admin-submit').disabled = false;
  if (nombre && segundosBloqueo(nombre) > 0) mostrarBloqueo(nombre);
}

function validarClaveNueva(clave, repetida) {
  if (clave.length < 8)               return 'La clave debe tener al menos 8 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(clave) || !/\d/.test(clave)) return 'Usá letras y números en la clave.';
  if (CLAVES_COMUNES.includes(clave.toLowerCase())) return 'Esa clave es demasiado común. Elegí otra.';
  if (clave !== repetida)             return 'Las dos claves no coinciden.';
  return '';
}

/* ── Login ────────────────────────────────────────────────── */
async function loginAdmin(e) {
  if (e) e.preventDefault();
  if (_loginBusy) return false;

  const nombre = document.getElementById('admin-name').value;
  const clave  = document.getElementById('admin-pass').value;
  const clave2 = document.getElementById('admin-pass2').value;

  if (!window.crypto || !crypto.subtle) {
    showAlert('alert-admin', '⚠️ Abrí el sitio por HTTPS (o localhost): este navegador no permite el cifrado necesario.', 'error');
    return false;
  }
  if (!nombre || !nombresValidos().includes(nombre)) { showAlert('alert-admin', '⚠️ Seleccioná tu nombre.', 'error'); return false; }
  if (!clave) { showAlert('alert-admin', '⚠️ Ingresá tu clave.', 'error'); return false; }
  if (segundosBloqueo(nombre) > 0) { mostrarBloqueo(nombre); return false; }

  _loginBusy = true;
  const btn = document.getElementById('admin-submit');
  btn.disabled = true;
  try {
    const creds = getCreds();
    if (!creds[nombre]) {
      // Primer uso: la profesional define su propia clave (se guarda sólo el hash con sal)
      const err = validarClaveNueva(clave, clave2);
      if (err) { showAlert('alert-admin', '⚠️ ' + err, 'error'); return false; }
      const salt = b64.enc(crypto.getRandomValues(new Uint8Array(16)));
      creds[nombre] = { salt, iter: PBKDF2_ITER, hash: await derivarHash(clave, salt, PBKDF2_ITER) };
      ls.set(ADMIN_CRED_KEY, creds);
    } else {
      const c = creds[nombre];
      const h = await derivarHash(clave, c.salt, c.iter || PBKDF2_ITER);
      if (!igualesCT(h, c.hash)) {
        const l = registrarFallo(nombre);
        document.getElementById('admin-pass').value = '';
        document.getElementById('admin-pass').focus();
        if (l.fails >= MAX_INTENTOS) mostrarBloqueo(nombre);
        else showAlert('alert-admin', `✕ Nombre o clave incorrectos. Te quedan ${MAX_INTENTOS - l.fails} intentos.`, 'error');
        return false;
      }
      limpiarFallos(nombre);
    }
  } catch (err) {
    showAlert('alert-admin', '⚠️ No se pudo verificar la clave. Probá de nuevo.', 'error');
    return false;
  } finally {
    _loginBusy = false;
    if (segundosBloqueo(nombre) === 0) btn.disabled = false;
  }

  document.getElementById('admin-pass').value  = '';
  document.getElementById('admin-pass2').value = '';
  iniciarSesionAdmin(nombre);

  const screen = document.getElementById('welcome-screen');
  document.getElementById('welcome-title').textContent = `Bienvenida, ${nombre} ✨`;
  document.getElementById('welcome-msg').textContent   = 'Accediste al panel profesional.';
  screen.classList.add('active');
  setTimeout(() => { screen.classList.remove('active'); launchAdmin(); }, 1500);
  return false;
}

/* ── Sesión (sessionStorage + vencimiento) ────────────────── */
function iniciarSesionAdmin(nombre) {
  const ahora = Date.now();
  sesionAdmin = { nombre, ini: ahora, ult: ahora };
  try { sessionStorage.setItem(ADMIN_SESS_KEY, JSON.stringify(sesionAdmin)); } catch {}
}
function leerSesionAdmin() {
  try {
    const s = JSON.parse(sessionStorage.getItem(ADMIN_SESS_KEY));
    const ahora = Date.now();
    if (!s || !nombresValidos().includes(s.nombre) || !getCreds()[s.nombre]) return null;
    if (ahora - s.ini > SESION_MAX_MS || ahora - s.ult > SESION_INACT_MS) return null;
    return s;
  } catch { return null; }
}
let _ultTouch = 0;
function tocarSesionAdmin() {
  if (!sesionAdmin) return;
  const ahora = Date.now();
  if (ahora - _ultTouch < 15000) return;       // como mucho una escritura cada 15 s
  _ultTouch = ahora;
  sesionAdmin.ult = ahora;
  try { sessionStorage.setItem(ADMIN_SESS_KEY, JSON.stringify(sesionAdmin)); } catch {}
}

function cerrarSesionAdmin(motivo) {
  sesionAdmin = null;
  try { sessionStorage.removeItem(ADMIN_SESS_KEY); } catch {}
  try { localStorage.removeItem(ADMIN_SESSION_KEY); } catch {}
  if (window._adminInterval) { clearInterval(window._adminInterval); window._adminInterval = null; }
  if (window._sesionWatch)   { clearInterval(window._sesionWatch);   window._sesionWatch = null; }
  document.getElementById('app-admin').classList.add('app-hidden');
  document.getElementById('app-login-admin').classList.remove('app-hidden');
  document.getElementById('admin-pass').value  = '';
  document.getElementById('admin-pass2').value = '';
  document.getElementById('admin-name').value  = '';
  actualizarModoLogin();
  if (motivo === 'inactividad') showAlert('alert-admin', '⏱️ Cerramos tu sesión por inactividad. Ingresá de nuevo.', 'error');
}

document.addEventListener('DOMContentLoaded', () => {
  // La sesión vieja en localStorage (sólo guardaba el nombre) ya no es válida: se elimina.
  try { localStorage.removeItem(ADMIN_SESSION_KEY); } catch {}

  document.getElementById('admin-name').addEventListener('change', actualizarModoLogin);
  actualizarModoLogin();

  ['click', 'keydown', 'touchstart', 'scroll'].forEach(ev =>
    document.addEventListener(ev, tocarSesionAdmin, { passive: true }));

  const guardada = leerSesionAdmin();
  if (guardada) { sesionAdmin = guardada; launchAdmin(); }
});

function launchAdmin() {
  document.getElementById('app-admin').classList.remove('app-hidden');
  document.getElementById('app-login-admin').classList.add('app-hidden');

  // textContent / DOM en lugar de innerHTML: el nombre nunca se interpreta como HTML
  const userEl = document.getElementById('a-username');
  userEl.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = sesionAdmin.nombre;
  userEl.append('Bienvenida, ', strong, ' ✨');

  // Vigilante de vencimiento de sesión
  if (window._sesionWatch) clearInterval(window._sesionWatch);
  window._sesionWatch = setInterval(() => {
    if (!leerSesionAdmin()) cerrarSesionAdmin('inactividad');
  }, 30000);

  // Enlaces desde otras páginas: admin.html#historias · admin.html#pacientes
  const destino = { '#historias': ['a-historias', 'tab-historias'], '#pacientes': ['a-pacientes', null] }[location.hash];
  if (destino) {
    const btn = destino[1] ? document.getElementById(destino[1]) : [...document.querySelectorAll('.tab-btn')].find(b => /Pacientes/.test(b.textContent));
    adminGoTo(destino[0], btn);
  } else {
    // Pestaña inicial: Turnos
    adminGoTo('a-turnos', document.querySelector('.tab-btn'));
  }
}

function adminGoTo(id, btn) {
  // ── Ocultar todas las secciones del panel admin, incluyendo la de historias ──
  ['a-turnos','a-pacientes','a-historias'].forEach(s => {
    document.getElementById(s)?.classList.remove('active');
  });
  document.getElementById(id)?.classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (id === 'a-turnos')      renderTurnosAdmin();
  if (id === 'a-pacientes')   renderPacientes();
  // ── Al navegar a historias, renderizar la lista guardada ──
  if (id === 'a-historias' && typeof renderHistorias === 'function') renderHistorias();
}

// ════════════════════════════════════════════════════════════
//  HISTORIAS CLÍNICAS — el listado, los permisos y la migración de
//  las fichas anteriores viven en js/historias.js (renderHistorias).
//  La vista detallada es historia_clinica.html?hc=ID.
// ════════════════════════════════════════════════════════════
