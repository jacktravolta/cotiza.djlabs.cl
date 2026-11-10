    // API(path): backend endpoints. En 2-servidores apunta al API origin
    // (api-config.js); con '' el default same-origin.
    window.API = (function () {
      var base = (typeof window.__API_BASE__ === 'string')
        ? window.__API_BASE__.trim().replace(/\/+$/, '')
        : '';
      return function (path) { return base + path; };
    })();
  