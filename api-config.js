// api-config.js — the ONE deploy-time knob of the frontend.
//
// This file is plain JS (not an ES module) so index.html loads it BEFORE
// the modules, and the deploy can rewrite just this one file on the
// frontend server.
//
// The API origin is FIXED: https://api.djlabs.cl. It is the only valid
// target, in every environment (local, staging, production). Every call
// resolves against the API origin, never against the front's own domain:
// the API is the only one that knows about accounts, credits, documents
// and the RAG.
//
// There is deliberately NO ?api= override (removed 2026-11-09). A URL
// parameter could point a deployed page at a dead local origin, and that
// is exactly what happened in production once: the cached api-config.js
// pointed at http://127.0.0.1:8099 and the chat never reached the API.
//
// window.__API_BASE__ is still honoured, but ONLY when a test harness
// injects it before the page loads (tests/cdp.mjs, option apiBase). It is
// not reachable from the URL.
//
// The backend must trust this origin in its 'cors.origins' config (exact
// scheme+host+port, or a '*.djlabs.cl' rule). This front calls the public
// quotation endpoint without a session token; the other products of the
// platform share the same origin, and api.djlabs.cl and *.djlabs.cl are the
// SAME site (same registrable domain), so SameSite=Lax + HTTPS is enough —
// no 'None' needed.
(function () {
  var definido = (typeof window.__API_BASE__ === 'string') ? window.__API_BASE__.trim() : '';

  if (!definido) {
    // Production origin: the API lives on its own domain.
    definido = 'https://api.djlabs.cl';
  }

  window.__API_BASE__ = definido;
})();
