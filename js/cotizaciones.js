// cotizaciones.js — CotizaIA: de la lista de precios a la cotización.
//
// QUÉ HACE ESTE MÓDULO
//   1. Reconoce en el chat dos mensajes que NO son preguntas: una lista de
//      precios pegada y un pedido de cotización. El front solo DETECTA;
//      el servidor valida, decide y cobra.
//   2. Habla con la API de cotizaciones: crear, listar, ver, editar,
//      borrar, reenviar y descargar el PDF.
//   3. Dibuja «Mis cotizaciones» y la ficha de la empresa (con su logo).
//
// LA REGLA DE ORO: el precio nunca sale de aquí. Lo pone el catálogo que
// la empresa publicó; el modelo solo elige qué productos y cuántas
// unidades. Este módulo solo muestra lo que el servidor devuelve.

import { apiUrl } from './api-base.js';
import { crearFormularioJson } from './json-form.js';

/** Un correo cualquiera (el destinatario de la cotización). */
const CORREO = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** La intención de cotizar: las palabras con las que se pide una cotización. */
const INTENCION = /(cotiza|cotizar|cotizaci|cotización|presupuesto|proforma|valoriza)/i;

/** Las columnas de una lista pegada: producto | precio. */
const SEPARADOR = '|';

/**
 * Identificador de una operación (idempotencia): el mismo intento con la
 * misma clave devuelve la misma cotización y nunca cobra dos veces.
 */
function operacionId() {
  if (typeof self !== 'undefined' && self.crypto && typeof self.crypto.randomUUID === 'function') {
    return self.crypto.randomUUID();
  }

  return 'cot_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function cabeceras(extra) {
  // El header Authorization SOLO viaja si hay token: un "Bearer " vacío o
  // un token caducado hacen que el backend descarte la sesión, aunque la
  // cookie httpOnly del login siga viva.
  const token = localStorage.getItem('jwt') || '';
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return Object.assign(headers, extra || {});
}

/**
 * Igual que cabeceras(), pero SIN forzar Content-Type: una subida con
 * FormData necesita que el navegador ponga su propio boundary multipart.
 * Forzar 'application/json' ahí rompe el archivo.
 */
function cabecerasMultipart(extra) {
  const token = localStorage.getItem('jwt') || '';
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return Object.assign(headers, extra || {});
}

/**
 * Una llamada a la API que devuelve los datos o lanza un error con el
 * mensaje que el servidor escribió para la persona (nunca una traza).
 */
async function pedir(ruta, opciones = {}) {
  const respuesta = await fetch(apiUrl(ruta), Object.assign({
    credentials: 'include',
    headers: cabeceras(),
  }, opciones));

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const error = (datos && datos.error) || {};
    const mensaje = (error && (error.message || error)) || 'No pudimos completar la acción. Inténtalo nuevamente en un momento, por favor.';
    const fallo = new Error(String(mensaje));
    fallo.codigo = (error && error.code) || '';
    fallo.estado = respuesta.status;
    throw fallo;
  }

  return datos;
}

// ---------------------------------------------------------------------------
// Detección: el front sospecha, el servidor decide.
// ---------------------------------------------------------------------------

function extraer(texto, patron) {
  const coincidencia = texto.match(patron);
  return coincidencia ? coincidencia[1].trim() : '';
}

/**
 * ¿El mensaje pide una cotización? Necesita el correo de destino (es
 * obligatorio), la intención de cotizar y algo que cotizar.
 *
 * @param {string} texto
 * @returns {{email: string, consulta: string, empresa: string, rut: string}|null}
 */
export function detectarSolicitud(texto) {
  const bruto = String(texto || '');
  const correo = bruto.match(CORREO);

  if (!correo) return null;
  if (!INTENCION.test(bruto)) return null;

  const consulta = bruto.trim();

  if (consulta.length < 10) return null;

  return {
    email: correo[0],
    consulta,
    empresa: extraer(bruto, /(?:empresa|raz[oó]n\s+social)\s*[:\-]\s*([^\n,;]+)/i),
    rut: extraer(bruto, /\brut\s*[:\-]\s*([0-9Kk.\-]{7,12})/i),
  };
}

/**
 * ¿El mensaje es una lista de precios pegada? Se sospecha cuando hay un
 * encabezado y al menos dos filas con columnas y un precio.
 *
 * @param {string} texto
 * @returns {boolean}
 */
export function detectarCatalogo(texto) {
  const lineas = String(texto || '')
    .split(/\r\n|\r|\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '' && !linea.startsWith('['));

  if (lineas.length < 3) return false;

  const conColumnas = lineas.filter((linea) => linea.includes(SEPARADOR));

  if (conColumnas.length < 3) return false;

  const conPrecio = conColumnas.filter((linea) =>
    linea
      .split(SEPARADOR)
      .slice(1)
      .some((celda) => /\d/.test(celda))
  );

  return conPrecio.length >= 2;
}

// ---------------------------------------------------------------------------
// API de cotizaciones
// ---------------------------------------------------------------------------

/**
 * Pide una cotización al servidor. Cuesta lo que diga la tarifa vigente
 * del heart; el servidor la cobra y devuelve el folio, las líneas y el
 * total (o explica que no encontró nada aplicable, sin cobrar).
 */
export async function crearCotizacion({ consulta, email, empresa, rut, operationId }) {
  const cuerpo = {
    consulta: String(consulta || '').trim(),
    email: String(email || '').trim(),
    operation_id: operationId || operacionId(),
  };

  if (empresa) cuerpo.empresa = empresa;
  if (rut) cuerpo.rut = rut;

  const datos = await pedir('/cotizaia/cotizacion', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });

  return datos.data || {};
}

/** Las cotizaciones de la cuenta (resumen: folio, destinatario, total). */
export async function listarCotizaciones() {
  const datos = await pedir('/cotizaia/cotizaciones');
  return (datos.data && datos.data.cotizaciones) || [];
}

/** Una cotización con su JSON y el HTML que el motor imprime como PDF. */
export async function detalleCotizacion(sourceId) {
  const datos = await pedir(`/cotizaia/cotizacion/${encodeURIComponent(sourceId)}`);
  return datos.data || {};
}

/** Guarda los datos que una persona puede cambiar (el folio y los precios no). */
export async function actualizarCotizacion(sourceId, campos) {
  const datos = await pedir(`/cotizaia/cotizacion/${encodeURIComponent(sourceId)}`, {
    method: 'PUT',
    body: JSON.stringify(campos || {}),
  });

  return datos.data || {};
}

/** Borra una cotización. */
export async function eliminarCotizacion(sourceId) {
  await pedir(`/cotizaia/cotizacion/${encodeURIComponent(sourceId)}`, { method: 'DELETE' });
}

/**
 * Reenvía el PDF de la cotización al correo del solicitante. Lo manda el
 * sistema (desde no-reply@djlabs.cl) con el correo del usuario como
 * respuesta, para que la conversación siga donde corresponde.
 */
export async function reenviarCotizacion(sourceId, destinatario) {
  const cuerpo = {};
  const correo = String(destinatario || '').trim();
  if (correo) cuerpo.destinatario = correo;

  const datos = await pedir(`/cotizaia/cotizacion/${encodeURIComponent(sourceId)}/reenviar`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });

  return datos.data || {};
}

/**
 * Descarga el PDF: el JSON de la cotización se renderiza con la plantilla
 * y el motor de documentos lo imprime (el mismo camino que usa el escáner
 * de URL). Cuesta la tarifa vigente de descarga.
 */
export async function descargarPdf(sourceId, { onBalance } = {}) {
  const detalle = await detalleCotizacion(sourceId);
  const html = detalle.html || '';

  if (!html) {
    throw new Error('Esta cotización no tiene contenido para imprimir.');
  }

  const respuesta = await fetch(apiUrl('/documents/download'), {
    method: 'POST',
    credentials: 'include',
    headers: cabeceras(),
    body: JSON.stringify({
      html,
      templateId: 'cotizacion',
      format: 'pdf',
      operationId: operacionId(),
      heart: localStorage.getItem('heart_id') || 'cotizaia',
    }),
  });

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const error = (datos && datos.error) || {};
    const fallo = new Error(String((error && (error.message || error)) || 'No pudimos generar el PDF.'));
    fallo.codigo = (error && error.code) || '';
    throw fallo;
  }

  if (typeof datos.new_balance === 'number' && typeof onBalance === 'function') {
    onBalance(datos.new_balance);
  }

  const binario = atob(datos.blob_base64 || '');
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);

  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = datos.filename || `cotizacion-${(detalle.cotizacion && detalle.cotizacion.folio) || 'documento'}.pdf`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);

  return datos;
}

// ---------------------------------------------------------------------------
// «Mis cotizaciones»: la lista del panel
// ---------------------------------------------------------------------------

function el(tag, clase, texto) {
  const nodo = document.createElement(tag);
  if (clase) nodo.className = clase;
  if (texto !== undefined && texto !== null) nodo.textContent = String(texto);
  return nodo;
}

function monto(valor) {
  const numero = Number(valor || 0);
  return '$' + numero.toLocaleString('es-CL', { maximumFractionDigits: 0 });
}

function fecha(iso) {
  if (!iso) return '';
  const fecha = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleDateString('es-CL');
}

function boton(texto, clase, alHacerClic) {
  const nodo = el('button', clase, texto);
  nodo.type = 'button';
  nodo.addEventListener('click', alHacerClic);
  return nodo;
}

// ---------------------------------------------------------------------------
// El editor: el formulario sale del JSON de la cotización
// ---------------------------------------------------------------------------

/** Las etiquetas del formulario: la clave del JSON y lo que se lee. */
const ETIQUETAS_COTIZACION = {
  tipo: 'Tipo de documento',
  folio: 'Folio',
  empresa: 'Empresa del cliente',
  empresa_rut: 'RUT de la empresa',
  empresa_generadora: 'Tu empresa (quien cotiza)',
  empresa_generadora_rut: 'RUT de tu empresa',
  empresa_rubro: 'Tu rubro',
  logo_path: 'Tu logo',
  destinatario: 'Correo del cliente',
  consulta: 'Descripción del pedido',
  observaciones: 'Observaciones',
  lineas: 'Productos',
  subtotal_neto: 'Subtotal sin IVA',
  iva_total: 'IVA',
  total: 'Total',
  iva_tasa: 'Tasa de IVA',
  confianza: 'Confianza del análisis',
  vigencia_hasta: 'Válida hasta',
  vigente_desde: 'Vigente desde',
  creado_at: 'Creada el',
  actualizado_at: 'Actualizada el',
  envios: 'Correos enviados',
  enviado_at: 'Último envío',
  duplicados: 'Duplicados',
  'lineas.*.descripcion': 'Producto',
  'lineas.*.cantidad': 'Cantidad',
  'lineas.*.precio_unitario': 'Precio unitario',
  'lineas.*.iva_incluido': 'El precio ya incluye IVA',
  'lineas.*.nota': 'Nota',
  'lineas.*.codigo': 'Código del catálogo',
};

/** Lo que la plataforma calcula: se muestra, pero no se toca. */
const BLOQUEADOS_COTIZACION = [
  'folio', 'subtotal_neto', 'iva_total', 'total',
];

/**
 * Lo que NO es un campo del formulario:
 *   - los cálculos de cada línea (se ven en el resumen de la cotización);
 *   - los metadatos de la plataforma (el tipo de documento, el logo, los
 *     contadores y las fechas): se leen en el encabezado y en la vista del
 *     JSON, no hacen falta como campos.
 */
const OCULTOS_COTIZACION = [
  'tipo', 'empresa_generadora', 'empresa_generadora_rut', 'empresa_rubro',
  'logo_path', 'iva_tasa', 'confianza', 'vigencia_hasta', 'vigente_desde',
  'creado_at', 'actualizado_at', 'envios', 'enviado_at', 'duplicados',
  'lineas.*.unidad', 'lineas.*.categoria', 'lineas.*.es_mano_obra',
  'lineas.*.subtotal', 'lineas.*.precio_neto', 'lineas.*.iva_unitario',
  'lineas.*.precio_total', 'lineas.*.subtotal_neto', 'lineas.*.subtotal_iva',
  'lineas.*.subtotal_total',
];

/** La explicación de los campos que la plataforma tiene bloqueados. */
const NOTAS_COTIZACION = {
  folio: 'La plataforma numera las cotizaciones: no se puede cambiar.',
  subtotal_neto: 'Sin IVA.',
  iva_total: 'El IVA que corresponde.',
  total: 'La suma: lo calcula la plataforma.',
  'lineas.*.codigo': 'Viene del catálogo; cámbialo si el producto no está en la lista.',
};

/**
 * Los campos que son números aunque el JSON los guarde como texto: el
 * precio guardado es "185000.00", y en el formulario es un campo numérico
 * de verdad (con teclado numérico y sin comas que estorben).
 */
const TIPOS_COTIZACION = {
  'lineas.*.cantidad': 'number',
  'lineas.*.precio_unitario': 'number',
  'lineas.*.iva_incluido': 'boolean',
};

/**
 * El IVA y los totales se recalculan en vivo, con la misma regla del
 * servidor: sin IVA el precio es el precio, y con IVA el precio es el
 * precio dividido por 1,19. Al guardar, el servidor vuelve a calcularlo
 * (su número es el que vale); esto es para que el JSON que se ve no mienta
 * mientras la persona escribe.
 *
 * @param {object} json
 */
function recalcularCotizacion(json) {
  const tasa = Number(json.iva_tasa || 0.19);
  const lineas = Array.isArray(json.lineas) ? json.lineas : [];

  let totalNeto = 0;
  let totalIva = 0;

  for (const linea of lineas) {
    const cantidad = Number(linea.cantidad || 0);
    const precio = Number(linea.precio_unitario || 0);
    const neto = linea.iva_incluido
      ? Math.round((precio / (1 + tasa)) * 100) / 100
      : Math.round(precio * 100) / 100;
    const iva = Math.round(neto * tasa * 100) / 100;

    linea.subtotal = (precio * cantidad).toFixed(2);
    linea.precio_neto = neto.toFixed(2);
    linea.iva_unitario = iva.toFixed(2);
    linea.precio_total = (neto + iva).toFixed(2);
    linea.subtotal_neto = (neto * cantidad).toFixed(2);
    linea.subtotal_iva = (iva * cantidad).toFixed(2);
    linea.subtotal_total = ((neto + iva) * cantidad).toFixed(2);

    totalNeto += Number(linea.subtotal_neto);
    totalIva += Number(linea.subtotal_iva);
  }

  json.subtotal_neto = Math.round(totalNeto * 100) / 100;
  json.iva_total = Math.round(totalIva * 100) / 100;
  json.total = Math.round((totalNeto + totalIva) * 100) / 100;
}

/**
 * Dibuja «Mis cotizaciones» en el panel: la lista con sus acciones
 * (descargar, editar, reenviar, borrar) y un aviso cuando no hay ninguna.
 *
 * @param {HTMLElement} host
 * @param {{onBalance?: (n: number) => void, onAviso?: (texto: string) => void, onError?: (e: Error) => void}} opciones
 */
export function montarCotizaciones(host, opciones = {}) {
  if (!host) return null;

  const lista = host.querySelector('[data-cotizaciones-lista]') || host;
  const vacio = host.querySelector('[data-cotizaciones-vacio]');
  const aviso = host.querySelector('[data-cotizaciones-aviso]');

  const avisar = (texto) => {
    if (!aviso) return;
    aviso.textContent = texto || '';
    aviso.classList.toggle('hidden', !texto);
  };

  const fallar = (error) => {
    const mensaje = (error && error.message) || 'No pudimos completar la acción.';
    avisar(mensaje);
    if (typeof opciones.onError === 'function') opciones.onError(error);
  };

  async function cargar() {
    try {
      const cotizaciones = await listarCotizaciones();
      lista.replaceChildren();

      if (vacio) vacio.classList.toggle('hidden', cotizaciones.length > 0);

      for (const cotizacion of cotizaciones) {
        lista.appendChild(fila(cotizacion));
      }

      return cotizaciones;
    } catch (error) {
      fallar(error);
      return [];
    }
  }

  function fila(cotizacion) {
    const item = el('li', 'rounded-xl border border-slate-200 bg-white p-4');

    const cabecera = el('div', 'flex flex-wrap items-start justify-between gap-3');
    const titulo = el('div', 'min-w-0');
    titulo.appendChild(el('p', 'text-sm font-semibold text-slate-900', cotizacion.folio || 'Cotización'));
    titulo.appendChild(el('p', 'text-xs text-slate-500', [
      cotizacion.empresa ? 'Para ' + cotizacion.empresa : '',
      cotizacion.destinatario ? '· ' + cotizacion.destinatario : '',
      cotizacion.productos ? '· ' + cotizacion.productos + ' producto(s)' : '',
      fecha(cotizacion.created_at) ? '· ' + fecha(cotizacion.created_at) : '',
    ].filter(Boolean).join(' ')));

    const total = el('p', 'text-sm font-semibold text-slate-900', monto(cotizacion.total));
    cabecera.append(titulo, total);
    item.appendChild(cabecera);

    const acciones = el('div', 'mt-3 flex flex-wrap gap-2');

    acciones.appendChild(boton('Descargar PDF', 'rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700', async () => {
      avisar('');
      acciones.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        await descargarPdf(cotizacion.source_id, {
          onBalance: (n) => { if (typeof opciones.onBalance === 'function') opciones.onBalance(n); },
        });
        avisar('Listo: el PDF se descargó.');
      } catch (error) {
        fallar(error);
      } finally {
        acciones.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    }));

    acciones.appendChild(boton('Editar', 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50', async () => {
      await abrirEditor(cotizacion, item, avisos => avisar(avisos));
    }));

    acciones.appendChild(boton('Enviar por correo', 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50', () => {
      abrirEnvio(cotizacion, item, avisos => avisar(avisos));
    }));

    acciones.appendChild(boton('Borrar', 'rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50', async () => {
      const ok = window.confirm('¿Borrar la cotización ' + (cotizacion.folio || '') + '? Esto no se puede deshacer.');
      if (!ok) return;
      avisar('');
      try {
        await eliminarCotizacion(cotizacion.source_id);
        await cargar();
        avisar('Listo: la cotización se borró.');
      } catch (error) {
        fallar(error);
      }
    }));

    item.appendChild(acciones);
    return item;
  }

  async function abrirEditor(cotizacion, item, avisar) {
    const existente = item.querySelector('[data-cotizacion-editor]');
    if (existente) {
      existente.remove();
      return;
    }

    // La lista trae el RESUMEN: para no perder lo que no se ve (las
    // observaciones o los productos, por ejemplo), el editor abre la
    // cotización COMPLETA, que es el JSON guardado en el RAG.
    let completa = null;
    try {
      const detalle = await detalleCotizacion(cotizacion.source_id);
      completa = detalle.cotizacion || null;
    } catch (_) { /* sin detalle se edita con el resumen */ }

    if (!completa) {
      // El resumen sirve de plan B: sin las llaves de la envoltura (el
      // identificador, el título y la fecha), que no son datos de la
      // cotización.
      completa = Object.assign({}, cotizacion);
      delete completa.source_id;
      delete completa.titulo;
      delete completa.created_at;
    }

    const editor = el('div', 'mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4');
    editor.dataset.cotizacionEditor = '1';

    // El JSON de trabajo: el formulario se arma con él y lo va cambiando.
    const json = JSON.parse(JSON.stringify(completa));
    let sucio = false;

    const cabecera = el('div', 'mb-3 flex flex-wrap items-center justify-between gap-2');
    cabecera.appendChild(el('p', 'text-xs font-semibold text-slate-700', 'Editar ' + (json.folio || 'la cotización')));

    // Lo que la persona necesita saber de un vistazo: hasta cuándo vale y
    // qué tan segura estaba la cotización que armó el análisis.
    const detalles = [];
    if (json.vigencia_hasta) detalles.push('Válida hasta el ' + fecha(json.vigencia_hasta));
    if (json.confianza) detalles.push('Confianza ' + json.confianza);
    if (detalles.length) {
      cabecera.appendChild(el('p', 'text-[11px] text-slate-500', detalles.join(' · ')));
    }

    const totalVivo = el('p', 'text-sm font-semibold text-slate-900', monto(json.total));
    cabecera.appendChild(totalVivo);
    editor.appendChild(cabecera);

    // El JSON se ve mientras se escribe: la persona ve exactamente lo que
    // se va a guardar.
    const vistaJson = el('pre', 'mt-2 max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100');
    vistaJson.textContent = JSON.stringify(json, null, 2);

    const form = crearFormularioJson(json, {
      etiquetas: ETIQUETAS_COTIZACION,
      bloqueados: BLOQUEADOS_COTIZACION,
      ocultos: OCULTOS_COTIZACION,
      notas: NOTAS_COTIZACION,
      tipos: TIPOS_COTIZACION,
      // Un producto nuevo: sin IVA (si nadie lo dice, no lo lleva).
      nuevoItem: () => ({ descripcion: '', cantidad: 1, precio_unitario: 0, iva_incluido: false, nota: '' }),
      alCambiar: () => {
        sucio = true;
        recalcularCotizacion(json);
        form.refrescar();
        totalVivo.textContent = monto(json.total);
        vistaJson.textContent = JSON.stringify(json, null, 2);
      },
    });

    const live = el('details', 'mt-3 rounded-lg border border-slate-200 bg-white p-3');
    live.appendChild(el('summary', 'cursor-pointer text-xs font-semibold text-slate-700', 'Ver el JSON (cambia mientras escribes)'));
    live.appendChild(vistaJson);

    editor.append(form.nodo, live);

    // Guardar: el servidor vuelve a calcular el IVA y los totales, y el
    // JSON queda regenerado en el RAG.
    const guardar = async () => {
      const cuerpo = {
        empresa: String(json.empresa || '').trim(),
        empresa_rut: String(json.empresa_rut || '').trim(),
        destinatario: String(json.destinatario || '').trim(),
        consulta: String(json.consulta || '').trim(),
        observaciones: String(json.observaciones || '').trim(),
        lineas: (Array.isArray(json.lineas) ? json.lineas : []).map((linea) => ({
          codigo: String(linea.codigo || ''),
          descripcion: String(linea.descripcion || ''),
          cantidad: Number(linea.cantidad || 0),
          precio_unitario: Number(linea.precio_unitario || 0),
          iva_incluido: Boolean(linea.iva_incluido),
          nota: String(linea.nota || ''),
        })),
      };

      const respuesta = await actualizarCotizacion(cotizacion.source_id, cuerpo);
      sucio = false;
      return respuesta;
    };

    const guardarSiCambio = async () => {
      if (sucio) await guardar();
    };

    const botones = el('div', 'mt-3 flex flex-wrap gap-2');

    botones.appendChild(boton('Guardar cambios', 'rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700', async () => {
      try {
        await guardar();
        editor.remove();
        await cargar();
        avisar('Listo: guardamos los cambios de la cotización.');
      } catch (error) {
        avisar((error && error.message) || 'No pudimos guardar los cambios.');
      }
    }));

    botones.appendChild(boton('Descargar PDF', 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50', async () => {
      try {
        await guardarSiCambio();
        editor.remove();
        await cargar();
        await descargarPdf(cotizacion.source_id, {
          onBalance: (n) => { if (typeof opciones.onBalance === 'function') opciones.onBalance(n); },
        });
        avisar('Listo: el PDF se descargó con los datos que editaste.');
      } catch (error) {
        avisar((error && error.message) || 'No pudimos preparar el PDF.');
      }
    }));

    botones.appendChild(boton('Enviar por correo', 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50', async () => {
      try {
        await guardarSiCambio();
        abrirEnvio(Object.assign({}, cotizacion, { destinatario: String(json.destinatario || '').trim() }), item, avisos => avisar(avisos));
      } catch (error) {
        avisar((error && error.message) || 'No pudimos guardar los cambios.');
      }
    }));

    botones.appendChild(boton('Cancelar', 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50', () => editor.remove()));
    editor.appendChild(botones);

    item.appendChild(editor);
  }

  function abrirEnvio(cotizacion, item, avisar) {
    const existente = item.querySelector('[data-cotizacion-envio]');
    if (existente) {
      existente.remove();
      return;
    }

    const box = el('div', 'mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4');
    box.dataset.cotizacionEnvio = '1';

    const etiqueta = el('label', 'flex flex-col gap-1 text-xs font-medium text-slate-700');
    etiqueta.appendChild(el('span', '', '¿A qué correo la enviamos?'));

    const input = document.createElement('input');
    input.type = 'email';
    input.value = cotizacion.destinatario || '';
    input.className = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none';
    etiqueta.appendChild(input);

    const botones = el('div', 'mt-3 flex flex-wrap gap-2');
    botones.appendChild(boton('Enviar ahora', 'rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700', async () => {
      try {
        const resultado = await reenviarCotizacion(cotizacion.source_id, input.value.trim());
        box.remove();
        avisar((resultado && resultado.mensaje) || 'Listo: enviamos la cotización por correo.');
        await cargar();
      } catch (error) {
        avisar((error && error.message) || 'No pudimos enviar la cotización.');
      }
    }));

    botones.appendChild(boton('Cancelar', 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50', () => box.remove()));

    box.append(etiqueta, botones);
    item.appendChild(box);
  }

  return { cargar, avisar };
}

// ---------------------------------------------------------------------------
// La ficha de la empresa (con su logo)
// ---------------------------------------------------------------------------

/**
 * Dibuja la ficha de la empresa: el logo (opcional), el nombre, el RUT y
 * el rubro que se imprimen en las cotizaciones. La misma ficha sirve en el
 * panel y en el perfil: el front la construye y la vuelve a pintar con los
 * datos que devuelve el servidor.
 *
 * @param {HTMLElement} host
 * @param {{prefijo?: string, usuario?: object, onGuardar?: (usuario: object) => void}} opciones
 */
export function montarEmpresa(host, opciones = {}) {
  if (!host) return null;

  const prefijo = opciones.prefijo || 'empresa';
  let usuario = opciones.usuario || {};

  // ---- La ficha (se construye aquí: el panel y el perfil usan la misma) ----
  const tarjeta = el('div', 'flex flex-col gap-4');

  const cabecera = el('div', 'flex flex-wrap items-start justify-between gap-4');

  const identidad = el('div', 'flex items-center gap-4');
  const logo = el('div', 'shrink-0');
  logo.dataset.empresaLogo = prefijo;

  const textos = el('div', 'min-w-0');
  const titulo = el('h2', 'text-base font-semibold text-slate-900', 'Datos de tu empresa');
  const resumen = el('p', 'mt-0.5 text-xs leading-relaxed text-slate-500');
  resumen.dataset.empresaResumen = prefijo;
  const ayuda = el('p', 'mt-1 text-xs leading-relaxed text-slate-500',
    'Esto es lo que aparece en el encabezado de las cotizaciones que preparas. El logo es opcional.');
  textos.append(titulo, resumen, ayuda);

  identidad.append(logo, textos);

  const botonEditar = el('button', 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700', 'Editar datos');
  botonEditar.type = 'button';
  botonEditar.dataset.empresaEditar = prefijo;

  cabecera.append(identidad, botonEditar);

  const aviso = el('p', 'hidden rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800');
  aviso.setAttribute('role', 'status');
  aviso.setAttribute('aria-live', 'polite');
  aviso.dataset.empresaAviso = prefijo;

  // ---- El formulario ----
  const form = el('form', 'mt-1 hidden flex-col gap-4');
  form.dataset.empresaForm = prefijo;

  const grilla = el('div', 'grid gap-4 sm:max-w-lg sm:grid-cols-2');

  const campo = (etiqueta, attrs, ayudaTexto) => {
    const label = el('label', 'flex flex-col gap-1 text-sm');
    label.appendChild(el('span', 'font-medium text-slate-700', etiqueta));
    const input = document.createElement('input');
    input.type = 'text';
    Object.entries(attrs).forEach(([clave, valor]) => { input.setAttribute(clave, valor); });
    input.className = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
    label.appendChild(input);
    if (ayudaTexto) label.appendChild(el('span', 'text-[11px] text-slate-500', ayudaTexto));
    return { label, input };
  };

  const nombre = campo('Nombre de la empresa', { 'data-empresa-nombre': '', maxlength: '120', placeholder: 'Carrocerías A. Rodríguez' });
  const rut = campo('RUT', { 'data-empresa-rut': '', maxlength: '12', placeholder: '12.345.678-5' }, 'Con punto y guión, ej: 12.345.678-5');
  grilla.append(nombre.label, rut.label);

  const rubroCaja = el('label', 'flex flex-col gap-1 text-sm sm:max-w-lg');
  rubroCaja.appendChild(el('span', 'font-medium text-slate-700', 'Rubro (opcional)'));
  const rubroInput = document.createElement('input');
  rubroInput.type = 'text';
  rubroInput.setAttribute('data-empresa-rubro', '');
  rubroInput.maxLength = 120;
  rubroInput.placeholder = 'Carrocería y reparación de vehículos';
  rubroInput.className = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
  rubroCaja.appendChild(rubroInput);

  const logoFila = el('div', 'flex flex-wrap items-center gap-3');
  const logoBoton = el('label', 'inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50');
  logoBoton.textContent = 'Elegir logo';
  const archivo = document.createElement('input');
  archivo.type = 'file';
  archivo.accept = 'image/png,image/jpeg,image/webp';
  archivo.className = 'hidden';
  archivo.dataset.empresaArchivo = prefijo;
  logoBoton.appendChild(archivo);

  const quitarLogo = el('button', 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:text-rose-600', 'Quitar logo');
  quitarLogo.type = 'button';
  quitarLogo.dataset.empresaQuitarLogo = prefijo;

  logoFila.append(logoBoton, quitarLogo, el('span', 'text-xs text-slate-500', 'JPG, PNG o WebP de hasta 2 MB.'));

  const guardar = el('button', 'rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700', 'Guardar datos');
  guardar.type = 'submit';

  // El botón va como hijo, no como texto: el helper el() pone el tercer
  // argumento como contenido, y un botón dentro de un texto se pierde.
  const botonCaja = el('div', '');
  botonCaja.appendChild(guardar);

  form.append(grilla, rubroCaja, logoFila, botonCaja);
  tarjeta.append(cabecera, aviso, form);
  host.replaceChildren(tarjeta);

  function avisar(texto, ok = true) {
    aviso.textContent = texto || '';
    aviso.classList.remove('hidden');
    aviso.classList.toggle('border-emerald-200', ok);
    aviso.classList.toggle('bg-emerald-50', ok);
    aviso.classList.toggle('text-emerald-800', ok);
    aviso.classList.toggle('border-amber-200', !ok);
    aviso.classList.toggle('bg-amber-50', !ok);
    aviso.classList.toggle('text-amber-900', !ok);
  }

  function pintar() {
    const nombreEmpresa = (usuario && usuario.empresa_nombre) || '';
    const rutEmpresa = (usuario && usuario.empresa_rut) || '';
    const rubroEmpresa = (usuario && usuario.empresa_rubro) || '';

    resumen.textContent = [nombreEmpresa || 'Sin nombre todavía', rutEmpresa, rubroEmpresa].filter(Boolean).join(' · ');

    logo.replaceChildren();
    const tieneLogo = !!(usuario && (usuario.empresa_logo || usuario.empresa_logo_path));

    if (tieneLogo && usuario.id) {
      const imagen = document.createElement('img');
      imagen.src = apiUrl('/logo/' + usuario.id) + '?v=' + Date.now();
      imagen.alt = 'Logo de la empresa';
      imagen.className = 'h-16 w-16 rounded-xl border border-slate-200 bg-white object-contain p-1';
      logo.appendChild(imagen);
    } else {
      const marca = el('div', 'flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400', 'Sin logo');
      logo.appendChild(marca);
    }

    nombre.input.value = nombreEmpresa;
    rut.input.value = rutEmpresa;
    rubroInput.value = rubroEmpresa;
  }

  botonEditar.addEventListener('click', () => {
    form.classList.toggle('hidden');
    botonEditar.textContent = form.classList.contains('hidden') ? 'Editar datos' : 'Ocultar edición';
  });

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    try {
      const datos = await pedir('/profile', {
        method: 'PUT',
        body: JSON.stringify({
          // El servidor exige el nombre de la cuenta: se manda el que ya
          // está, para no cambiarlo por accidente desde esta ficha.
          name: (usuario && usuario.name) || '',
          empresa_nombre: nombre.input.value.trim(),
          empresa_rut: rut.input.value.trim(),
          empresa_rubro: rubroInput.value.trim(),
        }),
      });

      const actualizado = (datos.data && datos.data.user) || usuario;
      usuario = Object.assign({}, usuario, actualizado);
      pintar();
      avisar('Listo: guardamos los datos de tu empresa.');
      if (typeof opciones.onGuardar === 'function') opciones.onGuardar(usuario);
    } catch (error) {
      avisar((error && error.message) || 'No pudimos guardar los datos de tu empresa.', false);
    }
  });

  archivo.addEventListener('change', async () => {
    const archivoElegido = archivo.files && archivo.files[0];
    archivo.value = '';

    if (!archivoElegido) return;

    if (archivoElegido.size > 2 * 1024 * 1024) {
      avisar('El logo pesa más de 2 MB. Elige uno de hasta 2 MB.', false);
      return;
    }

    const cuerpo = new FormData();
    cuerpo.append('logo', archivoElegido);

    try {
      const respuesta = await fetch(apiUrl('/profile/logo'), {
        method: 'POST',
        credentials: 'include',
        headers: cabecerasMultipart(),
        body: cuerpo,
      });
      const datos = await respuesta.json().catch(() => ({}));

      if (!respuesta.ok) {
        const error = (datos && datos.error) || {};
        throw new Error(String((error && (error.message || error)) || 'No pudimos subir el logo.'));
      }

      usuario = Object.assign({}, usuario, {
        empresa_logo_path: (datos.data && datos.data.empresa_logo_path) || 'logo',
        empresa_logo: (datos.data && datos.data.logo) || null,
      });
      pintar();
      avisar('Listo: actualizamos tu logo.');
      if (typeof opciones.onGuardar === 'function') opciones.onGuardar(usuario);
    } catch (error) {
      avisar((error && error.message) || 'No pudimos subir el logo.', false);
    }
  });

  quitarLogo.addEventListener('click', async () => {
    try {
      await pedir('/profile/logo', { method: 'DELETE' });
      usuario = Object.assign({}, usuario, { empresa_logo_path: null, empresa_logo: null });
      pintar();
      avisar('Listo: quitamos tu logo.');
      if (typeof opciones.onGuardar === 'function') opciones.onGuardar(usuario);
    } catch (error) {
      avisar((error && error.message) || 'No pudimos quitar el logo.', false);
    }
  });

  pintar();

  return {
    pintar,
    setUsuario(nuevo) {
      usuario = nuevo || usuario;
      pintar();
    },
  };
}
