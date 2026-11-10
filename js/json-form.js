// json-form.js — un JSON se vuelve un formulario editable.
//
// QUÉ HACE ESTE MÓDULO
//   Arma el formulario con la FORMA del JSON (sus claves y sus tipos), no
//   con una lista de campos escrita a mano. Así el mismo módulo sirve para
//   el editor de cotizaciones y para cualquier otro JSON del RAG: lo que
//   hay en el JSON es lo que aparece en el formulario.
//
// LAS REGLAS DE LA CASA
//   - Cada cambio escribe en el JSON de trabajo y avisa (alCambiar): el
//     JSON cambia en vivo mientras la persona escribe.
//   - Una ruta bloqueada se muestra, pero no se puede tocar.
//   - Una ruta oculta no se muestra (los cálculos se ven en su resumen).
//   - Un arreglo se puede agregar y quitar: la forma del nuevo elemento la
//     decide nuevoItem(ruta).
//
// USO
//   const form = crearFormularioJson(json, {
//     etiquetas: { empresa: 'Empresa', 'lineas.*.descripcion': 'Producto' },
//     bloqueados: ['folio', 'total'],
//     ocultos: ['lineas.*.precio_neto'],
//     nuevoItem: () => ({ descripcion: '', cantidad: 1 }),
//     alCambiar: (json) => console.log(json),
//   });
//   form.nodo.appendChild(algo);   // el formulario
//   form.refrescar();              // vuelve a pintar los valores bloqueados
//   form.json;                     // el JSON de trabajo (cambia en vivo)

const CLASES_INPUT = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none';

function nodo(tag, clase, texto) {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto !== undefined && texto !== null) n.textContent = String(texto);
  return n;
}

function boton(texto, clase, alHacerClic) {
  const n = nodo('button', clase, texto);
  n.type = 'button';
  n.addEventListener('click', alHacerClic);
  return n;
}

/**
 * Una ruta con comodín hace match con sus filas: 'lineas.*.descripcion'
 * hace match con 'lineas.0.descripcion' y con 'lineas.3.descripcion'.
 * Una ruta sin comodín además cubre lo que tiene debajo ('lineas' cubre
 * 'lineas.0.descripcion').
 */
function coincide(ruta, patron) {
  if (patron.indexOf('*') === -1) {
    return ruta === patron || ruta.startsWith(patron + '.');
  }

  const partes = patron.split('.');
  const reales = ruta.split('.');

  if (partes.length !== reales.length) return false;

  return partes.every((parte, i) => parte === '*' || parte === reales[i]);
}

/** 'empresa_rut' → 'Empresa rut' (cuando no hay una etiqueta a mano). */
function humanizar(clave) {
  const texto = String(clave || '').replace(/[_-]+/g, ' ').trim();

  if (!texto) return 'Campo';

  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Arma un formulario editable a partir de un JSON.
 *
 * @param {object} datos — el JSON de trabajo (se modifica en vivo)
 * @param {{etiquetas?: object, bloqueados?: string[], ocultos?: string[],
 *          notas?: object, tipos?: object, nuevoItem?: (ruta: string) => object,
 *          alCambiar?: (json: object) => void}} opciones
 *
 * @returns {{nodo: HTMLElement, json: object, refrescar: () => void}}
 */
export function crearFormularioJson(datos, opciones = {}) {
  const etiquetas = opciones.etiquetas || {};
  const bloqueados = opciones.bloqueados || [];
  const ocultos = opciones.ocultos || [];
  const notas = opciones.notas || {};
  const tipos = opciones.tipos || {};
  const nuevoItem = typeof opciones.nuevoItem === 'function' ? opciones.nuevoItem : () => ({});
  const alCambiar = typeof opciones.alCambiar === 'function' ? opciones.alCambiar : () => {};

  const json = datos && typeof datos === 'object' ? datos : {};
  const raiz = nodo('div', 'flex flex-col gap-4');

  // ruta -> { input, tipo, bloqueado }
  const inputs = new Map();

  function avisar() {
    alCambiar(json);
  }

  /**
   * La etiqueta de una ruta. Cuando varias la alcanzan, gana la más
   * específica: 'lineas.*.descripcion' le gana a 'lineas' (que además
   * cubre todo lo que hay debajo).
   */
  function etiquetaDe(ruta) {
    const etiqueta = mejor(ruta, etiquetas);
    if (etiqueta !== null) return etiqueta;

    return humanizar(ruta.split('.').pop());
  }

  function notaDe(ruta) {
    const nota = mejor(ruta, notas);
    return nota === null ? '' : nota;
  }

  /** El valor del mapa que mejor describe la ruta (la coincidencia más específica). */
  function mejor(ruta, mapa) {
    if (Object.prototype.hasOwnProperty.call(mapa, ruta)) return mapa[ruta];

    let elegido = null;
    let peso = -1;

    for (const patron of Object.keys(mapa)) {
      if (!coincide(ruta, patron)) continue;

      // Más niveles = más específico; a igual nivel, manda el texto más largo.
      const medida = patron.split('.').length * 1000 + patron.replace(/\*/g, '').length;
      if (medida > peso) {
        peso = medida;
        elegido = patron;
      }
    }

    return elegido === null ? null : mapa[elegido];
  }

  function esBloqueado(ruta) {
    return bloqueados.some((patron) => coincide(ruta, patron));
  }

  function esOculto(ruta) {
    return ocultos.some((patron) => coincide(ruta, patron));
  }

  /**
   * El tipo del campo: el que declara la persona (tipos) o, si no dice
   * nada, el del propio valor del JSON. Un precio guardado como texto
   * ("185000.00") es un número igual: se declara y el campo se vuelve
   * numérico de verdad.
   */
  function tipoDe(ruta, valor) {
    for (const patron of Object.keys(tipos)) {
      if (coincide(ruta, patron)) return tipos[patron];
    }

    if (typeof valor === 'boolean') return 'boolean';
    if (typeof valor === 'number') return 'number';

    return 'texto';
  }

  function valorEn(ruta) {
    if (!ruta) return json;

    let actual = json;

    for (const parte of ruta.split('.')) {
      if (actual === null || actual === undefined) return undefined;

      if (Array.isArray(actual)) {
        const indice = Number(parte);
        if (!Number.isInteger(indice)) return undefined;
        actual = actual[indice];
      } else if (typeof actual === 'object') {
        actual = actual[parte];
      } else {
        return undefined;
      }
    }

    return actual;
  }

  function leerValor(input, tipo) {
    if (tipo === 'boolean') return input.value === 'true';

    if (tipo === 'number') {
      const numero = Number(input.value);
      return Number.isFinite(numero) ? numero : 0;
    }

    return input.value;
  }

  function renderEscalar(ruta, valor, alCambiarValor) {
    const contenedor = nodo('label', 'flex flex-col gap-1 text-xs font-medium text-slate-700');
    contenedor.appendChild(nodo('span', '', etiquetaDe(ruta)));

    const bloqueado = esBloqueado(ruta);
    const tipo = tipoDe(ruta, valor);
    let input;

    if (tipo === 'boolean') {
      input = nodo('select', CLASES_INPUT);
      const si = nodo('option', '', 'Sí');
      si.value = 'true';
      const no = nodo('option', '', 'No');
      no.value = 'false';
      input.append(si, no);
      input.value = valor ? 'true' : 'false';
    } else if (tipo === 'number') {
      const numero = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
      // Un número guardado como texto ("185000.00") pasa a ser un número
      // de verdad: el JSON de trabajo y el campo dicen lo mismo.
      if (typeof valor !== 'number' && Number.isFinite(numero)) {
        alCambiarValor(numero);
      }

      input = nodo('input', CLASES_INPUT);
      input.type = 'number';
      input.step = 'any';
      input.value = Number.isFinite(numero) ? String(numero) : '';
    } else {
      const texto = valor === null || valor === undefined ? '' : String(valor);
      const largo = texto.length > 90;
      input = nodo(largo ? 'textarea' : 'input', CLASES_INPUT);
      // Un <textarea> no tiene atributo `type`: asignarlo lanza una
      // excepción (la propiedad es de solo lectura).
      if (!largo) input.type = 'text';
      if (largo) input.rows = 3;
      input.value = texto;
    }

    if (bloqueado) {
      input.disabled = true;
      contenedor.classList.add('opacity-70');
      const nota = notaDe(ruta);
      if (nota) contenedor.appendChild(nodo('span', 'text-[11px] font-normal text-slate-400', nota));
    }

    // La ruta del campo: el formulario se puede inspeccionar (y probar)
    // sin adivinar por el texto de la etiqueta.
    input.dataset.campo = ruta;

    // El campo va DENTRO de la etiqueta: así el texto es su nombre y
    // pincharlo enfoca el campo (como en cualquier formulario de verdad).
    contenedor.appendChild(input);

    input.addEventListener('input', () => {
      alCambiarValor(leerValor(input, tipo));
      avisar();
    });

    inputs.set(ruta, { input, tipo, bloqueado });

    return contenedor;
  }

  function renderObjeto(ruta, valor, alCambiarValor, titulo = null) {
    const esRaiz = ruta === '';
    const caja = nodo('div', esRaiz
      ? 'grid gap-3 sm:grid-cols-2'
      : 'rounded-xl border border-slate-200 bg-white p-3');

    // El título de una caja: el que le pasan (o el de la ruta). Los
    // elementos de un arreglo no lo llevan: sus campos ya se nombran
    // solos ("Producto", "Cantidad", "Precio unitario"...).
    const encabezado = titulo === null && !esRaiz ? etiquetaDe(ruta) : titulo;
    if (encabezado) {
      caja.appendChild(nodo('p', 'mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500', encabezado));
    }

    for (const clave of Object.keys(valor)) {
      const rutaHija = ruta ? ruta + '.' + clave : clave;
      if (esOculto(rutaHija)) continue;

      const hijo = renderNodo(rutaHija, valor[clave], (nuevo) => {
        valor[clave] = nuevo;
        alCambiarValor(valor);
      });

      caja.appendChild(hijo);
    }

    return caja;
  }

  function renderArreglo(ruta, valores, alCambiarValor) {
    const caja = nodo('div', 'flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3');

    const cabecera = nodo('div', 'flex items-center justify-between gap-2');
    cabecera.appendChild(nodo('p', 'text-xs font-semibold uppercase tracking-wide text-slate-500', etiquetaDe(ruta)));

    const cuerpo = nodo('div', 'flex flex-col gap-2');

    const limpiarRegistro = () => {
      for (const clave of Array.from(inputs.keys())) {
        if (clave === ruta || clave.startsWith(ruta + '.')) inputs.delete(clave);
      }
    };

    const pintar = () => {
      limpiarRegistro();
      cuerpo.replaceChildren();

      valores.forEach((item, indice) => {
        const fila = nodo('div', 'rounded-lg border border-slate-200 bg-slate-50 p-3');
        const rutaItem = ruta + '.' + indice;

        const hijo = renderNodo(rutaItem, item, (nuevo) => {
          valores[indice] = nuevo;
          alCambiarValor(valores);
        }, '');

        fila.appendChild(hijo);

        if (!esBloqueado(ruta)) {
          fila.appendChild(boton('Quitar', 'mt-2 rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] font-medium text-rose-600 transition hover:bg-rose-50', () => {
            valores.splice(indice, 1);
            pintar();
            avisar();
          }));
        }

        cuerpo.appendChild(fila);
      });
    };

    pintar();

    if (!esBloqueado(ruta)) {
      cabecera.appendChild(boton('+ Agregar', 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50', () => {
        valores.push(nuevoItem(ruta));
        pintar();
        avisar();
      }));
    }

    caja.append(cabecera, cuerpo);

    return caja;
  }

  function renderNodo(ruta, valor, alCambiarValor, titulo = null) {
    if (Array.isArray(valor)) return renderArreglo(ruta, valor, alCambiarValor);
    if (valor && typeof valor === 'object') return renderObjeto(ruta, valor, alCambiarValor, titulo);
    return renderEscalar(ruta, valor, alCambiarValor);
  }

  raiz.appendChild(renderNodo('', json, () => {}));

  /**
   * Vuelve a pintar los valores que la plataforma calcula (los bloqueados):
   * los totales se mueven mientras la persona escribe.
   */
  function refrescar() {
    for (const [ruta, registro] of inputs.entries()) {
      if (!registro.bloqueado) continue;

      const valor = valorEn(ruta);
      if (valor === undefined) continue;

      if (registro.tipo === 'boolean') {
        registro.input.value = valor ? 'true' : 'false';
      } else {
        registro.input.value = valor === null || valor === undefined ? '' : String(valor);
      }
    }
  }

  return { nodo: raiz, json, refrescar };
}
