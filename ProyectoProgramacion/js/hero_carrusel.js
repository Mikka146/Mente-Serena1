/* ═══════════════════════════════════════════════════════════
   §HERO-CARRUSEL — Carrusel de la portada de Inicio.
   - Avanza solo cada 6 s. Se pausa con el mouse encima, con el foco
     de teclado dentro, al ocultar la pestaña, si Inicio no está
     visible y si el usuario pidió menos movimiento.
   - Flechas, puntitos, teclado (← →) y deslizar con el dedo.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var root = document.getElementById('hero-carousel');
  if (!root) return;

  var slides = Array.prototype.slice.call(root.querySelectorAll('.hero-slide'));
  var dots   = Array.prototype.slice.call(root.querySelectorAll('.hero-car-dot'));
  var prev   = root.querySelector('.hero-car-nav.prev');
  var next   = root.querySelector('.hero-car-nav.next');
  if (slides.length < 2) return;

  var INTERVALO = 6000;
  var actual = 0;
  var timer = null;
  var reducido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var conMouse = window.matchMedia && window.matchMedia('(hover: hover)').matches;

  // Motivos de pausa (el autoplay sólo corre si ninguno está activo)
  var sobre = false;   // mouse encima
  var foco  = false;   // foco de teclado dentro

  function mostrar(i) {
    actual = (i + slides.length) % slides.length;
    slides.forEach(function (s, n) {
      var on = n === actual;
      s.classList.toggle('active', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    dots.forEach(function (d, n) {
      d.classList.toggle('active', n === actual);
      if (n === actual) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
    });
  }

  function parar() { if (timer) { clearInterval(timer); timer = null; } }
  function iniciar() {
    parar();
    if (reducido || document.hidden || sobre || foco) return;
    timer = setInterval(function () {
      // Si el usuario está en otra sección (Nosotros/Turnos) no avanzamos a ciegas
      if (root.offsetParent === null) return;
      mostrar(actual + 1);
    }, INTERVALO);
  }
  function ir(i) { mostrar(i); iniciar(); }

  prev.addEventListener('click', function () { ir(actual - 1); });
  next.addEventListener('click', function () { ir(actual + 1); });
  dots.forEach(function (d, n) { d.addEventListener('click', function () { ir(n); }); });

  // El hover sólo existe con mouse: en pantallas táctiles el "mouseenter" que
  // simula el navegador al tocar dejaba el carrusel pausado para siempre.
  if (conMouse) {
    root.addEventListener('mouseenter', function () { sobre = true; iniciar(); });
    root.addEventListener('mouseleave', function () { sobre = false; iniciar(); });
  }
  // Foco: sólo cuenta si viene del teclado (un click/toque no debe pausar).
  root.addEventListener('focusin', function (e) {
    var porTeclado = true;
    try { porTeclado = e.target.matches(':focus-visible'); } catch (err) {}
    foco = porTeclado; iniciar();
  });
  root.addEventListener('focusout', function () { foco = false; iniciar(); });
  document.addEventListener('visibilitychange', iniciar);

  root.setAttribute('tabindex', '0');
  root.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft')  { ir(actual - 1); }
    if (e.key === 'ArrowRight') { ir(actual + 1); }
  });

  // Deslizar en pantallas táctiles (ignora el scroll vertical)
  var x0 = null, y0 = null;
  root.addEventListener('touchstart', function (e) {
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  root.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    var dy = e.changedTouches[0].clientY - y0;
    x0 = y0 = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) ir(actual + (dx < 0 ? 1 : -1));
  }, { passive: true });

  mostrar(0);
  iniciar();
})();
