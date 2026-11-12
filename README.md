# Postres App

App para capturar desde el celular la venta de postres, las compras de insumos, las recetas, los clientes y lo que deben. Es un solo archivo HTML publicado en GitHub Pages; los datos viven en una hoja de Google Sheets en tu Drive.

## Pestañas de la app

| Pestaña | Para qué |
|---|---|
| Inicio | Resumen (utilidad, ventas, por cobrar, ticket, artículos por cliente, gráficas) y Movimientos |
| Venta | Carrito con varios productos; cobro en efectivo con cambio, transferencia con CLABE o fiado. No muestra costos |
| Insumos | Captura de compras y gastos con proveedor; abajo lo capturado hoy |
| Recetas | Productos, precios y receta por producto; "Receta terminado" arma la lista de compra de un pedido |
| Clientes | Alta de clientes y total comprado |
| Deudores | Saldo por cliente, antigüedad y abonos |

## Instalación (una sola vez)

1. Crea una hoja de cálculo nueva en tu Google Drive.
2. En la hoja: **Extensiones → Apps Script**. Borra lo que haya y pega el contenido completo de `Code.gs`.
3. Guarda, regresa a la hoja y recárgala. En el menú **Postres → Configurar y ver clave** acepta los permisos: crea todas las pestañas, la pestaña **Cuenta** y te muestra la **clave de acceso** (un código de 20 caracteres; no es el ID de la implementación).
4. **Implementar → Nueva implementación → Aplicación web**. Ejecutar como: *Yo*. Quién tiene acceso: *Cualquier persona*. Copia la URL que termina en `/exec`.
5. En GitHub: **Settings → Pages → Deploy from a branch → main / root**. La app queda en `https://<usuario>.github.io/postres_app/`.
6. Abre la app en el celular, toca el engrane y pega la **URL** y la **clave**. Toca *Guardar y probar conexión*.
7. Llena los valores de la pestaña **Cuenta** en la hoja (CLABE, beneficiario, institución, celular) y toca *Sincronizar con mi hoja*.
8. En el celular: menú del navegador → **Agregar a pantalla de inicio**.

Opcional: en Ajustes, *Cargar productos y recetas de ejemplo* crea seis postres con recetas base, sin precios.

## Pestañas de la hoja

| Pestaña | Tipo | Contenido |
|---|---|---|
| Ventas | Bitácora | Un renglón por producto vendido, con precio y costo del momento |
| Abonos | Bitácora | Pagos de ventas fiadas |
| Insumos | Bitácora | Cada compra de ingrediente o empaque, con proveedor |
| Gastos | Bitácora | Gas, transporte y otros |
| CatalogoInsumos | Catálogo | Un renglón por insumo con su precio vigente |
| Productos | Catálogo | Lista de productos, categoría, precio y piezas que rinde |
| Recetas | Catálogo | Un renglón por producto e ingrediente |
| Clientes | Catálogo | Nombre y canal |
| Cuenta | Manual | Datos para transferencia; se llenan en la hoja |

Las bitácoras solo crecen: nunca se modifica un renglón. En los catálogos, un insumo, producto o ingrediente se agrega la primera vez y después se actualiza su renglón. Nada se borra: lo que ya no se usa se marca con `Activo = No`.

## Reglas de negocio

- **Costo congelado.** Cada venta guarda el precio y el costo por pieza de ese momento. Cambiar el precio de un insumo o de un producto solo afecta a las ventas siguientes.
- **Precio de insumos.** Se captura una compra; el catálogo toma el precio de la compra más reciente. La compra capturada no se edita.
- **Cobranza.** Los abonos de un cliente liquidan primero sus ventas fiadas más antiguas.
- **Sin señal.** Todo se guarda primero en el celular y se envía a la hoja cuando hay conexión. Un envío repetido no duplica renglones.
- **Utilidad bruta** = ventas menos costo de lo vendido según receta. La cascada de Inicio resta además los gastos capturados.

## Archivos

- `index.html`: la app completa.
- `Code.gs`: servicio de Google Apps Script que lee y escribe la hoja.
- `sw.js`, `manifest.json`, `icon.png`: permiten instalarla y abrirla sin señal.
