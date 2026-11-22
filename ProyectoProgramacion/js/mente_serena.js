/* ============================================================
   MENTE_SERENA.JS — index.html (sitio público / panel de usuario)
   Requiere common.js (ls, esc, fmtDate, getArgNow, showAlert,
   getTurnos, getSesion/setSesion/clearSesion,
   estaLogueado, irALogin) cargado ANTES que este archivo.
   ============================================================ */

// ── Estado de sesión en memoria (reflejo de common.js) ───────
let sesion = getSesion(); // null si nadie inició sesión

// ── Mostrar/ocultar pantallas (compatibilidad) ───────────────
function showScreen(id) {
  document.getElementById('app-usuario')?.classList.toggle('app-hidden', id !== 'app-usuario');
}

// ════════════════════════════════════════════════════════════
//  SESIÓN — usa las cuentas reales de common.js (login.html)
// ════════════════════════════════════════════════════════════

/** Pinta el header según haya o no sesión iniciada */
function pintarSesion() {
  const logueado = estaLogueado();
  document.getElementById('user-chip')?.classList.toggle('app-hidden', !logueado);
  document.getElementById('btn-salir-user')?.classList.toggle('app-hidden', !logueado);
  document.getElementById('btn-login-top')?.classList.toggle('app-hidden', logueado);
  if (logueado) {
    const nombre = String(sesion.nombre || '').trim();
    const nombreEl = document.getElementById('user-nombre');
    if (nombreEl) nombreEl.textContent = nombre;
    // Avatar con la inicial del nombre (el nombre completo queda en el tooltip)
    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl) avatarEl.textContent = ([...nombre][0] || '•').toUpperCase();
    const chipEl = document.getElementById('user-chip');
    if (chipEl) chipEl.title = nombre;
  }
}

/** Mensaje flotante breve dentro del sitio público */
let _toastInicioT = null;
function toastInicio(msg) {
  let t = document.getElementById('ms-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ms-toast';
    t.className = 'ms-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('visible');
  if (_toastInicioT) clearTimeout(_toastInicioT);
  _toastInicioT = setTimeout(() => t.classList.remove('visible'), 3500);
}

/** Navega a una sección del sitio desde cualquier botón */
function irASeccion(destino) {
  document.querySelectorAll('.u-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('sec-' + destino)?.classList.add('active');
  document.querySelector(`.nav-link[data-section="${destino}"]`)?.classList.add('active');
  // Sincroniza los puntitos del hero (sólo cubren Inicio/Nosotros)
  const HERO_DOTS = ['inicio', 'nosotros'];
  const idx = HERO_DOTS.indexOf(destino);
  document.querySelectorAll('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  if (destino === 'turnos')      syncTurnos();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cerrarSesion() {
  clearSesion();
  sesion = null;
  pintarSesion();
  syncTurnos();
  irASeccion('inicio');
  toastInicio('👋 Cerraste tu sesión. Seguís pudiendo navegar el sitio.');
}

/* ────────────────────────────────────────────────────────────
   ARRANQUE — el sitio público es la pantalla inicial
   ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  sesion = getSesion();
  launchUsuario();
  const _y = document.getElementById('ft-year'); if (_y) _y.textContent = new Date().getFullYear();

  // Volviendo de login.html: mostrar saludo y, si correspondía,
  // llevar directo a la sección que pidió el login (turnos)
  const params = new URLSearchParams(window.location.search);
  if (params.get('login') === '1' && sesion) {
    toastInicio(`🌸 ¡Hola, ${sesion.nombre}! Ya iniciaste sesión.`);
    const ir = params.get('ir');
    if (ir === 'turnos') irASeccion(ir);
    // Limpia los parámetros de la URL sin recargar la página
    window.history.replaceState({}, '', window.location.pathname);
  }
});

// ════════════════════════════════════════════════════════════
//  PANTALLA USUARIO
// ════════════════════════════════════════════════════════════
function launchUsuario() {
  showScreen('app-usuario');
  pintarSesion();
  initParticles();
  initSplash();
  initNavUsuario();
  syncTurnos();
}

/* ────────────────────────────────────────────────────────────
   §GATE — Turnos exige sesión iniciada.
   Sin sesión, se inyecta una tarjeta que invita a hacer login
   en login.html (que al terminar redirige de vuelta aquí).
   ──────────────────────────────────────────────────────────── */
function _gateHTML(icono, titulo, texto, destino) {
  return `
    <div class="turnos-gate">
      <div class="tg-icon">${icono}</div>
      <h2>${titulo}</h2>
      <p>${texto}</p>
      <button class="btn btn-user" onclick="irALogin('${destino}')">Iniciar sesión</button>
      <p class="tg-hint">🌿 El resto del sitio seguís usándolo sin iniciar sesión.</p>
    </div>`;
}

function syncTurnos() {
  const wrapper = document.getElementById('sec-turnos');
  if (!wrapper) return;

  if (estaLogueado()) {
    if (wrapper.querySelector('.turnos-gate')) wrapper.innerHTML = '';
    initTurnos();                       // definido por turnos.js
    prefillTurnos();
    return;
  }

  wrapper.innerHTML = _gateHTML('🔒', 'Para reservar un turno, iniciá sesión',
    'Necesitamos tus datos de contacto para agendar la consulta y que el equipo pueda comunicarse con vos.',
    'turnos');
}

/** Precarga nombre y apellido de la sesión en el paso 3 de Turnos */
function prefillTurnos() {
  const campo = document.getElementById('t-nombre');
  if (campo && !campo.value && sesion) campo.value = `${sesion.nombre} ${sesion.apellido || ''}`.trim();
}

function initSplash() {
  const splash = document.getElementById('welcome-splash');
  if (!splash) return;
  // Sólo la primera vez de la visita: el sitio ahora abre directo aquí
  try {
    if (sessionStorage.getItem('ms_splash_visto')) { splash.style.display = 'none'; return; }
    sessionStorage.setItem('ms_splash_visto', '1');
  } catch {}
  splash.style.display = 'flex';
  splash.classList.remove('hide');
  setTimeout(() => splash.classList.add('hide'), 2800);
  setTimeout(() => { splash.style.display = 'none'; }, 3400);
}

function initParticles() {
  const cont = document.getElementById('particles');
  if (!cont || cont.childElementCount > 0) return;
  const colors = ['#f8c8dc','#a8e6cf','#a8e6cf','#fce4ee','#a8e6cf'];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const s = Math.random() * 60 + 15;
    p.style.cssText = `width:${s}px;height:${s}px;left:${Math.random()*100}%;background:${colors[i%5]};animation-duration:${Math.random()*20+15}s;animation-delay:${Math.random()*15}s;`;
    cont.appendChild(p);
  }
}

function initNavUsuario() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      irASeccion(link.dataset.section);
    });
  });
}

// ── Turnos usuario ───────────────────────────────────────────
function initTurnos() {
  const selDia  = document.getElementById('turno-dia');
  const selHora = document.getElementById('turno-hora');
  if (!selDia || !selHora) return;

  selDia.innerHTML = '<option value="">-- Elegí un día --</option>';
  const hoy = new Date();
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  let agregados = 0;
  for (let d = 0; d < 21 && agregados < 10; d++) {
    const fecha = new Date(hoy);
    fecha.setDate(hoy.getDate() + d);
    const dow = fecha.getDay();
    if (dow >= 1 && dow <= 5) {
      const val = fecha.toISOString().split('T')[0];
      selDia.innerHTML += `<option value="${val}">${dias[dow]} ${fecha.getDate()}/${fecha.getMonth()+1}/${fecha.getFullYear()}</option>`;
      agregados++;
    }
  }
  selDia.addEventListener('change', loadHoras);
}

function loadHoras() {
  const selDia  = document.getElementById('turno-dia');
  const selHora = document.getElementById('turno-hora');
  const diaVal  = selDia.value;
  selHora.innerHTML = '<option value="">-- Elegí un horario --</option>';
  if (!diaVal) return;

  const hoy    = new Date();
  const esHoy  = new Date(diaVal + 'T00:00:00').toDateString() === hoy.toDateString();
  const horaMin = esHoy ? hoy.getHours() + 1 : 9;
  const turnos  = getTurnos();
  const ocupados = turnos.filter(t => t.dia === diaVal).map(t => t.hora);

  for (let h = Math.max(9, horaMin); h <= 17; h++) {
    const label    = `${String(h).padStart(2,'0')}:00 - ${String(h+1).padStart(2,'0')}:00`;
    const disabled = ocupados.includes(h);
    selHora.innerHTML += `<option value="${h}" ${disabled ? 'disabled' : ''}>${label}${disabled ? ' (ocupado)' : ''}</option>`;
  }
}

function pedirTurno() {
  const dia  = document.getElementById('turno-dia').value;
  const hora = parseInt(document.getElementById('turno-hora').value);
  if (!dia || isNaN(hora)) { showTurnoMsg('Seleccioná día y horario.','error'); return; }
  const turnos = getTurnos();
  if (turnos.find(t => t.dia === dia && t.hora === hora)) { showTurnoMsg('Ese horario ya está reservado.','error'); return; }
  turnos.push({ dia, hora, usuario: sesion.nombre, estado: 'pendiente', fecha: Date.now() });
  saveTurnos(turnos);
  showTurnoMsg(`✅ Turno reservado: ${dia} ${String(hora).padStart(2,'0')}:00 hs`, 'success');
  loadHoras();
}

function showTurnoMsg(txt, type) {
  const msg = document.getElementById('turno-msg');
  msg.textContent = txt;
  msg.className   = 'form-msg ' + type + ' show';
  setTimeout(() => msg.classList.remove('show'), 4000);
}
