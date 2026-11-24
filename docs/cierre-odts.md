# Cierre de ODT con cuenta de destino

Para recibir pagos parciales, usar varias cuentas o cobrar en otra moneda, consulta [Abonos progresivos de ODT](abonos-odts.md).

## Uso

En **Gestión de ODTs → Cerrar ODT**, seleccionar una ODT, revisar el monto pagado y escoger la **Cuenta de destino del pago**. Se muestran cuentas de la misma moneda que la ODT; el cierre no realiza una conversión automática. Revisar el porcentaje administrativo y las comisiones, y pulsar **Cerrar ODT**.

El formulario muestra el monto y la cuenta antes de enviar, impide envíos duplicados mientras está guardando y conserva los datos ante un rechazo. Tras cerrar, muestra el comprobante, recarga las ODT abiertas y permite consultar la cuenta y el monto recibido en el registro de ODT cerradas. Cambiar de ODT borra la cuenta anterior.

## Registro y cálculos

El servidor valida sesión, permiso de actualización de ODT, acceso a la ODT, cuenta, moneda, importe y comisiones. PostgreSQL bloquea la ODT y registra el cierre, el porcentaje administrativo y todos los movimientos en una sola transacción. Un segundo cierre devuelve conflicto sin volver a abonar dinero. Si falta un saldo contable en la cuenta seleccionada, se crea antes del abono.

Los importes usan `numeric(30,10)`. Los porcentajes admiten de 0 a 100% y tres decimales porcentuales. Se conserva la distribución existente: administración sobre el pago, comisiones sobre la ganancia después de gastos, y Taionca recibe el remanente más la recuperación de gastos. El remanente de redondeo queda en Taionca y se comprueba que los movimientos sumen exactamente el pago.

Los gastos generales ya representan el total pagado: no se vuelven a multiplicar por cantidad. El inventario usa el costo que quedó registrado en los movimientos; solo cuando no existe ese registro histórico se usa cantidad × precio × tasa. Así, una reposición que cambie el precio del inventario no modifica el costo original de una ODT.

Cuando una ODT tiene un importe final documentado, ese importe se usa para cerrar y el contrato original queda en el historial. Si el importe acordado es cero, la ODT puede cerrarse sin cuenta ni movimientos cuando carece de abonos, gastos contabilizados y horas pendientes.

Al registrar un gasto general, el saldo de Taionca debe cubrir el gasto en la cuenta elegida. Si existe un límite para esa cuenta y ODT, se descuenta el importe de ese límite. Una cuenta sin límite configurado puede usarse si dispone de saldo, también cuando está en otra moneda.

Se rechazan listas incompletas, usuarios duplicados dentro de un mismo cargo, comisiones que excedan 100%, usuarios sin entidad contable, nómina pendiente y pagos que no cubran gastos más administración. Un usuario puede participar en cargos distintos; sus abonos se agrupan por entidad.

## Correcciones relacionadas

- Comando `npm run build` compatible con las comillas del entorno Windows.
- Entrada de porcentajes sin pérdida de dígitos y almacenamiento de exactamente 100%.
- Resumen de cuentas con códigos de moneda en mayúsculas o minúsculas.
- Conversión de cada línea de inventario de una cotización una sola vez, sin reconvertir el subtotal acumulado.
- Normalización y validación de tasas entre monedas, incluida la misma moneda.
- La ruta antigua `/update_payroll_token` dirige a `/payroll`; el endpoint antiguo `/api/public/pay_payroll` responde 410 e indica la ruta actual, sin ejecutar pagos sin horas ni cuentas seleccionadas.

## Pruebas reproducibles

Desde la carpeta de beta:

```powershell
npm test
npm run test:all
```

`npm test` levanta un clúster local temporal, aplica las migraciones en una base nueva, carga datos ficticios y ejecuta Playwright contra un servidor en un puerto libre. Al terminar elimina la base y el clúster que creó. Puedes indicar un clúster de pruebas existente con `TEST_ADMIN_DATABASE_URL`. Consulta la [configuración de pruebas](../README.md#pruebas).

`npm run test:all` también compila cliente, servidor y service worker y verifica que la actualización conserva cierres y movimientos históricos. En Windows las pruebas usan Microsoft Edge. Usa `PLAYWRIGHT_CHANNEL` para elegir otro canal y `TEST_PORT` para elegir un puerto específico. Las pruebas bloquean los service workers para que no intercepten las respuestas simuladas.

Cobertura: cierre real desde la interfaz y por API; cuenta elegida e historial; comisiones; decimales y redondeos; porcentajes límite; errores y conservación de datos; concurrencia; reversión de transacciones; ingresos, inversiones, transferencias y cambios de moneda; préstamos; límites de recursos; nómina; compra y consumo de ambos tipos de inventario; cotizaciones; inicio de sesión; pantalla móvil; carga de todas las rutas principales.

Las conversiones se verifican con tasas controladas. La disponibilidad del proveedor externo de cotizaciones y el funcionamiento offline no forman parte de esta suite. Las pruebas de carga de rutas comprueban renderizado y peticiones iniciales; no sustituyen pruebas de cada posible operación de todos los módulos.

Resultados detallados: `test-results/results.json` y `playwright-report/index.html`. Para abrir el informe: `npx playwright show-report`.

## Migración y respaldo

La migración nueva es `1790632800000_safe-odt-closure.js`. Sustituye ambas firmas existentes de `closure_odt` y amplía seis columnas de porcentaje a `numeric(6,5)`. No recalcula cierres anteriores. La reversión restaura las funciones anteriores y conserva la amplitud de las columnas para no perder registros con 100%.

Respaldo previo en este PC: `C:\Proyectos\taionca-backups\odt-20260929\before-odt-closure.dump`. El archivo `before-counts.json` contiene conteos y huellas de los registros originales para comprobar la conservación de ODT, cierres, comisiones, saldos y movimientos después de aplicar la migración.

## Verificación realizada el 29 de septiembre de 2026

- **114 pruebas aprobadas**, 0 fallos, 0 omitidas y 0 inestables. La ejecución final de Playwright duró 48,7 segundos, además de la preparación y compilación.
- 43 rutas comprobadas en navegador, además de los recorridos interactivos de cierre y autenticación.
- Compilación de cliente, servidor y service worker completada. Persisten avisos de las dependencias antiguas de Sapper/Carbon, sin errores de compilación.
- 39 migraciones aplicadas desde cero en la base de pruebas; reversión y reaplicación de la nueva migración verificadas.
- Migración `1790632800000_safe-odt-closure` aplicada a la base local `taionca` del PC.
- Conservación verificada por conteos y huellas completas: **635 ODT, 293 cierres, 248 saldos, 3.366 movimientos** y todas las comisiones anteriores, sin modificaciones de sus registros.
- Respaldo PostgreSQL validado con `pg_restore --list`. Evidencia posterior: `after-counts.json` y `verification.json` en la carpeta de respaldo.
- Ninguna base temporal de pruebas quedó en el servidor.
- Se conservaron los cambios que ya existían en `README.md` y `docs/architecture`.

Los cambios y la migración están aplicados en el proyecto local del PC. No se realizó un despliegue en un alojamiento externo.
