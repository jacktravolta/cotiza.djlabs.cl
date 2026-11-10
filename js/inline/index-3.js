    // Heart of this surface: wallet and rate limits of the CotizaIA heart.
    // Set BEFORE anything else reads it (same contract as app.html).
    const HEART = 'cotizaia';
    localStorage.setItem('heart_id', HEART);

    // Kind hint shown next to a 401: most existing accounts never set a
    // password (magic-link only), so we point them back to the link.
    const PASSWORD_LOGIN_HINT = 'Si nunca fijaste una contraseña, usa el enlace mágico: llega a tu correo y desde tu Perfil puedes dejarla guardada.';

    function setError(form, message, hint) {
      const box = form.querySelector('[data-error]');
      box.textContent = '';
      box.append(document.createTextNode(message));
      if (hint) {
        const hintEl = document.createElement('span');
        hintEl.className = 'mt-1 block text-xs text-rose-700';
        hintEl.textContent = hint;
        box.append(hintEl);
      }
      box.classList.remove('hidden');
    }

    function clearError(form) {
      const box = form.querySelector('[data-error]');
      box.textContent = '';
      box.classList.add('hidden');
    }

    async function requestMagicLink({ name, email, newsletter }) {
      // The real backend route (public/index.php POST /auth/magic-link):
      // JSON body, terms_accepted is server-enforced, heart routes the
      // welcome credit to the wallet this surface spends from.
      const response = await fetch(window.API('/auth/magic-link'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          terms_accepted: true,
          newsletter: newsletter === true,
          heart: HEART,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        const err = data.error;
        const message = typeof err === 'string'
          ? err
          : (err && err.message) || 'No pudimos enviar el enlace ahora. Inténtalo de nuevo en unos minutos.';
        throw new Error(message);
      }

      return data;
    }

    // POST /auth/login: email + password + remember opt-in. On success the
    // backend sets the httpOnly session cookies (persistent 30 days when
    // remember=true, session-scope when remember=false); the caller then
    // navigates to the panel. The heart travels with the request: the API
    // serves several hearts and the balance it returns is THIS panel's.
    async function loginWithPassword(email, password, remember) {
      const response = await fetch(window.API('/auth/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, remember: remember === true, heart: HEART }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        const err = data.error;
        const message = typeof err === 'string'
          ? err
          : (err && err.message) || 'No pudimos iniciar sesión ahora. Inténtalo nuevamente en unos minutos.';
        throw Object.assign(new Error(message), { status: response.status });
      }

      return data;
    }

    // POST /auth/register: creates the account with a password (min 8,
    // server-enforced) and sets the session cookies in the same response,
    // so the caller can navigate straight to the panel. Heart flows
    // (welcome bonus) and terms are server-enforced.
    async function registerAccount({ name, email, password, newsletter }) {
      const response = await fetch(window.API('/auth/register'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          terms_accepted: true,
          newsletter: newsletter === true,
          heart: HEART,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        const err = data.error;
        const message = typeof err === 'string'
          ? err
          : (err && err.message) || 'No pudimos crear tu cuenta ahora. Inténtalo nuevamente en unos minutos.';
        throw new Error(message);
      }

      return data;
    }

    function wireAuthForm(formId, options) {
      const form = document.getElementById(formId);

      if (!form) return;

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearError(form);

        const emailInput = form.querySelector('[name="email"]');
        const email = (emailInput.value || '').trim();
        const name = options.requireName ? (form.querySelector('[name="name"]').value || '').trim() : '';
        const newsletterEl = form.querySelector('[name="newsletter"]');
        const passwordInput = form.querySelector('[name="password"]');
        const password = passwordInput ? passwordInput.value : '';
        const usePassword = options.allowPassword && password !== '';

        // Registro con contraseña: server enforces min 8 too, but checking
        // here keeps the error local and immediate (empatía: no idas y
        // vueltas al servidor por algo el formulario sabe fallar mejor).
        if (options.passwordRequired) {
          if (password.length < 8) {
            setError(form, 'La contraseña debe tener al menos 8 caracteres. La usas para entrar a tu panel.');
            passwordInput?.focus();
            return;
          }
          const confirmInput = form.querySelector('[name="password_confirm"]');
          if (password !== (confirmInput ? confirmInput.value : '')) {
            setError(form, 'Las contraseñas no coinciden. Revísalas e inténtalo, con calma: sin apuros.');
            confirmInput?.focus();
            return;
          }
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setError(form, 'Escribe tu correo para enviarte el enlace de acceso (ejemplo: nombre@correo.cl).');
          emailInput.focus();
          return;
        }

        const button = form.querySelector('button[type="submit"]');
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = usePassword ? 'Entrando…' : options.loadingText;

        // When true the browser is navigating to the panel: keep the button
        // disabled and skip the restore in finally.
        let navigating = false;

        try {
          if (options.passwordRequired) {
            // Registro directo: /auth/register sets the session cookies in
            // this same response, so the visitor lands on their panel with
            // the welcome credits ready.
            const payload = await registerAccount({ name, email, password, newsletter: newsletterEl ? newsletterEl.checked : false });
            const session = payload && payload.data ? payload.data : payload;

            // Anuncia el registro: el checkout público de pagos (los packs
            // son visibles sin cuenta) consume este evento para desbloquear
            // el botón de pago SIN sacar a la persona de esta página. Si
            // nadie lo consume, el flujo normal es abrir el panel.
            const registered = new CustomEvent('aj:registered', { detail: session, cancelable: true });
            document.dispatchEvent(registered);

            if (registered.defaultPrevented) {
              // La superficie pública tomó el control: la sesión ya está
              // abierta y los 100 créditos de bienvenida acreditados. El
              // botón vuelve a su estado (finally) y la persona sigue aquí.
              return;
            }

            navigating = true;
            button.textContent = 'Abriendo tu panel…';
            window.location.assign(options.passwordRedirect || 'app.html');
            return;
          }

          if (usePassword) {
            // "Recordar sesión" is login-only: unchecked → session-scope
            // cookies. The checkbox is read wherever the login form has one
            // (registro/scan never touch it).
            const rememberCheckbox = form.querySelector('[name="remember"]');
            await loginWithPassword(email, password, rememberCheckbox ? rememberCheckbox.checked : true);
            navigating = true;
            button.textContent = 'Entrando…';
            window.location.assign(options.passwordRedirect);
            return;
          }

          await requestMagicLink({ name, email, newsletter: newsletterEl ? newsletterEl.checked : false });
          form.hidden = true;
          const success = form.parentElement.querySelector('[data-success]');
          success.querySelector('[data-success-email]').textContent = email;
          const recoveryNote = success.querySelector('[data-recovery-note]');
          if (recoveryNote) recoveryNote.classList.add('hidden');
          success.classList.remove('hidden');
        } catch (error) {
          setError(form, error.message, error.status === 401 ? PASSWORD_LOGIN_HINT : '');
        } finally {
          if (!navigating) {
            button.disabled = false;
            button.textContent = originalText;
          }
        }
      });
    }

    // "Olvidé mi contraseña": request a magic link for the typed email and
    // explain, kindly, that the link logs them in and Perfil lets them set a
    // new password.
    (function wireRecoveryLink() {
      const link = document.getElementById('login-recover');
      const form = document.getElementById('form-login');
      if (!link || !form) return;

      link.addEventListener('click', async () => {
        clearError(form);

        const emailInput = form.querySelector('[name="email"]');
        const email = (emailInput.value || '').trim();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setError(form, 'Escribe tu correo para enviarte el enlace de acceso (ejemplo: nombre@correo.cl).');
          emailInput.focus();
          return;
        }

        const originalText = link.textContent;
        link.disabled = true;
        link.textContent = 'Enviando enlace…';

        try {
          await requestMagicLink({ name: '', email, newsletter: false });
          form.hidden = true;
          const success = form.parentElement.querySelector('[data-success]');
          success.querySelector('[data-success-email]').textContent = email;
          const recoveryNote = success.querySelector('[data-recovery-note]');
          if (recoveryNote) recoveryNote.classList.remove('hidden');
          success.classList.remove('hidden');
        } catch (error) {
          setError(form, error.message);
        } finally {
          link.disabled = false;
          link.textContent = originalText;
        }
      });
    })();

    // ----- Password reveal (eye icon) + advisory strength meter -----
    // Same contract as the main panel: aria-pressed mirrors the revealed
    // state, delegated listeners so any future password field works, and
    // the meter is ADVISORY ONLY (real limits live server-side, bcrypt).
    // Copy is zero-blame: guide, never scold.
    document.addEventListener('click', (event) => {
      const button = event.target && event.target.closest
        ? event.target.closest('button[data-password-eye]')
        : null;
      if (!button || !document.contains(button)) return;
      const input = button.parentElement.querySelector('input');
      if (!input) return;
      const willShow = input.type !== 'text';
      input.type = willShow ? 'text' : 'password';
      button.setAttribute('aria-pressed', willShow ? 'true' : 'false');
      button.setAttribute('aria-label', willShow ? 'Ocultar contraseña' : 'Mostrar contraseña');
      button.setAttribute('title', willShow ? 'Ocultar contraseña' : 'Mostrar contraseña');
      const iconEye = button.querySelector('[data-eye-icon]');
      const iconEyeOff = button.querySelector('[data-eye-off-icon]');
      if (iconEye) iconEye.classList.toggle('hidden', willShow);
      if (iconEyeOff) iconEyeOff.classList.toggle('hidden', !willShow);
    });

    const PASSWORD_STRENGTH_FILL = { debil: 'bg-rose-400', media: 'bg-amber-400', segura: 'bg-emerald-500' };
    const PASSWORD_STRENGTH_COPY = {
      corta: 'Fortaleza de la contraseña: por empezar. 8+ caracteres, mezcla mayúsculas, minúsculas y números: entre más larga, más segura.',
      debil: 'Fortaleza de la contraseña: débil. Puedes reforzarla agregando mayúsculas, números o algunos caracteres más.',
      media: 'Fortaleza de la contraseña: media. Con 12 o más caracteres y un símbolo queda aún más segura.',
      segura: 'Fortaleza de la contraseña: segura. Bien: entre más larga, más difícil de adivinar.'
    };
    const PASSWORD_STRENGTH_FILLED = { corta: 0, debil: 1, media: 2, segura: 3 };

    function passwordStrength(value) {
      const hasLower = /[a-záéíóúüñ]/.test(value);
      const hasUpper = /[A-ZÁÉÍÓÚÜÑ]/.test(value);
      const hasDigit = /[0-9]/.test(value);
      const hasSymbol = /[^A-Za-z0-9áéíóúüñÁÉÍÓÚÜÑ]/.test(value);
      if (value.length >= 12 && hasUpper && hasLower && hasDigit && hasSymbol) return 'segura';
      if (value.length >= 10 && hasUpper && hasLower && hasDigit) return 'media';
      if (value.length >= 8 && (hasLower || hasUpper)) return 'debil';
      return 'corta';
    }

    function paintPasswordStrength(value, meter) {
      const level = passwordStrength(value);
      const filled = PASSWORD_STRENGTH_FILLED[level] || 0;
      meter.querySelectorAll('[data-strength-seg]').forEach((segment, index) => {
        const activeColor = index < filled ? PASSWORD_STRENGTH_FILL[level] : null;
        Object.keys(PASSWORD_STRENGTH_FILL).forEach((levelName) => {
          segment.classList.toggle(PASSWORD_STRENGTH_FILL[levelName], activeColor === PASSWORD_STRENGTH_FILL[levelName]);
        });
        segment.classList.toggle('bg-slate-200', !activeColor);
      });
      const text = meter.querySelector('[data-strength-text]');
      if (text) text.textContent = PASSWORD_STRENGTH_COPY[level];
      meter.classList.toggle('hidden', value.length === 0);
    }

    document.addEventListener('input', (event) => {
      const target = event.target;
      if (!target || !target.matches || !target.matches('input[data-strength-for]')) return;
      const meter = document.getElementById(target.dataset.strengthFor || target.getAttribute('data-strength-for'));
      if (meter) paintPasswordStrength(target.value || '', meter);
    });

    wireAuthForm('form-login', { requireName: false, loadingText: 'Enviando…', allowPassword: true, passwordRedirect: 'app.html' });
    wireAuthForm('form-registro', { requireName: true, loadingText: 'Creando tu cuenta…', passwordRequired: true, passwordRedirect: 'app.html' });

    // ============================== RECORDAR SESIÓN ==============================
    // Persisted opt-in (aj:remember): the panel reads it on every silent
    // /auth/refresh rotation so a remembered session stays persistent and an
    // un-remembered session keeps dying with the browser. Stored value:
    // '1' → true, absent or '0' → false.
    (function wireRememberSession() {
      const REMEMBER_KEY = 'aj:remember';
      const checkbox = document.getElementById('login-remember');

      if (!checkbox) return;

      try {
        checkbox.checked = localStorage.getItem(REMEMBER_KEY) === '1';
      } catch (_) { /* storage unavailable: markup default (unchecked) applies */ }

      checkbox.addEventListener('change', () => {
        try {
          localStorage.setItem(REMEMBER_KEY, checkbox.checked ? '1' : '0');
        } catch (_) { /* storage unavailable: the choice just survives the page */ }
      });
    })();

    // ============================== LOGGED-IN VISITOR ==============================
    // Owner (2026-10-22): "si el usuario está logeado el registro y form login
    // desaparecen del index, y los botones de header cambian a entrar a
    // panel". One /auth/me probe on load reflows the landing for a returning
    // user; on any failure the default (visitor) markup stays untouched.
    // Session knowledge for the scan flow (ldAuthedEmail + body dataset):
    // clicking "Escanear mi sitio" skips the email gate for a returning
    // visitor. It stays in memory/DOM only — never localStorage.
    let ldAuthedEmail = null;

    // Session-aware UI: the header CTAs and the Acceso cards follow the
    // session. It runs at boot AND when the account is created IN this very
    // page (the public checkout modal registers without reloading).
    function revealSessionUi(user) {
      if (!user) return;

      // Expose the session state for the rest of the page (the checkout
      // modal and the panel know who is signed in). httpOnly cookies stay
      // the only session store.
      document.body.dataset.ldAuthed = '1';
      ldAuthedEmail = typeof user.email === 'string' ? user.email.trim() : '';

      // Header: hide the auth links, reveal the panel entry. The theme
      // toggle carries no data-auth-links, so it is never touched.
      document.querySelectorAll('[data-auth-links]').forEach((el) => el.classList.add('hidden'));

      const enterPanel = document.getElementById('btn-enter-panel');
      if (enterPanel) enterPanel.hidden = false;

      // Acceso: hide login/registro cards and the heading, show the
      // welcome card (markup stays in the DOM, only hidden).
      const loginCard = document.getElementById('login');
      const registerCard = document.getElementById('registro');
      const welcome = document.getElementById('auth-welcome');
      const heading = document.querySelector('[data-auth-heading]');

      if (loginCard) loginCard.hidden = true;
      if (registerCard) registerCard.hidden = true;
      if (heading) heading.hidden = true;
      if (welcome) welcome.hidden = false;

      // Warm greeting with the first name, built via textContent — the
      // name is user-controlled and must never touch innerHTML.
      const name = typeof user.name === 'string' ? user.name.trim() : '';
      const firstName = name.split(/\s+/)[0] || '';
      const welcomeText = welcome?.querySelector('[data-welcome-text]');

      if (firstName && welcomeText) {
        welcomeText.textContent = `Bienvenido de nuevo, ${firstName}: ya tienes una sesión activa; tu panel te espera.`;
      }
    }

    // Una cuenta creada desde ESTA página (modal del checkout público) no
    // recarga la landing: el mismo evento que desbloquea el botón de pago
    // actualiza la UI de sesión.
    document.addEventListener('aj:registered', (event) => {
      const user = event.detail && event.detail.user;
      if (user) revealSessionUi(user);
    });

    (async function revealLoggedInState() {
      const enterPanel = document.getElementById('btn-enter-panel');

      enterPanel?.addEventListener('click', () => {
        window.location.assign('app.html');
      });

      try {
        const fetchMe = () => fetch(window.API('/auth/me'), {
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
        });
        let response = await fetchMe();

        // The short-lived access token can expire while the refresh cookie
        // is still valid (30-min access / httpOnly refresh): silently renew
        // once before giving up, so a logged-in visitor is not mistaken
        // for anonymous.
        if (response.status === 401) {
          const refreshed = await fetch(window.API('/auth/refresh'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Accept': 'application/json' },
          });
          if (refreshed.ok) response = await fetchMe();
        }

        const data = await response.json().catch(() => ({}));

        // Response shape: { success, data: { user, balance } } — flat
        // data.user never exists on /auth/me.
        const user = data && data.success ? data.data && data.data.user : null;

        if (!user) return;

        revealSessionUi(user);
      } catch (_) {
        // Network/backend hiccup: keep the visitor landing exactly as it is.
      }
    })();

    // ============================== LIGHTBOX ==============================
    // Click-to-zoom for the section screenshots (9 imgs, cursor-zoom-in).
    // One shared viewer: backdrop / × / Escape close it, focus is stored
    // and restored, and body scroll is locked while it is open.
    (function wireLightbox() {
      const box = document.getElementById('lightbox');

      if (!box) return;

      const img = box.querySelector('[data-lightbox-img]');
      const caption = box.querySelector('[data-lightbox-caption]');
      const close = box.querySelector('[data-lightbox-close]');
      let lastFocus = null;

      function openLightbox(source) {
        lastFocus = document.activeElement;
        img.src = source.currentSrc || source.src;
        img.alt = source.alt || '';
        caption.textContent = source.alt || '';
        box.hidden = false;
        document.body.style.overflow = 'hidden';
        close.focus();
      }

      function closeLightbox() {
        if (box.hidden) return;

        box.hidden = true;
        document.body.style.overflow = '';
        if (lastFocus && lastFocus.isConnected) lastFocus.focus();
        lastFocus = null;
      }

      document.querySelectorAll('img.cursor-zoom-in').forEach((el) => {
        el.addEventListener('click', () => openLightbox(el));
      });

      box.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) return;

        if (event.target.hasAttribute('data-lightbox-backdrop') || event.target.closest('[data-lightbox-close]')) {
          closeLightbox();
        }
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeLightbox();
      });
    })();

    // ============================== CONTACT ==============================
    // Ported from the main landing's "Contáctanos" section: same POST
    // /contact contract (honeypot "website" empty, name/email/message).
    // User input only ever touches the DOM via textContent — never
    // innerHTML; the status copy stays warm and blame-free.
    (function wireContactForm() {
      const form = document.getElementById('contact-form');

      if (!form) return;

      const statusEl = document.getElementById('contact-status');
      const submit = form.querySelector('#contact-submit');
      const OK_CLASSES = ['border-emerald-200', 'bg-emerald-50/60', 'text-emerald-900'];
      // Failure keeps the file's existing rose error palette (amber is not
      // part of this landing's theme).
      const FAIL_CLASSES = ['border-rose-200', 'bg-rose-50', 'text-rose-800'];
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const GENERIC_ERROR = 'No pudimos enviarlo ahora; puedes reintentar en un momento.';

      function setFieldError(input, message) {
        const box = document.getElementById(input.id + '-error');

        if (!box) return;
        box.textContent = message;
        box.classList.remove('hidden');
      }

      function clearFieldErrors() {
        form.querySelectorAll('[id$="-error"]').forEach((box) => {
          box.textContent = '';
          box.classList.add('hidden');
        });
      }

      function showStatus(message, ok) {
        if (!statusEl) return;

        statusEl.classList.add('hidden');
        statusEl.classList.remove(...OK_CLASSES, ...FAIL_CLASSES);
        statusEl.classList.add(...(ok ? OK_CLASSES : FAIL_CLASSES));
        statusEl.classList.remove('hidden');
        statusEl.textContent = message;
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearFieldErrors();

        const nameInput = form.querySelector('[name="name"]');
        const emailInput = form.querySelector('[name="email"]');
        const messageInput = form.querySelector('[name="message"]');
        const honeypot = (form.querySelector('[name="website"]')?.value || '').trim();
        const name = (nameInput?.value || '').trim();
        const email = (emailInput?.value || '').trim();
        const message = (messageInput?.value || '').trim();

        if (name === '') {
          setFieldError(nameInput, 'Escribe tu nombre para saber cómo responderte.');
          nameInput?.focus();
          return;
        }

        if (!EMAIL_RE.test(email)) {
          setFieldError(emailInput, 'Escribe tu correo para que podamos responderte (ejemplo: nombre@correo.cl).');
          emailInput?.focus();
          return;
        }

        if (message === '') {
          setFieldError(messageInput, 'Cuéntanos brevemente en qué te podemos ayudar.');
          messageInput?.focus();
          return;
        }

        // Honeypot filled: a bot is in the field. Pretend success and keep
        // the request — and the table — clean, like the backend does.
        if (honeypot !== '') {
          form.reset();
          showStatus('Gracias. Recibimos tu mensaje; te escribiremos en breve.', true);
          return;
        }

        submit.disabled = true;
        const originalText = submit.textContent;
        submit.textContent = 'Enviando…';

        try {
          const response = await fetch(window.API('/contact'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, message, website: '' }),
          });
          const data = await response.json().catch(() => ({}));

          if (response.ok && data && data.success) {
            form.reset();
            showStatus('Gracias. Recibimos tu mensaje; te escribiremos a ' + email + ' en breve.', true);
          } else {
            showStatus(GENERIC_ERROR, false);
          }
        } catch (_) {
          showStatus(GENERIC_ERROR, false);
        } finally {
          submit.disabled = false;
          submit.textContent = originalText;
        }
      });
    })();
  