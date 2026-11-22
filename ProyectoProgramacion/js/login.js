/* ============================================================
   LOGIN.JS — Mente Serena
   Login, registro y recuperación de contraseña de usuarios.
   Usado únicamente por login.html. Depende de common.js.
   ============================================================ */

/** Cuenta hallada durante el flujo de recuperación (temporal) */
let _cuentaRecuperar = null;

/* ── Parámetro ?redirect= para volver a la sección pedida ──── */
function _redirectDestino() {
  const params = new URLSearchParams(window.location.search);
  return params.get('redirect') || '';
}

document.addEventListener('DOMContentLoaded', () => {
  // Si ya había una sesión activa, no tiene sentido pedir login de nuevo
  if (estaLogueado()) { _irAIndex(); return; }

  const destino = _redirectDestino();
  const sub = document.getElementById('brand-sub');
  if (sub && destino === 'turnos')      sub.textContent = 'Iniciá sesión para reservar tu turno';
});

function _irAIndex() {
  const destino = _redirectDestino();
  const url = destino ? `index.html?login=1&ir=${encodeURIComponent(destino)}` : 'index.html?login=1';
  window.location.href = url;
}

/* ════════════════════════════════════════════════════════════
   PESTAÑAS / PANELES
   ════════════════════════════════════════════════════════════ */
function mostrarPanel(nombre) {
  ['login','registro','recuperar'].forEach(p => {
    document.getElementById('panel-' + p)?.classList.toggle('active', p === nombre);
  });
  document.getElementById('tab-login')?.classList.toggle('active', nombre === 'login');
  document.getElementById('tab-registro')?.classList.toggle('active', nombre === 'registro');
  // Las pestañas de arriba sólo tienen sentido para login/registro
  document.getElementById('auth-tabs')?.classList.toggle('app-hidden', nombre === 'recuperar');

  // Reiniciar el flujo de recuperación cada vez que se entra a ese panel
  if (nombre === 'recuperar') {
    _cuentaRecuperar = null;
    document.getElementById('recuperar-paso1')?.classList.remove('app-hidden');
    document.getElementById('recuperar-paso2')?.classList.add('app-hidden');
    document.getElementById('rec-usuario').value = '';
    document.getElementById('alert-recuperar').className = 'alert';
  }
}

/* ════════════════════════════════════════════════════════════
   LOGIN
   ════════════════════════════════════════════════════════════ */
function hacerLogin() {
  const usuario  = document.getElementById('login-usuario').value.trim();
  const password = document.getElementById('login-password').value;

  if (!usuario || !password) {
    showAlert('alert-login', '⚠️ Completá usuario y contraseña.', 'error');
    return;
  }

  const cuenta = buscarCuenta(usuario);
  if (!cuenta || cuenta.password !== password) {
    showAlert('alert-login', '✕ Usuario o contraseña incorrectos.', 'error');
    return;
  }

  setSesion({
    nombre: cuenta.nombre, apellido: cuenta.apellido,
    usuario: cuenta.usuario, correo: cuenta.correo
  });
  showAlert('alert-login', '✓ ¡Bienvenido/a de nuevo! Ingresando…', 'success');
  setTimeout(_irAIndex, 500);
}

/* ════════════════════════════════════════════════════════════
   REGISTRO
   ════════════════════════════════════════════════════════════ */
function hacerRegistro() {
  const nombre    = document.getElementById('reg-nombre').value.trim();
  const apellido  = document.getElementById('reg-apellido').value.trim();
  const usuario   = document.getElementById('reg-usuario').value.trim();
  const correo    = document.getElementById('reg-correo').value.trim();
  const password  = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;

  if (!nombre || !apellido || !usuario || !correo || !password) {
    showAlert('alert-registro', '⚠️ Completá todos los campos.', 'error');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    showAlert('alert-registro', '⚠️ Ingresá un correo válido.', 'error');
    return;
  }
  if (usuario.length < 3) {
    showAlert('alert-registro', '⚠️ El usuario debe tener al menos 3 caracteres.', 'error');
    return;
  }
  if (password.length < 6) {
    showAlert('alert-registro', '⚠️ La contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }
  if (password !== password2) {
    showAlert('alert-registro', '⚠️ Las contraseñas no coinciden.', 'error');
    return;
  }

  const usuarios = getUsers();
  if (usuarios.some(u => u.usuario.toLowerCase() === usuario.toLowerCase())) {
    showAlert('alert-registro', '✕ Ese usuario ya existe. Elegí otro.', 'error');
    return;
  }
  if (usuarios.some(u => u.correo.toLowerCase() === correo.toLowerCase())) {
    showAlert('alert-registro', '✕ Ya hay una cuenta con ese correo.', 'error');
    return;
  }

  usuarios.push({ nombre, apellido, usuario, correo, password, creado: Date.now() });
  saveUsers(usuarios);

  setSesion({ nombre, apellido, usuario, correo });
  showAlert('alert-registro', '✓ ¡Cuenta creada! Ingresando…', 'success');
  setTimeout(_irAIndex, 600);
}

/* ════════════════════════════════════════════════════════════
   RECUPERAR CONTRASEÑA
   Al no existir backend/correo real, el "envío de instrucciones"
   se simula dejando definir una nueva contraseña en el momento.
   ════════════════════════════════════════════════════════════ */
function buscarCuentaRecuperar() {
  const valor  = document.getElementById('rec-usuario').value.trim();
  if (!valor) {
    showAlert('alert-recuperar', '⚠️ Ingresá tu usuario o correo.', 'error');
    return;
  }
  const cuenta = buscarCuenta(valor);
  if (!cuenta) {
    showAlert('alert-recuperar', '✕ No encontramos ninguna cuenta con ese dato.', 'error');
    return;
  }
  _cuentaRecuperar = cuenta;
  document.getElementById('alert-recuperar').className = 'alert';
  document.getElementById('rec-nombre-hallado').textContent = `${cuenta.nombre} ${cuenta.apellido}`;
  document.getElementById('recuperar-paso1').classList.add('app-hidden');
  document.getElementById('recuperar-paso2').classList.remove('app-hidden');
}

function guardarNuevaPassword() {
  if (!_cuentaRecuperar) return;
  const p1 = document.getElementById('rec-password').value;
  const p2 = document.getElementById('rec-password2').value;

  if (p1.length < 6) {
    showAlert('alert-recuperar', '⚠️ La contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }
  if (p1 !== p2) {
    showAlert('alert-recuperar', '⚠️ Las contraseñas no coinciden.', 'error');
    return;
  }

  const usuarios = getUsers();
  const idx = usuarios.findIndex(u => u.usuario === _cuentaRecuperar.usuario);
  if (idx === -1) {
    showAlert('alert-recuperar', '✕ Ocurrió un error. Intentá de nuevo.', 'error');
    return;
  }
  usuarios[idx].password = p1;
  saveUsers(usuarios);

  showAlert('alert-recuperar', '✓ Contraseña actualizada. Ya podés iniciar sesión.', 'success');
  setTimeout(() => mostrarPanel('login'), 900);
}
