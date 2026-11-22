/* ============================================================
   PACIENTES.JS — Mente Serena
   Sección "Pacientes" del panel profesional (admin.html).

   · Alta / edición / baja de pacientes con sus datos.
   · Sesiones: se cuentan automáticamente desde la agenda
     (turnos confirmados que ya pasaron) y se pueden registrar
     a mano (realizada / ausente) para lo que no pasó por la agenda.
   · Otros datos: última sesión, próximo turno, asistencia,
     cancelaciones, historia clínica vinculada, exportación CSV.

   Almacenamiento: localStorage, clave "ms_pacientes"
   (igual que turnos, posts e historias: queda en este dispositivo).

   Depende de common.js (ls, esc, getTurnos, getArgNow) y, en
   tiempo de ejecución, de admin.js (sesionAdmin) y de historias.js (hcVer, hcCrearPara).
   ============================================================ */

const PAC_KEY = 'ms_pacientes';

const PAC_PROFS = {
  daiana:  { nombre: 'Lic. Daiana Bazan',     corto: 'Daiana Bazan' },
  micaela: { nombre: 'Lic. Micaela Alvarado', corto: 'Micaela Alvarado' }
};
const PAC_ESTADOS = {
  activo: { label: 'Activo',    ico: '🟢' },
  pausa:  { label: 'En pausa',  ico: '⏸️' },
  alta:   { label: 'De alta',   ico: '✅' }
};

/* ── Estado de la vista ───────────────────────────────────── */
let pacFiltro = 'todos';     // todos | activo | pausa | alta
let pacProf   = '';          // '' | daiana | micaela
let pacOrden  = 'reciente';  // reciente | nombre | sesiones | ultima
let pacBusca  = '';
let pacFichaId = null;       // id del paciente con la ficha abierta

/* ════════════════════════════════════════════════════════════
   DATOS
   ════════════════════════════════════════════════════════════ */
const getPacs  = () => ls.get(PAC_KEY, []);
const savePacs = (v) => ls.set(PAC_KEY, v);
const pacPorId = (id) => getPacs().find(p => p.id === id) || null;

function pacNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}
function pacHoyISO() { return getArgNow().toISOString().slice(0, 10); }

/** "2026-09-24" → "24 sep 2026" */
function pacFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d) ? '—' : d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function pacHoraStr(h) { return typeof h === 'number' ? String(h).padStart(2, '0') + ':00' : String(h || '00:00'); }
function pacTurnoTs(t) { return new Date(`${t.dia}T${pacHoraStr(t.hora)}:00-03:00`).getTime(); }

function pacEdad(p) {
  if (p.nacimiento) {
    const n = new Date(p.nacimiento + 'T12:00:00'), h = getArgNow();
    if (!isNaN(n)) {
      let e = h.getUTCFullYear() - n.getFullYear();
      const m = h.getUTCMonth() - n.getMonth();
      if (m < 0 || (m === 0 && h.getUTCDate() < n.getDate())) e--;
      return e >= 0 ? e : null;
    }
  }
  const e = parseInt(p.edad, 10);
  return isNaN(e) ? null : e;
}

/** ¿Este turno de la agenda corresponde a este paciente? (email o nombre) */
function pacCoincide(p, t) {
  if (p.email && t.email && pacNorm(p.email) === pacNorm(t.email)) return true;
  return !!pacNorm(t.usuario) && pacNorm(t.usuario) === pacNorm(p.nombre);
}
const pacTurnosDe = (p) => getTurnos().filter(t => t.dia && pacCoincide(p, t));

/**
 * Estadísticas de un paciente.
 * Sesión realizada = registrada a mano como "realizada" +
 * turno confirmado de la agenda que ya pasó. Si hay un registro
 * manual con la misma fecha que un turno, manda el manual.
 */
function pacStats(p) {
  const ahora = Date.now();
  const ses = p.sesiones || [];
  const fechasManual = new Set(ses.map(s => s.fecha));
  const fechasReal = ses.filter(s => s.estado === 'realizada').map(s => s.fecha);
  let ausentes = ses.filter(s => s.estado === 'ausente').length;
  let canceladas = 0, sinRegistrar = 0, proximo = null;

  pacTurnosDe(p).forEach(t => {
    const ts = pacTurnoTs(t);
    if (t.estado === 'cancelado') { canceladas++; return; }
    if (ts >= ahora) { if (!proximo || ts < proximo.ts) proximo = { t, ts }; return; }
    if (fechasManual.has(t.dia)) return;
    if (t.estado === 'confirmado') fechasReal.push(t.dia); else sinRegistrar++;
  });

  const realizadas = fechasReal.length;
  const total = realizadas + ausentes;
  return {
    realizadas, ausentes, canceladas, sinRegistrar, proximo,
    ultima: fechasReal.length ? fechasReal.slice().sort().pop() : null,
    asistencia: total ? Math.round(realizadas / total * 100) : null,
    delMes: fechasReal.filter(f => f.slice(0, 7) === pacHoyISO().slice(0, 7)).length
  };
}

/** Historia clínica vinculada (módulo js/historias.js) */
function pacHcDe(p) {
  return typeof hcPorPaciente === 'function' ? hcPorPaciente(p.id) : null;
}

/* ════════════════════════════════════════════════════════════
   LISTA
   ════════════════════════════════════════════════════════════ */
function renderPacientes() {
  const cont = document.getElementById('pac-root');
  if (!cont) return;

  const todos = getPacs().map(p => ({ p, s: pacStats(p) }));

  // Resumen superior
  const activos = todos.filter(x => (x.p.estado || 'activo') === 'activo').length;
  const totSes  = todos.reduce((n, x) => n + x.s.realizadas, 0);
  const totMes  = todos.reduce((n, x) => n + x.s.delMes, 0);
  const en7     = todos.filter(x => x.s.proximo && x.s.proximo.ts <= Date.now() + 7 * 864e5).length;

  const cuenta = (est) => todos.filter(x => (x.p.estado || 'activo') === est).length;

  const chip = (id, label, n) =>
    `<button class="cm-chip${pacFiltro === id ? ' active' : ''}" onclick="pacSetFiltro('${id}')">${label} <span class="cm-count">${n}</span></button>`;

  cont.innerHTML = `
    <div class="pac-resumen">
      <div class="pac-tile"><span class="pac-tile-n">${todos.length}</span><span class="pac-tile-l">Pacientes</span><span class="pac-tile-s">${activos} activos</span></div>
      <div class="pac-tile"><span class="pac-tile-n">${totSes}</span><span class="pac-tile-l">Sesiones realizadas</span><span class="pac-tile-s">en total</span></div>
      <div class="pac-tile"><span class="pac-tile-n">${totMes}</span><span class="pac-tile-l">Sesiones este mes</span><span class="pac-tile-s pac-cap">${esc(new Date().toLocaleDateString('es-AR', { month: 'long', timeZone: 'America/Argentina/Buenos_Aires' }))}</span></div>
      <div class="pac-tile"><span class="pac-tile-n">${en7}</span><span class="pac-tile-l">Citas próximas</span><span class="pac-tile-s">en los próximos 7 días</span></div>
    </div>

    <div class="pac-acciones">
      <button class="btn-hc-new" onclick="pacAbrirForm()">＋ Nuevo paciente</button>
      <button class="pac-btn-sec" onclick="pacImportarTurnos()">📅 Importar desde turnos</button>
      <button class="pac-btn-sec" onclick="pacExportarCSV()" ${todos.length ? '' : 'disabled'}>⬇ Exportar CSV</button>
    </div>

    <div class="pac-toolbar">
      <input type="text" class="pac-buscar" id="pac-buscar" placeholder="🔍 Buscar paciente…"
             value="${esc(pacBusca)}" oninput="pacSetBusca(this.value)" aria-label="Buscar paciente">
      <div class="cm-filtros" role="group" aria-label="Filtrar por estado">
        ${chip('todos', '📋 Todos', todos.length)}${chip('activo', '🟢 Activos', cuenta('activo'))}${chip('pausa', '⏸️ En pausa', cuenta('pausa'))}${chip('alta', '✅ De alta', cuenta('alta'))}
      </div>
      <div class="pac-selects">
        <select onchange="pacSetProf(this.value)" aria-label="Filtrar por profesional">
          <option value="">Todas las profesionales</option>
          ${Object.entries(PAC_PROFS).map(([k, v]) => `<option value="${k}" ${pacProf === k ? 'selected' : ''}>${v.nombre}</option>`).join('')}
        </select>
        <select onchange="pacSetOrden(this.value)" aria-label="Ordenar">
          <option value="reciente" ${pacOrden === 'reciente' ? 'selected' : ''}>Más recientes</option>
          <option value="nombre"   ${pacOrden === 'nombre'   ? 'selected' : ''}>Nombre (A–Z)</option>
          <option value="sesiones" ${pacOrden === 'sesiones' ? 'selected' : ''}>Más sesiones</option>
          <option value="ultima"   ${pacOrden === 'ultima'   ? 'selected' : ''}>Última sesión</option>
        </select>
      </div>
    </div>

    <div id="pac-lista-wrap">${pacListaHTML(todos)}</div>
  `;
}

/** Aplica búsqueda, filtros y orden, y devuelve el HTML de la lista */
function pacListaHTML(todos) {
  const lista = todos.filter(({ p }) => {
    if (pacFiltro !== 'todos' && (p.estado || 'activo') !== pacFiltro) return false;
    if (pacProf && p.profesional !== pacProf) return false;
    if (pacBusca) {
      const q = pacNorm(pacBusca);
      return [p.nombre, p.dni, p.telefono, p.email].some(v => pacNorm(v).includes(q));
    }
    return true;
  });
  const orden = {
    reciente: (a, b) => (b.p.creado || 0) - (a.p.creado || 0),
    nombre:   (a, b) => pacNorm(a.p.nombre).localeCompare(pacNorm(b.p.nombre)),
    sesiones: (a, b) => b.s.realizadas - a.s.realizadas,
    ultima:   (a, b) => (b.s.ultima || '').localeCompare(a.s.ultima || '')
  };
  lista.sort(orden[pacOrden] || orden.reciente);

  if (!lista.length) {
    return !todos.length
      ? `<div class="feed-empty"><span class="feed-empty-icon">👥</span>Todavía no cargaste pacientes.<br>
           <small>Agregá uno con “Nuevo paciente” o traé a quienes ya sacaron turno con “Importar desde turnos”.</small></div>`
      : `<div class="feed-empty"><span class="feed-empty-icon">🔍</span>Ningún paciente coincide con la búsqueda.</div>`;
  }
  const filtrando = pacBusca || pacProf || pacFiltro !== 'todos';
  return `<div class="pac-lista">${lista.map(({ p, s }) => pacCardHTML(p, s)).join('')}</div>` +
         (filtrando ? `<p class="pac-contador">Mostrando ${lista.length} de ${todos.length} pacientes</p>` : '');
}

function pacCardHTML(p, s) {
  const est = PAC_ESTADOS[p.estado || 'activo'] || PAC_ESTADOS.activo;
  const edad = pacEdad(p);
  const prof = PAC_PROFS[p.profesional];
  const prox = s.proximo ? `${pacFecha(s.proximo.t.dia)} · ${esc(pacHoraStr(s.proximo.t.hora))} hs` : 'Sin turno';
  return `
    <article class="pac-card" onclick="pacAbrirFicha('${p.id}')" tabindex="0"
             onkeydown="if(event.key==='Enter')pacAbrirFicha('${p.id}')">
      <div class="pac-avatar" aria-hidden="true">${esc((p.nombre || '?').charAt(0).toUpperCase())}</div>
      <div class="pac-info">
        <div class="pac-nombre">${esc(p.nombre)}
          <span class="pac-estado pac-estado-${p.estado || 'activo'}">${est.ico} ${est.label}</span>
          ${s.sinRegistrar ? `<span class="pac-alerta" title="Turnos pasados que todavía no marcaste como realizados o ausentes">⚠ ${s.sinRegistrar} sin registrar</span>` : ''}
        </div>
        <div class="pac-meta">
          ${edad != null ? `<span>🎂 ${edad} años</span>` : ''}
          ${prof ? `<span>👩‍⚕️ ${esc(prof.corto)}</span>` : ''}
          ${p.telefono ? `<span>📞 ${esc(p.telefono)}</span>` : ''}
          <span>📅 Última: ${s.ultima ? pacFecha(s.ultima) : '—'}</span>
          <span>⏭ Próxima: ${prox}</span>
        </div>
      </div>
      <div class="pac-ses">
        <span class="pac-ses-n">${s.realizadas}</span>
        <span class="pac-ses-l">${s.realizadas === 1 ? 'sesión' : 'sesiones'}</span>
      </div>
    </article>`;
}

/* ── Controles de filtro ──────────────────────────────────── */
function pacSetFiltro(f) { pacFiltro = f; renderPacientes(); }
function pacSetProf(v)   { pacProf = v;   renderPacientes(); }
function pacSetOrden(v)  { pacOrden = v;  renderPacientes(); }
function pacSetBusca(v) {
  pacBusca = v;
  const w = document.getElementById('pac-lista-wrap');
  if (w) w.innerHTML = pacListaHTML(getPacs().map(p => ({ p, s: pacStats(p) })));
}

/* ════════════════════════════════════════════════════════════
   MODAL (base)
   ════════════════════════════════════════════════════════════ */
function pacModal(html, ancho) {
  let ov = document.getElementById('pac-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'pac-overlay';
    ov.className = 'pac-overlay';
    ov.innerHTML = '<div class="pac-modal" id="pac-modal" role="dialog" aria-modal="true"></div>';
    ov.addEventListener('mousedown', e => { if (e.target === ov) pacCerrarModal(); });
    document.body.appendChild(ov);
  }
  const m = document.getElementById('pac-modal');
  m.style.maxWidth = ancho || '720px';
  m.innerHTML = html;
  ov.classList.add('abierto');
  document.body.style.overflow = 'hidden';
  m.scrollTop = 0;
}
function pacCerrarModal() {
  document.getElementById('pac-overlay')?.classList.remove('abierto');
  document.body.style.overflow = '';
  pacFichaId = null;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('pac-overlay')?.classList.contains('abierto')) pacCerrarModal();
});

function pacToast(msg, ok) {
  let t = document.getElementById('pac-toast');
  if (!t) { t = document.createElement('div'); t.id = 'pac-toast'; t.className = 'pac-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'pac-toast visible' + (ok ? ' ok' : '');
  clearTimeout(pacToast._t);
  pacToast._t = setTimeout(() => t.classList.remove('visible'), 2800);
}

/* ════════════════════════════════════════════════════════════
   FORMULARIO (alta / edición)
   ════════════════════════════════════════════════════════════ */
function pacAbrirForm(id) {
  const p = id ? pacPorId(id) : null;
  const v = (k, d = '') => esc(p && p[k] != null ? p[k] : d);
  const miProf = sesionAdmin && /daiana/i.test(sesionAdmin.nombre) ? 'daiana'
               : sesionAdmin && /micaela/i.test(sesionAdmin.nombre) ? 'micaela' : '';
  const profSel = p ? p.profesional : miProf;

  pacModal(`
    <div class="pac-modal-head">
      <h3>${p ? 'Editar' : 'Nuevo'} <em>paciente</em></h3>
      <button class="pac-x" onclick="pacCerrarModal()" aria-label="Cerrar">×</button>
    </div>
    <div class="pac-form">
      <div class="pac-f pac-f-full"><label for="pf-nombre">Nombre y apellido *</label>
        <input type="text" id="pf-nombre" value="${v('nombre')}" placeholder="Ej: Ana García" autocomplete="off"></div>

      <div class="pac-f"><label for="pf-dni">DNI</label>
        <input type="text" id="pf-dni" inputmode="numeric" value="${v('dni')}" placeholder="Sin puntos"></div>
      <div class="pac-f"><label for="pf-nac">Fecha de nacimiento</label>
        <input type="date" id="pf-nac" value="${v('nacimiento')}" max="${pacHoyISO()}" onchange="pacSyncEdad()"></div>
      <div class="pac-f"><label for="pf-edad">Edad</label>
        <input type="number" id="pf-edad" min="0" max="120" value="${v('edad')}" placeholder="Años"></div>

      <div class="pac-f pac-f-half"><label for="pf-tel">Teléfono</label>
        <input type="tel" id="pf-tel" value="${v('telefono')}" placeholder="Ej: 381 555 1234"></div>
      <div class="pac-f pac-f-half"><label for="pf-email">Email</label>
        <input type="email" id="pf-email" value="${v('email')}" placeholder="nombre@correo.com"></div>

      <div class="pac-f pac-f-half"><label for="pf-os">Obra social / prepaga</label>
        <input type="text" id="pf-os" value="${v('obraSocial')}" placeholder="Ej: OSDE, PAMI, particular"></div>
      <div class="pac-f pac-f-half"><label for="pf-emerg">Contacto de emergencia / responsable</label>
        <input type="text" id="pf-emerg" value="${v('emergencia')}" placeholder="Nombre y teléfono"></div>

      <div class="pac-f"><label for="pf-prof">Profesional a cargo</label>
        <select id="pf-prof"><option value="">— Sin asignar —</option>
          ${Object.entries(PAC_PROFS).map(([k, x]) => `<option value="${k}" ${profSel === k ? 'selected' : ''}>${x.nombre}</option>`).join('')}
        </select></div>
      <div class="pac-f"><label for="pf-mod">Modalidad</label>
        <select id="pf-mod">
          <option value="">— A definir —</option>
          <option value="presencial" ${p && p.modalidad === 'presencial' ? 'selected' : ''}>Presencial</option>
          <option value="virtual" ${p && p.modalidad === 'virtual' ? 'selected' : ''}>Virtual</option>
        </select></div>
      <div class="pac-f"><label for="pf-estado">Estado</label>
        <select id="pf-estado">
          ${Object.entries(PAC_ESTADOS).map(([k, x]) => `<option value="${k}" ${(p ? p.estado || 'activo' : 'activo') === k ? 'selected' : ''}>${x.label}</option>`).join('')}
        </select></div>

      <div class="pac-f pac-f-half"><label for="pf-inicio">Inicio del tratamiento</label>
        <input type="date" id="pf-inicio" value="${v('fechaInicio', p ? '' : pacHoyISO())}"></div>

      <div class="pac-f pac-f-full"><label for="pf-motivo">Motivo de consulta</label>
        <textarea id="pf-motivo" rows="2" placeholder="Breve descripción del motivo…">${v('motivo')}</textarea></div>
      <div class="pac-f pac-f-full"><label for="pf-notas">Notas internas</label>
        <textarea id="pf-notas" rows="2" placeholder="Solo visibles para el equipo profesional…">${v('notas')}</textarea></div>
    </div>
    <div class="alert" id="pac-alert"></div>
    <div class="pac-modal-foot">
      <button class="pac-btn-sec" onclick="${p ? `pacAbrirFicha('${p.id}')` : 'pacCerrarModal()'}">Cancelar</button>
      <button class="btn-hc-new" onclick="pacGuardar('${p ? p.id : ''}')">${p ? 'Guardar cambios' : 'Guardar paciente'}</button>
    </div>
  `);
  pacSyncEdad();
  // Autofoco en Nombre, salvo que la persona ya haya empezado a usar otro campo
  setTimeout(() => {
    const m = document.getElementById('pac-modal');
    if (m && !m.contains(document.activeElement)) document.getElementById('pf-nombre')?.focus();
  }, 50);
}

/** Si hay fecha de nacimiento, la edad se calcula sola */
function pacSyncEdad() {
  const nac = document.getElementById('pf-nac'), ed = document.getElementById('pf-edad');
  if (!nac || !ed) return;
  if (nac.value) { ed.value = pacEdad({ nacimiento: nac.value }) ?? ''; ed.readOnly = true; }
  else ed.readOnly = false;
}

function pacGuardar(id) {
  const g = (i) => (document.getElementById(i)?.value || '').trim();
  const nombre = g('pf-nombre');
  const err = (m) => showAlert('pac-alert', '⚠️ ' + m, 'error');

  if (!nombre) { err('Ingresá el nombre del paciente.'); document.getElementById('pf-nombre').focus(); return; }
  const dni = g('pf-dni').replace(/[.\s]/g, '');
  const email = g('pf-email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err('El email no parece válido.'); return; }
  const pacs = getPacs();
  if (dni && pacs.some(x => x.dni === dni && x.id !== id)) { err('Ya existe un paciente con ese DNI.'); return; }

  const datos = {
    nombre, dni, nacimiento: g('pf-nac'), edad: g('pf-edad'),
    telefono: g('pf-tel'), email, obraSocial: g('pf-os'), emergencia: g('pf-emerg'),
    profesional: g('pf-prof'), modalidad: g('pf-mod'), estado: g('pf-estado') || 'activo',
    fechaInicio: g('pf-inicio'), motivo: g('pf-motivo'), notas: g('pf-notas')
  };

  if (id) {
    const i = pacs.findIndex(x => x.id === id);
    if (i === -1) return;
    pacs[i] = { ...pacs[i], ...datos };
    savePacs(pacs);
    pacToast('Datos actualizados.', true);
    renderPacientes();
    pacAbrirFicha(id);
  } else {
    const nuevo = { id: 'p' + Date.now(), ...datos, sesiones: [], creado: Date.now() };
    pacs.push(nuevo);
    savePacs(pacs);
    pacToast('Paciente agregado.', true);
    renderPacientes();
    pacAbrirFicha(nuevo.id);
  }
}

function pacEliminar(id) {
  const p = pacPorId(id);
  if (!p) return;
  if (!confirm(`¿Eliminar a ${p.nombre}? Se borran sus datos y las sesiones registradas a mano.\nLos turnos de la agenda y su historia clínica no se modifican.`)) return;
  savePacs(getPacs().filter(x => x.id !== id));
  pacCerrarModal();
  renderPacientes();
  pacToast('Paciente eliminado.');
}

/* ════════════════════════════════════════════════════════════
   FICHA DEL PACIENTE
   ════════════════════════════════════════════════════════════ */
function pacAbrirFicha(id) {
  const p = pacPorId(id);
  if (!p) return;
  pacFichaId = id;
  const s = pacStats(p);
  const edad = pacEdad(p);
  const prof = PAC_PROFS[p.profesional];
  const hc = pacHcDe(p);
  const hoy = pacHoyISO();
  const dato = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
  const tile = (n, l) => `<div class="pac-mini"><span class="pac-mini-n">${n}</span><span class="pac-mini-l">${l}</span></div>`;

  // Sesiones registradas a mano (más recientes primero)
  const ses = (p.sesiones || []).slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const sesHTML = ses.length ? ses.map(x => `
    <li class="pac-ses-item ${x.estado === 'ausente' ? 'aus' : 'ok'}">
      <span class="pac-ses-ico">${x.estado === 'ausente' ? '✕' : '✓'}</span>
      <div class="pac-ses-txt">
        <strong>${pacFecha(x.fecha)}</strong>
        <span class="pac-ses-tag">${x.estado === 'ausente' ? 'Ausente' : 'Realizada'}${x.modalidad ? ' · ' + (x.modalidad === 'virtual' ? 'Virtual' : 'Presencial') : ''}${x.turnoId ? ' · desde agenda' : ''}</span>
        ${x.nota ? `<p>${esc(x.nota)}</p>` : ''}
      </div>
      <button class="pac-ses-del" onclick="pacQuitarSesion('${p.id}','${x.id}')" title="Quitar registro" aria-label="Quitar registro">🗑️</button>
    </li>`).join('') : `<li class="pac-vacio-li">Todavía no registraste sesiones a mano.</li>`;

  // Turnos de la agenda vinculados
  const manual = new Set((p.sesiones || []).map(x => x.fecha));
  const turnos = pacTurnosDe(p).sort((a, b) => pacTurnoTs(b) - pacTurnoTs(a));
  const turnosHTML = turnos.length ? turnos.map(t => {
    const pasado = pacTurnoTs(t) < Date.now();
    const cancel = t.estado === 'cancelado';
    const cubierto = manual.has(t.dia);
    let badge, acciones = '';
    if (cancel)             badge = '<span class="turno-estado-badge cancelado">✕ Cancelado</span>';
    else if (cubierto)      badge = '<span class="turno-estado-badge confirmado">Registrado</span>';
    else if (!pasado)       badge = `<span class="turno-estado-badge ${t.estado === 'confirmado' ? 'confirmado' : 'pendiente'}">${t.estado === 'confirmado' ? '✓ Confirmado' : '⏳ Pendiente'}</span>`;
    else if (t.estado === 'confirmado') badge = '<span class="turno-estado-badge confirmado">✓ Realizada</span>';
    else                    badge = '<span class="turno-estado-badge pendiente">Sin registrar</span>';
    if (!cancel && pasado && !cubierto) {
      acciones = `<div class="pac-turno-acc">
        ${t.estado !== 'confirmado' ? `<button class="btn-hc-open" onclick="pacMarcarTurno('${p.id}','${t.id}','realizada')">✓ Realizada</button>` : ''}
        <button class="btn-hc-del" onclick="pacMarcarTurno('${p.id}','${t.id}','ausente')" title="Marcar como ausente">✕ Ausente</button></div>`;
    }
    return `<li class="pac-turno">
      <div><strong>${pacFecha(t.dia)}</strong> · ${esc(pacHoraStr(t.hora))} hs
        <span class="pac-turno-sub">${esc(t.profNombre || '')}${t.modalidad ? ' · ' + (t.modalidad === 'virtual' ? '💻 Virtual' : '🏠 Presencial') : ''}</span></div>
      <div class="pac-turno-der">${badge}${acciones}</div></li>`;
  }).join('') : `<li class="pac-vacio-li">No hay turnos de la agenda vinculados a este paciente.<br><small>Se vinculan por email o nombre exacto.</small></li>`;

  pacModal(`
    <div class="pac-modal-head">
      <div class="pac-ficha-id">
        <div class="pac-avatar pac-avatar-lg" aria-hidden="true">${esc((p.nombre || '?').charAt(0).toUpperCase())}</div>
        <div>
          <h3>${esc(p.nombre)}</h3>
          <select class="pac-estado-sel pac-estado-${p.estado || 'activo'}" onchange="pacCambiarEstado('${p.id}',this.value)" aria-label="Estado del paciente">
            ${Object.entries(PAC_ESTADOS).map(([k, x]) => `<option value="${k}" ${(p.estado || 'activo') === k ? 'selected' : ''}>${x.ico} ${x.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <button class="pac-x" onclick="pacCerrarModal()" aria-label="Cerrar">×</button>
    </div>

    <div class="pac-minis">
      ${tile(s.realizadas, 'Sesiones realizadas')}
      ${tile(s.ausentes, 'Ausencias')}
      ${tile(s.canceladas, 'Turnos cancelados')}
      ${tile(s.asistencia != null ? s.asistencia + '%' : '—', 'Asistencia')}
      ${tile(s.ultima ? pacFecha(s.ultima) : '—', 'Última sesión')}
      ${tile(s.proximo ? pacFecha(s.proximo.t.dia) + ' · ' + esc(pacHoraStr(s.proximo.t.hora)) : '—', 'Próximo turno')}
    </div>
    ${s.sinRegistrar ? `<div class="pac-aviso">⚠ Tenés ${s.sinRegistrar} turno${s.sinRegistrar > 1 ? 's' : ''} pasado${s.sinRegistrar > 1 ? 's' : ''} sin registrar. Marcalos abajo como realizados o ausentes para que cuenten en las estadísticas.</div>` : ''}

    <h4 class="pac-h4">Datos del paciente</h4>
    <dl class="pac-datos">
      ${dato('DNI', esc(p.dni))}
      ${dato('Edad', edad != null ? edad + ' años' + (p.nacimiento ? ' (' + pacFecha(p.nacimiento) + ')' : '') : '')}
      ${dato('Teléfono', p.telefono ? `<a href="tel:${esc(p.telefono)}">${esc(p.telefono)}</a>` : '')}
      ${dato('Email', p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '')}
      ${dato('Obra social', esc(p.obraSocial))}
      ${dato('Emergencia / responsable', esc(p.emergencia))}
      ${dato('Profesional', prof ? esc(prof.nombre) : '')}
      ${dato('Modalidad', p.modalidad ? (p.modalidad === 'virtual' ? '💻 Virtual' : '🏠 Presencial') : '')}
      ${dato('Inicio del tratamiento', p.fechaInicio ? pacFecha(p.fechaInicio) : '')}
      ${dato('Motivo de consulta', esc(p.motivo))}
      ${dato('Notas internas', esc(p.notas))}
    </dl>

    <h4 class="pac-h4">Registrar sesión</h4>
    <div class="pac-ses-form">
      <div class="pac-f"><label for="ps-fecha">Fecha</label>
        <input type="date" id="ps-fecha" value="${hoy}" max="${hoy}"></div>
      <div class="pac-f"><label for="ps-estado">Resultado</label>
        <select id="ps-estado"><option value="realizada">Realizada</option><option value="ausente">Ausente</option></select></div>
      <div class="pac-f"><label for="ps-mod">Modalidad</label>
        <select id="ps-mod"><option value="presencial" ${p.modalidad !== 'virtual' ? 'selected' : ''}>Presencial</option><option value="virtual" ${p.modalidad === 'virtual' ? 'selected' : ''}>Virtual</option></select></div>
      <div class="pac-f pac-f-full"><label for="ps-nota">Nota (opcional)</label>
        <input type="text" id="ps-nota" placeholder="Ej: trabajamos ansiedad anticipatoria…" onkeydown="if(event.key==='Enter')pacAgregarSesion('${p.id}')"></div>
      <button class="btn-hc-new pac-ses-add" onclick="pacAgregarSesion('${p.id}')">＋ Registrar</button>
    </div>
    <div class="alert" id="pac-alert"></div>
    <p class="pac-help">Usá esto para sesiones que no pasaron por la agenda. Los turnos confirmados que ya pasaron se cuentan solos.</p>
    <ul class="pac-ses-list">${sesHTML}</ul>

    <h4 class="pac-h4">Turnos en la agenda</h4>
    <ul class="pac-turnos">${turnosHTML}</ul>

    <div class="pac-modal-foot pac-foot-ficha">
      ${hc ? `<button class="btn-hc-open" onclick="hcVer('${esc(hc.id)}')">🗂️ Ver historia clínica</button>`
           : `<button class="btn-hc-open" onclick="hcCrearPara('${p.id}')">🗂️ Crear historia clínica</button>`}
      <span class="pac-foot-sp"></span>
      <button class="btn-hc-del" onclick="pacEliminar('${p.id}')">🗑️ Eliminar</button>
      <button class="btn-hc-new" onclick="pacAbrirForm('${p.id}')">✏️ Editar datos</button>
    </div>
  `, '780px');
}

function pacCambiarEstado(id, estado) {
  const pacs = getPacs(), p = pacs.find(x => x.id === id);
  if (!p) return;
  p.estado = estado;
  savePacs(pacs);
  renderPacientes();
  pacAbrirFicha(id);
}

function pacAgregarSesion(id) {
  const pacs = getPacs(), p = pacs.find(x => x.id === id);
  if (!p) return;
  const fecha = document.getElementById('ps-fecha').value;
  if (!fecha) { showAlert('pac-alert', '⚠️ Elegí la fecha de la sesión.', 'error'); return; }
  if (fecha > pacHoyISO()) { showAlert('pac-alert', '⚠️ La fecha no puede ser futura.', 'error'); return; }
  const estado = document.getElementById('ps-estado').value;
  if ((p.sesiones || []).some(x => x.fecha === fecha)) {
    if (!confirm('Ya hay una sesión registrada en esa fecha. ¿Agregar otra igualmente?')) return;
  }
  p.sesiones = p.sesiones || [];
  p.sesiones.push({
    id: 's' + Date.now(), fecha, estado,
    modalidad: document.getElementById('ps-mod').value,
    nota: document.getElementById('ps-nota').value.trim()
  });
  savePacs(pacs);
  renderPacientes();
  pacAbrirFicha(id);
  pacToast(estado === 'ausente' ? 'Ausencia registrada.' : 'Sesión registrada.', true);
}

function pacQuitarSesion(id, sid) {
  if (!confirm('¿Quitar este registro de sesión?')) return;
  const pacs = getPacs(), p = pacs.find(x => x.id === id);
  if (!p) return;
  p.sesiones = (p.sesiones || []).filter(x => x.id !== sid);
  savePacs(pacs);
  renderPacientes();
  pacAbrirFicha(id);
}

/** Convierte un turno pasado de la agenda en un registro manual */
function pacMarcarTurno(id, turnoId, estado) {
  const pacs = getPacs(), p = pacs.find(x => x.id === id);
  const t = getTurnos().find(x => String(x.id) === String(turnoId));
  if (!p || !t) return;
  p.sesiones = p.sesiones || [];
  p.sesiones.push({ id: 's' + Date.now(), fecha: t.dia, estado, modalidad: t.modalidad || '', nota: '', turnoId: t.id });
  savePacs(pacs);
  renderPacientes();
  pacAbrirFicha(id);
}

/* ════════════════════════════════════════════════════════════
   IMPORTAR DESDE TURNOS
   ════════════════════════════════════════════════════════════ */
function pacImportarTurnos() {
  const pacs = getPacs();
  const nuevos = [];
  getTurnos().slice().sort((a, b) => String(a.dia).localeCompare(String(b.dia))).forEach(t => {
    if (!t.usuario || !t.dia) return;
    const ya = pacs.concat(nuevos).find(p => pacCoincide(p, t));
    if (ya) {
      // Si es un paciente recién detectado, conserva la fecha más antigua
      if (nuevos.includes(ya) && t.dia < ya.fechaInicio) ya.fechaInicio = t.dia;
      return;
    }
    nuevos.push({
      id: 'p' + (Date.now() + nuevos.length), nombre: String(t.usuario).trim(), dni: '', nacimiento: '',
      edad: t.edad || '', telefono: t.telefono || '', email: t.email || '', obraSocial: '', emergencia: '',
      profesional: t.profesional || '', modalidad: t.modalidad || '', estado: 'activo',
      fechaInicio: t.dia, motivo: t.motivo || '', notas: '', sesiones: [], creado: Date.now()
    });
  });
  if (!nuevos.length) { pacToast('No hay pacientes nuevos en la agenda.'); return; }
  if (!confirm(`Se van a agregar ${nuevos.length} paciente${nuevos.length > 1 ? 's' : ''} desde la agenda:\n\n· ${nuevos.map(n => n.nombre).join('\n· ')}\n\n¿Continuar?`)) return;
  savePacs(pacs.concat(nuevos));
  renderPacientes();
  pacToast(`${nuevos.length} paciente${nuevos.length > 1 ? 's' : ''} importado${nuevos.length > 1 ? 's' : ''}.`, true);
}

/* ════════════════════════════════════════════════════════════
   EXPORTAR CSV (separador ";" para que Excel en español lo abra bien)
   ════════════════════════════════════════════════════════════ */
function pacExportarCSV() {
  const celda = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;             // evita fórmulas en Excel
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const filas = [['Nombre', 'DNI', 'Edad', 'Teléfono', 'Email', 'Obra social', 'Profesional', 'Estado',
                  'Inicio tratamiento', 'Sesiones realizadas', 'Ausencias', 'Turnos cancelados', 'Asistencia %',
                  'Última sesión', 'Próximo turno']];
  getPacs().forEach(p => {
    const s = pacStats(p);
    filas.push([p.nombre, p.dni, pacEdad(p) ?? '', p.telefono, p.email, p.obraSocial,
      (PAC_PROFS[p.profesional] || {}).nombre || '', (PAC_ESTADOS[p.estado || 'activo'] || {}).label || '',
      p.fechaInicio || '', s.realizadas, s.ausentes, s.canceladas, s.asistencia ?? '',
      s.ultima || '', s.proximo ? s.proximo.t.dia + ' ' + pacHoraStr(s.proximo.t.hora) : '']);
  });
  const blob = new Blob(['\ufeff' + filas.map(f => f.map(celda).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pacientes-mente-serena-${pacHoyISO()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
