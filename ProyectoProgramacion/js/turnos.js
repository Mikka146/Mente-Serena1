/* ============================================================
   TURNOS.JS — Módulo de reserva de turnos
   Integrado en index.html como sección dentro de #sec-turnos
   Reemplaza initTurnos(), pedirTurno() de mente_serena.js
   Comparte localStorage con el resto del sistema (ms_turnos)
   ============================================================ */

/* ────────────────────────────────────────────────────────────
   NAMESPACE — evita conflictos con mente_serena.js
   ──────────────────────────────────────────────────────────── */
const Turnos = (() => {

  /* ── Configuración de profesionales ────────────────────────
     Espeja exactamente los datos de mente_serena.js (admin-name)
     y el índice de PROFESIONALES del sistema                  */
  const PROFS = {
    daiana: {
      nombre:      'Lic. Daiana Bazan',
      esp:         'Psicología Clínica · Adultos',
      inicial:     'D',
      diasSemana:  [1, 2, 3, 4, 5],      // Lun a Vie
      franja:      'tarde',              // atiende de tarde: 16 a 20 hs
      diasLabel:   'Lun a Vie',
      horarioLabel:'Tarde · 16 a 20 hs',
      avatarStyle: ''
    },
    micaela: {
      nombre:      'Lic. Micaela Alvarado',
      esp:         'Psicología Clínica · Adultos',
      inicial:     'M',
      diasSemana:  [1, 2, 3, 4, 5],      // Lun a Vie
      franja:      'manana',             // atiende de mañana: 8 a 12 hs
      diasLabel:   'Lun a Vie',
      horarioLabel:'Mañana · 8 a 12 hs',
      avatarStyle: 'background:linear-gradient(135deg,var(--celeste),var(--morado))'
    }
  };

  /* ── Franjas horarias — turnos de 50 minutos ─────────────────
     Mañana: 08:00-12:00 (Lic. Micaela Alvarado)
     Tarde:  16:00-20:00 (Lic. Daiana Bazan)                    */
  const DURACION_TURNO = 50; // minutos
  const FRANJA = {
    manana: _slots(8,  12, DURACION_TURNO),
    tarde:  _slots(16, 20, DURACION_TURNO)
  };

  /* ── Política de cancelación ─────────────────────────────────
     El paciente puede cancelar su turno hasta 24 hs antes del
     horario reservado. Pasado ese límite debe contactar al equipo. */
  const HORAS_LIMITE_CANCELACION = 24;
  const TZ_AR = 'America/Argentina/Buenos_Aires';

  /* ── Mensajes de logro al reservar ─────────────────────────*/
  const MENSAJES = [
    '🌸 ¡Primer paso dado! Te esperamos.',
    '💜 Tu bienestar importa. Hasta pronto.',
    '🌿 Reserva recibida. El equipo te contactará.',
    '✨ ¡Excelente decisión! Te vemos pronto.',
    '🌸 Tu espacio está reservado. Cuidate.'
  ];

  /* ── Nombres de días y meses en español ──────────────────── */
  const DIAS_C = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const DIAS_L = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const MESES_C = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const MESES_L = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  /* ── Estado de la reserva en curso ─────────────────────────*/
  let R = _resetR();   // objeto de reserva
  let paso = 1;        // paso activo del flujo
  let vistaAct = 'reservar';   // 'reservar' | 'mis'  (pestaña activa de la sección)
  let _confirmandoId = null;   // id del turno que espera confirmación de cancelación
  let _ultimoId = null;        // id del último turno reservado (para el comprobante)
  let _pollInterval = null;    // intervalo que vigila si el profesional confirmó algún turno

  /* ──────────────────────────────────────────────────────────
     HELPERS PRIVADOS
     ──────────────────────────────────────────────────────────*/

  /** Genera horarios de inicio cada `duracionMin` minutos entre
   *  ini (incl) y fin (excl), de modo que cada turno completo
   *  (inicio + duración) entre dentro de la franja. */
  function _slots(ini, fin, duracionMin = 50) {
    const arr = [];
    let cursor = ini * 60;
    const limite = fin * 60;
    while (cursor + duracionMin <= limite) {
      arr.push(_pad(Math.floor(cursor / 60)) + ':' + _pad(cursor % 60));
      cursor += duracionMin;
    }
    return arr;
  }

  /** Rellena con cero a la izquierda */
  function _pad(n) { return String(n).padStart(2,'0'); }

  /** Escapa HTML para evitar XSS */
  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /** Objeto de reserva en blanco */
  function _resetR() {
    return {
      prof: null, tipo: null, fechaISO: null, fechaLabel: null,
      hora: null, nombre: '', edad: '', tel: '', email: '',
      motivo: '', modalidad: null
    };
  }

  /** Lee turnos del localStorage (misma clave que mente_serena.js) */
  function _getTurnos() {
    try { return JSON.parse(localStorage.getItem('ms_turnos')) || []; } catch { return []; }
  }

  /** Guarda turnos (misma clave que mente_serena.js) */
  function _saveTurnos(arr) {
    try { localStorage.setItem('ms_turnos', JSON.stringify(arr)); } catch {}
  }

  /** Muestra un toast de validación */
  let _toastT = null;
  function _toast(msg, ok = false) {
    const t = document.getElementById('turnos-toast');
    if (!t) return;
    if (_toastT) clearTimeout(_toastT);
    t.textContent = msg;
    t.className = 'turnos-toast visible' + (ok ? ' ok' : '');
    _toastT = setTimeout(() => t.classList.remove('visible'), 3500);
  }

  /** Obtiene el valor de un input por id */
  function _val(id) {
    const el = document.getElementById('t-' + id);
    return el ? el.value.trim() : '';
  }

  /* ──────────────────────────────────────────────────────────
     HELPERS DE "MIS TURNOS" Y CANCELACIÓN
     ──────────────────────────────────────────────────────────*/

  /** Turnos que no ocupan horario: los cancelados liberan el lugar */
  function _ocupa(t) { return t.estado !== 'cancelado'; }

  /** Normaliza la hora ("16:00" o, en datos viejos, el número 16) */
  function _horaStr(h) {
    return typeof h === 'number' ? _pad(h) + ':00' : String(h || '00:00');
  }

  /** Momento exacto del turno (ms). La fecha/hora guardadas son de
   *  Argentina (UTC-3), así el cálculo no depende del huso del equipo. */
  function _turnoTs(t) {
    return new Date(`${t.dia}T${_horaStr(t.hora)}:00-03:00`).getTime();
  }

  /** ¿El turno pertenece a la persona con sesión iniciada?
   *  Los turnos nuevos guardan la cuenta; los anteriores (sin cuenta)
   *  se reconocen por coincidir el email cargado con el de la cuenta. */
  function _esMio(t) {
    const s = getSesion();
    if (!s) return false;
    if (t.cuenta) return String(t.cuenta).toLowerCase() === String(s.usuario || '').toLowerCase();
    return !!t.email && String(t.email).toLowerCase() === String(s.correo || '').toLowerCase();
  }

  /** 'cancelado' | 'pasado' | 'pendiente' | 'confirmado' */
  function _estadoVis(t) {
    if (t.estado === 'cancelado') return 'cancelado';
    if (_turnoTs(t) < Date.now()) return 'pasado';
    return t.estado === 'confirmado' ? 'confirmado' : 'pendiente';
  }

  /** Cancelable = sigue activo y faltan al menos 24 hs */
  function _puedeCancelar(t) {
    const ms = _turnoTs(t) - Date.now();
    return _estadoVis(t) !== 'cancelado' && _estadoVis(t) !== 'pasado'
        && ms >= HORAS_LIMITE_CANCELACION * 3600000;
  }

  /** "miércoles, 30 de septiembre, 16:00 hs" en hora argentina */
  function _fmtAR(ts) {
    return new Date(ts).toLocaleString('es-AR', {
      timeZone: TZ_AR, weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit', hour12: false
    }) + ' hs';
  }

  /** "Miércoles 30 de Septiembre" a partir del ISO guardado */
  function _fmtDia(iso) {
    const f = new Date(iso + 'T12:00:00');
    return `${DIAS_L[f.getDay()]} ${f.getDate()} de ${MESES_L[f.getMonth()]}`;
  }

  /** Muestra en la pestaña "Mis turnos" cuántos turnos próximos hay */
  function _actualizarContador() {
    const el = document.getElementById('t-tab-count');
    if (!el) return;
    const n = _getTurnos().filter(t => _esMio(t) && ['pendiente','confirmado'].includes(_estadoVis(t))).length;
    el.textContent = n || '';
    el.classList.toggle('app-hidden', !n);
  }

  /* ──────────────────────────────────────────────────────────
     CONSTRUCCIÓN DEL HTML DEL MÓDULO
     Se inyecta dentro de #sec-turnos cuando se activa la sección
     ──────────────────────────────────────────────────────────*/

  /**
   * Genera el HTML completo del módulo de turnos.
   * Reutiliza todas las clases de mente_serena.css y turnos.css.
   */
  function _buildHTML() {
    /* Botones de profesionales */
    const profsHTML = Object.entries(PROFS).map(([id, p]) => `
      <div class="prof-card" id="tprof-${id}" onclick="Turnos.selProf('${id}')">
        <div class="prof-avatar" ${p.avatarStyle ? `style="${p.avatarStyle}"` : ''}>${p.inicial}</div>
        <div class="prof-nombre">${_esc(p.nombre)}</div>
        <div class="prof-especialidad">${_esc(p.esp)}</div>
        <div class="prof-disponible">● Disponible</div>
        <div class="prof-dias">${_esc(p.diasLabel)} — ${_esc(p.horarioLabel)}</div>
      </div>`).join('');

    return `
    <!-- ══ MÓDULO DE TURNOS — Mente Serena ══ -->

    <!-- Pestañas: reservar / ver y cancelar mis turnos -->
    <div class="turnos-tabs" role="tablist" aria-label="Turnos">
      <button class="turnos-tab activo" id="t-tab-reservar" role="tab" aria-selected="true"  onclick="Turnos.vista('reservar')">🌸 Reservar turno</button>
      <button class="turnos-tab"        id="t-tab-mis"      role="tab" aria-selected="false" onclick="Turnos.vista('mis')">📋 Mis turnos <span class="turnos-tab-count app-hidden" id="t-tab-count"></span></button>
    </div>

    <!-- ── VISTA: RESERVAR (flujo de 4 pasos) ── -->
    <div id="t-vista-reservar">

    <!-- Stepper visual de pasos -->
    <div class="turnos-stepper">
      ${[['1','Profesional'],['2','Fecha y hora'],['3','Tus datos'],['4','Confirmar']].map(([n,l],i) =>
        `<div class="step-item${i===0?' activo':''}" id="t-step-${n}">
          <div class="step-num">${n}</div>
          <div class="step-label">${l}</div>
        </div>`
      ).join('')}
    </div>

    <!-- ── PASO 1: Elegir profesional ── -->
    <div class="turno-panel activo" id="t-panel-1">
      <div class="section-title">Elegí tu <em style="font-style:italic;color:var(--morado-d)">profesional</em></div>
      <p style="color:var(--text-s);font-size:0.87rem;margin-bottom:18px;">Ambas atienden de forma presencial y virtual en Bella Vista, Tucumán.</p>
      <div class="prof-grid">${profsHTML}</div>
      <div class="nav-btns">
        <span></span>
        <button class="btn-continuar" id="t-btn-sig1" onclick="Turnos.ir(2)" disabled>Continuar →</button>
      </div>
    </div>

    <!-- ── PASO 2: Fecha y horario ── -->
    <div class="turno-panel" id="t-panel-2">
      <div class="prof-mini" id="t-mini-2">
        <div class="prof-mini-avatar" id="t-m2-av"></div>
        <div><strong id="t-m2-nm"></strong><div style="font-size:0.73rem;color:var(--text-s)" id="t-m2-es"></div></div>
      </div>

      <div class="turnos-section-title">🌅 Turno</div>
      <div class="turnos-section-sub">Mañana 08:00–12:00 · Tarde/Noche 16:00–20:00 · Sesiones de 50 min</div>
      <div class="turno-tipo-grid">
        <div class="turno-tipo-btn" id="t-tipo-manana" onclick="Turnos.selTipo('manana')">
          <div class="turno-tipo-icon">🌅</div>
          <div class="turno-tipo-label">Mañana</div>
          <div class="turno-tipo-hora">08:00 — 12:00</div>
        </div>
        <div class="turno-tipo-btn" id="t-tipo-tarde" onclick="Turnos.selTipo('tarde')">
          <div class="turno-tipo-icon">🌙</div>
          <div class="turno-tipo-label">Tarde / Noche</div>
          <div class="turno-tipo-hora">16:00 — 20:00</div>
        </div>
      </div>

      <div class="turnos-section-title">📅 Fecha</div>
      <div class="turnos-section-sub">Próximos días hábiles disponibles para la profesional</div>
      <div class="calendario-scroll">
        <div class="calendario-dias" id="t-cal"></div>
      </div>

      <div class="turnos-section-title">🕐 Horario</div>
      <div class="horarios-legend">
        <div class="legend-item"><div class="legend-dot disponible"></div>Disponible</div>
        <div class="legend-item"><div class="legend-dot seleccionado"></div>Seleccionado</div>
        <div class="legend-item"><div class="legend-dot ocupado"></div>Ocupado</div>
      </div>
      <div class="horarios-grid" id="t-horarios"></div>

      <div class="nav-btns">
        <button class="btn-volver" onclick="Turnos.ir(1)">← Volver</button>
        <button class="btn-continuar" id="t-btn-sig2" onclick="Turnos.ir(3)" disabled>Continuar →</button>
      </div>
    </div>

    <!-- ── PASO 3: Datos del paciente ── -->
    <div class="turno-panel" id="t-panel-3">
      <div class="prof-mini" id="t-mini-3">
        <div class="prof-mini-avatar" id="t-m3-av"></div>
        <div><strong id="t-m3-nm"></strong><div style="font-size:0.73rem;color:var(--text-s)" id="t-m3-fe"></div></div>
      </div>

      <div class="turnos-wrap" style="padding:24px 22px">
        <div class="form-dos-col">

          <div class="form-group-u">
            <label for="t-nombre">Nombre completo *</label>
            <input type="text" id="t-nombre" placeholder="Ej: Ana García" autocomplete="name"/>
          </div>

          <div class="form-group-u">
            <label for="t-edad">Edad *</label>
            <input type="number" id="t-edad" placeholder="Ej: 28" min="1" max="120"/>
          </div>

          <div class="form-group-u">
            <label for="t-tel">Teléfono / WhatsApp *</label>
            <input type="tel" id="t-tel" placeholder="Ej: 381 4123456" autocomplete="tel"/>
          </div>

          <div class="form-group-u">
            <label for="t-email">Email</label>
            <input type="email" id="t-email" placeholder="tu@email.com" autocomplete="email"/>
          </div>

          <div class="form-group-u form-full">
            <label>Modalidad *</label>
            <div class="modalidad-grid">
              <div class="modalidad-btn" id="t-mod-p" onclick="Turnos.selMod('presencial')">🏠 Presencial</div>
              <div class="modalidad-btn" id="t-mod-v" onclick="Turnos.selMod('virtual')">💻 Virtual</div>
            </div>
          </div>

          <div class="form-group-u form-full">
            <label for="t-motivo">Motivo de consulta *</label>
            <textarea class="turnos-form-textarea" id="t-motivo"
              placeholder="Contanos brevemente el motivo. Todo es confidencial."></textarea>
          </div>

        </div>
      </div>

      <div class="nav-btns">
        <button class="btn-volver" onclick="Turnos.ir(2)">← Volver</button>
        <button class="btn-continuar" onclick="Turnos.ir(4)">Revisar →</button>
      </div>
    </div>

    <!-- ── PASO 4: Confirmación ── -->
    <div class="turno-panel" id="t-panel-4">
      <div class="section-title">Revisá tu <em style="font-style:italic;color:var(--morado-d)">reserva</em></div>
      <div class="resumen-card" id="t-resumen"></div>
      <p class="anon-hint" style="margin-bottom:18px;">🔒 Tu información es <strong>100% confidencial</strong>. Solo el equipo de Mente Serena tiene acceso.</p>
      <div class="nav-btns">
        <button class="btn-volver" onclick="Turnos.ir(3)">← Editar datos</button>
        <button class="btn-continuar" onclick="Turnos.confirmar()">✓ Confirmar turno</button>
      </div>
    </div>

    <!-- ── PASO 5: Éxito ── -->
    <div class="turno-panel" id="t-panel-5">
      <div class="exito-wrap">
        <div class="exito-icon">✓</div>
        <div class="exito-titulo">¡Turno <em>confirmado</em>!</div>
        <p class="exito-sub" id="t-exito-sub"></p>
        <div class="exito-codigo" id="t-exito-cod">—</div>
        <div class="exito-btns">
          <button class="btn-comprobante" onclick="Turnos.comprobante()">📄 Descargar comprobante</button>
          <button class="btn-turno" onclick="Turnos.reiniciar()">🌸 Reservar otro turno</button>
          <button class="btn-volver" onclick="Turnos.vista('mis')">📋 Ver mis turnos</button>
        </div>
      </div>
    </div>

    </div><!-- /#t-vista-reservar -->

    <!-- ── VISTA: MIS TURNOS (ver y cancelar) ── -->
    <div id="t-vista-mis" class="app-hidden"></div>

    <!-- Toast global del módulo -->
    <div class="turnos-toast" id="turnos-toast"></div>
    `;
  }

  /* ──────────────────────────────────────────────────────────
     INICIALIZACIÓN
     ──────────────────────────────────────────────────────────*/

  /**
   * Inyecta el módulo en #sec-turnos y resetea el flujo.
   * Se llama desde initTurnos() en mente_serena.js.
   */
  function init() {
    const wrapper = document.getElementById('sec-turnos');
    if (!wrapper) return;
    if (wrapper.querySelector('.turnos-stepper')) {        // ya inicializado
      _actualizarContador();
      if (vistaAct === 'mis') renderMisTurnos();           // refresca (p. ej. el límite de 24 hs)
      return;
    }
    vistaAct = 'reservar';
    _confirmandoId = null;
    wrapper.innerHTML = _buildHTML();
    _irPaso(1);
    _actualizarContador();
    _iniciarAvisoConfirmacion();
  }

  /* ──────────────────────────────────────────────────────────
     AVISO AL PACIENTE CUANDO EL PROFESIONAL CONFIRMA EL TURNO
     Como el sistema no tiene backend (todo vive en localStorage
     del navegador), se vigila periódicamente ms_turnos: apenas
     un turno propio pasa a 'confirmado', se avisa una sola vez
     (queda marcado con avisoConfirmado) y se refresca la vista.
     ──────────────────────────────────────────────────────────*/

  /** Arranca el sondeo (una sola vez por carga de página) */
  function _iniciarAvisoConfirmacion() {
    if (_pollInterval) return;
    _chequearConfirmaciones();                       // chequeo inmediato al entrar
    _pollInterval = setInterval(_chequearConfirmaciones, 4000);
  }

  /** Busca turnos propios recién confirmados y avisa al paciente */
  function _chequearConfirmaciones() {
    const s = getSesion();
    if (!s) return;
    const turnos = _getTurnos();
    let huboCambio = false;

    turnos.forEach(t => {
      if (_esMio(t) && t.estado === 'confirmado' && !t.avisoConfirmado) {
        t.avisoConfirmado = true;
        huboCambio = true;
        const p = PROFS[t.profesional] || {};
        const msg = `✅ ¡Tu turno con ${t.profNombre || p.nombre || 'tu profesional'} ` +
                    `el ${_fmtDia(t.dia)} a las ${_horaStr(t.hora)} hs fue confirmado!`;
        // Toast del sitio general (visible en cualquier sección), con fallback al toast interno
        if (typeof toastInicio === 'function') toastInicio(msg);
        else _toast(msg, true);
      }
    });

    if (huboCambio) {
      _saveTurnos(turnos);
      _actualizarContador();
      if (vistaAct === 'mis') renderMisTurnos();      // refresca la tarjeta si está a la vista
    }
  }

  /* ──────────────────────────────────────────────────────────
     NAVEGACIÓN
     ──────────────────────────────────────────────────────────*/

  /**
   * Navega al paso indicado con validación previa.
   * @param {number} destino
   */
  function ir(destino) {
    if (destino > paso && !_validar(paso)) return;
    _prep(destino);
    _irPaso(destino);
  }

  /** Mueve la UI al paso indicado sin validar */
  function _irPaso(n) {
    document.querySelectorAll('.turno-panel').forEach(p => p.classList.remove('activo'));
    document.getElementById('t-panel-' + n)?.classList.add('activo');
    paso = n;
    _stepper(n);
    // Scroll suave al inicio de la sección
    document.getElementById('sec-turnos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Actualiza los indicadores del stepper */
  function _stepper(act) {
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById('t-step-' + i);
      if (!el) continue;
      el.classList.remove('activo','done');
      if (i < act) el.classList.add('done');
      if (i === act) el.classList.add('activo');
    }
  }

  /**
   * Prepara la UI de cada paso antes de mostrarlo.
   * @param {number} n
   */
  function _prep(n) {
    if (n === 2) _prepPaso2();
    if (n === 3) _prepPaso3();
    if (n === 4) _prepPaso4();
  }

  /* ──────────────────────────────────────────────────────────
     VALIDACIONES
     ──────────────────────────────────────────────────────────*/

  /**
   * Valida el paso actual antes de avanzar.
   * @param {number} p
   * @returns {boolean}
   */
  function _validar(p) {
    if (p === 1) {
      if (!R.prof) { _toast('⚠️ Elegí una profesional para continuar.'); return false; }
    }
    if (p === 2) {
      if (!R.tipo) { _toast('⚠️ Seleccioná el turno mañana o tarde.'); return false; }
      if (!R.fechaISO) { _toast('⚠️ Elegí una fecha disponible.'); return false; }
      if (!R.hora) { _toast('⚠️ Seleccioná un horario.'); return false; }
    }
    if (p === 3) return _validarForm();
    return true;
  }

  /** Valida todos los campos del formulario de datos */
  function _validarForm() {
    // Leer valores
    R.nombre   = _val('nombre');
    R.edad     = _val('edad');
    R.tel      = _val('tel');
    R.email    = _val('email');
    R.motivo   = _val('motivo');

    // Limpiar marcas anteriores
    ['t-nombre','t-edad','t-tel','t-motivo'].forEach(id => {
      document.getElementById(id)?.classList.remove('input-invalido');
    });

    const err = [];
    if (!R.nombre) err.push('t-nombre');
    if (!R.edad || isNaN(+R.edad) || +R.edad < 1 || +R.edad > 120) err.push('t-edad');
    if (!R.tel || R.tel.length < 7) err.push('t-tel');
    if (!R.motivo || R.motivo.length < 10) err.push('t-motivo');

    if (!R.modalidad) { _toast('⚠️ Seleccioná la modalidad de consulta.'); return false; }

    if (err.length) {
      err.forEach(id => document.getElementById(id)?.classList.add('input-invalido'));
      _toast('⚠️ Completá los campos obligatorios marcados.');
      document.getElementById(err[0])?.scrollIntoView({ behavior:'smooth', block:'center' });
      return false;
    }
    return true;
  }

  /* ──────────────────────────────────────────────────────────
     PASO 1 — PROFESIONAL
     ──────────────────────────────────────────────────────────*/

  /**
   * Selecciona la profesional y habilita el botón de continuar.
   * @param {string} id — clave del objeto PROFS
   */
  function selProf(id) {
    R.prof = id;
    document.querySelectorAll('.prof-card').forEach(c => c.classList.remove('seleccionada'));
    document.getElementById('tprof-' + id)?.classList.add('seleccionada');
    document.getElementById('t-btn-sig1').disabled = false;
  }

  /* ──────────────────────────────────────────────────────────
     PASO 2 — FECHA Y HORARIO
     ──────────────────────────────────────────────────────────*/

  /** Actualiza la mini-card y genera el calendario al entrar al paso 2 */
  function _prepPaso2() {
    const p = PROFS[R.prof];
    if (!p) return;

    // Mini-card
    const av = document.getElementById('t-m2-av');
    if (av) { av.textContent = p.inicial; if (p.avatarStyle) av.style.cssText = p.avatarStyle; }
    const nm = document.getElementById('t-m2-nm'); if (nm) nm.textContent = p.nombre;
    const es = document.getElementById('t-m2-es'); if (es) es.textContent = p.esp;

    // Cada profesional atiende en una sola franja: se muestra solo esa
    // opción y se selecciona automáticamente.
    const btnManana = document.getElementById('t-tipo-manana');
    const btnTarde  = document.getElementById('t-tipo-tarde');
    if (btnManana) btnManana.style.display = p.franja === 'manana' ? '' : 'none';
    if (btnTarde)  btnTarde.style.display  = p.franja === 'tarde'  ? '' : 'none';
    if (R.tipo !== p.franja) selTipo(p.franja, true);

    // Calendario
    _buildCal(p.diasSemana);

    // Restaurar fecha si ya había
    if (R.fechaISO) {
      const btn = document.querySelector(`.dia-btn[data-fecha="${R.fechaISO}"]`);
      if (btn) _selFecha(R.fechaISO, btn);
    }
  }

  /**
   * Selecciona el tipo de turno (mañana / tarde).
   * @param {string} tipo
   * @param {boolean} [silent]
   */
  function selTipo(tipo, silent = false) {
    R.tipo = tipo;
    R.hora = null;
    document.getElementById('t-tipo-manana')?.classList.toggle('activo', tipo === 'manana');
    document.getElementById('t-tipo-tarde')?.classList.toggle('activo', tipo === 'tarde');
    if (R.fechaISO) _buildHorarios(R.fechaISO);
    _checkSig2();
  }

  /**
   * Genera los botones de días hábiles del calendario.
   * @param {number[]} dias — días de la semana en que atiende la profesional
   */
  function _buildCal(dias) {
    const cont = document.getElementById('t-cal');
    if (!cont) return;
    cont.innerHTML = '';
    const hoy = new Date();
    let agregados = 0, offset = 1; // empezar desde mañana

    while (agregados < 14 && offset < 90) {
      const f = new Date(hoy);
      f.setDate(hoy.getDate() + offset);
      offset++;
      const dow = f.getDay();
      if (!dias.includes(dow)) continue;

      const iso = f.toISOString().split('T')[0];
      const btn = document.createElement('button');
      btn.className = 'dia-btn';
      btn.dataset.fecha = iso;
      btn.innerHTML = `
        <span class="dia-nombre">${DIAS_C[dow]}</span>
        <span class="dia-num">${f.getDate()}</span>
        <span class="dia-mes">${MESES_C[f.getMonth()]}</span>`;

      if (iso === R.fechaISO) btn.classList.add('activo');
      btn.addEventListener('click', () => _selFecha(iso, btn));
      cont.appendChild(btn);
      agregados++;
    }
  }

  /**
   * Marca el día seleccionado y genera los horarios.
   * @param {string} iso
   * @param {HTMLElement} btnEl
   */
  function _selFecha(iso, btnEl) {
    R.fechaISO = iso;
    R.hora = null;

    // Label legible de la fecha
    const f = new Date(iso + 'T12:00:00');
    R.fechaLabel = `${DIAS_L[f.getDay()]} ${f.getDate()} de ${MESES_L[f.getMonth()]}`;

    // Marcar botón
    document.querySelectorAll('.dia-btn').forEach(b => b.classList.remove('activo'));
    btnEl.classList.add('activo');

    // Generar horarios si ya hay tipo
    if (R.tipo) {
      _buildHorarios(iso);
    } else {
      _toast('ℹ️ Elegí primero el turno mañana o tarde.');
    }

    _checkSig2();
  }

  /**
   * Genera los botones de horario para la fecha y franja elegidas.
   * Consulta localStorage para marcar los ocupados.
   * @param {string} iso
   */
  function _buildHorarios(iso) {
    const grid = document.getElementById('t-horarios');
    if (!grid) return;
    grid.innerHTML = '';

    const slots   = FRANJA[R.tipo] || [];
    const turnos  = _getTurnos();
    // Ocupados: misma profesional, mismo día, cualquier hora del día
    const ocupados = new Set(
      turnos
        .filter(t => _ocupa(t) && t.profesional === R.prof && t.dia === iso)
        .map(t => t.hora)
    );

    slots.forEach(slot => {
      const ocup = ocupados.has(slot);
      const btn  = document.createElement('button');
      btn.className     = 'hora-btn' + (ocup ? ' ocupado' : '');
      btn.disabled      = ocup;
      btn.dataset.hora  = slot;
      btn.innerHTML     = `${slot}<span class="hora-estado">${ocup ? 'Ocupado' : 'Libre'}</span>`;
      if (!ocup) btn.addEventListener('click', () => _selHora(slot, btn));
      if (slot === R.hora) btn.classList.add('activo');
      grid.appendChild(btn);
    });
  }

  /**
   * Marca el horario seleccionado.
   * @param {string} hora
   * @param {HTMLElement} btnEl
   */
  function _selHora(hora, btnEl) {
    R.hora = hora;
    document.querySelectorAll('.hora-btn').forEach(b => b.classList.remove('activo'));
    btnEl.classList.add('activo');
    _checkSig2();
  }

  /** Habilita/deshabilita el botón continuar del paso 2 */
  function _checkSig2() {
    const btn = document.getElementById('t-btn-sig2');
    if (btn) btn.disabled = !(R.tipo && R.fechaISO && R.hora);
  }

  /* ──────────────────────────────────────────────────────────
     PASO 3 — DATOS DEL PACIENTE
     ──────────────────────────────────────────────────────────*/

  /** Actualiza la mini-card del paso 3 con el resumen hasta ahora */
  function _prepPaso3() {
    const p = PROFS[R.prof];

    // Mini-card paso 3
    const av = document.getElementById('t-m3-av');
    if (av) { av.textContent = p.inicial; if (p.avatarStyle) av.style.cssText = p.avatarStyle; }
    const nm = document.getElementById('t-m3-nm'); if (nm) nm.textContent = p.nombre;
    const fe = document.getElementById('t-m3-fe');
    if (fe) fe.textContent = `${R.fechaLabel || '—'} · ${R.hora} · ${R.tipo === 'manana' ? '🌅 Mañana' : '🌙 Tarde'}`;

    // Restaurar valores del formulario
    _setInput('t-nombre', R.nombre);
    _setInput('t-edad',   R.edad);
    _setInput('t-tel',    R.tel);
    _setInput('t-email',  R.email);
    _setInput('t-motivo', R.motivo);

    if (R.modalidad) selMod(R.modalidad, true);
  }

  function _setInput(id, val) {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  }

  /**
   * Selecciona la modalidad de consulta.
   * @param {string} mod — 'presencial' | 'virtual'
   * @param {boolean} [silent]
   */
  function selMod(mod, silent = false) {
    R.modalidad = mod;
    document.getElementById('t-mod-p')?.classList.toggle('activo', mod === 'presencial');
    document.getElementById('t-mod-v')?.classList.toggle('activo', mod === 'virtual');
  }

  /* ──────────────────────────────────────────────────────────
     PASO 4 — RESUMEN Y CONFIRMACIÓN
     ──────────────────────────────────────────────────────────*/

  /** Construye el resumen de la reserva en el paso 4 */
  function _prepPaso4() {
    const p = PROFS[R.prof];
    const cont = document.getElementById('t-resumen');
    if (!cont) return;

    const franjaL  = R.tipo === 'manana' ? '🌅 Mañana' : '🌙 Tarde/Noche';
    const modalL   = R.modalidad === 'presencial' ? '🏠 Presencial' : '💻 Virtual';

    const filas = [
      ['Profesional',  p.nombre],
      ['Especialidad', p.esp],
      ['Fecha',        R.fechaLabel || '—'],
      ['Turno',        franjaL],
      ['Horario',      R.hora],
      ['Modalidad',    modalL],
      ['Paciente',     R.nombre],
      ['Edad',         R.edad + ' años'],
      ['Teléfono',     R.tel],
      ['Email',        R.email || '—'],
      ['Motivo',       R.motivo.length > 80 ? R.motivo.substring(0,80) + '…' : R.motivo]
    ];

    cont.innerHTML = `<div class="resumen-titulo">Detalles del turno</div>` +
      filas.map(([k,v]) => `
        <div class="resumen-fila">
          <span class="resumen-key">${_esc(k)}</span>
          <span class="resumen-val">${_esc(v)}</span>
        </div>`).join('');
  }

  /* ──────────────────────────────────────────────────────────
     CONFIRMAR TURNO
     ──────────────────────────────────────────────────────────*/

  /**
   * Guarda el turno en localStorage y muestra la pantalla de éxito.
   * Compatible con el formato que lee renderTurnosAdmin() en mente_serena.js.
   */
  function confirmar() {
    // Verificar que no fue tomado mientras completaba el formulario
    const turnos = _getTurnos();
    const yaExiste = turnos.some(t =>
      _ocupa(t) && t.profesional === R.prof && t.dia === R.fechaISO && t.hora === R.hora
    );

    if (yaExiste) {
      _toast('⚠️ Ese horario acaba de ser tomado. Elegí otro.');
      ir(2);
      return;
    }

    // Código de confirmación único
    const codigo = 'MS-' + Date.now().toString(36).toUpperCase().slice(-6);

    // Objeto de turno — compatible con mente_serena.js (getTurnos / saveTurnos)
    // Incluye los campos nuevos que renderTurnosAdmin() ya usará
    const sesionAct = getSesion();
    const nuevoTurno = {
      id:          Date.now(),
      codigo,
      cuenta:      sesionAct ? sesionAct.usuario : null,   // dueño de la reserva (para "Mis turnos")
      profesional: R.prof,
      profNombre:  PROFS[R.prof].nombre,
      dia:         R.fechaISO,
      hora:        R.hora,
      franja:      R.tipo,
      modalidad:   R.modalidad,
      usuario:     R.nombre,          // clave que ya usa renderTurnosAdmin()
      edad:        R.edad,
      telefono:    R.tel,
      email:       R.email,
      motivo:      R.motivo,
      estado:      'pendiente',
      fecha:       Date.now()
    };

    turnos.push(nuevoTurno);
    _saveTurnos(turnos);
    _actualizarContador();
    _ultimoId = nuevoTurno.id;

    // Pantalla de éxito
    const sub = document.getElementById('t-exito-sub');
    const cod = document.getElementById('t-exito-cod');
    const pNombre = PROFS[R.prof].nombre;
    if (sub) sub.textContent =
      `Tu solicitud con ${pNombre} para el ${R.fechaLabel} a las ${R.hora} fue registrada. ` +
      `El equipo te contactará para confirmar.`;
    if (cod) cod.textContent = `Código: ${codigo}`;

    _toast(MENSAJES[Math.floor(Math.random() * MENSAJES.length)], true);
    _irPaso(5);
  }

  /* ──────────────────────────────────────────────────────────
     MIS TURNOS — ver y cancelar
     ──────────────────────────────────────────────────────────*/

  /** Cambia entre las pestañas "Reservar" y "Mis turnos" */
  function vista(nombre) {
    vistaAct = nombre === 'mis' ? 'mis' : 'reservar';
    _confirmandoId = null;
    document.getElementById('t-vista-reservar')?.classList.toggle('app-hidden', vistaAct !== 'reservar');
    document.getElementById('t-vista-mis')?.classList.toggle('app-hidden', vistaAct !== 'mis');
    ['reservar','mis'].forEach(v => {
      const tab = document.getElementById('t-tab-' + v);
      tab?.classList.toggle('activo', v === vistaAct);
      tab?.setAttribute('aria-selected', v === vistaAct ? 'true' : 'false');
    });
    if (vistaAct === 'mis') renderMisTurnos();
    document.getElementById('sec-turnos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Dibuja una tarjeta de turno con su estado y acción disponible */
  function _cardMiTurno(t) {
    const est  = _estadoVis(t);
    const p    = PROFS[t.profesional] || {};
    const id   = _esc(String(t.id));
    const ts   = _turnoTs(t);
    const modal = t.modalidad === 'presencial' ? '🏠 Presencial' : t.modalidad === 'virtual' ? '💻 Virtual' : '';
    const badge = {
      pendiente:  '⏳ Pendiente',
      confirmado: '✓ Confirmado',
      cancelado:  '✕ Cancelado',
      pasado:     'Finalizado'
    }[est];

    let accion = '';
    if (est === 'pendiente' || est === 'confirmado') {
      if (_puedeCancelar(t)) {
        const limite = _fmtAR(ts - HORAS_LIMITE_CANCELACION * 3600000);
        accion = (_confirmandoId === String(t.id))
          ? `<div class="mt-confirm">
               <p>¿Querés cancelar este turno? El horario quedará libre para otras personas.</p>
               <div class="mt-btns">
                 <button class="btn-cancelar-si" onclick="Turnos.cancelar('${id}')">Sí, cancelar turno</button>
                 <button class="btn-volver" onclick="Turnos.noCancelar()">No, mantenerlo</button>
               </div>
             </div>`
          : `<div class="mt-accion">
               <button class="btn-cancelar-turno" onclick="Turnos.pedirCancelar('${id}')">Cancelar turno</button>
               <span class="mt-nota">Podés cancelar hasta el ${_esc(limite)}</span>
             </div>`;
      } else {
        accion = `<p class="mt-bloq">🔒 Este turno ya no se puede cancelar desde acá: faltan menos de ${HORAS_LIMITE_CANCELACION} hs. Si no podés asistir, comunicate con el equipo.</p>`;
      }
    } else if (est === 'cancelado' && t.canceladoEn) {
      accion = `<p class="mt-nota">Lo cancelaste el ${_esc(new Date(t.canceladoEn).toLocaleString('es-AR', { timeZone: TZ_AR, day:'numeric', month:'long', hour:'2-digit', minute:'2-digit', hour12:false }))} hs.</p>`;
    }

    return `
      <article class="mt-card mt-${est}">
        <div class="mt-head">
          <div class="mt-avatar" ${p.avatarStyle ? `style="${p.avatarStyle}"` : ''}>${_esc(p.inicial || '?')}</div>
          <div class="mt-quien">
            <strong>${_esc(t.profNombre || p.nombre || 'Profesional')}</strong>
            <span>${_esc(p.esp || '')}</span>
          </div>
          <span class="turno-estado-badge ${est}">${badge}</span>
        </div>
        <div class="mt-datos">
          <span>📅 ${_esc(_fmtDia(t.dia))}</span>
          <span>🕐 ${_esc(_horaStr(t.hora))} hs</span>
          ${modal ? `<span>${modal}</span>` : ''}
          ${t.codigo ? `<span class="mt-cod">${_esc(t.codigo)}</span>` : ''}
        </div>
        ${t.codigo ? `
          <div class="mt-comprobante-row">
            <button class="btn-comprobante" onclick="Turnos.comprobante('${id}')">📄 Descargar comprobante</button>
          </div>` : ''}
        ${accion}
      </article>`;
  }

  /** Dibuja la lista de turnos de la persona con sesión iniciada */
  function renderMisTurnos() {
    const cont = document.getElementById('t-vista-mis');
    if (!cont) return;

    const todos    = _getTurnos().filter(_esMio);
    const proximos = todos.filter(t => ['pendiente','confirmado'].includes(_estadoVis(t)))
                          .sort((a, b) => _turnoTs(a) - _turnoTs(b));
    const historial = todos.filter(t => ['cancelado','pasado'].includes(_estadoVis(t)))
                           .sort((a, b) => _turnoTs(b) - _turnoTs(a));

    if (!todos.length) {
      cont.innerHTML = `
        <div class="mt-vacio">
          <span class="mt-vacio-ico">🌿</span>
          <p>Todavía no tenés turnos reservados</p>
          <span>Cuando reserves uno, lo vas a ver acá y vas a poder cancelarlo.</span>
          <button class="btn-continuar" onclick="Turnos.vista('reservar')">Reservar un turno →</button>
        </div>`;
      return;
    }

    cont.innerHTML = `
      <div class="section-title">Mis <em style="font-style:italic;color:var(--morado-d)">turnos</em></div>
      <p class="mt-politica">Podés cancelar un turno hasta <strong>${HORAS_LIMITE_CANCELACION} hs antes</strong> del horario reservado. Pasado ese momento, comunicate con el equipo.</p>

      <h3 class="mt-sub">Próximos</h3>
      ${proximos.length
        ? `<div class="mt-lista">${proximos.map(_cardMiTurno).join('')}</div>`
        : `<p class="mt-nota mt-nada">No tenés turnos próximos.</p>`}

      ${historial.length ? `
        <h3 class="mt-sub">Historial</h3>
        <div class="mt-lista">${historial.map(_cardMiTurno).join('')}</div>` : ''}`;
  }

  /** Paso 1 de la cancelación: pide confirmación en la propia tarjeta */
  function pedirCancelar(id) {
    _confirmandoId = String(id);
    renderMisTurnos();
  }

  /** El usuario se arrepintió: vuelve la tarjeta a su estado normal */
  function noCancelar() {
    _confirmandoId = null;
    renderMisTurnos();
  }

  /** Paso 2: cancela de verdad, revalidando la regla de las 24 hs */
  function cancelar(id) {
    _confirmandoId = null;
    const turnos = _getTurnos();
    const idx = turnos.findIndex(t => String(t.id) === String(id));
    if (idx === -1) { renderMisTurnos(); return; }
    const t = turnos[idx];

    if (!_esMio(t)) { _toast('⚠️ No podés cancelar un turno de otra cuenta.'); renderMisTurnos(); return; }
    if (!_puedeCancelar(t)) {
      _toast(`⚠️ Ya no se puede cancelar: faltan menos de ${HORAS_LIMITE_CANCELACION} hs para el turno.`);
      renderMisTurnos();
      return;
    }

    turnos[idx].estado      = 'cancelado';
    turnos[idx].canceladoEn = Date.now();
    turnos[idx].canceladoPor = 'paciente';
    _saveTurnos(turnos);

    _actualizarContador();
    renderMisTurnos();
    _toast('✓ Turno cancelado. El horario quedó libre.', true);
  }

  /* ──────────────────────────────────────────────────────────
     COMPROBANTE DE TURNO (descarga como PDF)
     Requiere jsPDF (window.jspdf.jsPDF), cargado en index.html
     antes de este archivo.
     ──────────────────────────────────────────────────────────*/

  /**
   * Genera y descarga el comprobante del turno indicado, en PDF.
   * Sin argumento, usa el último turno reservado (pantalla de éxito).
   * @param {string|number} [id]
   */
  function comprobante(id) {
    const objetivo = id != null ? id : _ultimoId;
    const t = _getTurnos().find(x => String(x.id) === String(objetivo));
    if (!t) { _toast('⚠️ No se encontró el turno para generar el comprobante.'); return; }
    const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) { _toast('⚠️ No se pudo cargar el generador de PDF. Revisá tu conexión.'); return; }
    try {
      _generarComprobantePDF(t, jsPDFCtor);
    } catch (e) {
      console.error(e);
      _toast('⚠️ No se pudo generar el comprobante.');
    }
  }

  /** Construye el PDF del comprobante con jsPDF y dispara la descarga */
  function _generarComprobantePDF(t, jsPDFCtor) {
    const p = PROFS[t.profesional] || {};
    const est = _estadoVis(t);
    const estadoLabel = {
      pendiente:  'Pendiente de confirmación',
      confirmado: 'Confirmado',
      cancelado:  'Cancelado',
      pasado:     'Finalizado'
    }[est] || 'Pendiente de confirmación';
    const estadoRGB = {
      pendiente: [196,142,74], confirmado: [61,92,64],
      cancelado: [194,24,91],  pasado: [118,118,118]
    }[est] || [196,142,74];

    const W = 360, H = 500;       // pt — proporción tipo "recibo"
    const M = 28;                  // margen horizontal
    const doc = new jsPDFCtor({ unit: 'pt', format: [W, H] });

    // Fondo blanco
    doc.setFillColor(255,255,255);
    doc.rect(0, 0, W, H, 'F');

    // Franja superior de color (simula el degradé rosa→verde)
    doc.setFillColor(248,200,220);
    doc.rect(0, 0, W / 2, 74, 'F');
    doc.setFillColor(168,230,207);
    doc.rect(W / 2, 0, W / 2, 74, 'F');

    // Logo circular "MS"
    doc.setFillColor(255,255,255);
    doc.circle(40, 37, 17, 'F');
    doc.setTextColor(194,24,91);
    doc.setFont('helvetica','bold'); doc.setFontSize(13);
    doc.text('MS', 40, 41, { align:'center' });

    // Título y subtítulo
    doc.setTextColor(28,28,28);
    doc.setFont('helvetica','bold'); doc.setFontSize(16);
    doc.text('Mente Serena', 66, 33);
    doc.setTextColor(77,77,77);
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5);
    doc.text('Comprobante de turno', 66, 47);

    let y = 100;

    // Caja de código de reserva
    doc.setFillColor(245,245,245);
    doc.roundedRect(M, y, W - M*2, 46, 8, 8, 'F');
    doc.setTextColor(118,118,118);
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
    doc.text('CÓDIGO DE RESERVA', M + 12, y + 17);
    doc.setTextColor(194,24,91);
    doc.setFont('helvetica','bold'); doc.setFontSize(15);
    doc.text(t.codigo || '—', M + 12, y + 35);

    // Estado, esquina derecha de la caja
    doc.setTextColor(estadoRGB[0], estadoRGB[1], estadoRGB[2]);
    doc.setFont('helvetica','bold'); doc.setFontSize(8.5);
    doc.text(estadoLabel, W - M - 12, y + 27, { align:'right' });

    y += 66;

    // Filas de datos
    const filas = [
      ['Paciente',     t.usuario || '—'],
      ['Profesional',  t.profNombre || p.nombre || '—'],
      ['Especialidad', p.esp || '—'],
      ['Fecha',        _fmtDia(t.dia)],
      ['Hora',         _horaStr(t.hora) + ' hs'],
      ['Modalidad',    t.modalidad === 'presencial' ? 'Presencial' : t.modalidad === 'virtual' ? 'Virtual' : '—']
    ];

    filas.forEach(([k, v]) => {
      doc.setDrawColor(28,28,28); doc.setLineWidth(0.5);
      doc.setDrawColor(230,230,230);
      doc.line(M, y, W - M, y);
      y += 16;
      doc.setTextColor(118,118,118);
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
      doc.text(k.toUpperCase(), M, y);
      doc.setTextColor(28,28,28);
      doc.setFont('helvetica','bold'); doc.setFontSize(11);
      doc.text(String(v), M + 105, y);
      y += 14;
    });

    y += 10;
    doc.setDrawColor(220,220,220);
    doc.setLineDashPattern([3,2], 0);
    doc.line(M, y, W - M, y);
    doc.setLineDashPattern([], 0);

    y += 20;
    doc.setTextColor(77,77,77);
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
    const nota = 'Este comprobante certifica tu solicitud de turno en Mente Serena. Si el estado es ' +
      '"Pendiente de confirmación", el equipo se va a comunicar para confirmarlo. Tu información es confidencial.';
    const lineas = doc.splitTextToSize(nota, W - M*2);
    doc.text(lineas, M, y);
    y += lineas.length * 11 + 10;

    doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
    doc.setTextColor(118,118,118);
    doc.text('Generado el ' + _fmtAR(Date.now()), M, y);

    doc.save(`comprobante-${t.codigo || t.id}.pdf`);
  }

  /* ──────────────────────────────────────────────────────────
     REINICIAR
     ──────────────────────────────────────────────────────────*/

  /** Resetea el flujo y vuelve al paso 1 */
  function reiniciar() {
    R = _resetR();
    paso = 0;

    // Limpiar marcas visuales
    document.querySelectorAll('.prof-card').forEach(c => c.classList.remove('seleccionada'));
    document.querySelectorAll('.turno-tipo-btn').forEach(b => b.classList.remove('activo'));
    document.querySelectorAll('.dia-btn').forEach(b => b.classList.remove('activo'));
    document.querySelectorAll('.hora-btn').forEach(b => b.classList.remove('activo'));
    document.querySelectorAll('.modalidad-btn').forEach(b => b.classList.remove('activo'));

    // Limpiar inputs
    ['t-nombre','t-edad','t-tel','t-email','t-motivo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.classList.remove('input-invalido'); }
    });

    document.getElementById('t-btn-sig1').disabled = true;
    _irPaso(1);
  }

  /* ──────────────────────────────────────────────────────────
     API PÚBLICA
     ──────────────────────────────────────────────────────────*/
  return { init, ir, selProf, selTipo, selMod, confirmar, reiniciar,
           vista, renderMisTurnos, pedirCancelar, noCancelar, cancelar,
           comprobante };

})(); // fin IIFE Turnos


/* ────────────────────────────────────────────────────────────
   INTEGRACIÓN CON MENTE_SERENA.JS
   Reemplaza las funciones que ya llama launchUsuario()
   sin modificar nada más del sistema.
   ──────────────────────────────────────────────────────────── */

/**
 * initTurnos() — reemplaza la función original de mente_serena.js.
 * Inyecta el módulo de turnos en #sec-turnos.
 * Se llama desde launchUsuario() exactamente igual que antes.
 */
function initTurnos() {
  Turnos.init();
}

/**
 * pedirTurno() — ya no se usa (el flujo es visual y paso a paso),
 * pero se mantiene para no romper ninguna referencia en el HTML.
 */
function pedirTurno() {
  Turnos.confirmar();
}

/* ────────────────────────────────────────────────────────────
   ACTUALIZACIÓN DE renderTurnosAdmin()
   Se redefine para mostrar los nuevos campos (profesional,
   franja, modalidad, motivo, teléfono) manteniendo las mismas
   clases CSS del sistema original.
   ──────────────────────────────────────────────────────────── */

/**
 * renderTurnosAdmin() — versión mejorada compatible con el nuevo
 * modelo de datos del módulo Turnos.
 * Reemplaza la definición de mente_serena.js (last-write wins).
 */
function renderTurnosAdmin() {
  const container = document.getElementById('turnos-admin-content');
  if (!container) return;

  // Helpers locales
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  const argNow   = getArgNow();
  const today    = new Date(argNow);
  const dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const turnos   = getTurnos();

  // Filtros de vista
  const filtros = [
    { id:'todos',      label:'📋 Todos'     },
    { id:'pendiente',  label:'⏳ Pendientes' },
    { id:'confirmado', label:'✓ Confirmados' },
    { id:'cancelado',  label:'✕ Cancelados'  }
  ];
  const filtroAct = container.dataset.filtro || 'todos';

  let html = `
    <!-- Hora Argentina -->
    <div style="text-align:center;margin-bottom:16px;font-size:0.84rem;color:var(--text-s);">
      Hora Argentina: <strong style="color:var(--morado-d)">
        ${argNow.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}
      </strong>
    </div>

    <!-- Filtros -->
    <div class="turnos-filtros">
      ${filtros.map(f =>
        `<button class="filtro-btn${filtroAct===f.id?' activo':''}"
          onclick="document.getElementById('turnos-admin-content').dataset.filtro='${f.id}';renderTurnosAdmin()">
          ${f.label}
        </button>`
      ).join('')}
    </div>

    <div class="turnos-admin-grid">`;

  // Mostrar los próximos 7 días hábiles
  let diasMostrados = 0;
  for (let i = 0; diasMostrados < 7 && i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (d.getDay() === 0) continue; // omitir domingos
    diasMostrados++;

    const dateStr   = d.toISOString().split('T')[0];
    const esSabado  = d.getDay() === 6;
    const dayLabel  = i === 0
      ? `Hoy (${dayNames[d.getDay()]} ${d.getDate()})`
      : `${dayNames[d.getDay()]} ${d.getDate()}`;

    // Filtrar turnos del día según el filtro activo
    let dayTurnos = turnos.filter(t => t.dia === dateStr);
    if (filtroAct !== 'todos') dayTurnos = dayTurnos.filter(t => t.estado === filtroAct);

    html += `<div class="turno-card"><h4>📅 ${dayLabel}</h4>`;

    if (!dayTurnos.length) {
      html += `<div style="font-size:0.78rem;color:var(--text-s);font-style:italic;padding:4px 0">Sin reservas</div>`;
    } else {
      // Ordenar por hora
      dayTurnos
        .sort((a,b) => (a.hora||'').localeCompare(b.hora||''))
        .forEach(t => {
          const estado    = t.estado || 'pendiente';
          const franjaL   = t.franja === 'manana' ? '🌅' : t.franja === 'tarde' ? '🌙' : '';
          const modalL    = t.modalidad === 'presencial' ? '🏠' : t.modalidad === 'virtual' ? '💻' : '';
          const profIni   = (t.profNombre || t.profesional || '?').charAt(t.profesional === 'daiana' ? 4 : 4).toUpperCase();
          const profLabel = t.profNombre || esc(t.profesional || '');

          html += `
            <div class="turno-slot${estado === 'cancelado' ? ' cancelado' : ''}" id="tslot-${t.id}">
              <div style="flex:1;min-width:0">
                <div class="turno-slot-time">
                  ${franjaL} ${esc(t.hora)}
                  ${modalL ? `<span style="font-size:0.75rem;margin-left:4px">${modalL}</span>` : ''}
                </div>
                <div class="turno-slot-status">${esc(t.usuario || '—')}</div>
                <div class="turno-slot-extra">
                  👩‍⚕️ ${esc(profLabel)}
                  ${t.telefono ? ` · 📞 ${esc(t.telefono)}` : ''}
                </div>
                <!-- Detalle expandible -->
                <div class="turno-detalle" id="tdet-${t.id}">
                  <dl class="turno-detalle-grid">
                    ${t.edad     ? `<dt>Edad</dt><dd>${esc(t.edad)} años</dd>` : ''}
                    ${t.email    ? `<dt>Email</dt><dd>${esc(t.email)}</dd>` : ''}
                    ${t.modalidad? `<dt>Modalidad</dt><dd>${t.modalidad==='presencial'?'Presencial':'Virtual'}</dd>` : ''}
                    ${t.motivo   ? `<dt>Motivo</dt><dd>${esc(t.motivo.substring(0,100))}${t.motivo.length>100?'…':''}</dd>` : ''}
                    ${t.codigo   ? `<dt>Código</dt><dd>${esc(t.codigo)}</dd>` : ''}
                    ${estado === 'cancelado' && t.canceladoEn ? `<dt>Cancelado</dt><dd>${t.canceladoPor === 'profesional' ? 'por el equipo profesional' : 'por el paciente'}, el ${esc(new Date(t.canceladoEn).toLocaleString('es-AR', { timeZone:'America/Argentina/Buenos_Aires', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:false }))} hs</dd>` : ''}
                  </dl>
                </div>
              </div>
              <!-- Botones de acción -->
              <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0">
                <span class="turno-estado-badge ${estado}">${estado === 'confirmado' ? '✓ Confirmado' : estado === 'cancelado' ? '✕ Cancelado' : '⏳ Pendiente'}</span>
                <button class="btn-liberar" style="font-size:0.68rem;padding:4px 8px"
                  onclick="document.getElementById('tdet-${t.id}').classList.toggle('abierto')">
                  Ver más
                </button>
                ${estado === 'pendiente' ? `
                  <button class="btn-liberar" style="background:rgba(138,171,140,0.15);color:var(--sage-d);font-size:0.68rem;padding:4px 8px"
                    onclick="confirmarTurnoAdmin('${dateStr}','${t.hora}','${t.id}')">
                    ✓ Confirmar
                  </button>` : ''}
                ${estado !== 'cancelado' ? `
                  <button class="btn-liberar" onclick="liberarTurno('${dateStr}','${t.hora}','${t.id}')">Liberar</button>` : ''}
              </div>
            </div>`;
        });
    }
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

/**
 * confirmarTurnoAdmin() — cambia el estado del turno a 'confirmado'.
 * Nuevo helper compatible con el modelo extendido.
 * @param {string} dia
 * @param {string} hora
 * @param {number} id
 */
function confirmarTurnoAdmin(dia, hora, id) {
  const turnos = getTurnos();
  const idx = turnos.findIndex(t => String(t.id) === String(id));
  if (idx === -1) return;
  turnos[idx].estado = 'confirmado';
  saveTurnos(turnos);
  renderTurnosAdmin();
}

/**
 * liberarTurno() — el equipo profesional libera un turno ya reservado
 * (pendiente o confirmado), dejando ese horario disponible de nuevo
 * para que otra persona lo reserve. A diferencia de la cancelación
 * que hace el propio paciente, esta acción no respeta el límite de
 * 24 hs: la profesional puede liberar el turno en cualquier momento.
 * @param {string} dia            fecha del turno (YYYY-MM-DD)
 * @param {string} hora           horario del turno (HH:MM)
 * @param {string|number} [id]    id puntual del turno a liberar
 */
function liberarTurno(dia, hora, id) {
  const turnos = getTurnos();

  // Se prioriza la búsqueda por id (más precisa); si no viene o no
  // se encuentra, se cae al par dia+hora sobre un turno aún activo.
  let idx = id != null ? turnos.findIndex(t => String(t.id) === String(id)) : -1;
  if (idx === -1) {
    idx = turnos.findIndex(t => t.dia === dia && t.hora === hora && t.estado !== 'cancelado');
  }
  if (idx === -1) return;

  const t = turnos[idx];
  if (t.estado === 'cancelado') return; // ya estaba libre

  const paciente = t.usuario || 'este paciente';
  if (!confirm(`¿Liberar el turno de ${paciente} (${hora} hs)? El horario quedará disponible para que otra persona lo reserve.`)) return;

  turnos[idx].estado       = 'cancelado';
  turnos[idx].canceladoEn  = Date.now();
  turnos[idx].canceladoPor = 'profesional';
  saveTurnos(turnos);
  renderTurnosAdmin();
}
