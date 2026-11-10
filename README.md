# cotiza.djlabs.cl — front estático (CotizaIA)

La puerta pública del servicio de **cotizaciones online**: el visitante describe
su proyecto y recibe la cotización en PDF por correo. Sin registro, sin costo y
sin que quede ni una fila en la base de datos de la empresa.

**Este front no tiene servidor.** No hay PHP, ni proxy, ni configuración con
credenciales: el navegador habla directo con la API y el resultado se pinta en
la misma página. Se puede publicar en GitHub Pages tal cual.

## Arquitectura: una sola llamada, del navegador a la API

```
VISITANTE ANÓNIMO (cotización)
   navegador ──POST JSON──▶ api.djlabs.cl/cotizaia/cotizacion/publica
                ◀── folio, líneas, total, PDF en base64 ──

CLIENTE CON CUENTA (panel, billetera, recargas, chat)
   navegador ──REST JSON + cookies──▶ api.djlabs.cl  (origen del backend)
     └─ CORS: el backend debe permitir este origen exacto
```

El endpoint de cotización **no pide token de servicio**: ese secreto es
servidor-a-servidor y jamás puede viajar al navegador. El front no guarda
ningún secreto.

## Qué hay aquí

| Archivo | Qué hace |
|---|---|
| `index.html` | La landing: hero, formulario de cotización, cómo funciona, qué obtienes, acceso (login/registro), recargas y contacto. |
| `app.html` | El panel del cliente: asistente de cotización, billetera, recargas, conversaciones, perfil y uso. |
| `contrasena.html`, `verificar.html` | Cerrar sesión con contraseña y confirmar el correo. |
| `js/cotizaia.js` | El formulario de cotización: valida, llama a la API pública y pinta folio, líneas, total, observaciones, vigencia y la descarga del PDF. |
| `js/chat-widget.js`, `js/checkout.js`, `js/topup.js` | Los módulos compartidos con la plataforma: hablan por `apiUrl()` (REST). |
| `api-config.js` | **La única perilla del despliegue**: el origen del backend para el navegador. |
| `js/theme.js`, `css/tokens.css`, `css/cotizaia.css` | El sistema de diseño (piel ámbar de la empresa). |

## El contrato con la API

El formulario manda `POST {API_BASE}/cotizaia/cotizacion/publica` con este
cuerpo:

```json
{ "consulta": "...", "email": "...", "idempotency_key": "..." }
```

- `idempotency_key` se genera **una vez por carga de la página**: un doble clic
  no produce dos cotizaciones.
- Respuesta `200`: `{ "success": true, "data": { "folio", "lineas", "total",
  "observaciones", "vigencia_hasta", "vigente_desde", "pdf_base64", "mensaje" } }`.
- Respuesta de error: `{ "success": false, "error": { "code", "message" } }`.
  El `message` se muestra **tal cual**: la plataforma sabe mejor que el front
  qué pasó y cómo explicarlo.
- Si la API no está disponible, el front lo dice con calma y **conserva lo que
  el visitante escribió** para que pueda reintentar sin volver a escribirlo.

El PDF llega en base64 dentro de la respuesta; el navegador lo convierte en un
archivo y lo deja listo para descargar (también llega por correo).

## Configuración

### El navegador → la API

`api-config.js` (un solo archivo, se reescribe en el deploy):

```js
window.__API_BASE__ = 'https://api.djlabs.cl';
```

El valor es **fijo**: el front siempre habla con la API, nunca consigo mismo.
El origen del front debe estar en la allowlist `cors.origins` del backend
(coincidencia exacta de esquema+host+puerto, o una regla `*.djlabs.cl`), y la
cookie de sesión debe viajar: `api.djlabs.cl` y `*.djlabs.cl` son el
**mismo sitio** (mismo dominio registrable), así que `SameSite=Lax` + HTTPS
alcanza — no hace falta `None`.

**En local** el origen **no** se cambia desde la URL: el override `?api=...`
se eliminó (2026-11-09) porque podía dejar un front ya desplegado apuntando a
un origen muerto — fue exactamente el bug que dejó el chat sin conexión en
producción, cuando un `api-config.js` cacheado apuntaba a
`http://127.0.0.1:8099`. Para correr contra una API local, el arnés E2E
inyecta `window.__API_BASE__` antes de cargar la página.

## Requisitos del servidor

- **Ninguno**: es un sitio de archivos estáticos (HTML, CSS, JS).
- HTTPS obligatorio en producción.
- `DirectoryIndex index.html` (por defecto en Apache y nginx).
- Las rutas de la página son **relativas**: el front funciona en la raíz del
  dominio o en un subdirectorio (por ejemplo, una página de proyecto de
  GitHub Pages).

## Cómo probarlo

```bash
# Servir el front (cualquier servidor estático sirve)
php -S 127.0.0.1:8812 -t cotiza.djlabs.cl

# Batería del front: verifica que no queda PHP de servidor, que el
# formulario es de JavaScript y que el front funciona en la raíz del
# dominio y en un subdirectorio
php tests/test_cotizaia_front.php
```

## Las reglas que este front no rompe

- **No escribe en la base de datos de la empresa.** La cotización vive en la
  plataforma (con su folio) y en el correo de quien la pidió.
- **Cero secretos.** Ni en el código, ni en un archivo de configuración, ni en
  una cabecera: el front es público.
- **Los errores se explican sin culpar a nadie** y sin dejar pantallas en
  blanco.
- **Cero `/api/*.php`**: todo va por REST JSON contra el backend.
