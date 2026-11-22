/**
 * ==============================================================
 * MENTE SERENA PRO — LÓGICA DE NEGOCIO E INTERACCIÓN
 * ==============================================================
 * Sistema autónomo de historia clínica digital.
 * Sin dependencias de servidor: todo se procesa en el navegador.
 *
 * Módulos:
 *  1.  Estado de la aplicación
 *  2.  Chips de antecedentes clínicos
 *  3.  Acordeones de escalas psicométricas
 *  4.  Evaluación y cálculo de escalas (dep / anx / risk / str)
 *  5.  Línea de vida (timeline biográfico)
 *  6.  Registro de sesiones
 *  7.  Persistencia local (localStorage)
 *  8.  Exportación a PDF (via window.print)
 *  9.  Limpiar formulario (nueva ficha)
 *  10. Carga de logo
 *  11. Sistema de toast (notificaciones no bloqueantes)
 *  12. Inicialización y restauración de datos
 * ==============================================================
 */

const app = (function () {

    /* ===========================================================
       1. ESTADO GLOBAL DE LA APLICACIÓN
       Objeto central que almacena el estado reactivo de todos
       los módulos. Se serializa en localStorage al guardar.
       =========================================================== */
    const state = {
        /** Mapa de chips activos: { tipo: boolean } */
        chips: {},

        /**
         * Puntuaciones de cada escala psicométrica.
         * dep / anx / str: 0–3 por ítem.
         * risk: 0–1 por ítem (binario Sí/No).
         */
        scales: {
            dep:  { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, // Depresión (5 ítems)
            anx:  { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, // Ansiedad  (5 ítems)
            risk: { 1: 0, 2: 0, 3: 0 },               // Riesgo suicida (3 binarios)
            str:  { 1: 0, 2: 0, 3: 0 }                // Estrés percibido (3 ítems)
        },

        /** Array de eventos de la línea de vida: { id, stage, age, desc, impact } */
        timeline: [],

        /** Array de sesiones registradas: { id, number, date, modality, summary } */
        sessions: [],
        
        /** Imagen de la firma digitalizada en formato Base64 */
        signature: null
    };

    /* Clave única en localStorage para esta aplicación */
    const STORAGE_KEY = 'menteSerena_ProDB_v2';

    /**
     * Mapa de ID de elemento HTML → clave en el payload de guardado.
     * Se usa tanto para guardar como para restaurar datos.
     */
    const FIELD_MAP = {
        'doc-name':          'docName',
        'doc-specialty':     'docSpecialty',
        'doc-license':       'docLicense',
        'doc-institution':   'docInstitution',
        'doc-address':       'docAddress',
        'doc-contact':       'docContact',
        'pat-name':          'patName',
        'pat-age':           'patAge',
        'pat-gender':        'patGender',
        'pat-civil':         'patCivil',
        'pat-occupation':    'patOccupation',
        'pat-education':     'patEducation',
        'pat-emergency':     'patEmergency',
        'pat-record-id':     'patRecordId',
        'pat-start-date':    'patStartDate',
        'pat-motive':        'patMotive',
        'pat-demand':        'patDemand',
        'pat-treatments':    'patTreatments',
        'pat-medical':       'patMedical',
        'hist-family':       'histFamily',
        'hist-social':       'histSocial',
        'hist-family-mental':'histFamilyMental',
        'hist-socioeconomic':'histSocioeconomic',
        'mse-appearance':    'mseAppearance',
        'mse-orientation':   'mseOrientation',
        'mse-memory':        'mseMemory',
        'mse-speech':        'mseSpeech',
        'mse-mood':          'mseMood',
        'mse-thought':       'mseThought',
        'mse-personality':   'msePersonality',
        'mse-notes':         'mseNotes',
        'soap-s':            'soapS',
        'soap-o':            'soapO',
        'soap-a':            'soapA',
        'soap-p':            'soapP',
        'dx-primary':        'dxPrimary',
        'dx-secondary':      'dxSecondary',
        'dx-approach':       'dxApproach',
        'dx-frequency':      'dxFrequency',
        'dx-goals':          'dxGoals',
        'dx-prognosis':      'dxPrognosis',
        'dx-review-date':    'dxReviewDate',
        'dx-signature-notes':'dxSignatureNotes'
    };


    /* ===========================================================
       2. CHIPS DE ANTECEDENTES CLÍNICOS
       Permite seleccionar/deseleccionar diagnósticos previos
       del paciente mediante botones tipo "tag".
       =========================================================== */

    /**
     * Alterna el estado activo de un chip al hacer clic.
     * Sincroniza el estado visual (clase CSS) con state.chips.
     * También actualiza el aria-checked para accesibilidad.
     *
     * @param {HTMLElement} element - El elemento .chip clicado
     */
    const toggleChip = (element) => {
        const type = element.getAttribute('data-type');
        element.classList.toggle('active');
        const isActive = element.classList.contains('active');

        // Actualizar estado interno
        state.chips[type] = isActive;

        // Accesibilidad: refleja el estado en aria-checked
        element.setAttribute('aria-checked', isActive ? 'true' : 'false');
    };


    /* ===========================================================
       3. ACORDEONES DE ESCALAS PSICOMÉTRICAS
       Expande o colapsa el cuerpo de cada escala al hacer clic
       en su cabecera. Soporta múltiples abiertos a la vez.
       =========================================================== */

    /**
     * Alterna la clase .open en el acordeón indicado.
     * El CSS usa esa clase para mostrar/ocultar el body con flex.
     * También actualiza aria-expanded para accesibilidad.
     *
     * @param {string} id - ID del .accordion-item a alternar
     */
    const toggleAccordion = (id) => {
        const item = document.getElementById(id);
        if (!item) return;

        item.classList.toggle('open');
        const header = item.querySelector('.accordion-header');
        if (header) {
            const expanded = item.classList.contains('open');
            header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }
    };


    /* ===========================================================
       4. EVALUACIÓN Y CÁLCULO DE ESCALAS PSICOMÉTRICAS
       Al mover un slider: actualiza el estado, refresca la
       etiqueta de nivel y recalcula el total de la escala.
       =========================================================== */

    /**
     * Registra el valor de un slider en el estado y actualiza la UI.
     *
     * @param {string} scaleType   - Tipo de escala: 'dep', 'anx', 'risk', 'str'
     * @param {number} questionNum - Número de pregunta dentro de la escala
     * @param {HTMLInputElement} slider - El input[type="range"] que cambió
     */
    const evaluateScale = (scaleType, questionNum, slider) => {
        const val = parseInt(slider.value, 10);

        // Asegurar que el objeto de la escala existe (p.ej. para 'str')
        if (!state.scales[scaleType]) {
            state.scales[scaleType] = {};
        }

        // 1. Persistir valor en el estado
        state.scales[scaleType][questionNum] = val;

        // 2. Actualizar la etiqueta visual sobre el slider
        _updateSliderLabel(scaleType, questionNum, val);

        // 3. Recalcular y mostrar el total de la escala
        _processScaleTotals(scaleType);
    };

    /**
     * Actualiza la etiqueta de nivel (badge) junto al slider.
     * Cambia el texto y el atributo data-level (usado por CSS para el color).
     *
     * @param {string} scaleType   - 'dep', 'anx', 'risk' o 'str'
     * @param {number} questionNum - Número de pregunta
     * @param {number} val         - Valor actual del slider
     * @private
     */
    const _updateSliderLabel = (scaleType, questionNum, val) => {
        const label = document.getElementById(`lbl-${scaleType}-${questionNum}`);
        if (!label) return;

        if (scaleType === 'risk') {
            // Escala binaria: No / Sí
            label.textContent   = val === 1 ? 'Sí'  : 'No';
            label.dataset.level = val === 1 ? 'si'  : 'no';
        } else {
            // Escala 0–3: Nada / Leve / Moderado / Severo
            const map = [
                { text: '0 — Nada',     level: '' },
                { text: '1 — Leve',     level: 'leve' },
                { text: '2 — Moderado', level: 'mod' },
                { text: '3 — Severo',   level: 'severo' }
            ];
            label.textContent   = map[val].text;
            label.dataset.level = map[val].level;
        }
    };

    /**
     * Calcula la suma total de una escala y actualiza el indicador
     * de resultado visible en la cabecera del acordeón.
     *
     * Umbrales orientativos:
     *  dep / anx / str: 0–4=Mínima · 5–9=Leve · 10+=Moderada/Alta
     *  risk: 0=Sin riesgo · 1=Medio · 2+=ALTO
     *
     * @param {string} type - 'dep', 'anx', 'risk' o 'str'
     * @private
     */
    const _processScaleTotals = (type) => {
        if (!state.scales[type]) return;

        const values = Object.values(state.scales[type]);
        const total  = values.reduce((acc, curr) => acc + curr, 0);
        const max    = values.length * (type === 'risk' ? 1 : 3);

        if (type === 'dep' || type === 'anx' || type === 'str') {
            // Umbral proporcional al número de ítems
            const midLow  = Math.round(max * 0.25);
            const midHigh = Math.round(max * 0.55);
            const level = total >= midHigh ? 'Moderada/Alta'
                        : total >= midLow  ? 'Leve'
                        : 'Mínima';

            const idMap = { dep: 'res-dep-total', anx: 'res-anx-total', str: 'res-str-total' };
            const el = document.getElementById(idMap[type]);
            if (el) el.textContent = `${total} / ${max} — ${level}`;
        }
        else if (type === 'risk') {
            const level    = total >= 2 ? 'RIESGO ALTO' : total === 1 ? 'RIESGO MEDIO' : 'SIN RIESGO';
            const alertBar = document.getElementById('risk-alert-bar');
            const indicator= document.getElementById('res-risk-total');

            if (indicator) indicator.textContent = total > 0 ? String(total) : '—';

            if (alertBar) {
                alertBar.textContent = `Total: ${total} / ${state.scales.risk ? Object.keys(state.scales.risk).length : 3}  ·  Nivel: ${level}`;

                if (total >= 2) {
                    // Riesgo alto → alerta roja intensa
                    alertBar.style.cssText = 'background-color:#FEE2E2;color:#A63A50;border-color:#FCA5A5;font-size:0.9rem;';
                } else if (total === 1) {
                    // Riesgo medio → alerta naranja
                    alertBar.style.cssText = 'background-color:#FEF3C7;color:#92400E;border-color:#FCD34D;';
                } else {
                    // Sin riesgo → neutro
                    alertBar.style.cssText = 'background-color:#F1F5F9;color:#475569;border-color:#CBD5E1;';
                }
            }
        }
    };


    /* ===========================================================
       5. LÍNEA DE VIDA (TIMELINE BIOGRÁFICO)
       Permite registrar eventos biográficos significativos
       del paciente ordenados por etapa vital.
       =========================================================== */

    /**
     * Lee el formulario de nuevo evento, valida los campos
     * requeridos y agrega la entrada al estado y al DOM.
     * El campo de impacto es opcional y tiene valor por defecto.
     */
    const addTimelineEvent = () => {
        const stageEl  = document.getElementById('tl-stage');
        const ageEl    = document.getElementById('tl-age');
        const descEl   = document.getElementById('tl-desc');
        const impactEl = document.getElementById('tl-impact');

        const stage  = stageEl  ? stageEl.value.trim()  : '';
        const age    = ageEl    ? ageEl.value.trim()    : '';
        const desc   = descEl   ? descEl.value.trim()   : '';
        const impact = impactEl ? impactEl.value.trim() : 'Neutro';

        // Validación: edad y descripción son obligatorios
        if (!age || !desc) {
            _showToast('Complete la edad/fecha y el evento antes de agregar.', 'danger');
            return;
        }

        // Crear objeto de evento con ID único basado en timestamp
        const newEvent = { id: Date.now(), stage, age, desc, impact };
        state.timeline.push(newEvent);

        // Limpiar campos de entrada para el siguiente evento
        if (ageEl)  ageEl.value  = '';
        if (descEl) descEl.value = '';
        if (ageEl)  ageEl.focus();

        _renderTimeline();
    };

    /**
     * Elimina un evento de la línea de vida por su ID numérico.
     * Expuesto públicamente porque el HTML generado dinámicamente
     * lo llama via onclick.
     *
     * @param {number} id - ID del evento a eliminar
     */
    const deleteTimelineEvent = (id) => {
        state.timeline = state.timeline.filter(ev => ev.id !== id);
        _renderTimeline();
    };

    /**
     * Renderiza la lista completa de eventos en #timeline-box.
     * Reconstruye el DOM desde el estado (estrategia simple y
     * suficiente para el volumen esperado de eventos).
     *
     * @private
     */
    const _renderTimeline = () => {
        const box = document.getElementById('timeline-box');
        if (!box) return;

        box.innerHTML = '';

        if (state.timeline.length === 0) {
            // Estado vacío con mensaje orientativo
            box.innerHTML = `
                <div class="timeline-empty">
                    <i class="fas fa-stream" style="margin-right:8px;opacity:0.35;" aria-hidden="true"></i>
                    Aún no hay eventos. Complete el formulario y presione "Agregar Evento".
                </div>
            `;
            return;
        }

        // Color del borde izquierdo según el impacto del evento
        const impactColor = {
            'Positivo': '#22C55E',  // Verde
            'Negativo': '#EF4444',  // Rojo
            'Mixto':    '#F59E0B',  // Ámbar
            'Neutro':   '#C48E4A'   // Dorado (por defecto)
        };

        state.timeline.forEach(ev => {
            const color = impactColor[ev.impact] || impactColor['Neutro'];
            const card  = document.createElement('div');
            card.className = 'timeline-event-card';
            card.style.borderLeftColor = color;

            card.innerHTML = `
                <div class="event-data">
                    <strong>${_escapeHTML(ev.stage)} · ${_escapeHTML(ev.age)}</strong>
                    <p>${_escapeHTML(ev.desc)}</p>
                </div>
                <span style="font-size:0.7rem;color:${color};font-weight:600;padding:3px 10px;
                             border-radius:20px;background:${color}18;flex-shrink:0;">
                    ${_escapeHTML(ev.impact)}
                </span>
                <button
                    class="btn-delete-ev"
                    onclick="app.deleteTimelineEvent(${ev.id})"
                    title="Eliminar este evento"
                    aria-label="Eliminar evento: ${_escapeHTML(ev.desc)}"
                >
                    <i class="fas fa-trash-alt" aria-hidden="true"></i>
                </button>
            `;

            box.appendChild(card);
        });
    };


    /* ===========================================================
       6. REGISTRO DE SESIONES
       Tabla dinámica del historial de sesiones del proceso
       terapéutico: número, fecha, modalidad y resumen.
       =========================================================== */

    /**
     * Lee el formulario de nueva sesión, valida y agrega al estado.
     * Autoincrementa el número de sesión si el campo está vacío.
     */
    const addSession = () => {
        const numberEl   = document.getElementById('sess-number');
        const dateEl     = document.getElementById('sess-date');
        const modalityEl = document.getElementById('sess-modality');
        const summaryEl  = document.getElementById('sess-summary');

        // Autoincrement: si no ingresaron número, usar el siguiente
        const nextNumber = state.sessions.length + 1;
        const number   = numberEl   && numberEl.value.trim()
                         ? numberEl.value.trim()
                         : String(nextNumber);
        const date     = dateEl     ? dateEl.value     : '';
        const modality = modalityEl ? modalityEl.value : 'Presencial';
        const summary  = summaryEl  ? summaryEl.value.trim() : '';

        // Validación: al menos la fecha o el resumen deben estar presentes
        if (!date && !summary) {
            _showToast('Ingrese al menos la fecha o el resumen de la sesión.', 'danger');
            return;
        }

        const newSession = { id: Date.now(), number, date, modality, summary };
        state.sessions.push(newSession);

        // Limpiar campos
        if (numberEl)  numberEl.value  = '';
        if (dateEl)    dateEl.value    = '';
        if (summaryEl) summaryEl.value = '';

        // Actualizar el número sugerido para la próxima sesión
        if (numberEl) numberEl.placeholder = `Ej. ${state.sessions.length + 1}`;

        _renderSessions();
        _showToast(`Sesión ${number} registrada correctamente.`);
    };

    /**
     * Elimina una sesión registrada por su ID.
     *
     * @param {number} id - ID de la sesión a eliminar
     */
    const deleteSession = (id) => {
        state.sessions = state.sessions.filter(s => s.id !== id);
        _renderSessions();
    };

    /**
     * Renderiza el historial de sesiones en #sessions-box.
     * Muestra fecha, modalidad y resumen en tarjetas compactas.
     *
     * @private
     */
    const _renderSessions = () => {
        const box = document.getElementById('sessions-box');
        if (!box) return;

        box.innerHTML = '';

        if (state.sessions.length === 0) {
            box.innerHTML = `
                <div class="timeline-empty">
                    <i class="fas fa-calendar-times" style="margin-right:8px;opacity:0.35;" aria-hidden="true"></i>
                    No hay sesiones registradas aún.
                </div>
            `;
            return;
        }

        // Ordenar sesiones por número (ascendente)
        const sorted = [...state.sessions].sort((a, b) => Number(a.number) - Number(b.number));

        // Icono por modalidad de sesión
        const modalityIcon = {
            'Presencial':       'fa-chair',
            'Videoconferencia': 'fa-video',
            'Telefónica':       'fa-phone'
        };

        sorted.forEach(s => {
            const card = document.createElement('div');
            card.className = 'timeline-event-card';
            card.style.borderLeftColor = 'var(--primary-mid)';

            // Formatear fecha para legibilidad
            let dateDisplay = s.date;
            if (s.date) {
                try {
                    dateDisplay = new Date(s.date + 'T00:00:00').toLocaleDateString('es-AR', {
                        year: 'numeric', month: 'long', day: 'numeric'
                    });
                } catch (e) { /* Si falla, usar la fecha tal cual */ }
            }

            const icon = modalityIcon[s.modality] || 'fa-calendar';

            card.innerHTML = `
                <div class="event-data">
                    <strong>
                        Sesión ${_escapeHTML(s.number)}
                        <span style="font-weight:400;margin-left:6px;opacity:0.7;">
                            <i class="fas ${icon}" aria-hidden="true"></i>
                            ${_escapeHTML(s.modality)}
                            ${s.date ? '· ' + dateDisplay : ''}
                        </span>
                    </strong>
                    ${s.summary ? `<p>${_escapeHTML(s.summary)}</p>` : '<p style="opacity:0.4;font-style:italic;">Sin resumen.</p>'}
                </div>
                <button
                    class="btn-delete-ev"
                    onclick="app.deleteSession(${s.id})"
                    title="Eliminar esta sesión"
                    aria-label="Eliminar sesión ${_escapeHTML(s.number)}"
                >
                    <i class="fas fa-trash-alt" aria-hidden="true"></i>
                </button>
            `;

            box.appendChild(card);
        });
    };


    /* ===========================================================
       7. PERSISTENCIA LOCAL (localStorage)
       Guarda y recupera el estado completo de la ficha clínica
       en el almacenamiento local del dispositivo.
       No se transmite ningún dato a servidores externos.
       =========================================================== */

    /**
     * Serializa todos los campos del formulario + el estado interno
     * y los almacena en localStorage como JSON.
     * Muestra toast de confirmación al usuario.
     *
     * ADEMÁS actualiza dos claves extra para que mente_serena.js
     * pueda mostrar la lista de historias en el panel profesional:
     *   · ms_hc_list         → array de resúmenes {id, paciente, profesional, fecha}
     *   · ms_hc_data_{hcId}  → payload completo, cargado al abrir por id via ?hcId=…
     */
    const saveToLocalStorage = () => {
        try {
            // ── Construir el payload recolectando todos los campos del FIELD_MAP ──
            const payload = { state, savedAt: new Date().toISOString() };

            Object.entries(FIELD_MAP).forEach(([id, key]) => {
                payload[key] = _val(id);
            });

            // ── Generar o reutilizar el ID único de esta historia clínica ──
            // Si ya hay un hcId guardado en la sesión activa, conservarlo;
            // de lo contrario asignar uno nuevo basado en timestamp.
            let hcId = null;
            try {
                const prev = localStorage.getItem(STORAGE_KEY);
                if (prev) hcId = JSON.parse(prev).hcId || null;
            } catch { /* ignorar */ }
            payload.hcId = hcId || String(Date.now());

            // ── Guardar la ficha completa en la clave principal de sesión ──
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

            // ── Guardar también la ficha completa indexada por su propio ID ──
            // Esto permite que historia_clinica.html la cargue via ?hcId=...
            localStorage.setItem('ms_hc_data_' + payload.hcId, JSON.stringify(payload));

            // ── Actualizar el array de resúmenes que lee mente_serena.js ──
            let hcList = [];
            try { hcList = JSON.parse(localStorage.getItem('ms_hc_list') || '[]'); } catch {}
            const summary = {
                id:          payload.hcId,
                paciente:    payload.patName    || 'Paciente sin nombre',
                profesional: payload.docName    || '—',
                fecha:       Date.now()
            };
            const idx = hcList.findIndex(h => h.id === payload.hcId);
            if (idx >= 0) hcList[idx] = summary;  // actualizar registro existente
            else          hcList.push(summary);    // agregar nuevo registro
            localStorage.setItem('ms_hc_list', JSON.stringify(hcList));

            _showToast('Ficha guardada en este dispositivo.');
        } catch (err) {
            console.error('[MenteSerena] Error al guardar:', err);
            _showToast('No se pudo guardar. Almacenamiento insuficiente.', 'danger');
        }
    };

    /**
     * Recupera los datos guardados en localStorage y los restaura
     * en el formulario y en el estado interno.
     * Se llama automáticamente durante la inicialización.
     *
     * Si la URL contiene ?hcId=…, carga esa historia específica desde
     * la clave ms_hc_data_{id} (escrita por saveToLocalStorage).
     * Si no, carga la sesión activa desde STORAGE_KEY.
     *
     * @private
     */
    const _loadFromLocalStorage = () => {
        // ── Determinar qué clave usar según el parámetro de URL ──
        const urlParams  = new URLSearchParams(window.location.search);
        const hcIdParam  = urlParams.get('hcId');
        const storageKey = hcIdParam ? ('ms_hc_data_' + hcIdParam) : STORAGE_KEY;

        const raw = localStorage.getItem(storageKey);
        if (!raw) return;

        try {
            const data = JSON.parse(raw);

            // Restaurar campos de formulario
            Object.entries(FIELD_MAP).forEach(([id, key]) => {
                const el = document.getElementById(id);
                if (el && data[key] !== undefined) el.value = data[key];
            });

            // Restaurar estado interno (escalas, chips, timeline, sessions)
            if (data.state) {
                // Chips
                Object.assign(state.chips, data.state.chips || {});

                // Escalas — fusión profunda para no perder nuevas claves
                Object.keys(state.scales).forEach(scaleKey => {
                    if (data.state.scales && data.state.scales[scaleKey]) {
                        Object.assign(state.scales[scaleKey], data.state.scales[scaleKey]);
                    }
                });

                // Timeline y sesiones
                state.timeline = data.state.timeline || [];
                state.sessions = data.state.sessions || [];
            }

            // Re-aplicar chips activos en el DOM
            document.querySelectorAll('.chip').forEach(chip => {
                const type = chip.getAttribute('data-type');
                if (state.chips[type]) {
                    chip.classList.add('active');
                    chip.setAttribute('aria-checked', 'true');
                }
            });

            // Restaurar valores de sliders y recalcular totales
            Object.keys(state.scales).forEach(scaleType => {
                const scale = state.scales[scaleType];
                Object.keys(scale).forEach(q => {
                    // Buscar el slider por su atributo oninput
                    const slider = document.querySelector(
                        `input[type="range"][oninput*="'${scaleType}', ${q}"]`
                    );
                    if (slider) {
                        slider.value = scale[q];
                        _updateSliderLabel(scaleType, parseInt(q, 10), scale[q]);
                    }
                });
                _processScaleTotals(scaleType);
            });

            // Re-renderizar listas dinámicas
            _renderTimeline();
            _renderSessions();

            // Restaurar firma digitalizada si existía
            if (data.state && data.state.signature) {
                _restoreSignatureFromState(data.state.signature);
            }
        } catch (err) {
            console.error('[MenteSerena] Error al cargar datos guardados:', err);
        }
    };


    /* ===========================================================
       8. EXPORTACIÓN A PDF
       Utiliza window.print() con el CSS @media print que oculta
       controles y expande acordeones para un PDF clínico limpio.
       El usuario elige "Guardar como PDF" en el diálogo del SO.
       =========================================================== */

    /**
     * Abre el diálogo nativo de impresión del navegador.
     * Cambia temporalmente el título del documento para que sea
     * el nombre sugerido al guardar el PDF.
     */
    const generatePDF = () => {
        const patName = _val('pat-name') || 'Paciente';
        const today   = new Date().toLocaleDateString('es-AR').replace(/\//g, '-');
        const originalTitle = document.title;

        document.title = `Expediente_${patName.replace(/\s+/g, '_')}_${today}`;
        window.print();
        document.title = originalTitle;
    };


    /* ===========================================================
       9. LIMPIAR FORMULARIO (NUEVA FICHA)
       Resetea todos los campos, el estado y las listas dinámicas
       para comenzar la historia clínica de un nuevo paciente.
       Pide confirmación antes de borrar para evitar pérdidas.
       =========================================================== */

    /**
     * Solicita confirmación al usuario y, si acepta,
     * limpia completamente el formulario y el estado interno.
     */
    const clearForm = () => {
        if (!window.confirm(
            '¿Está seguro de que desea limpiar el formulario?\n\n' +
            'Se perderán todos los datos no guardados. ' +
            'Esta acción no se puede deshacer.'
        )) return;

        // Limpiar todos los campos del FIELD_MAP
        Object.keys(FIELD_MAP).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // Limpiar campos específicos de timeline y sesiones
        ['tl-age', 'tl-desc', 'sess-number', 'sess-date', 'sess-summary'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // Resetear chips
        document.querySelectorAll('.chip').forEach(chip => {
            chip.classList.remove('active');
            chip.setAttribute('aria-checked', 'false');
        });

        // Resetear sliders a 0
        document.querySelectorAll('input[type="range"]').forEach(slider => {
            slider.value = 0;
        });

        // Resetear etiquetas de escalas
        document.querySelectorAll('.badge-level').forEach(lbl => {
            lbl.textContent   = '0 — Nada';
            lbl.dataset.level = '';
        });

        // Resetear indicadores de resultado
        ['res-dep-total', 'res-anx-total', 'res-str-total'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = 'Sin realizar';
        });
        const riskIndicator = document.getElementById('res-risk-total');
        if (riskIndicator) riskIndicator.textContent = '—';

        const riskBar = document.getElementById('risk-alert-bar');
        if (riskBar) {
            riskBar.textContent   = 'Total: 0  ·  Nivel: SIN RIESGO';
            riskBar.style.cssText = 'background-color:#F1F5F9;color:#475569;border-color:#CBD5E1;';
        }

        // Cerrar todos los acordeones abiertos
        document.querySelectorAll('.accordion-item.open').forEach(item => {
            item.classList.remove('open');
        });

        // Resetear logo
        const logoLabel = document.getElementById('logo-label');
        if (logoLabel) logoLabel.textContent = 'SUBIR LOGO';
        const logoImg = document.querySelector('.logo-upload-box img.logo-preview');
        if (logoImg) logoImg.remove();
        const logoIcon = document.querySelector('.logo-upload-box .upload-icon');
        if (logoIcon) logoIcon.style.display = '';

        // Resetear estado interno
        state.chips    = {};
        state.timeline = [];
        state.sessions = [];
        clearSignature(); // <-- NUEVO: Borra el canvas y asigna state.signature = null
        Object.keys(state.scales).forEach(k => {
            Object.keys(state.scales[k]).forEach(q => { state.scales[k][q] = 0; });
        });

        // Re-renderizar listas vacías
        _renderTimeline();
        _renderSessions();

        // Eliminar datos guardados del localStorage
        localStorage.removeItem(STORAGE_KEY);

        _showToast('Formulario limpiado. Listo para una nueva ficha.');
    };


    /* ===========================================================
       10. CARGA DE LOGO
       Permite al clínico subir el logo de su consultorio.
       Se muestra una vista previa dentro de la caja de carga.
       =========================================================== */

    /**
     * Inicializa el comportamiento de la caja de carga de logo.
     * Escucha el cambio en el input[type=file] y genera la
     * vista previa usando FileReader.
     *
     * @private
     */
    const _initLogoUpload = () => {
        const input   = document.getElementById('logo-file-input');
        const box     = document.getElementById('logo-drop-zone');
        const label   = document.getElementById('logo-label');
        const icon    = box ? box.querySelector('.upload-icon') : null;

        if (!input || !box) return;

        // Activar el input al presionar Enter o Space sobre la caja (accesibilidad)
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                input.click();
            }
        });

        // Procesar el archivo seleccionado
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;

            // Validar que sea una imagen
            if (!file.type.startsWith('image/')) {
                _showToast('Solo se aceptan archivos de imagen (JPG, PNG, SVG…).', 'danger');
                return;
            }

            const reader = new FileReader();

            reader.onload = (e) => {
                // Eliminar imagen previa si existe
                const prev = box.querySelector('img.logo-preview');
                if (prev) prev.remove();

                // Ocultar ícono y etiqueta originales
                if (icon)  icon.style.display  = 'none';
                if (label) label.style.display = 'none';

                // Crear y mostrar la vista previa
                const img   = document.createElement('img');
                img.src     = e.target.result;
                img.className = 'logo-preview';
                img.alt     = 'Logo del consultorio';
                box.insertBefore(img, input);
            };

            reader.readAsDataURL(file);
        });
    };


    /* ===========================================================
       11. SISTEMA DE TOAST (NOTIFICACIONES NO BLOQUEANTES)
       Reemplaza los alert() con mensajes no intrusivos que
       desaparecen automáticamente en ~3 segundos.
       =========================================================== */

    /**
     * Crea y muestra un mensaje toast en el contenedor fijo.
     *
     * @param {string} message            - Texto a mostrar
     * @param {'success'|'danger'} [type] - Tipo visual (defecto: 'success')
     */
    const _showToast = (message, type = 'success') => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const icon  = type === 'danger' ? 'exclamation-circle' : 'check-circle';
        const toast = document.createElement('div');

        toast.className = `toast${type === 'danger' ? ' toast-danger' : ''}`;
        toast.setAttribute('role', 'alert');
        toast.innerHTML = `
            <i class="fas fa-${icon}" aria-hidden="true"></i>
            <span>${_escapeHTML(message)}</span>
        `;

        container.appendChild(toast);

        // Destruir el elemento al terminar la animación de salida
        toast.addEventListener('animationend', (e) => {
            if (e.animationName === 'toastOut') toast.remove();
        });
    };


    /* ===========================================================
       12. UTILIDADES INTERNAS
       Funciones de ayuda privadas (no expuestas).
       =========================================================== */

    /**
     * Obtiene el valor de un campo de formulario por su ID.
     * Retorna cadena vacía si el elemento no existe.
     *
     * @param {string} id - ID del elemento HTML
     * @returns {string}
     * @private
     */
    const _val = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    };

    /**
     * Escapa caracteres HTML especiales en una cadena para
     * prevenir inyección de HTML al generar contenido dinámico.
     *
     * @param {string} str - Cadena a escapar
     * @returns {string}
     * @private
     */
    const _escapeHTML = (str) => {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    /* ===========================================================
       10B. SISTEMA DE FIRMA DIGITAL (CANVAS)
       Permite al profesional capturar su firma de forma interactiva.
       Soporta eventos de mouse y pantallas táctiles.
       =========================================================== */

    let _canvas = null;
    let _ctx = null;
    let _isDrawing = false;

    /**
     * Inicializa el lienzo de dibujo y vincula los eventos del mouse/táctiles.
     * @private
     */
    const _initSignatureCanvas = () => {
        _canvas = document.getElementById('signature-canvas');
        if (!_canvas) return;

        _ctx = _canvas.getContext('2d');
        if (!_ctx) return;

        // Configuración estética del trazo
        _ctx.strokeStyle = '#1E293B'; // Color de tinta (Slate 800)
        _ctx.lineWidth = 2;
        _ctx.lineCap = 'round';
        _ctx.lineJoin = 'round';

        // --- EVENTOS DE MOUSE ---
        _canvas.addEventListener('mousedown', (e) => {
            _isDrawing = true;
            _ctx.beginPath();
            _ctx.moveTo(e.offsetX, e.offsetY);
        });

        _canvas.addEventListener('mousemove', (e) => {
            if (!_isDrawing) return;
            _ctx.lineTo(e.offsetX, e.offsetY);
            _ctx.stroke();
        });

        window.addEventListener('mouseup', () => {
            if (_isDrawing) {
                _isDrawing = false;
                _saveCanvasState(); // Auto-guardar trazo en el estado al soltar el clic
            }
        });

        // --- EVENTOS TÁCTILES (Móviles / Tablets) ---
        _canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length !== 1) return;
            _isDrawing = true;
            const rect = _canvas.getBoundingClientRect();
            _ctx.beginPath();
            _ctx.moveTo(e.touches.clientX - rect.left, e.touches.clientY - rect.top);
        }, { passive: false });

        _canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!_isDrawing || e.touches.length !== 1) return;
            const rect = _canvas.getBoundingClientRect();
            _ctx.lineTo(e.touches.clientX - rect.left, e.touches.clientY - rect.top);
            _ctx.stroke();
        }, { passive: false });

        _canvas.addEventListener('touchend', () => {
            if (_isDrawing) {
                _isDrawing = false;
                _saveCanvasState();
            }
        });
    };

    /**
     * Guarda el estado del lienzo como String Base64 en el estado global.
     * @private
     */
    const _saveCanvasState = () => {
        if (!_canvas) return;
        // Verificamos si el canvas está vacío antes de guardar
        const blank = document.createElement('canvas');
        blank.width = _canvas.width;
        blank.height = _canvas.height;
        if (_canvas.toDataURL() === blank.toDataURL()) {
            state.signature = null;
        } else {
            state.signature = _canvas.toDataURL();
        }
    };

    /**
     * Limpia por completo el trazo del Canvas y actualiza el estado.
     */
    const clearSignature = () => {
        if (!_canvas || !_ctx) return;
        _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
        state.signature = null;
    };

    /**
     * Restaura la imagen guardada de la firma de vuelta en el lienzo de dibujo.
     * Se invoca automáticamente al recuperar datos desde LocalStorage.
     * @private
     */
    const _restoreSignatureFromState = (base64Data) => {
        if (!_canvas || !_ctx || !base64Data) return;
        const img = new Image();
        img.onload = () => {
            _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
            _ctx.drawImage(img, 0, 0);
        };
        img.src = base64Data;
    };

    /* ===========================================================
       INICIALIZACIÓN
       Punto de entrada del módulo. Se ejecuta cuando el DOM
       está completamente cargado (DOMContentLoaded).
       =========================================================== */

    /**
     * Orquesta la inicialización completa de la aplicación:
     *  - Muestra la fecha actual en la cabecera
     *  - Inicializa el uploader de logo
     *  - Renderiza los estados vacíos de las listas dinámicas
     *  - Restaura datos guardados en localStorage
     */
    const init = () => {
        // 1. Mostrar la fecha actual en la cabecera
        const dateEl = document.getElementById('header-date');
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString('es-AR', {
                weekday: 'long',
                year:    'numeric',
                month:   'long',
                day:     'numeric'
            });
        }

        // 2. Inicializar uploader de logo
        _initLogoUpload();
        _initSignatureCanvas(); // <-- NUEVO

        // 3. Renderizar estados vacíos iniciales
        _renderTimeline();
        _renderSessions();

        // 4. Sugerir el número de la primera sesión
        const sessNumberInput = document.getElementById('sess-number');
        if (sessNumberInput) sessNumberInput.placeholder = 'Ej. 1';

        // 5. Restaurar la sesión de trabajo anterior (si existe)
        _loadFromLocalStorage();
    };

    // Ejecutar init cuando el DOM esté listo
    document.addEventListener('DOMContentLoaded', init);


    /* ===========================================================
       INTERFAZ PÚBLICA
       Solo se exponen las funciones llamadas desde atributos
       onclick/oninput del HTML. El resto permanece privado.
       =========================================================== */
    return {
        toggleChip,
        toggleAccordion,
        evaluateScale,
        addTimelineEvent,
        deleteTimelineEvent,
        addSession,
        deleteSession,
        saveToLocalStorage,
        generatePDF,
        clearForm,
        clearSignature
    };

})();
