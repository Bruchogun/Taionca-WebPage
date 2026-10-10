# Cierres de ODT por moneda e importes manuales

## Registrar abonos

En **Gestión de ODTs → Abonos de ODT**:

1. Selecciona la ODT y la cuenta donde recibiste el dinero.
2. Ingresa el monto recibido en la moneda de esa cuenta.
3. Si la cuenta tiene otra moneda, escribe el **Equivalente del abono en la moneda original de la ODT**. Por ejemplo: recibiste 1.500.000 COP y decides que ese pago representa 375 USD de una ODT en dólares.
4. Agrega una referencia si la necesitas y registra el abono.

No se solicita, deduce ni consulta una tasa. Los dos importes quedan registrados exactamente como los escribiste. Si las monedas coinciden, el equivalente es el mismo monto. El ingreso aumenta inmediatamente el saldo de Taionca en la cuenta que lo recibió; el equivalente solo determina cuánto se ha pagado de la ODT.

Los abonos anteriores registrados con tasa conservan su información histórica. La interfaz nueva usa el equivalente manual. Se mantienen la referencia única de cada abono, los reintentos sin duplicar ingresos y la recuperación de solicitudes pendientes después de recargar la misma pestaña.

## Elegir el cierre

En **Cerrar ODT**, selecciona una ODT completamente pagada. El formulario permite estas modalidades:

| Modalidad | Ingresos para calcular el resultado | Cuenta del reparto |
| --- | --- | --- |
| Moneda original de la ODT | Suma de los equivalentes registrados en los abonos | Una cuenta que elijas en la moneda original |
| Otra moneda recibida | Los abonos de esa moneda mantienen su importe; ingresas cuánto representa el total de cada otra moneda | Una cuenta que elijas en esa moneda |
| Mini cierres separados por moneda | Cada moneda tiene como ingreso su total abonado original | Las cuentas que recibieron los abonos de cada moneda |

Ejemplo: una ODT de 10.000 USD pagada con 5.000 USD, 10.000.000 COP y 10.200.800 VES puede cerrarse como tres mini cierres de esos importes. Los equivalentes de los abonos deben completar los 10.000 USD de la ODT; no se deducen a partir de los montos en COP o VES.

Los mini cierres se calculan por separado y **se confirman juntos**. Puedes ajustar administración, presidente y usuarios de comisión para cada moneda. No se cierra una moneda dejando las otras a medias. Cambiar la modalidad reinicia las asignaciones del formulario para evitar reutilizar importes en una moneda diferente.

La utilidad para comisiones de cada cierre se calcula como:

`ingresos − gastos generales asignados − inventario asignado − administración`

Las comisiones se calculan sobre esa utilidad. El importe mostrado para Taionca conserva la regla contable del sistema: incluye la recuperación de gastos, además del remanente de utilidades. Los saldos y resultados de distintas monedas nunca se suman como si fueran una sola moneda.

## Gastos y utilidades negativas

En los mini cierres, cada gasto conocido comienza asignado a su moneda original. Un gasto general usa el importe total registrado y la moneda de su cuenta; no vuelve a multiplicarse por cantidad. El inventario usa su costo y moneda del movimiento contable original, sin usar precios actuales ni tasas guardadas para convertirlo.

Si un cierre queda con utilidad negativa, se abre **Revisar o reasignar gastos manualmente**. Para cada gasto que quieras mover:

1. Selecciona la moneda del cierre que lo asumirá, entre las monedas disponibles.
2. Escribe el importe exacto que corresponde en esa moneda.
3. Revisa cómo cambian los gastos y las utilidades de ambos cierres.

Por ejemplo, si el mini cierre COP recibió 100 COP y tiene 200 COP de gastos, puedes elegir que ese gasto lo asuma el cierre USD e indicar manualmente su importe en dólares. El sistema no propone una tasa ni rellena el importe convertido.

Un gasto que permanece en su moneda conserva su importe original y no puede sobrescribirse desde el cierre. Si hay gastos en una moneda sin abonos, debes asignarlos expresamente a una moneda de cierre e ingresar su equivalente. Si un gasto antiguo de inventario carece de movimiento contable, se solicita el importe manual en lugar de estimarlo con el precio actual.

**Reasignar un gasto cambia qué resultado lo asume; no vuelve a descontar dinero de la cuenta.** El movimiento bancario original permanece intacto, y el historial del cierre guarda el importe y moneda originales junto con la asignación manual.

## Cambios de dinero entre cuentas

En un cierre de una sola moneda, el reparto se paga desde la cuenta que selecciones. Calcular las utilidades en esa moneda no convierte automáticamente el dinero de las otras cuentas.

Si necesitas registrar un cambio para disponer de saldo, abre **Cambios de moneda para disponer de saldo en la cuenta de reparto** y agrega:

- Una cuenta de origen que haya recibido abonos en otra moneda.
- El monto que sale de esa cuenta.
- El monto que llega a la cuenta elegida para el reparto.

Cada importe se escribe por separado. Antes de cerrar, el formulario muestra los movimientos concretos para confirmarlos. Los cambios y el reparto se registran en una sola transacción. También puedes cerrar sin agregar cambios si la cuenta de reparto ya tiene saldo suficiente de Taionca.

En los mini cierres, administración y comisiones se reparten dentro de las cuentas originales de cada moneda, proporcionalmente a sus ingresos y conservando los importes exactos después del redondeo.

Si falta saldo, hay nómina pendiente, una utilidad sigue negativa o falta un importe manual, no se completa el cierre. Si falla un cambio o una comisión, se revierten todos los movimientos de esa operación; los abonos previos permanecen registrados.

## Historial y consistencia

**Registro ODTs → ODTs cerradas** muestra:

- Todos los abonos con su moneda, monto y equivalente original.
- El resultado independiente de cada moneda y sus comisiones.
- Los importes de ingresos utilizados en el cálculo.
- Los gastos originales y sus asignaciones definitivas.
- Los cambios entre cuentas con sus importes de salida y llegada.

La cabecera muestra el equivalente total en la moneda original de la ODT. Los importes de utilidad se presentan en sus monedas correspondientes; no se fabrica un total convertido.

Si se agrega o modifica un gasto después de cargar la vista previa, el servidor rechaza el cierre y solicita recargarlo. Los gastos y horas de una ODT cerrada no pueden modificarse. Las cuentas que recibieron abonos, repartos o cambios de este cierre conservan su moneda.

Los cálculos usan enteros de escala decimal fija con 10 decimales y almacenamiento PostgreSQL `numeric(30,10)`. El servidor vuelve a calcular el plan con los datos bloqueados de la base antes de escribir. Los porcentajes admiten hasta tres decimales porcentuales y no pueden superar sus límites. No se consulta ningún proveedor de tasas para preparar o confirmar estos cierres.

## Implementación y pruebas

Migración: `1790709000000_manual-currency-closures.js`. Añade resultados, comisiones, gastos, valoraciones de ingresos y cambios por cierre; permite guardar abonos manuales sin tasa; protege gastos, horas y monedas. La reversión se bloquea si hay registros nuevos que se perderían.

Rutas nuevas: `GET /api/public/odt_settlement/:id_odt` para preparar un cierre y `POST /api/public/odt_settlement` para confirmarlo. Ambas verifican sesión, permiso de actualización y acceso a la ODT. El cierre directo anterior permanece disponible para una ODT sin abonos.

Desde `C:\Proyectos\taionca`:

```powershell
npm test
npm run test:all
```

Las pruebas usan una base temporal, aplican las 41 migraciones desde cero, comprueban reversión y reaplicación de la última migración y eliminan la base al terminar. La segunda orden también compila cliente, servidor y service worker. Las pruebas incluyen los módulos anteriores, la navegación de las 44 rutas principales, abonos manuales, los tres modos de cierre, pérdidas por moneda, reasignaciones, cambios bancarios, importes extremos, redondeos, permisos, concurrencia, errores, historial y móvil.

Respaldo anterior a esta ampliación: `C:\Proyectos\taionca-backups\cierres-moneda-20260929\before-cierres-moneda.dump`, validado con `pg_restore --list`. La misma carpeta conserva el código previo y la evidencia de las verificaciones. Los informes de pruebas están en `playwright-report/index.html` y `test-results/results.json`.

## Verificación final del 29 de septiembre de 2026

- **218 pruebas aprobadas**, cero fallos, omitidas o inestables. La ejecución final de Playwright duró 82,2 segundos, además de preparación y compilación.
- 48 pruebas adicionales respecto de la versión anterior, más la actualización de los recorridos de abonos al equivalente manual. Se ejecutó toda la batería anterior y la carga de las 44 rutas principales.
- Compilación de cliente, servidor y service worker aprobada en pruebas y con la configuración local. Persisten avisos de dependencias antiguas de Sapper/Carbon, sin errores de compilación.
- Las 41 migraciones se aplicaron desde cero en pruebas; se verificaron reversión y reaplicación de la última migración.
- La migración `1790709000000_manual-currency-closures` quedó aplicada a la base local `taionca` del PC.
- Conteos y huellas de todas las columnas originales coinciden con el respaldo: **635 ODT, 293 cierres, 248 saldos, 3.366 movimientos, 34 ingresos y todas las comisiones anteriores intactos**. También se verificaron las tablas de abonos y asignaciones previas.
- Cero abonos o mini cierres ficticios en la base real; cero bases temporales pendientes.
- Evidencia en la carpeta de respaldo: `before-counts.json`, `original-columns.json`, `after-counts.json`, `verification.json`, `all-tests-and-build.log` y `local-build.log`.

Los cambios están aplicados al proyecto y a su base local en el PC.
