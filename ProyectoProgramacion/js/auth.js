/* ============================================================
   AUTH.JS — Mente Serena
   Extras visuales compartidos por login.html y admin.html:
   · ojito para mostrar/ocultar contraseñas
   · frases rotativas del panel ilustrado (con puntitos)
   No contiene lógica de sesión (ver login.js / admin.js).
   ============================================================ */
(function () {
  const EYE_ON  = '<svg class="eye-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg class="eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function initPasswordToggles() {
    document.querySelectorAll('.auth-panel input[type="password"], #admin-form input[type="password"]').forEach(input => {
      const wrap = document.createElement('div');
      wrap.className = 'pw-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-toggle';
      btn.setAttribute('aria-label', 'Mostrar contraseña');
      btn.innerHTML = EYE_ON + EYE_OFF;
      btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.classList.toggle('shown', show);
        btn.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
      });
      wrap.appendChild(btn);
    });
  }

  function initSlides() {
    const slides = document.querySelectorAll('.auth-slide');
    const dots   = document.querySelectorAll('.auth-dot');
    if (!slides.length) return;
    let i = 0, timer = null;
    const show = n => {
      i = (n + slides.length) % slides.length;
      slides.forEach((s, k) => s.classList.toggle('active', k === i));
      dots.forEach((d, k) => { d.classList.toggle('active', k === i); d.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    };
    const play = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      clearInterval(timer); timer = setInterval(() => show(i + 1), 5500);
    };
    dots.forEach((d, k) => d.addEventListener('click', () => { show(k); play(); }));
    show(0); play();
  }

  document.addEventListener('DOMContentLoaded', () => { initPasswordToggles(); initSlides(); });
})();
