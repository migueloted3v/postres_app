/**
 * Postres App — servicio web (Google Apps Script)
 * Versión: 1.0.2
 *
 * Vive pegado a tu hoja de cálculo (Extensiones → Apps Script).
 * La app le manda y le pide datos con una clave; no necesita iniciar sesión con Google.
 *
 * Primera vez:
 *   1. Pega este archivo completo en el editor de Apps Script.
 *   2. Guarda, regresa a la hoja y recárgala. En el menú nuevo "Postres" elige
 *      "Configurar y ver clave": crea las pestañas y te muestra la clave de acceso.
 *      (También puedes ejecutar configurar() aquí; la clave sale en el registro.)
 *   3. Implementar → Nueva implementación → Aplicación web
 *      (Ejecutar como: Yo · Quién tiene acceso: Cualquier persona).
 *   4. Pega la URL /exec y la clave en Ajustes de la app.
 *   5. Llena los valores de la pestaña Cuenta (CLABE, beneficiario, etc.).
 */

const SCRIPT_VERSION = '1.0.2';
const TZ = 'America/Mexico_City';

let _tzHoja = null;
function tzHoja() {
  if (!_tzHoja) _tzHoja = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || TZ;
  return _tzHoja;
}

// Pestañas que la app puede leer y escribir, con su encabezado oficial.
const HOJAS = {
  Ventas:          ['Fecha','Ticket','Cliente','Categoría','Producto','Cantidad','Precio unitario','Total','Costo unitario','Costo total','Método de pago','ID producto'],
  Abonos:          ['Fecha','Cliente','Monto','Método'],
  Insumos:         ['Fecha','Categoría','Insumo','Contenido','Unidad','Precio','Proveedor'],
  Gastos:          ['Fecha','Categoría','Descripción','Monto','Proveedor'],
  CatalogoInsumos: ['Insumo','Categoría','Contenido','Unidad','Precio','Proveedor','Actualizado'],
  Productos:       ['ID','Producto','Categoría','Precio','Rinde','Activo','Actualizado'],
  Recetas:         ['ID producto','Insumo','Producto','Cantidad','Unidad','Activo','Actualizado'],
  Clientes:        ['Cliente','Canal','Alta'],
  Cuenta:          ['Campo','Valor']
};

// Bitácoras: solo se agregan renglones, nunca se modifican. Su primera columna es fecha.
const CON_FECHA = ['Ventas', 'Abonos', 'Insumos', 'Gastos'];

// Catálogos: un renglón por llave. Si la llave ya existe se actualiza el renglón; si no, se agrega.
const LLAVES = { CatalogoInsumos: [0], Productos: [0], Recetas: [0, 1], Clientes: [0] };

// Renglones de la pestaña Cuenta (el valor lo llenas tú en la hoja)
const CAMPOS_CUENTA = ['CLABE', 'Beneficiario', 'Institución', 'Celular (Dimo)'];

/* ---------- Menú en la hoja ---------- */

/** Agrega el menú "Postres" a la hoja de cálculo. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Postres')
    .addItem('Configurar y ver clave', 'mostrarClave')
    .addToUi();
}

/** Crea lo que falte y muestra la clave en una ventana, lista para copiar. */
function mostrarClave() {
  const clave = configurar();
  SpreadsheetApp.getUi().alert('Clave de acceso de la app',
    clave + '\n\nCópiala y pégala en Ajustes de la app, en "Clave de acceso".\n' +
    'No es el ID de la implementación: es este código de 20 caracteres.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ---------- Configuración inicial ---------- */

/** Ejecútala una sola vez desde el editor. Se puede repetir sin riesgo: no borra nada. */
function configurar() {
  const ss = SpreadsheetApp.getActive();
  if (ss.getSpreadsheetTimeZone() !== TZ) ss.setSpreadsheetTimeZone(TZ);
  Object.keys(HOJAS).forEach(asegurarHoja);
  inicializarCuenta();
  const clave = crearClave();
  Logger.log('Pestañas listas: ' + Object.keys(HOJAS).join(', '));
  Logger.log('Llena los valores de la pestaña Cuenta.');
  return clave;
}

function crearClave() {
  const props = PropertiesService.getScriptProperties();
  let clave = props.getProperty('APP_KEY');
  if (!clave) {
    clave = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    props.setProperty('APP_KEY', clave);
  }
  Logger.log('Tu clave de acceso es: ' + clave);
  return clave;
}

/** Úsala solo si crees que alguien más conoce tu clave. Después actualízala en la app. */
function cambiarClave() {
  PropertiesService.getScriptProperties().deleteProperty('APP_KEY');
  return crearClave();
}

/* ---------- Entrada web ---------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    validarClave(p.key);
    switch (p.action) {
      case 'ping':   return responder({ ok: true, version: SCRIPT_VERSION, tz: tzHoja(), hoja: SpreadsheetApp.getActive().getName() });
      case 'cuenta': return responder({ ok: true, filas: leer('Cuenta') });
      case 'todo':   return responder({ ok: true, version: SCRIPT_VERSION, datos: leerTodo() });
      default:       return responder({ ok: false, error: 'Acción no reconocida' });
    }
  } catch (err) {
    return responder({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    validarClave(body.key);
    if (body.action === 'append')    return responder(agregarFilas(body));
    if (body.action === 'upsert')    return responder(actualizarFilas(body));
    if (body.action === 'initHojas') return responder(inicializarHojas());
    return responder({ ok: false, error: 'Acción no reconocida' });
  } catch (err) {
    return responder({ ok: false, error: String(err.message || err) });
  }
}

/* ---------- Escritura ---------- */

/**
 * Agrega renglones a una bitácora. Cada envío trae un id único: si la app reintenta
 * un envío que sí llegó (se cortó la señal antes de la respuesta), no se duplica.
 */
function agregarFilas(body) {
  const hoja = body.sheet, filas = body.rows;
  if (!HOJAS[hoja] || CON_FECHA.indexOf(hoja) < 0) throw new Error('Pestaña no permitida: ' + hoja);
  if (!Array.isArray(filas) || filas.length === 0) return { ok: true, agregadas: 0 };

  const cache = CacheService.getScriptCache();
  const idKey = body.id ? 'env_' + body.id : null;
  if (idKey && cache.get(idKey)) return { ok: true, agregadas: 0, duplicado: true };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (idKey && cache.get(idKey)) return { ok: true, agregadas: 0, duplicado: true };
    const sh = asegurarHoja(hoja);
    const ancho = HOJAS[hoja].length;
    const normalizadas = filas.map(f => ajustarAncho_(f, ancho));
    // La fecha llega como texto "aaaa-mm-dd hh:mm:ss" y se guarda como fecha real
    normalizadas.forEach(r => { r[0] = aFecha(r[0]); });
    sh.getRange(sh.getLastRow() + 1, 1, normalizadas.length, ancho).setValues(normalizadas);
    if (idKey) cache.put(idKey, '1', 21600); // 6 horas
    return { ok: true, agregadas: normalizadas.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Catálogos (insumos, productos, recetas, clientes): si la llave del renglón ya existe
 * se actualiza ese renglón; si es la primera vez, se agrega al final. Nunca borra.
 * Repetir el mismo envío deja la hoja igual, así que no hay duplicados.
 */
function actualizarFilas(body) {
  const hoja = body.sheet, filas = body.rows, llave = LLAVES[hoja];
  if (!HOJAS[hoja] || !llave) throw new Error('Pestaña no permitida: ' + hoja);
  if (!Array.isArray(filas) || filas.length === 0) return { ok: true, actualizadas: 0, agregadas: 0 };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = asegurarHoja(hoja);
    const ancho = HOJAS[hoja].length;
    const n = Math.max(sh.getLastRow() - 1, 0);
    const actuales = n ? sh.getRange(2, 1, n, ancho).getValues() : [];
    const k = r => llave.map(c => String(r[c]).trim().toLowerCase()).join('\u0001');
    const indice = {};
    actuales.forEach((r, i) => { indice[k(r)] = i; });
    let actualizadas = 0, agregadas = 0;
    filas.forEach(f => {
      const r = ajustarAncho_(f, ancho);
      const i = indice[k(r)];
      if (i === undefined) { indice[k(r)] = actuales.length; actuales.push(r); agregadas++; }
      else { actuales[i] = r; actualizadas++; }
    });
    sh.getRange(2, 1, actuales.length, ancho).setValues(actuales);
    return { ok: true, actualizadas: actualizadas, agregadas: agregadas };
  } finally {
    lock.releaseLock();
  }
}

function ajustarAncho_(f, ancho) {
  const r = (f || []).slice(0, ancho).map(v => v == null ? '' : v);
  while (r.length < ancho) r.push('');
  return r;
}

/** Crea las pestañas que falten (con encabezado) y la pestaña Cuenta. No toca datos existentes. */
function inicializarHojas() {
  Object.keys(HOJAS).forEach(asegurarHoja);
  const c = inicializarCuenta();
  return { ok: true, hojas: Object.keys(HOJAS), cuentaCreada: c.creada };
}

/** Crea la pestaña Cuenta con sus campos vacíos. Si ya tiene datos, no la toca. */
function inicializarCuenta() {
  const sh = asegurarHoja('Cuenta');
  if (sh.getLastRow() > 1) return { ok: true, creada: false };
  sh.getRange(2, 2, CAMPOS_CUENTA.length, 1).setNumberFormat('@'); // CLABE y celular como texto
  sh.getRange(2, 1, CAMPOS_CUENTA.length, 2).setValues(CAMPOS_CUENTA.map(c => [c, '']));
  return { ok: true, creada: true };
}

function asegurarHoja(nombre) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(nombre);
  const enc = HOJAS[nombre];
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange(1, 1, 1, enc.length).setValues([enc]);
    sh.setFrozenRows(1);
    return sh;
  }
  const ultimaCol = Math.max(sh.getLastColumn(), 1);
  const actual = sh.getRange(1, 1, 1, ultimaCol).getValues()[0];
  if (actual.length < enc.length || actual.some((v, i) => i < enc.length && v === '')) {
    // Completa encabezados faltantes sin mover los existentes
    const nuevo = enc.map((h, i) => (actual[i] !== undefined && actual[i] !== '') ? actual[i] : h);
    sh.getRange(1, 1, 1, nuevo.length).setValues([nuevo]);
  }
  return sh;
}

/* ---------- Lectura ---------- */

function leer(nombre) {
  const sh = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = sh.getLastRow() - 1;
  const ancho = Math.max(sh.getLastColumn(), HOJAS[nombre].length);
  const valores = sh.getRange(2, 1, n, ancho).getValues();
  const conFecha = CON_FECHA.indexOf(nombre) >= 0;
  // La fecha se toma tal como se VE en la celda: así nunca se recorre por zonas horarias
  const textos = conFecha ? sh.getRange(2, 1, n, 1).getDisplayValues() : null;
  const fmt = v => v instanceof Date ? Utilities.formatDate(v, tzHoja(), 'yyyy-MM-dd HH:mm:ss') : v;
  return valores
    .map((r, i) => r.map((v, j) => (conFecha && j === 0) ? fechaCelda(v, textos[i][0]) : fmt(v)))
    .filter(r => r.some(v => v !== '' && v !== null));
}

function leerTodo() {
  const out = {};
  Object.keys(HOJAS).forEach(n => out[n] = leer(n));
  return out;
}

let _mdy = null;
function fechaEnOrdenMDY() {
  if (_mdy === null) _mdy = /^en[_-]US/i.test(SpreadsheetApp.getActive().getSpreadsheetLocale() || '');
  return _mdy;
}

/** Texto visible de la celda Fecha (4/10/2026 14:42:12, 2026-10-02…) → aaaa-mm-dd hh:mm:ss */
function fechaCelda(v, txt) {
  const t = String(txt || '').trim();
  const p2 = x => String(x).padStart(2, '0');
  const hora = (h, mi, se, ampm) => {
    let hh = Number(h || 0);
    if (ampm && /p/i.test(ampm) && hh < 12) hh += 12;
    if (ampm && /a/i.test(ampm) && hh === 12) hh = 0;
    return `${p2(hh)}:${p2(mi || 0)}:${p2(se || 0)}`;
  };
  let m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?)?/i);
  if (m) {
    const mdy = fechaEnOrdenMDY();
    return `${m[3]}-${p2(mdy ? m[1] : m[2])}-${p2(mdy ? m[2] : m[1])} ${hora(m[4], m[5], m[6], m[7])}`;
  }
  m = t.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?)?/i);
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])} ${hora(m[4], m[5], m[6], m[7])}`;
  if (v instanceof Date) return Utilities.formatDate(v, tzHoja(), 'yyyy-MM-dd HH:mm:ss');
  return v;
}

/* ---------- Utilidades ---------- */

function validarClave(k) {
  const clave = PropertiesService.getScriptProperties().getProperty('APP_KEY');
  if (!clave) throw new Error('Falta crear la clave: ejecuta configurar() en el editor');
  if (!k || k !== clave) throw new Error('Clave incorrecta');
}

function aFecha(v) {
  if (v instanceof Date || typeof v !== 'string') return v;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return v;
  const txt = `${m[1]}-${m[2]}-${m[3]} ${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
  return Utilities.parseDate(txt, tzHoja(), 'yyyy-MM-dd HH:mm:ss');
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
