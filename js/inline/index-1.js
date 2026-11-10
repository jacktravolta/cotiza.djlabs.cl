    // No-flash theme boot: apply the visitor's stored tema before any
    // stylesheet paints. The heart's administered defaults (REST
    // /ui/theme?heart=) only fill what the visitor never chose;
    // /js/theme.js then wires the on-screen controls.
    (function () {
      try {
        // root = the ELEMENT (documentElement.dataset here would be the
        // DOMStringMap itself, and root.dataset.* inside it would write a
        // bogus data-dataset-* attribute — the reload-reverts-to-default
        // bug). The heart's administered theme applies after this script
        // (REST /ui/theme), solo si el visitante no eligió.
        var root = document.documentElement;
        var tema = localStorage.getItem('aj:tema');
        if (tema === 'dia' || tema === 'noche') root.dataset.tema = tema;
      } catch (error) { /* storage unavailable: markup defaults apply */ }
    })();
  