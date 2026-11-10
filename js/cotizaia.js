// =============================================================================
// CotizaIA - la pagina publica (Sistema A Rodriguez).
//
// QUE HACE ESTE ARCHIVO:
// - Prepara el formulario: valida lo escrito y lo envia sin recargar la
//   pagina, para que un error aparezca al lado y el visitante no pierda lo
//   que escribio.
// - Llama al endpoint PUBLICO de la plataforma y pinta la cotizacion en la
//   misma pagina: folio, lineas, total, observaciones, vigencia y la
//   descarga del PDF.
//
// QUE NO HACE:
// - No guarda ningun secreto y no necesita ningun servidor. El front es
//   estatico: no hay PHP ni configuracion con credenciales. El token de
//   servicio se queda en la plataforma (es servidor-a-servidor); el
//   navegador habla con un endpoint que no lo necesita.
// =============================================================================

import { apiUrl } from './api-base.js';

(function () {
    'use strict';

    var form = document.getElementById('cotizaia-form');

    if (!form) {
        return;
    }

    var consulta = document.getElementById('consulta');
    var email = document.getElementById('email');
    var aviso = document.getElementById('cotizaia-aviso');
    var boton = document.getElementById('cotizaia-enviar');
    var clave = document.getElementById('cotizaia-clave');
    var textoBoton = boton ? boton.textContent : 'Pedir cotización';

    // El resultado se pinta en la misma pagina: un contenedor que nace
    // oculto y las cajas donde cae cada dato de la cotizacion.
    var resultado = document.getElementById('cotizaia-resultado');
    var cajaFolio = document.getElementById('cotizaia-folio');
    var cajaMensaje = document.getElementById('cotizaia-mensaje');
    var cuerpoLineas = document.getElementById('cotizaia-lineas');
    var cajaTotal = document.getElementById('cotizaia-total');
    var cajaObservaciones = document.getElementById('cotizaia-observaciones');
    var cajaVigencia = document.getElementById('cotizaia-vigencia');
    var botonDescargar = document.getElementById('cotizaia-descargar');

    // La URL temporal del PDF: se suelta cuando la pagina se va o cuando
    // llega otra cotizacion, para no dejar archivos abiertos en el
    // navegador.
    var urlPdf = null;

    // La clave de idempotencia se genera una vez por carga de la pagina:
    // un doble clic no gasta dos cotizaciones, y una Cotizacion nueva (otra
    // carga) es una cotizacion nueva.
    function generarClave() {
        try {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                return window.crypto.randomUUID();
            }
        } catch (error) {
            /* sin randomUUID: se usa una cadena aleatoria simple */
        }

        return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    }

    if (clave) {
        clave.value = generarClave();
    }

    function mostrarAviso(mensaje, ok) {
        if (!aviso) {
            return;
        }

        aviso.textContent = mensaje;
        aviso.classList.toggle('cotizaia-aviso-ok', ok === true);
        aviso.classList.toggle('cotizaia-aviso-info', ok === 'info');
        aviso.hidden = !mensaje;
    }

    function validar() {
        var texto = (consulta && consulta.value ? consulta.value : '').trim();
        var correo = (email && email.value ? email.value : '').trim();

        if (texto.length < 10) {
            mostrarAviso('Cuéntanos un poco más sobre el proyecto: qué necesitas construir o reparar, y en qué tipo de vehículo o estructura.', false);
            if (consulta) { consulta.focus(); }
            return null;
        }

        if (texto.length > 4000) {
            mostrarAviso('La descripción es un poco larga. Cuentanos lo esencial en menos de 4000 caracteres.', false);
            if (consulta) { consulta.focus(); }
            return null;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) {
            mostrarAviso('Revisa el correo: no parece una dirección válida. Te enviamos la cotización ahí, y si algo falla te avisamos.', false);
            if (email) { email.focus(); }
            return null;
        }

        mostrarAviso('', false);

        return { consulta: texto, email: correo };
    }

    function trabajando(trabajando) {
        if (!boton) {
            return;
        }

        boton.disabled = trabajando;
        boton.textContent = trabajando ? 'Preparando tu cotización…' : textoBoton;
    }

    // El dinero se muestra como lo mostraba la pagina de resultado: pesos
    // sin decimales y con el punto de miles.
    function dinero(valor) {
        var numero = Number(valor);

        if (!isFinite(numero)) {
            return '$ 0';
        }

        return '$ ' + numero.toLocaleString('es-CL', { maximumFractionDigits: 0 });
    }

    // Las fechas de vigencia llegan como 'AAAA-MM-DD': se muestran en el
    // formato que se lee de un vistazo.
    function fecha(valor) {
        var texto = String(valor || '').trim();
        var partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);

        if (!partes) {
            return texto;
        }

        return partes[3] + '/' + partes[2] + '/' + partes[1];
    }

    function celda(texto, clase) {
        var elemento = document.createElement('td');
        elemento.className = clase;
        elemento.textContent = texto;
        return elemento;
    }

    function pintarLineas(lista) {
        if (!cuerpoLineas) {
            return;
        }

        cuerpoLineas.textContent = '';

        (lista || []).forEach(function (linea) {
            var fila = document.createElement('tr');
            fila.className = 'border-b border-slate-100';

            var producto = document.createElement('td');
            producto.className = 'py-2 pr-4';

            var nombre = document.createElement('span');
            nombre.className = 'block font-medium';
            nombre.textContent = String(linea.descripcion || linea.nombre || '');
            producto.appendChild(nombre);

            if (linea.codigo) {
                var codigo = document.createElement('code');
                codigo.className = 'text-xs text-slate-500';
                codigo.textContent = String(linea.codigo);
                producto.appendChild(codigo);
            }

            var cantidad = linea.cantidad !== undefined && linea.cantidad !== null
                ? String(linea.cantidad)
                : '';
            var unitario = linea.precio_unitario !== undefined && linea.precio_unitario !== null
                ? linea.precio_unitario
                : linea.precio;
            var subtotal = linea.subtotal !== undefined && linea.subtotal !== null
                ? linea.subtotal
                : linea.precio_total;

            fila.appendChild(producto);
            fila.appendChild(celda(cantidad, 'py-2 pr-4 text-right'));
            fila.appendChild(celda(dinero(unitario), 'py-2 pr-4 text-right'));
            fila.appendChild(celda(dinero(subtotal), 'py-2 text-right'));

            cuerpoLineas.appendChild(fila);
        });
    }

    // El PDF viaja dentro de la respuesta como base64: se convierte en un
    // archivo de verdad (Blob) y en una URL temporal que el navegador puede
    // bajar.
    function bytesDeBase64(base64) {
        var limpio = String(base64 || '');
        var coma = limpio.indexOf(',');

        // Si alguna vez llega como data URI, se corta la cabecera antes de
        // decodificar.
        if (limpio.slice(0, 5) === 'data:' && coma !== -1) {
            limpio = limpio.slice(coma + 1);
        }

        var binario = atob(limpio);
        var bytes = new Uint8Array(binario.length);

        for (var i = 0; i < binario.length; i++) {
            bytes[i] = binario.charCodeAt(i);
        }

        return bytes;
    }

    function soltarPdf() {
        if (!urlPdf) {
            return;
        }

        URL.revokeObjectURL(urlPdf);
        urlPdf = null;
    }

    function prepararPdf(base64, folioCotizacion) {
        if (!botonDescargar || !base64) {
            return;
        }

        soltarPdf();

        var url = URL.createObjectURL(new Blob([bytesDeBase64(base64)], { type: 'application/pdf' }));

        urlPdf = url;
        botonDescargar.href = url;
        botonDescargar.download = 'cotizacion-' + (folioCotizacion || 'ia') + '.pdf';
        botonDescargar.hidden = false;

        // El PDF queda descargado: el visitante no tiene que buscar un
        // boton, y el boton sigue ahi por si el navegador lo bloquea.
        botonDescargar.click();
    }

    // La URL temporal se suelta al salir de la pagina.
    window.addEventListener('pagehide', soltarPdf);

    function pintarCotizacion(datos) {
        if (!resultado) {
            return;
        }

        if (cajaFolio) {
            cajaFolio.textContent = datos.folio ? 'Cotización ' + datos.folio : 'Cotización';
        }

        if (cajaMensaje) {
            cajaMensaje.textContent = String(datos.mensaje || 'Tu cotización está lista.');
        }

        pintarLineas(datos.lineas);

        if (cajaTotal) {
            cajaTotal.textContent = dinero(datos.total);
        }

        if (cajaObservaciones) {
            var observaciones = String(datos.observaciones || '').trim();

            cajaObservaciones.textContent = observaciones;
            cajaObservaciones.hidden = observaciones === '';
        }

        if (cajaVigencia) {
            var partes = [];

            if (datos.vigente_desde) {
                partes.push('Vigente desde el ' + fecha(datos.vigente_desde) + '.');
            }

            if (datos.vigencia_hasta) {
                partes.push('Válida hasta el ' + fecha(datos.vigencia_hasta) + '.');
            }

            partes.push('Es un borrador generado con asistencia de IA: antes de convertirlo en oferta final, una persona de nuestro equipo lo revisa.');

            cajaVigencia.textContent = partes.join(' ');
            cajaVigencia.hidden = false;
        }

        resultado.hidden = false;

        prepararPdf(datos.pdf_base64, datos.folio);
    }

    form.addEventListener('submit', function (evento) {
        // El formulario es de JavaScript: la peticion va a la API desde el
        // navegador y el resultado se pinta en esta misma pagina.
        evento.preventDefault();

        if (!window.fetch || !window.Promise) {
            mostrarAviso('Tu navegador está muy viejo para enviar la cotización en línea. Puedes escribirnos desde el formulario de contacto de esta página y te cotizamos a mano.', false);
            return;
        }

        var datos = validar();

        if (!datos) {
            return;
        }

        trabajando(true);
        mostrarAviso('Estamos revisando tu proyecto contra nuestra lista de productos. Esto puede tardar hasta un minuto.', true);

        var cuerpo = {
            consulta: datos.consulta,
            email: datos.email
        };

        if (clave && clave.value) {
            cuerpo.idempotency_key = clave.value;
        }

        fetch(apiUrl('/cotizaia/cotizacion/publica'), {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json; charset=UTF-8'
            },
            // La cotizacion publica es anonima: no viaja la sesion del
            // visitante (ni hace falta, ni el endpoint la necesita).
            credentials: 'omit',
            body: JSON.stringify(cuerpo)
        }).then(function (respuesta) {
            return respuesta.json().catch(function () {
                return {};
            });
        }).then(function (json) {
            trabajando(false);

            if (json && json.success === true) {
                var datosCotizacion = json.data || {};

                // Una cotizacion sin lineas no es un error: la plataforma
                // reviso el proyecto y no encontro nada de nuestra lista.
                if (datosCotizacion.vacia === true) {
                    if (resultado) {
                        resultado.hidden = true;
                    }

                    mostrarAviso(String(datosCotizacion.mensaje || 'Revisamos tu proyecto y, por ahora, ninguno de los productos de nuestra lista corresponde a lo que necesitas.'), 'info');
                    return;
                }

                mostrarAviso('', false);
                pintarCotizacion(datosCotizacion);
                return;
            }

            // El mensaje de la plataforma se muestra tal cual: ella sabe
            // mejor que el front que paso y como explicarlo.
            var mensaje = '';

            if (json && json.error && json.error.message) {
                mensaje = String(json.error.message);
            }

            mostrarAviso(mensaje || 'No pudimos preparar tu cotización. Inténtalo nuevamente en unos minutos.', false);
        }).catch(function () {
            trabajando(false);
            mostrarAviso('No pudimos conectar con el servicio de cotizaciones. Revisa tu conexión e inténtalo nuevamente.', false);
        });
    });
})();
