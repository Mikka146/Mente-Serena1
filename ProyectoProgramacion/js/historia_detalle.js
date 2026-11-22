/* ============================================================
   HISTORIA_DETALLE.JS — Mente Serena
   Vista detallada de una historia clínica (historia_clinica.html).
   Pestañas · edición por sección · registro de sesiones · línea de
   tiempo · cierre / reapertura · impresión / PDF con confirmación.

   Depende de common.js, pacientes.js e historias.js (en ese orden).
   Parámetros de URL: ?hc=ID  ·  ?pac=ID_PACIENTE  ·  ?hcId=ID_ANTERIOR
   ============================================================ */

const HCD_SECC = {
  motivo: { titulo: 'Motivo de consulta', campos: [
    { k: 'motivo', l: 'Motivo de consulta', t: 'area', req: true, ph: 'Motivo por el cual la persona solicita atención psicológica…' },
    { k: 'demanda', l: 'Demanda y expectativas del paciente', t: 'area', rows: 3, ph: '¿Qué espera lograr con el proceso terapéutico?' }] },
  antecedentes: { titulo: 'Antecedentes relevantes', campos: [
    { k: 'personales', l: 'Antecedentes personales', t: 'area', ph: 'Historia personal, contexto familiar y social pertinentes…' },
    { k: 'familiares', l: 'Antecedentes familiares', t: 'area', rows: 3 },
    { k: 'salud', l: 'Antecedentes de salud', t: 'area', rows: 3, ph: 'Enfermedades y tratamientos previos pertinentes para la atención.' },
    { k: 'medicacion', l: 'Medicación actual', t: 'area', rows: 2 }] },
  evaluacion: { titulo: 'Evaluación inicial', campos: [
    { k: 'fecha', l: 'Fecha de la evaluación', t: 'date', maxHoy: true },
    { k: 'estadoEmocional', l: 'Estado emocional', t: 'area', rows: 3 },
    { k: 'observaciones', l: 'Observaciones profesionales', t: 'area', req: true, ph: 'Observaciones según el criterio del profesional…' },
    { k: 'otros', l: 'Otros aspectos relevantes', t: 'area', rows: 3 }] },
  objetivos: { titulo: 'Objetivos terapéuticos', campos: [
    { k: 'objetivos', l: 'Objetivos acordados con el paciente', t: 'area', req: true, ph: 'Corto, mediano y largo plazo…' }] },
  plan: { titulo: 'Plan de tratamiento', campos: [
    { k: 'plan', l: 'Estrategias de intervención y seguimiento', t: 'area', req: true },
    { k: 'enfoque', l: 'Enfoque terapéutico', t: 'select', opts: ['TCC', 'Psicodinámica / Psicoanalítica', 'Humanista', 'ACT', 'EMDR', 'Sistémica / Familiar', 'DBT', 'Integrativa', 'Otro'] },
    { k: 'frecuencia', l: 'Frecuencia de sesiones', t: 'select', opts: ['Semanal', 'Quincenal', 'Mensual', 'Según necesidad'] },
    { k: 'revision', l: 'Fecha estimada de revisión', t: 'date' }] }
};
const HCD_TABS = [
  ['general', 'Información general', []], ['motivo', 'Motivo y antecedentes', ['motivo', 'antecedentes']],
  ['evaluacion', 'Evaluación inicial', ['evaluacion']], ['plan', 'Objetivos y plan', ['objetivos', 'plan']],
  ['sesiones', 'Sesiones y evolución', []], ['cierre', 'Cierre', []]
];
const HCD_MOTIVOS_CIERRE = ['Alta terapéutica', 'Abandono del tratamiento', 'Derivación a otro profesional', 'Interrupción acordada', 'Otro'];

const H = { id: null, pac: null, legacy: null, tab: 'general', edit: null, ses: null, orden: 'desc', dirty: false, abiertas: new Set(), logged: false, locked: false };
const hcd$ = (id) => document.getElementById(id);
const hcdFechaHora = (ts) => ts ? new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }) : '—';
const hcdDato = (v) => (v && String(v).trim() ? esc(v) : '<span class="hcx-vacio">Sin completar</span>');

function hcdActual() {
  let hc = H.id ? hcPorId(H.id) : null;
  if (!hc && H.legacy) hc = getHCs().find(h => h.legacyId === H.legacy) || null;
  if (!hc && H.pac) hc = hcPorPaciente(H.pac);
  if (hc) H.id = hc.id;
  return hc;
}

/* ════════════════════════════════════════════════════════════
   INICIO, SESIÓN Y BLOQUEO
   ════════════════════════════════════════════════════════════ */
function hcdInit() {
  const q = new URLSearchParams(location.search);
  H.id = q.get('hc'); H.pac = q.get('pac'); H.legacy = q.get('hcId');
  hcMigrar();
  const un = hcd$('hcd-user'); if (un) un.textContent = hcUser().nombre;
  let ult = 0;
  ['click', 'keydown', 'touchstart', 'scroll'].forEach(ev => document.addEventListener(ev, () => {
    const t = Date.now(); if (t - ult < 15000) return; ult = t;
    try { const s = JSON.parse(sessionStorage.getItem('ms_admin_sess')); if (s) { s.ult = t; sessionStorage.setItem('ms_admin_sess', JSON.stringify(s)); } } catch {}
  }, { passive: true }));
  setInterval(() => { if (!H.locked && !hcSesion()) hcdBloqueo('Cerramos tu sesión por inactividad.'); }, 30000);
  window.addEventListener('beforeunload', e => { if (H.dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('afterprint', () => { const p = hcd$('hcx-print'); if (p) p.innerHTML = ''; if (H.title) document.title = H.title; });
  hcdRender();
}

function hcdBloqueo(msg) {
  H.locked = true; H.dirty = false;
  const p = hcd$('hcx-print'); if (p) p.innerHTML = '';
  hcd$('hcd-root').innerHTML = hcdAviso('🔒', 'Acceso restringido',
    (msg ? msg + ' ' : '') + 'La historia clínica sólo puede verse con una sesión activa del Panel Profesional.',
    '<a class="btn-hc-new" href="admin.html" style="text-decoration:none;display:inline-block">Ir al Panel Profesional</a>');
}
function hcdAviso(ico, titulo, texto, extra) {
  return `<div class="hcx-card hcx-lock"><div style="font-size:2.2rem" aria-hidden="true">${ico}</div><h2>${esc(titulo)}</h2><p>${esc(texto)}</p>${extra || ''}</div>`;
}

/* ════════════════════════════════════════════════════════════
   RENDER PRINCIPAL
   ════════════════════════════════════════════════════════════ */
function hcdRender() {
  const root = hcd$('hcd-root');
  if (!hcSesion()) return hcdBloqueo();
  H.locked = false;
  const volver = '<a class="btn-hc-open hcx-volver" href="admin.html#historias" onclick="return hcdVolver(event)">← Historias clínicas</a>';
  const hc = hcdActual();

  if (!hc) {
    const p = H.pac ? pacPorId(H.pac) : null;
    root.innerHTML = `<div class="hcx-nav">${volver}</div>` + (p && hcPuede(null, p)
      ? hcdAviso('🗂️', 'Este paciente todavía no tiene historia clínica', p.nombre, `<button class="btn-hc-new" onclick="hcCrearPara('${p.id}')">Crear historia clínica</button>`)
      : hcdAviso('🔍', 'No encontramos esa historia clínica', 'Volvé al listado y elegí un paciente.'));
    return;
  }
  if (!hcPuede(hc, null)) {
    root.innerHTML = `<div class="hcx-nav">${volver}</div>` + hcdAviso('🔒', 'Sin acceso', 'Esta historia clínica está a cargo de otra profesional.');
    return;
  }
  if (!H.logged) { H.logged = true; hcRegistrar(hc.id, 'Acceso a la historia clínica', '', 30 * 60e3); }

  const p = hcPaciente(hc), edad = pacEdad(p), editable = hc.estado === 'activa';
  const resp = HC_PROFS[hc.profesional];
  const y = window.scrollY;
  document.title = `Historia clínica · ${p.nombre} — Mente Serena`;
  root.innerHTML = `
    <div class="hcx-nav">${volver}
      <span class="hcx-badge reservada">🔒 Contenido confidencial</span></div>
    <header class="hcx-head">
      <div class="hcx-head-id">
        <div class="pac-avatar pac-avatar-lg" aria-hidden="true">${esc((p.nombre || '?').charAt(0).toUpperCase())}</div>
        <div>
          <h1>${esc(p.nombre)}</h1>
          <div class="hcx-head-meta">
            <span class="hcx-badge ${editable ? 'activa' : 'cerrada'}">${editable ? 'Activa' : 'Cerrada'}</span>
            <span>🗂️ ${esc(hc.numero || '')}</span>
            ${p.dni ? `<span>🪪 DNI ${esc(p.dni)}</span>` : ''}${edad != null ? `<span>🎂 ${edad} años</span>` : ''}
            ${resp ? `<span>👩‍⚕️ ${esc(resp.nombre)}</span>` : ''}
            <span>📅 Creada: ${hcFechaCorta(hc.creada)}</span><span>✏️ Modificada: ${hcFechaCorta(hc.modificada)}</span>
          </div>
        </div>
      </div>
      <div class="hcx-head-act">
        <button class="pac-btn-sec" onclick="hcdImprimir()">🖨️ Imprimir / PDF</button>
      </div>
    </header>
    <nav class="hcx-tabs" role="tablist" aria-label="Secciones de la historia clínica">
      ${HCD_TABS.map(([id, label]) => `<button class="tab-btn${H.tab === id ? ' active' : ''}" role="tab" aria-selected="${H.tab === id}" onclick="hcdTab('${id}')">${label}</button>`).join('')}
    </nav>
    <section role="tabpanel">${!editable && H.tab !== 'cierre' ? '<div class="hcx-solo-lectura">🔒 Historia cerrada: se muestra en modo lectura. Para modificarla, reabrila desde la pestaña Cierre.</div>' : ''}
      ${hcdPanel(hc, p, editable)}</section>`;
  window.scrollTo(0, y);
}

function hcdPanel(hc, p, editable) {
  if (H.tab === 'general') return hcdGeneral(hc, p);
  if (H.tab === 'sesiones') return hcdSesiones(hc, editable);
  if (H.tab === 'cierre') return hcdCierre(hc, editable);
  return HCD_TABS.find(t => t[0] === H.tab)[2].map(k => hcdSeccion(hc, k, editable)).join('');
}

/* ── Pestañas con confirmación si hay cambios sin guardar ──── */
async function hcdDescartar() {
  if (!H.dirty) return true;
  const r = await hcConfirm({ titulo: 'Cambios sin guardar', texto: 'Hay datos cargados que todavía no se guardaron. Si continuás, se pierden.', ok: 'Descartar cambios', peligro: true });
  if (r) { H.dirty = false; H.edit = null; H.ses = null; }
  return !!r;
}
async function hcdTab(t) {
  if (t === H.tab) return;
  if (!(await hcdDescartar())) return;
  H.edit = null; H.ses = null; H.tab = t; hcdRender(); window.scrollTo(0, 0);
}
async function hcdVolver(e) {
  if (!H.dirty) return true;
  e.preventDefault();
  if (await hcdDescartar()) location.href = 'admin.html#historias';
  return false;
}
function hcdAlerta(id, msg) { showAlert(id, '⚠️ ' + msg, 'error'); }

/* ════════════════════════════════════════════════════════════
   SECCIONES EDITABLES (motivo, antecedentes, evaluación, objetivos, plan)
   ════════════════════════════════════════════════════════════ */
function hcdCampo(pre, c, val) {
  const id = `${pre}-${c.k}`;
  let ctl;
  if (c.t === 'area') ctl = `<textarea id="${id}" rows="${c.rows || 4}" placeholder="${esc(c.ph || '')}">${esc(val)}</textarea>`;
  else if (c.t === 'date') ctl = `<input type="date" id="${id}" value="${esc(val)}" ${c.maxHoy ? `max="${pacHoyISO()}"` : ''}>`;
  else {
    const opts = c.opts.slice(); if (val && !opts.includes(val)) opts.push(val);
    ctl = `<select id="${id}"><option value="">— Sin definir —</option>${opts.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  }
  return `<div class="pac-f ${c.t === 'area' ? 'pac-f-full' : 'pac-f-half'}"><label for="${id}">${esc(c.l)}${c.req ? ' <span class="hcx-req">*</span>' : ''}</label>${ctl}
    <span class="hcx-err">${c.t === 'date' ? 'Ingresá una fecha válida.' : 'Este campo es obligatorio.'}</span></div>`;
}

function hcdSeccion(hc, k, editable) {
  const S = HCD_SECC[k], d = hc[k] || {};
  if (H.edit === k) {
    return `<div class="hcx-card"><div class="hcx-card-head"><h3>${esc(S.titulo)}</h3></div>
      <div class="pac-form hcx-form" oninput="H.dirty=true">${S.campos.map(c => hcdCampo('hcf-' + k, c, d[c.k] || '')).join('')}</div>
      <div class="alert" id="hcx-alert-${k}" role="alert"></div>
      <div class="hcx-form-act"><button class="pac-btn-sec" onclick="hcdCancelarEdit()">Cancelar</button>
        <button class="btn-hc-new" onclick="hcdGuardarSeccion('${k}')">Guardar cambios</button></div></div>`;
  }
  const filas = S.campos.map(c => `<dt>${esc(c.l)}</dt><dd>${c.t === 'date' ? (d[c.k] ? esc(pacFecha(d[c.k])) : hcdDato('')) : hcdDato(d[c.k])}</dd>`).join('');
  return `<div class="hcx-card"><div class="hcx-card-head"><h3>${esc(S.titulo)}</h3>
    ${editable ? `<button class="btn-hc-open" onclick="hcdEditar('${k}')">✏️ Editar</button>` : ''}</div><dl class="hcx-dl">${filas}</dl></div>`;
}
function hcdEditar(k) {
  if (H.edit || H.ses) { pacToast('Guardá o cancelá primero la edición abierta.'); return; }
  H.edit = k; hcdRender();
  setTimeout(() => { const el = document.querySelector('.hcx-form input, .hcx-form textarea, .hcx-form select'); if (el) el.focus(); }, 30);
}
async function hcdCancelarEdit() { if (await hcdDescartar()) { H.edit = null; hcdRender(); } }

function hcdGuardarSeccion(k) {
  const hc = hcdActual(); if (!hc || hc.estado !== 'activa') return;
  const S = HCD_SECC[k], vals = {}; let malo = null;
  S.campos.forEach(c => {
    const el = hcd$(`hcf-${k}-${c.k}`); vals[c.k] = el.value.trim();
    let err = c.req && !vals[c.k];
    if (c.t === 'date' && vals[c.k] && (isNaN(new Date(vals[c.k])) || (c.maxHoy && vals[c.k] > pacHoyISO()))) err = true;
    el.closest('.pac-f').classList.toggle('err', !!err);
    if (err && !malo) malo = el;
  });
  if (malo) { malo.focus(); hcdAlerta('hcx-alert-' + k, 'Revisá los campos marcados antes de guardar.'); return; }
  const vacia = Object.values(hc[k] || {}).every(v => !v);
  if (!hcActualizar(hc.id, h => { h[k] = Object.assign({}, h[k], vals); }, [vacia ? 'Carga de sección' : 'Edición de sección', S.titulo])) {
    hcdAlerta('hcx-alert-' + k, 'No se pudo guardar: almacenamiento insuficiente.'); return;
  }
  H.edit = null; H.dirty = false; hcdRender();
  pacToast(`“${S.titulo}” guardado correctamente.`, true);
}

/* ════════════════════════════════════════════════════════════
   INFORMACIÓN GENERAL
   ════════════════════════════════════════════════════════════ */
function hcdGeneral(hc, p) {
  const edad = pacEdad(p), u = hcUser();
  const esMia = hc.profesional && hc.profesional === u.key;
  const pd = hc.profesional ? hcProfDatos(hc.profesional) : { matricula: '', especialidad: 'Psicología' };
  const resp = HC_PROFS[hc.profesional];

  const profCard = H.edit === 'prof'
    ? `<div class="hcx-card"><div class="hcx-card-head"><h3>Datos del profesional</h3></div>
        <div class="pac-form hcx-form" oninput="H.dirty=true">
          <div class="pac-f pac-f-half"><label for="hcp-mat">Matrícula profesional <span class="hcx-req">*</span></label>
            <input type="text" id="hcp-mat" value="${esc(pd.matricula)}" placeholder="Ej: MP 1234"><span class="hcx-err">Ingresá tu matrícula.</span></div>
          <div class="pac-f pac-f-half"><label for="hcp-esp">Especialidad <span class="hcx-req">*</span></label>
            <input type="text" id="hcp-esp" value="${esc(pd.especialidad)}"><span class="hcx-err">Ingresá la especialidad.</span></div></div>
        <div class="alert" id="hcx-alert-prof" role="alert"></div>
        <div class="hcx-form-act"><button class="pac-btn-sec" onclick="hcdCancelarEdit()">Cancelar</button>
          <button class="btn-hc-new" onclick="hcdGuardarProf()">Guardar</button></div></div>`
    : `<div class="hcx-card"><div class="hcx-card-head"><h3>Datos del profesional</h3>
        ${esMia ? `<button class="btn-hc-open" onclick="hcdEditar('prof')">✏️ Editar</button>` : ''}</div>
        <dl class="hcx-dl"><dt>Nombre y apellido</dt><dd>${esc(resp ? resp.nombre : hc.creadaPor)}</dd>
          <dt>Matrícula profesional</dt><dd>${hcdDato(pd.matricula)}</dd><dt>Especialidad</dt><dd>${esc(pd.especialidad)}</dd></dl></div>`;

  const aud = (hc.auditoria || []).slice().reverse();
  return `
    <div class="hcx-card"><div class="hcx-card-head"><h3>Datos del paciente</h3></div>
      <dl class="hcx-dl">
        <dt>Nombre y apellido</dt><dd>${esc(p.nombre)}</dd>
        <dt>DNI</dt><dd>${hcdDato(p.dni)}</dd>
        <dt>Fecha de nacimiento</dt><dd>${p.nacimiento ? esc(pacFecha(p.nacimiento)) + (edad != null ? ` (${edad} años)` : '') : hcdDato('')}</dd>
        <dt>Teléfono</dt><dd>${hcdDato(p.telefono)}</dd><dt>Correo electrónico</dt><dd>${hcdDato(p.email)}</dd>
        <dt>Obra social</dt><dd>${hcdDato(p.obraSocial)}</dd><dt>Contacto de emergencia</dt><dd>${hcdDato(p.emergencia)}</dd></dl>
      <p class="hcx-nota">Estos datos se editan desde la sección <a href="admin.html#pacientes" class="hcx-link">Pacientes</a> del panel, para mantenerlos siempre actualizados.</p></div>
    ${profCard}
    <div class="hcx-card"><div class="hcx-card-head"><h3>Registro de la historia</h3></div>
      <dl class="hcx-dl"><dt>N.º de historia</dt><dd>${esc(hc.numero || '—')}</dd>
        <dt>Estado</dt><dd><span class="hcx-badge ${hc.estado === 'activa' ? 'activa' : 'cerrada'}">${hc.estado === 'activa' ? 'Activa' : 'Cerrada'}</span></dd>
        <dt>Fecha de creación</dt><dd>${hcdFechaHora(hc.creada)} · ${esc(hc.creadaPor || '—')}</dd>
        <dt>Última modificación</dt><dd>${hcdFechaHora(hc.modificada)} · ${esc(hc.modificadaPor || '—')}</dd></dl></div>
    <details class="hcx-card"><summary class="hcx-card-head" style="cursor:pointer;margin:0;border:none"><h3>Registro de modificaciones (${aud.length})</h3></summary>
      <p class="hcx-nota" style="margin:0 0 10px">Quién y cuándo accedió, modificó o exportó la historia. No se guarda el contenido clínico en este registro.</p>
      <ul class="hcx-audit">${aud.slice(0, 80).map(a => `<li><time>${hcdFechaHora(a.ts)}</time><strong>${esc(a.accion)}</strong>${a.detalle ? `<span>${esc(a.detalle)}</span>` : ''}<span style="color:var(--text-s)">${esc(a.por || '')}</span></li>`).join('')}</ul></details>`;
}
function hcdGuardarProf() {
  const hc = hcdActual(), u = hcUser(); if (!hc || hc.profesional !== u.key) return;
  const m = hcd$('hcp-mat'), e = hcd$('hcp-esp');
  const bm = !m.value.trim(), be = !e.value.trim();
  m.closest('.pac-f').classList.toggle('err', bm); e.closest('.pac-f').classList.toggle('err', be);
  if (bm || be) { hcdAlerta('hcx-alert-prof', 'Completá matrícula y especialidad.'); return; }
  if (!hcProfGuardar(u.key, { matricula: m.value.trim(), especialidad: e.value.trim() })) { hcdAlerta('hcx-alert-prof', 'No se pudo guardar.'); return; }
  hcActualizar(hc.id, () => {}, ['Edición de datos del profesional', '']);
  H.edit = null; H.dirty = false; hcdRender(); pacToast('Datos del profesional guardados.', true);
}

/* ════════════════════════════════════════════════════════════
   SESIONES Y EVOLUCIÓN
   ════════════════════════════════════════════════════════════ */
function hcdSesiones(hc, editable) {
  const vig = hcSesionesVigentes(hc);
  const ult = vig.length ? vig[vig.length - 1] : null;
  const tend = ult && HC_TENDENCIAS[ult.tendencia || ''];
  let lista = hcSesionesOrd(hc); if (H.orden === 'desc') lista.reverse();

  const evo = vig.length ? `
    <div class="hcx-card"><div class="hcx-card-head"><h3>Evolución del tratamiento</h3></div>
      <div class="hcx-evo" role="img" aria-label="Valoración de la evolución en cada sesión">
        ${vig.map(s => `<span class="hcx-evo-dot ${HC_TENDENCIAS[s.tendencia || ''].cls}" title="${esc(pacFecha(s.fecha))} · ${HC_TENDENCIAS[s.tendencia || ''].label}"></span>`).join('')}</div>
      <div class="hcx-leyenda">${['mejoria', 'estable', 'dificultad', ''].map(t => `<span class="${HC_TENDENCIAS[t].cls}">${HC_TENDENCIAS[t].label}</span>`).join('')}</div>
    </div>` : '';

  return `
    <div class="hcx-minis">
      <div class="pac-mini"><span class="pac-mini-n">${vig.length}</span><span class="pac-mini-l">Sesiones registradas</span></div>
      <div class="pac-mini"><span class="pac-mini-n">${vig.length ? esc(pacFecha(vig[0].fecha)) : '—'}</span><span class="pac-mini-l">Primera sesión</span></div>
      <div class="pac-mini"><span class="pac-mini-n">${ult ? esc(pacFecha(ult.fecha)) : '—'}</span><span class="pac-mini-l">Última sesión${tend && ult.tendencia ? ' · ' + tend.label : ''}</span></div>
    </div>
    ${evo}
    <div class="hcx-sesbar"><h3 style="font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:600">Línea de tiempo</h3>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <select aria-label="Orden de las sesiones" onchange="H.orden=this.value;hcdRender()">
          <option value="desc" ${H.orden === 'desc' ? 'selected' : ''}>Más recientes primero</option>
          <option value="asc" ${H.orden === 'asc' ? 'selected' : ''}>Más antiguas primero</option>
        </select>
        ${editable && !H.ses ? `<button class="btn-hc-new" onclick="hcdAbrirSesion('nueva')">＋ Registrar sesión</button>` : ''}
      </div></div>
    ${H.ses ? hcdFormSesion(hc) : ''}
    ${lista.length
      ? `<ol class="hcx-tl">${lista.map(s => hcdSesionItem(hc, s, editable)).join('')}</ol>`
      : `<div class="hcx-card hcx-vacio-box"><div style="font-size:2rem" aria-hidden="true">🗒️</div>
          Esta historia clínica todavía no tiene sesiones registradas.
          ${editable ? `<br><button class="btn-hc-new" onclick="hcdAbrirSesion('nueva')">＋ Registrar la primera sesión</button>` : ''}</div>`}`;
}

function hcdSesionItem(hc, s, editable) {
  const T = HC_TENDENCIAS[s.tendencia || ''], abierta = H.abiertas.has(s.id);
  const dentro = Date.now() - (s.creada || 0) < HC_VENTANA_EDICION_MS;
  const resumen = (s.temas || '').replace(/\s+/g, ' ');
  const filas = [['Profesional responsable', s.profNombre], ['Modalidad', s.modalidad === 'virtual' ? 'Virtual' : s.modalidad === 'presencial' ? 'Presencial' : ''],
    ['Motivo / temas abordados', s.temas], ['Intervenciones realizadas', s.intervenciones], ['Evolución observada', s.evolucion],
    ['Observaciones clínicas', s.observaciones], ['Próximos pasos', s.proximos]]
    .filter(([, v]) => v && String(v).trim()).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  const acc = editable && !s.anulada ? `<div class="hcx-tl-acc">
      ${dentro ? `<button class="btn-hc-open" onclick="hcdAbrirSesion('${s.id}')">✏️ Editar</button>` : ''}
      <button class="btn-hc-open" onclick="hcdAdenda('${s.id}')">＋ Nota complementaria</button>
      <button class="btn-hc-del" onclick="hcdAnular('${s.id}')">Anular</button></div>` : '<span></span>';
  return `
    <li class="hcx-tl-item${abierta ? ' abierta' : ''}${s.anulada ? ' anulada' : ''}" id="tl-${s.id}">
      <span class="hcx-tl-dot ${T.cls}"></span>
      <div class="hcx-tl-card">
        <button class="hcx-tl-head" aria-expanded="${abierta}" onclick="hcdToggleSes('${s.id}')">
          <span class="hcx-tl-fecha">${esc(pacFecha(s.fecha))}</span><span class="hcx-tl-num">Sesión N° ${s.numero || '—'}</span>
          ${s.tendencia ? `<span class="hcx-tl-tend"><span class="hcx-evo-dot ${T.cls}"></span>${T.label}</span>` : ''}
          ${s.anulada ? '<span class="hcx-badge anulada">Anulada</span>' : ''}${s.importada ? '<span class="hcx-badge reservada">Importada</span>' : ''}
          <span class="hcx-tl-flecha" aria-hidden="true">▾</span>
          <span class="hcx-tl-resumen">${esc(resumen.length > 100 ? resumen.slice(0, 100) + '…' : resumen)}</span>
        </button>
        <div class="hcx-tl-body">
          ${s.anulada ? `<div class="hcx-adenda"><small>Anulada el ${hcdFechaHora(s.anulada.ts)} por ${esc(s.anulada.por)}</small>Motivo: ${esc(s.anulada.motivo)}</div>` : ''}
          <dl class="hcx-dl">${filas || '<dt>Contenido</dt><dd><span class="hcx-vacio">Sin completar</span></dd>'}</dl>
          ${(s.adendas || []).map(a => `<div class="hcx-adenda"><small>Nota complementaria · ${hcdFechaHora(a.ts)} · ${esc(a.por)}</small>${esc(a.texto)}</div>`).join('')}
          <div class="hcx-tl-pie"><span>Registrada ${hcdFechaHora(s.creada)} · ${esc(s.creadaPor || '')}${s.modificada ? ` · Editada ${hcdFechaHora(s.modificada)}` : ''}</span>${acc}</div>
        </div>
      </div>
    </li>`;
}
function hcdToggleSes(id) {
  const el = hcd$('tl-' + id); if (!el) return;
  const ab = el.classList.toggle('abierta');
  el.querySelector('.hcx-tl-head').setAttribute('aria-expanded', ab);
  ab ? H.abiertas.add(id) : H.abiertas.delete(id);
}

/* ── Formulario de sesión (nueva / edición) ────────────────── */
function hcdFormSesion(hc) {
  const ed = H.ses !== 'nueva' ? hc.sesiones.find(s => s.id === H.ses) : null;
  const v = ed || { fecha: pacHoyISO(), modalidad: 'presencial', tendencia: '' };
  const u = hcUser();
  const num = ed ? ed.numero : Math.max(0, ...hc.sesiones.map(s => s.numero || 0)) + 1;
  const f = (id, label, ctl, cls, req) => `<div class="pac-f ${cls}"><label for="${id}">${label}${req ? ' <span class="hcx-req">*</span>' : ''}</label>${ctl}<span class="hcx-err">${req ? 'Este dato es obligatorio.' : ''}</span></div>`;
  const ta = (id, val, rows, ph) => `<textarea id="${id}" rows="${rows}" placeholder="${esc(ph || '')}">${esc(val)}</textarea>`;
  return `
    <div class="hcx-card" id="hcs-card"><div class="hcx-card-head"><h3>${ed ? 'Editar' : 'Nueva'} sesión · N° ${num}</h3></div>
      <div class="pac-form hcx-form" oninput="H.dirty=true">
        ${f('hcs-fecha', 'Fecha de la sesión', `<input type="date" id="hcs-fecha" value="${esc(v.fecha)}" max="${pacHoyISO()}">`, '', true).replace('Este dato es obligatorio.', 'Ingresá una fecha válida que no sea futura.')}
        ${f('hcs-prof', 'Profesional responsable', `<input type="text" id="hcs-prof" value="${esc(ed ? ed.profNombre : u.nombre)}" readonly>`, '')}
        ${f('hcs-mod', 'Modalidad', `<select id="hcs-mod"><option value="presencial" ${v.modalidad !== 'virtual' ? 'selected' : ''}>Presencial</option><option value="virtual" ${v.modalidad === 'virtual' ? 'selected' : ''}>Virtual</option></select>`, '')}
        ${f('hcs-temas', 'Motivo o temas abordados', ta('hcs-temas', v.temas || '', 2, 'Temas centrales de la sesión…'), 'pac-f-full', true)}
        ${f('hcs-interv', 'Intervenciones realizadas', ta('hcs-interv', v.intervenciones || '', 3, 'Técnicas y estrategias utilizadas…'), 'pac-f-full', true)}
        ${f('hcs-evo', 'Evolución observada', ta('hcs-evo', v.evolucion || '', 3, 'Cambios y avances respecto de sesiones anteriores…'), 'pac-f-half', true)}
        ${f('hcs-tend', 'Valoración de la evolución', `<select id="hcs-tend">${Object.entries(HC_TENDENCIAS).map(([k, t]) => `<option value="${k}" ${(v.tendencia || '') === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select>`, 'pac-f-half')}
        ${f('hcs-obs', 'Observaciones clínicas pertinentes', ta('hcs-obs', v.observaciones || '', 3), 'pac-f-full')}
        ${f('hcs-prox', 'Próximos pasos o recomendaciones', ta('hcs-prox', v.proximos || '', 2, 'Tareas, derivaciones, temas para la próxima sesión…'), 'pac-f-full')}
      </div>
      ${ed ? `<p class="hcx-nota">Podés editar esta sesión hasta 24 horas después de registrarla; luego sólo se pueden agregar notas complementarias.</p>` : ''}
      <div class="alert" id="hcx-alert-ses" role="alert"></div>
      <div class="hcx-form-act"><button class="pac-btn-sec" onclick="hcdCancelarSesion()">Cancelar</button>
        <button class="btn-hc-new" onclick="hcdGuardarSesion()">${ed ? 'Guardar cambios' : 'Registrar sesión'}</button></div>
    </div>`;
}
async function hcdAbrirSesion(id) {
  if (H.edit || H.ses) { pacToast('Guardá o cancelá primero la edición abierta.'); return; }
  H.ses = id; hcdRender();
  const c = hcd$('hcs-card'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => { const el = hcd$('hcs-temas'); if (el) el.focus({ preventScroll: true }); }, 250);
}
async function hcdCancelarSesion() { if (await hcdDescartar()) { H.ses = null; hcdRender(); } }

async function hcdGuardarSesion() {
  const hc = hcdActual(); if (!hc || hc.estado !== 'activa') return;
  const ed = H.ses !== 'nueva' ? hc.sesiones.find(s => s.id === H.ses) : null;
  const g = (id) => hcd$(id).value.trim();
  const vals = { fecha: g('hcs-fecha'), modalidad: g('hcs-mod'), temas: g('hcs-temas'), intervenciones: g('hcs-interv'),
    evolucion: g('hcs-evo'), tendencia: g('hcs-tend'), observaciones: g('hcs-obs'), proximos: g('hcs-prox') };
  const malos = [];
  const marca = (id, bad) => { hcd$(id).closest('.pac-f').classList.toggle('err', bad); if (bad) malos.push(id); };
  marca('hcs-fecha', !vals.fecha || isNaN(new Date(vals.fecha)) || vals.fecha > pacHoyISO());
  marca('hcs-temas', !vals.temas); marca('hcs-interv', !vals.intervenciones); marca('hcs-evo', !vals.evolucion);
  if (malos.length) {
    hcd$(malos[0]).focus();
    hcdAlerta('hcx-alert-ses', `Faltan datos obligatorios (${malos.length}). Completá los campos marcados.`); return;
  }
  if (ed && Date.now() - ed.creada >= HC_VENTANA_EDICION_MS) { hcdAlerta('hcx-alert-ses', 'Esta sesión ya no se puede editar. Agregá una nota complementaria.'); return; }
  if (hc.sesiones.some(s => s.fecha === vals.fecha && !s.anulada && (!ed || s.id !== ed.id))) {
    const r = await hcConfirm({ titulo: 'Ya hay una sesión ese día', texto: 'Existe otra sesión registrada con la misma fecha. ¿Querés registrar esta igualmente?', ok: 'Sí, registrar' });
    if (!r) return;
  }
  const u = hcUser(), ahora = Date.now();
  const num = ed ? ed.numero : Math.max(0, ...hc.sesiones.map(s => s.numero || 0)) + 1;
  const ok = hcActualizar(hc.id, h => {
    if (ed) Object.assign(h.sesiones.find(s => s.id === ed.id), vals, { modificada: ahora, modificadaPor: u.nombre });
    else h.sesiones.push(Object.assign({ id: hcNuevoId('s'), numero: num, profesional: u.key, profNombre: u.nombre, creada: ahora, creadaPor: u.nombre, adendas: [] }, vals));
  }, [ed ? 'Edición de sesión' : 'Nueva sesión', `Sesión N° ${num} (${vals.fecha})`]);
  if (!ok) { hcdAlerta('hcx-alert-ses', 'No se pudo guardar: almacenamiento insuficiente.'); return; }
  H.ses = null; H.dirty = false; hcdRender();
  pacToast(ed ? `Sesión N° ${num} actualizada.` : `Sesión N° ${num} registrada correctamente.`, true);
}

async function hcdAdenda(sid) {
  const hc = hcdActual(); if (!hc || hc.estado !== 'activa') return;
  const s = hc.sesiones.find(x => x.id === sid); if (!s) return;
  const r = await hcConfirm({ titulo: `Nota complementaria · Sesión N° ${s.numero}`,
    texto: 'Se agrega al pie de la sesión sin modificar el registro original. Queda con fecha y tu usuario.',
    ok: 'Agregar nota', motivo: { label: 'Nota complementaria', req: true } });
  if (!r) return;
  const u = hcUser();
  if (!hcActualizar(hc.id, h => h.sesiones.find(x => x.id === sid).adendas.push({ ts: Date.now(), por: u.nombre, texto: r.motivo }), ['Nota complementaria', `Sesión N° ${s.numero}`])) { pacToast('No se pudo guardar.'); return; }
  H.abiertas.add(sid); hcdRender(); pacToast('Nota complementaria agregada.', true);
}
async function hcdAnular(sid) {
  const hc = hcdActual(); if (!hc || hc.estado !== 'activa') return;
  const s = hc.sesiones.find(x => x.id === sid); if (!s) return;
  const r = await hcConfirm({ titulo: `Anular sesión N° ${s.numero}`,
    texto: 'La sesión no se elimina: queda en la historia marcada como anulada, con el motivo, la fecha y tu usuario.',
    ok: 'Anular sesión', peligro: true, motivo: { label: 'Motivo de la anulación', req: true } });
  if (!r) return;
  const u = hcUser();
  if (!hcActualizar(hc.id, h => { h.sesiones.find(x => x.id === sid).anulada = { ts: Date.now(), por: u.nombre, motivo: r.motivo }; }, ['Anulación de sesión', `Sesión N° ${s.numero}`])) { pacToast('No se pudo guardar.'); return; }
  H.abiertas.add(sid); hcdRender(); pacToast('Sesión anulada.');
}

/* ════════════════════════════════════════════════════════════
   CIERRE Y REAPERTURA
   ════════════════════════════════════════════════════════════ */
function hcdCierre(hc, editable) {
  if (!editable) {
    const c = hc.cierre || {};
    return `<div class="hcx-card"><div class="hcx-card-head"><h3>Cierre de la historia clínica</h3></div>
      <dl class="hcx-dl"><dt>Fecha de cierre</dt><dd>${c.fecha ? esc(pacFecha(c.fecha)) : hcdDato('')}</dd>
        <dt>Motivo de cierre</dt><dd>${hcdDato(c.motivo)}</dd><dt>Resumen del proceso</dt><dd>${hcdDato(c.resumen)}</dd>
        <dt>Registrado por</dt><dd>${c.ts ? hcdFechaHora(c.ts) + ' · ' + esc(c.por || '') : hcdDato('')}</dd></dl>
      <div class="hcx-form-act"><button class="btn-hc-new" onclick="hcdReabrir()">Reabrir historia clínica</button></div></div>`;
  }
  return `<div class="hcx-card"><div class="hcx-card-head"><h3>Cierre de la historia clínica</h3></div>
    <p class="hcx-nota" style="margin:0 0 14px">La historia está <strong>activa</strong>. Cuando finalice el proceso terapéutico, registrá el cierre. Pasará a modo lectura y podrá reabrirse con un motivo.</p>
    <div class="pac-form hcx-form" oninput="H.dirty=true">
      <div class="pac-f pac-f-half"><label for="hcc-fecha">Fecha de cierre <span class="hcx-req">*</span></label>
        <input type="date" id="hcc-fecha" value="${pacHoyISO()}" max="${pacHoyISO()}"><span class="hcx-err">Ingresá una fecha válida que no sea futura.</span></div>
      <div class="pac-f pac-f-half"><label for="hcc-motivo">Motivo de cierre <span class="hcx-req">*</span></label>
        <select id="hcc-motivo"><option value="">— Seleccioná —</option>${HCD_MOTIVOS_CIERRE.map(m => `<option>${m}</option>`).join('')}</select><span class="hcx-err">Elegí un motivo.</span></div>
      <div class="pac-f pac-f-full"><label for="hcc-resumen">Resumen del proceso <span class="hcx-req">*</span></label>
        <textarea id="hcc-resumen" rows="4" placeholder="Síntesis del proceso, logros alcanzados y recomendaciones finales…"></textarea><span class="hcx-err">Este campo es obligatorio.</span></div></div>
    <div class="alert" id="hcx-alert-cierre" role="alert"></div>
    <div class="hcx-form-act"><button class="btn-hc-new peligro" onclick="hcdCerrar()">Cerrar historia clínica</button></div></div>`;
}
async function hcdCerrar() {
  const hc = hcdActual(); if (!hc || hc.estado !== 'activa') return;
  const f = hcd$('hcc-fecha'), m = hcd$('hcc-motivo'), r = hcd$('hcc-resumen');
  const bf = !f.value || f.value > pacHoyISO(), bm = !m.value, br = !r.value.trim();
  [[f, bf], [m, bm], [r, br]].forEach(([el, b]) => el.closest('.pac-f').classList.toggle('err', b));
  if (bf || bm || br) { hcdAlerta('hcx-alert-cierre', 'Completá los datos obligatorios del cierre.'); return; }
  const ok = await hcConfirm({ titulo: 'Cerrar historia clínica',
    texto: 'La historia pasará a modo lectura y no podrán registrarse nuevas sesiones ni ediciones hasta que se reabra. El cierre queda registrado con tu usuario.',
    ok: 'Cerrar historia', peligro: true });
  if (!ok) return;
  const u = hcUser(), motivo = m.value;
  if (!hcActualizar(hc.id, h => {
    h.estado = 'cerrada'; h.cierre = { fecha: f.value, motivo, resumen: r.value.trim(), por: u.nombre, ts: Date.now() };
  }, ['Cierre de la historia clínica', motivo])) { hcdAlerta('hcx-alert-cierre', 'No se pudo guardar.'); return; }
  H.dirty = false; hcdRender(); pacToast('Historia clínica cerrada.', true);
}
async function hcdReabrir() {
  const hc = hcdActual(); if (!hc || hc.estado !== 'cerrada') return;
  const r = await hcConfirm({ titulo: 'Reabrir historia clínica',
    texto: 'La historia volverá a estar activa. El cierre anterior se conserva en el registro de modificaciones.',
    ok: 'Reabrir', motivo: { label: 'Motivo de la reapertura', req: true } });
  if (!r) return;
  if (!hcActualizar(hc.id, h => { h.estado = 'activa'; h.cierreAnterior = h.cierre; h.cierre = null; }, ['Reapertura de la historia clínica', r.motivo])) { pacToast('No se pudo guardar.'); return; }
  H.tab = 'general'; hcdRender(); pacToast('Historia clínica reabierta.', true);
}

/* ════════════════════════════════════════════════════════════
   IMPRESIÓN / PDF (con confirmación)
   ════════════════════════════════════════════════════════════ */
async function hcdImprimir() {
  const hc = hcdActual(); if (!hc || !hcPuede(hc, null)) return;
  if (H.dirty && !(await hcdDescartar())) return;
  const p = hcPaciente(hc);
  const r = await hcConfirm({ titulo: 'Imprimir o exportar historia clínica',
    texto: `Vas a generar una versión imprimible / PDF de la historia clínica de ${p.nombre}, con información clínica sensible.\nFuera de este sistema ya no está protegida por el control de acceso: guardala y compartila sólo con quienes estén autorizados por la normativa.`,
    ok: 'Generar documento', check: 'Confirmo que estoy autorizada/o a emitir este documento y que lo trataré de forma confidencial.' });
  if (!r) return;
  hcRegistrar(hc.id, 'Impresión / exportación a PDF', '');
  H.edit = null; H.ses = null;
  hcd$('hcx-print').innerHTML = hcdPrintHTML(hcdActual(), p);
  H.title = document.title;
  const ap = (p.nombre || 'Paciente').trim().split(/\s+/).pop();
  document.title = `HC_${ap}_${pacHoyISO()}`.replace(/[^\w\-]/g, '_');
  window.print();
}

function hcdPrintHTML(hc, p) {
  const edad = pacEdad(p), pd = hc.profesional ? hcProfDatos(hc.profesional) : { matricula: '', especialidad: 'Psicología' };
  const resp = HC_PROFS[hc.profesional], nombreProf = resp ? resp.nombre : hc.creadaPor;
  const dl = (pares) => `<dl>${pares.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  const sec = (k) => dl(HCD_SECC[k].campos.map(c => [c.l, c.t === 'date' && hc[k][c.k] ? pacFecha(hc[k][c.k]) : hc[k][c.k]]));
  const ses = hcSesionesOrd(hc).map(s => `
    <div class="pr-ses"><h3>Sesión N° ${s.numero || '—'} · ${esc(pacFecha(s.fecha))}${s.anulada ? ' (ANULADA)' : ''}</h3>
      ${dl([['Profesional', s.profNombre], ['Modalidad', s.modalidad], ['Motivo / temas', s.temas], ['Intervenciones', s.intervenciones], ['Evolución', s.evolucion],
        ['Valoración', s.tendencia ? HC_TENDENCIAS[s.tendencia].label : ''], ['Observaciones', s.observaciones], ['Próximos pasos', s.proximos],
        ['Anulación', s.anulada ? `${hcdFechaHora(s.anulada.ts)} · ${s.anulada.por} · ${s.anulada.motivo}` : ''],
        ...(s.adendas || []).map(a => ['Nota complementaria', `${hcdFechaHora(a.ts)} · ${a.por}: ${a.texto}`])])}</div>`).join('');
  const c = hc.cierre;
  return `
    <h1>Historia Clínica Psicológica</h1>
    <div class="pr-sub">Mente Serena · ${esc(hc.numero || '')} · Estado: ${hc.estado === 'activa' ? 'Activa' : 'Cerrada'}</div>
    <div class="pr-conf">DOCUMENTO CONFIDENCIAL. Contiene datos sensibles de salud protegidos por las Leyes 26.529 y 26.657. Su uso y divulgación están limitados a las personas autorizadas.</div>
    <h2>Datos del paciente</h2>
    ${dl([['Nombre y apellido', p.nombre], ['DNI', p.dni], ['Fecha de nacimiento', p.nacimiento ? pacFecha(p.nacimiento) + (edad != null ? ` (${edad} años)` : '') : ''],
      ['Teléfono', p.telefono], ['Correo electrónico', p.email], ['Obra social', p.obraSocial], ['Contacto de emergencia', p.emergencia]])}
    <h2>Datos del profesional</h2>
    ${dl([['Nombre y apellido', nombreProf], ['Matrícula', pd.matricula], ['Especialidad', pd.especialidad]])}
    <h2>Motivo de consulta</h2>${sec('motivo')}
    <h2>Antecedentes relevantes</h2>${sec('antecedentes')}
    <h2>Evaluación inicial</h2>${sec('evaluacion')}
    <h2>Objetivos terapéuticos</h2>${sec('objetivos')}
    <h2>Plan de tratamiento</h2>${sec('plan')}
    <h2>Registro de sesiones y evolución</h2>${ses || '<p>Sin sesiones registradas.</p>'}
    ${c ? `<h2>Cierre de la historia clínica</h2>${dl([['Fecha', c.fecha ? pacFecha(c.fecha) : ''], ['Motivo', c.motivo], ['Resumen del proceso', c.resumen]])}` : ''}
    <div class="pr-firma">${esc(nombreProf)}${pd.matricula ? '<br>Matrícula: ' + esc(pd.matricula) : ''}</div>
    <div class="pr-pie">Creada el ${hcdFechaHora(hc.creada)} · Última modificación ${hcdFechaHora(hc.modificada)}.<br>Documento emitido el ${hcdFechaHora(Date.now())} por ${esc(hcUser().nombre)}.</div>`;
}

document.addEventListener('DOMContentLoaded', () => { if (hcd$('hcd-root')) hcdInit(); });
