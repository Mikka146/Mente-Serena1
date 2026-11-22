/* ============================================================
   HISTORIAS.JS — Mente Serena
   Módulo de Historias Clínicas Psicológicas · parte compartida:
     · datos (localStorage "ms_hc_v2"), permisos y trazabilidad
     · migración de las fichas del formato anterior ("ms_hc_list")
     · diálogo de confirmación propio
     · listado de historias (sección del panel, admin.html)
     · datos ficticios de demostración
   La vista detallada vive en historia_detalle.js.

   Depende de common.js (ls, esc, getArgNow) y de pacientes.js
   (getPacs, pacPorId, pacNorm, pacEdad, pacFecha, pacHoyISO, pacToast,
   PAC_PROFS), que se cargan antes.

   NOTA: es un prototipo sin servidor; los datos quedan en el
   navegador de este dispositivo y NO están cifrados.
   ============================================================ */

const HC_KEY      = 'ms_hc_v2';          // array de historias clínicas
const HC_PROF_KEY = 'ms_hc_prof';        // { daiana: { matricula, especialidad } }
const HC_MIGRADO  = 'ms_hc_v2_migrado';  // marca de migración realizada
const HC_PROFS    = PAC_PROFS;

/** Una sesión puede editarse sólo durante este lapso; después, sólo notas complementarias. */
const HC_VENTANA_EDICION_MS = 24 * 60 * 60 * 1000;
/** false: cada profesional accede sólo a las historias a su cargo (o sin responsable). */
const HC_ACCESO_CRUZADO = false;

const HC_TENDENCIAS = {
  mejoria:    { label: 'Mejoría',      cls: 't-mejoria' },
  estable:    { label: 'Estable',      cls: 't-estable' },
  dificultad: { label: 'Dificultades', cls: 't-dificultad' },
  '':         { label: 'Sin valorar',  cls: 't-sin' }
};

/* ════════════════════════════════════════════════════════════
   SESIÓN Y USUARIO
   ════════════════════════════════════════════════════════════ */
/** Sesión profesional válida (la misma que crea admin.js) o null */
function hcSesion() {
  try {
    const s = JSON.parse(sessionStorage.getItem('ms_admin_sess'));
    const ahora = Date.now();
    if (!s || !ls.get('ms_admin_cred', {})[s.nombre]) return null;
    if (ahora - s.ini > 8 * 3600e3 || ahora - s.ult > 30 * 60e3) return null;
    return s;
  } catch { return null; }
}
function hcUser() {
  const s = (typeof sesionAdmin !== 'undefined' && sesionAdmin) || hcSesion();
  if (!s) return { nombre: '', key: '' };
  const key = /daiana/i.test(s.nombre) ? 'daiana' : /micaela/i.test(s.nombre) ? 'micaela' : '';
  return { nombre: 'Lic. ' + s.nombre, key };
}

/* ════════════════════════════════════════════════════════════
   DATOS
   ════════════════════════════════════════════════════════════ */
const getHCs = () => ls.get(HC_KEY, []);
/** Guarda y avisa si falló (ls.set ignora los errores de espacio) */
function hcGuardarTodo(lista) {
  try { localStorage.setItem(HC_KEY, JSON.stringify(lista)); return true; } catch { return false; }
}
const hcPorId = (id) => getHCs().find(h => h.id === id) || null;
const hcPorPaciente = (pid) => (pid ? getHCs().find(h => h.pacienteId === pid) || null : null);
const hcNuevoId = (pre) => pre + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function hcSnap(p) {
  return { nombre: p.nombre, dni: p.dni || '', nacimiento: p.nacimiento || '', edad: p.edad || '',
           telefono: p.telefono || '', email: p.email || '', obraSocial: p.obraSocial || '', emergencia: p.emergencia || '' };
}
/** Datos del paciente: de Pacientes si existe; si no, la copia guardada en la historia */
function hcPaciente(hc) {
  const p = hc.pacienteId ? pacPorId(hc.pacienteId) : null;
  return p || Object.assign({ id: null, nombre: 'Paciente sin nombre' }, hc.pacSnap || {});
}

/** Modifica una historia, actualiza fechas y agrega la entrada de trazabilidad */
function hcActualizar(id, fn, audit) {
  const lista = getHCs(), hc = lista.find(h => h.id === id);
  if (!hc) return false;
  const u = hcUser();
  fn(hc);
  hc.modificada = Date.now();
  hc.modificadaPor = u.nombre;
  const p = hc.pacienteId ? pacPorId(hc.pacienteId) : null;
  if (p) hc.pacSnap = hcSnap(p);
  if (audit) hc.auditoria.push({ ts: hc.modificada, por: u.nombre, accion: audit[0], detalle: audit[1] || '' });
  return hcGuardarTodo(lista);
}
/** Entrada de auditoría sin modificar el contenido (accesos, exportaciones) */
function hcRegistrar(id, accion, detalle, dedupMs) {
  const lista = getHCs(), hc = lista.find(h => h.id === id);
  if (!hc) return;
  const u = hcUser(), ahora = Date.now();
  if (dedupMs && hc.auditoria.some(a => a.accion === accion && a.por === u.nombre && ahora - a.ts < dedupMs)) return;
  hc.auditoria.push({ ts: ahora, por: u.nombre, accion, detalle: detalle || '' });
  hcGuardarTodo(lista);
}

/** Datos del profesional (matrícula y especialidad) */
function hcProfDatos(key) {
  const g = ls.get(HC_PROF_KEY, {})[key] || {};
  return { matricula: g.matricula || '', especialidad: g.especialidad || 'Psicología' };
}
function hcProfGuardar(key, d) {
  const todos = ls.get(HC_PROF_KEY, {});
  todos[key] = d;
  try { localStorage.setItem(HC_PROF_KEY, JSON.stringify(todos)); return true; } catch { return false; }
}

/** ¿Puede el usuario actual ver/editar esta historia (o crearla para este paciente)? */
function hcPuede(hc, pac) {
  const u = hcUser();
  if (!u.key) return false;
  if (HC_ACCESO_CRUZADO) return true;
  const resp = hc ? hc.profesional : (pac && pac.profesional);
  return !resp || resp === u.key;
}

function hcNumero() {
  const y = getArgNow().getUTCFullYear();
  const max = getHCs().reduce((m, h) => {
    const r = /^HC-(\d{4})-(\d+)$/.exec(h.numero || '');
    return r && +r[1] === y ? Math.max(m, +r[2]) : m;
  }, 0);
  return `HC-${y}-${String(max + 1).padStart(3, '0')}`;
}

/** Estructura vacía de una historia clínica */
function hcNueva(p, u, extra) {
  const ahora = Date.now();
  return Object.assign({
    id: hcNuevoId('hc'), numero: hcNumero(), pacienteId: p ? p.id : null, pacSnap: p ? hcSnap(p) : null,
    profesional: u.key, estado: 'activa',
    creada: ahora, creadaPor: u.nombre, modificada: ahora, modificadaPor: u.nombre,
    motivo: { motivo: p && p.motivo ? p.motivo : '', demanda: '' },
    antecedentes: { personales: '', familiares: '', salud: '', medicacion: '' },
    evaluacion: { fecha: '', estadoEmocional: '', observaciones: '', otros: '' },
    objetivos: { objetivos: '' },
    plan: { plan: '', enfoque: '', frecuencia: '', revision: '' },
    sesiones: [], cierre: null,
    auditoria: [{ ts: ahora, por: u.nombre, accion: 'Creación de la historia clínica', detalle: '' }]
  }, extra || {});
}

/** Sesiones ordenadas cronológicamente (más antigua primero) */
function hcSesionesOrd(hc) {
  return (hc.sesiones || []).slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (a.creada || 0) - (b.creada || 0));
}
const hcSesionesVigentes = (hc) => hcSesionesOrd(hc).filter(s => !s.anulada);

/* ════════════════════════════════════════════════════════════
   MIGRACIÓN — fichas del formato anterior (ms_hc_list / ms_hc_data_*)
   No borra nada del formato anterior; sólo copia al nuevo.
   ════════════════════════════════════════════════════════════ */
function hcLineas(pares) {
  return pares.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k}: ${String(v).trim()}`).join('\n');
}
function hcMigrar() {
  if (localStorage.getItem(HC_MIGRADO)) return;
  const viejas = ls.get('ms_hc_list', []);
  const lista = getHCs();
  const pacs = getPacs();
  const CHIPS = { ansiedad: 'Ansiedad', depresion: 'Depresión', trauma: 'Trauma / TEPT', suicida: 'Riesgo suicida', duelo: 'Duelo',
    adicciones: 'Adicciones', toc: 'TOC', tdah: 'TDAH', 'trastorno-a': 'Trastorno alimentario', psicosis: 'Psicosis',
    bipolar: 'Trastorno bipolar', personalidad: 'Trastorno de personalidad' };

  viejas.forEach(it => {
    if (lista.some(h => h.legacyId === it.id)) return;
    const d = ls.get('ms_hc_data_' + it.id, null);
    if (!d) return;
    const nombre = d.patName || it.paciente || 'Paciente sin nombre';
    const p = pacs.find(x => pacNorm(x.nombre) === pacNorm(nombre)) || null;
    const dup = p && lista.some(h => h.pacienteId === p.id);     // un paciente = una historia
    const st = d.state || {};
    const key = /daiana/i.test(d.docName || '') ? 'daiana' : /micaela/i.test(d.docName || '') ? 'micaela' : (p ? p.profesional : '');
    const creada = Date.parse(d.savedAt) || it.fecha || Date.now();
    const chips = Object.keys(st.chips || {}).filter(k => st.chips[k]).map(k => CHIPS[k] || k).join(', ');
    const linea = (st.timeline || []).map(e => `${e.stage}${e.age ? ' (' + e.age + ')' : ''}: ${e.desc} [${e.impact}]`).join('\n');
    const esc3 = st.scales || {};
    const suma = (o) => Object.values(o || {}).reduce((a, b) => a + (+b || 0), 0);
    const escalas = Object.keys(esc3).some(k => suma(esc3[k])) ?
      `Depresión ${suma(esc3.dep)}/15 · Ansiedad ${suma(esc3.anx)}/15 · Riesgo suicida ${suma(esc3.risk)}/3 · Estrés ${suma(esc3.str)}/9 (orientativas)` : '';

    const hc = hcNueva(p, { key: key || '', nombre: d.docName ? 'Lic. ' + d.docName.replace(/^Lic\.?\s*/i, '') : '' }, {
      legacyId: it.id, creada, modificada: it.fecha || creada, creadaPor: d.docName || '', modificadaPor: d.docName || '',
      pacienteId: dup ? null : (p ? p.id : null),
      pacSnap: p ? hcSnap(p) : { nombre, edad: d.patAge || '', emergencia: d.patEmergency || '' },
      motivo: { motivo: d.patMotive || '', demanda: d.patDemand || '' },
      antecedentes: {
        personales: hcLineas([['Género', d.patGender], ['Estado civil', d.patCivil], ['Ocupación', d.patOccupation], ['Escolaridad', d.patEducation],
          ['Dinámica familiar', d.histFamily], ['Vida social y red de apoyo', d.histSocial], ['Situación socioeconómica', d.histSocioeconomic]]) +
          (linea ? '\n\nLínea de vida:\n' + linea : ''),
        familiares: d.histFamilyMental || '',
        salud: hcLineas([['Antecedentes clínicos referidos', chips], ['Enfermedades médicas', d.patMedical]]),
        medicacion: d.patTreatments || ''
      },
      evaluacion: {
        fecha: '', estadoEmocional: d.mseMood || '',
        observaciones: hcLineas([['Apariencia / conducta', d.mseAppearance], ['Orientación', d.mseOrientation], ['Atención / memoria', d.mseMemory],
          ['Lenguaje', d.mseSpeech], ['Pensamiento / juicio', d.mseThought], ['Autoconcepto / personalidad', d.msePersonality], ['Otras observaciones', d.mseNotes]]),
        otros: hcLineas([['Escalas', escalas], ['Diagnóstico principal', d.dxPrimary], ['Diagnóstico secundario', d.dxSecondary]])
      },
      objetivos: { objetivos: d.dxGoals || '' },
      plan: { plan: hcLineas([['Pronóstico', d.dxPrognosis], ['Observaciones finales', d.dxSignatureNotes]]),
              enfoque: '', frecuencia: ['Semanal', 'Quincenal', 'Mensual'].includes(d.dxFrequency) ? d.dxFrequency : '', revision: d.dxReviewDate || '' }
    });
    if (d.dxApproach) hc.plan.plan = hcLineas([['Enfoque', d.dxApproach]]) + (hc.plan.plan ? '\n' + hc.plan.plan : '');
    hc.auditoria = [{ ts: Date.now(), por: 'Sistema', accion: 'Importada desde la ficha del formato anterior', detalle: '' }];

    (st.sessions || []).forEach((s, i) => hc.sesiones.push({
      id: hcNuevoId('s'), numero: +s.number || i + 1, fecha: s.date || '', profesional: key || '', profNombre: d.docName || '',
      modalidad: (s.modality || '').toLowerCase().startsWith('v') ? 'virtual' : 'presencial',
      temas: s.summary || '', intervenciones: '', evolucion: '', tendencia: '', observaciones: '', proximos: '',
      creada, creadaPor: d.docName || '', importada: true, adendas: []
    }));
    if (['soapS', 'soapO', 'soapA', 'soapP'].some(k => (d[k] || '').trim())) {
      hc.sesiones.push({
        id: hcNuevoId('s'), numero: hc.sesiones.length + 1, fecha: new Date(creada).toISOString().slice(0, 10), profesional: key || '',
        profNombre: d.docName || '', modalidad: 'presencial', temas: d.soapS || '', intervenciones: d.soapP || '',
        evolucion: d.soapA || '', tendencia: '', observaciones: d.soapO || '', proximos: '', creada, creadaPor: d.docName || '',
        importada: true, adendas: [], nota: 'Importada desde nota SOAP anterior'
      });
    }
    lista.push(hc);
  });
  if (hcGuardarTodo(lista)) { try { localStorage.setItem(HC_MIGRADO, '1'); } catch {} }
}

/* ════════════════════════════════════════════════════════════
   DIÁLOGO DE CONFIRMACIÓN
   opts: { titulo, texto, ok, peligro, motivo:{label,req}, check:'texto' }
   Devuelve una Promesa: false | { ok:true, motivo }
   ════════════════════════════════════════════════════════════ */
function hcConfirm(o) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'pac-overlay hcx-ov abierto';
    ov.innerHTML = `
      <div class="pac-modal hcx-dlg" role="alertdialog" aria-modal="true" aria-labelledby="hcx-dlg-t" style="max-width:470px">
        <div class="pac-modal-head"><h3 id="hcx-dlg-t">${esc(o.titulo)}</h3></div>
        <p>${esc(o.texto || '')}</p>
        ${o.motivo ? `<div class="pac-f"><label for="hcx-dlg-m">${esc(o.motivo.label)}${o.motivo.req ? ' <span class="hcx-req">*</span>' : ''}</label>
          <textarea id="hcx-dlg-m" rows="3"></textarea><span class="hcx-err">Este dato es obligatorio.</span></div>` : ''}
        ${o.check ? `<label class="hcx-chk"><input type="checkbox" id="hcx-dlg-c"> <span>${esc(o.check)}</span></label>
          <span class="hcx-err" id="hcx-dlg-ce" style="display:none;margin-top:6px">Tenés que confirmar para continuar.</span>` : ''}
        <div class="pac-modal-foot">
          <button type="button" class="pac-btn-sec" id="hcx-dlg-no">Cancelar</button>
          <button type="button" class="btn-hc-new${o.peligro ? ' peligro' : ''}" id="hcx-dlg-si">${esc(o.ok || 'Confirmar')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const previo = document.activeElement;
    const cerrar = (v) => { ov.remove(); document.removeEventListener('keydown', onKey, true); if (previo && previo.focus) previo.focus(); resolve(v); };
    const aceptar = () => {
      let ok = true, motivo = '';
      if (o.motivo) {
        const m = ov.querySelector('#hcx-dlg-m'); motivo = m.value.trim();
        const bad = o.motivo.req && !motivo;
        m.closest('.pac-f').classList.toggle('err', bad); if (bad) { m.focus(); ok = false; }
      }
      if (o.check) {
        const bad = !ov.querySelector('#hcx-dlg-c').checked;
        ov.querySelector('#hcx-dlg-ce').style.display = bad ? 'block' : 'none'; if (bad) ok = false;
      }
      if (ok) cerrar({ ok: true, motivo });
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(false); } };
    document.addEventListener('keydown', onKey, true);
    ov.querySelector('#hcx-dlg-no').onclick = () => cerrar(false);
    ov.querySelector('#hcx-dlg-si').onclick = aceptar;
    setTimeout(() => (ov.querySelector('#hcx-dlg-m') || ov.querySelector('#hcx-dlg-si')).focus(), 30);
  });
}

/* ════════════════════════════════════════════════════════════
   NAVEGACIÓN ENTRE LISTADO Y HISTORIA
   ════════════════════════════════════════════════════════════ */
const hcVer = (id) => { window.location.href = `historia_clinica.html?hc=${encodeURIComponent(id)}`; };
/** Compatibilidad con pacientes.js */
const abrirHistoriaId = hcVer;

async function hcCrearPara(pacId) {
  const p = pacPorId(pacId), u = hcUser();
  if (!p) return;
  if (!u.key) { pacToast('Iniciá sesión en el panel profesional.'); return; }
  const ya = hcPorPaciente(pacId);
  if (ya) { hcVer(ya.id); return; }
  if (!hcPuede(null, p)) { pacToast('Este paciente está a cargo de otra profesional.'); return; }
  const r = await hcConfirm({
    titulo: 'Crear historia clínica',
    texto: `Se creará la historia clínica de ${p.nombre}, a cargo de ${u.nombre}.\nQuedarán registrados la fecha de creación y tu usuario.`,
    ok: 'Crear historia'
  });
  if (!r) return;
  const lista = getHCs(), hc = hcNueva(p, u);
  lista.push(hc);
  if (!hcGuardarTodo(lista)) { pacToast('No se pudo guardar: almacenamiento insuficiente.'); return; }
  hcVer(hc.id);
}

/* ════════════════════════════════════════════════════════════
   LISTADO (sección "Historias Clínicas" del panel)
   ════════════════════════════════════════════════════════════ */
let hcxFiltro = 'todas', hcxBusca = '', hcxOrden = 'nombre';

function hcFilas() {
  const pacs = getPacs(), hcs = getHCs(), usadas = new Set();
  const filas = pacs.map(p => { const hc = hcs.find(h => h.pacienteId === p.id) || null; if (hc) usadas.add(hc.id); return { p, hc }; });
  hcs.filter(h => !usadas.has(h.id)).forEach(hc => filas.push({ p: hcPaciente(hc), hc }));
  return filas;
}
const hcEstadoDe = (f) => (!f.hc ? 'sin' : f.hc.estado === 'cerrada' ? 'cerrada' : 'activa');
const hcFechaCorta = (ts) => ts ? new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }) : '—';

function renderHistorias() {
  const cont = document.getElementById('hcx-root');
  if (!cont) return;
  hcMigrar();
  const filas = hcFilas();
  const n = (e) => filas.filter(f => hcEstadoDe(f) === e).length;
  const chip = (id, label, c) => `<button class="cm-chip${hcxFiltro === id ? ' active' : ''}" onclick="hcxSetFiltro('${id}')">${label} <span class="cm-count">${c}</span></button>`;
  const hayDemo = getPacs().some(p => p.demo) || getHCs().some(h => h.demo);

  cont.innerHTML = `
    <div class="hcx-aviso" role="note"><span aria-hidden="true">🔒</span>
      <span>Información confidencial (Ley 26.529 de Derechos del Paciente y Ley 26.657 de Salud Mental). Se muestran sólo datos administrativos; el contenido clínico se ve dentro de cada historia.</span></div>
    <div class="pac-toolbar">
      <input type="search" class="pac-buscar" id="hcx-buscar" placeholder="🔍 Buscar por nombre, apellido o DNI…" value="${esc(hcxBusca)}"
             oninput="hcxSetBusca(this.value)" aria-label="Buscar paciente por nombre, apellido o DNI" autocomplete="off">
      <div class="cm-filtros" role="group" aria-label="Filtrar por estado de la historia">
        ${chip('todas', '📋 Todos', filas.length)}${chip('activa', '🟢 Activas', n('activa'))}${chip('cerrada', '⚪ Cerradas', n('cerrada'))}${chip('sin', '➕ Sin historia', n('sin'))}
      </div>
      <div class="pac-selects">
        <select onchange="hcxSetOrden(this.value)" aria-label="Ordenar">
          <option value="nombre" ${hcxOrden === 'nombre' ? 'selected' : ''}>Nombre (A–Z)</option>
          <option value="modificada" ${hcxOrden === 'modificada' ? 'selected' : ''}>Última modificación</option>
          <option value="sesiones" ${hcxOrden === 'sesiones' ? 'selected' : ''}>Más sesiones</option>
        </select>
      </div>
    </div>
    <div id="hcx-lista-wrap">${hcListaHTML(filas)}</div>
    <p class="hcx-pie">${hayDemo
      ? 'Hay datos ficticios de demostración cargados. <button class="hcx-link" onclick="hcQuitarDemo()">Quitar datos de demostración</button>'
      : 'Para probar el módulo: <button class="hcx-link" onclick="hcCargarDemo()">cargar datos ficticios de demostración</button>'}</p>`;
}

function hcListaHTML(filas) {
  const q = pacNorm(hcxBusca), qd = hcxBusca.replace(/[.\s]/g, '');
  let lista = filas.filter(f => {
    if (hcxFiltro !== 'todas' && hcEstadoDe(f) !== hcxFiltro) return false;
    if (!q) return true;
    return pacNorm(f.p.nombre).includes(q) || (qd && String(f.p.dni || '').replace(/[.\s]/g, '').includes(qd));
  });
  const ord = {
    nombre: (a, b) => pacNorm(a.p.nombre).localeCompare(pacNorm(b.p.nombre)),
    modificada: (a, b) => ((b.hc && b.hc.modificada) || 0) - ((a.hc && a.hc.modificada) || 0),
    sesiones: (a, b) => (b.hc ? hcSesionesVigentes(b.hc).length : -1) - (a.hc ? hcSesionesVigentes(a.hc).length : -1)
  };
  lista.sort(ord[hcxOrden] || ord.nombre);
  if (!lista.length) {
    return filas.length
      ? `<div class="feed-empty"><span class="feed-empty-icon">🔍</span>Ningún paciente coincide con la búsqueda o el filtro.</div>`
      : `<div class="feed-empty"><span class="feed-empty-icon">📋</span>Todavía no hay pacientes cargados.<br><small>Agregalos desde la sección Pacientes para crear sus historias clínicas.</small></div>`;
  }
  const filtrando = q || hcxFiltro !== 'todas';
  return `<div class="pac-lista">${lista.map(hcFilaHTML).join('')}</div>` +
    (filtrando ? `<p class="pac-contador">Mostrando ${lista.length} de ${filas.length} pacientes</p>` : '');
}

function hcFilaHTML(f) {
  const { p, hc } = f, est = hcEstadoDe(f), edad = pacEdad(p);
  const permitido = hc ? hcPuede(hc, null) : hcPuede(null, p);
  const resp = HC_PROFS[hc ? hc.profesional : p.profesional];
  const badges = { activa: '<span class="hcx-badge activa">Activa</span>', cerrada: '<span class="hcx-badge cerrada">Cerrada</span>', sin: '<span class="hcx-badge sin">Sin historia</span>' };
  let accion;
  if (!permitido) accion = `<button class="pac-btn-sec" disabled title="A cargo de ${esc(resp ? resp.nombre : 'otra profesional')}">🔒 Reservada</button>`;
  else if (hc) accion = `<button class="btn-hc-open" onclick="hcVer('${hc.id}')">${est === 'cerrada' ? 'Ver historia' : 'Abrir historia'}</button>`;
  else accion = `<button class="btn-hc-new" onclick="hcCrearPara('${p.id}')">Crear historia</button>`;
  return `
    <article class="pac-card hcx-row" style="cursor:default">
      <div class="pac-avatar" aria-hidden="true">${esc((p.nombre || '?').charAt(0).toUpperCase())}</div>
      <div class="pac-info">
        <div class="pac-nombre">${esc(p.nombre)} ${badges[est]}${p.demo ? ' <span class="hcx-badge reservada">Demo</span>' : ''}</div>
        <div class="pac-meta">
          ${p.dni ? `<span>🪪 DNI ${esc(p.dni)}</span>` : ''}
          ${edad != null ? `<span>🎂 ${edad} años</span>` : ''}
          ${resp ? `<span>👩‍⚕️ ${esc(resp.corto)}</span>` : ''}
          ${hc ? `<span>🗂️ ${esc(hc.numero || '')}</span><span>📅 Creada: ${hcFechaCorta(hc.creada)}</span><span>✏️ Modificada: ${hcFechaCorta(hc.modificada)}</span>` : ''}
        </div>
      </div>
      ${hc ? `<div class="pac-ses"><span class="pac-ses-n">${hcSesionesVigentes(hc).length}</span><span class="pac-ses-l">sesiones</span></div>` : ''}
      <div class="hcx-row-act">${accion}</div>
    </article>`;
}

function hcxSetFiltro(f) { hcxFiltro = f; renderHistorias(); }
function hcxSetOrden(v)  { hcxOrden = v;  renderHistorias(); }
function hcxSetBusca(v) {
  hcxBusca = v;
  const w = document.getElementById('hcx-lista-wrap');
  if (w) w.innerHTML = hcListaHTML(hcFilas());
}

/* ════════════════════════════════════════════════════════════
   DATOS FICTICIOS DE DEMOSTRACIÓN (marcados con demo:true)
   ════════════════════════════════════════════════════════════ */
function hcCargarDemo() {
  const u = hcUser();
  if (!u.key) { pacToast('Iniciá sesión para cargar la demostración.'); return; }
  const DIA = 864e5, hoy = Date.now();
  const iso = (dias) => new Date(hoy - dias * DIA).toISOString().slice(0, 10);
  const pacs = getPacs(), lista = getHCs();
  const mkP = (nombre, dni, nac, motivo, estado) => ({ id: hcNuevoId('p'), nombre, dni, nacimiento: nac, edad: '', telefono: '381 555 0100',
    email: '', obraSocial: 'Particular', emergencia: 'Familiar directo · 381 555 0101', profesional: u.key, modalidad: 'presencial',
    estado, fechaInicio: iso(100), motivo, notas: '', sesiones: [], creado: hoy, demo: true });
  const p1 = mkP('Lucía Fernández Ortiz', '99000001', '1991-04-12', 'Ansiedad asociada al ámbito laboral.', 'activo');
  const p2 = mkP('Martín Paredes Vega', '99000002', '1985-09-03', 'Dificultades de pareja tras una mudanza.', 'alta');
  const p3 = mkP('Camila Rojas Medina', '99000003', '2000-01-25', 'Consulta por estrés académico.', 'activo');
  pacs.push(p1, p2, p3);
  try { localStorage.setItem('ms_pacientes', JSON.stringify(pacs)); } catch { pacToast('Sin espacio de almacenamiento.'); return; }

  const ses = (hc, n, dias, temas, interv, evo, tend, obs, prox) => hc.sesiones.push({
    id: hcNuevoId('s'), numero: n, fecha: iso(dias), profesional: u.key, profNombre: u.nombre, modalidad: 'presencial',
    temas, intervenciones: interv, evolucion: evo, tendencia: tend, observaciones: obs, proximos: prox,
    creada: hoy - dias * DIA, creadaPor: u.nombre, adendas: []
  });
  const num0 = hcNumero();
  let corr = 0;
  const base = (p, dias) => hcNueva(p, u, { demo: true, numero: num0.replace(/\d+$/, m => String(+m + corr++).padStart(3, '0')),
    creada: hoy - dias * DIA, modificada: hoy - 2 * DIA, pacSnap: hcSnap(p) });

  const h1 = base(p1, 90);
  h1.motivo = { motivo: 'Refiere preocupación excesiva y dificultad para desconectarse del trabajo desde hace aproximadamente seis meses.', demanda: 'Quiere aprender a manejar la ansiedad y mejorar su descanso.' };
  h1.antecedentes = { personales: 'Licenciada en administración. Vive con su pareja. Buena red de apoyo.', familiares: 'Madre con antecedentes de ansiedad.', salud: 'Sin enfermedades relevantes.', medicacion: 'No toma medicación.' };
  h1.evaluacion = { fecha: iso(88), estadoEmocional: 'Ánimo ansioso, colaboradora, discurso fluido.', observaciones: 'Tensión corporal marcada. Juicio conservado. Sin indicadores de riesgo.', otros: 'Se acuerda continuar con evaluación durante las primeras sesiones.' };
  h1.objetivos = { objetivos: '1) Reducir la rumiación laboral.\n2) Establecer rutinas de descanso.\n3) Incorporar técnicas de regulación emocional.' };
  h1.plan = { plan: 'Psicoeducación sobre ansiedad, registro de pensamientos y entrenamiento en respiración.', enfoque: 'TCC', frecuencia: 'Semanal', revision: iso(-30) };
  ses(h1, 1, 88, 'Presentación del proceso y motivo de consulta.', 'Entrevista inicial y encuadre.', 'Se muestra receptiva.', 'estable', 'Ansiedad anticipatoria frecuente.', 'Registro diario de situaciones de ansiedad.');
  ses(h1, 2, 74, 'Rutinas laborales y descanso.', 'Psicoeducación y registro de pensamientos.', 'Logra identificar disparadores.', 'mejoria', '', 'Practicar respiración diafragmática.');
  ses(h1, 3, 60, 'Conflicto con la jefatura.', 'Reestructuración cognitiva.', 'Semana difícil, aumento de tensión.', 'dificultad', 'Se trabajó la autoexigencia.', 'Revisar el registro semanal.');
  ses(h1, 4, 30, 'Límites en el trabajo.', 'Entrenamiento asertivo.', 'Pone un límite horario por primera vez.', 'mejoria', '', 'Sostener los límites acordados.');
  ses(h1, 5, 8, 'Balance del proceso.', 'Revisión de objetivos.', 'Mejor sueño y menos rumiación.', 'mejoria', '', 'Espaciar encuentros si se mantiene.');
  h1.auditoria.push({ ts: hoy - 2 * DIA, por: u.nombre, accion: 'Nueva sesión', detalle: 'Sesión N° 5' });

  const h2 = base(p2, 150);
  h2.motivo = { motivo: 'Dificultades de comunicación en la pareja tras una mudanza.', demanda: 'Mejorar el diálogo con su pareja.' };
  h2.objetivos = { objetivos: 'Mejorar la comunicación y acordar tareas del hogar.' };
  h2.plan = { plan: 'Entrenamiento en comunicación y ejercicios entre sesiones.', enfoque: 'Sistémica', frecuencia: 'Quincenal', revision: '' };
  ses(h2, 1, 140, 'Historia de la pareja.', 'Entrevista inicial.', 'Disposición al cambio.', 'estable', '', 'Observar patrones de discusión.');
  ses(h2, 2, 110, 'Pautas de comunicación.', 'Role-playing.', 'Aplica lo practicado.', 'mejoria', '', 'Mantener acuerdos.');
  ses(h2, 3, 70, 'Cierre del proceso.', 'Revisión de logros.', 'Objetivos cumplidos.', 'mejoria', '', 'Alta terapéutica.');
  h2.estado = 'cerrada';
  h2.cierre = { fecha: iso(70), motivo: 'Alta terapéutica', resumen: 'Se cumplieron los objetivos propuestos. Proceso finalizado de común acuerdo.', por: u.nombre, ts: hoy - 70 * DIA };
  h2.auditoria.push({ ts: hoy - 70 * DIA, por: u.nombre, accion: 'Cierre de la historia clínica', detalle: 'Alta terapéutica' });

  lista.push(h1, h2);
  if (!hcGuardarTodo(lista)) { pacToast('Sin espacio de almacenamiento.'); return; }
  renderHistorias();
  pacToast('Datos ficticios cargados.', true);
}

async function hcQuitarDemo() {
  const r = await hcConfirm({ titulo: 'Quitar datos de demostración',
    texto: 'Se quitarán únicamente los pacientes e historias ficticias de demostración. Tus registros reales no se tocan.', ok: 'Quitar demostración', peligro: true });
  if (!r) return;
  try {
    localStorage.setItem('ms_pacientes', JSON.stringify(getPacs().filter(p => !p.demo)));
    localStorage.setItem(HC_KEY, JSON.stringify(getHCs().filter(h => !h.demo)));
  } catch {}
  renderHistorias();
  pacToast('Datos de demostración quitados.');
}

document.addEventListener('DOMContentLoaded', hcMigrar);
