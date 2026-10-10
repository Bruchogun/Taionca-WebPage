# Auditoría funcional y seguridad de Taionca

Revisión del código de las páginas, componentes, rutas de API, funciones de PostgreSQL y migraciones. Las pruebas cubren cada módulo identificado y sus operaciones principales, además de errores, concurrencia y acceso. Una prueba de inventario verifica que cada página y ruta de API tenga una política de acceso explícita; otra carga todas las páginas y detecta excepciones y errores de servidor.

## Matriz de funciones y pruebas

Los archivos indicados están dentro de `tests/`. Las pruebas comprueban resultados de la API, la base de datos o el navegador; no se limitan a verificar que existan botones.

| Sistema y páginas | Función y comprobaciones | Pruebas |
|---|---|---|
| Inicio y cierre de sesión; cambio de contraseña | Credenciales válidas/incorrectas, normalización, rotación de sesión, contraseña confirmada, invalidación de sesiones anteriores, cierre real, límite de intentos, redacción de registros | `sign in/admin`, `security/sessions`, `security/cache`, `security/transaction`, `security/ui`, `audit/access`, `audit/catalog-users`, `audit/browser` |
| Administración de permisos | Crear/editar/eliminar permisos y roles, asignar/quitar roles, unión de permisos, revocación inmediata, historial, validación, último administrador y cambios simultáneos; interfaz móvil | `security/authorization`, `security/ui`, `audit/catalog-users` |
| Protección de páginas y API | Sesión obligatoria, permisos por operación, URL directa y navegación interna, API antigua, intento de elevar privilegios, origen de escrituras, denegación por defecto, funcionamiento con el rol mínimo | `audit/access`, `security/authorization`, `security/sessions`, `security/ui`, `admin/pages` |
| Usuarios y clientes | Alta normalizada y atómica, duplicados, campos requeridos, creación de entidad/saldos/deuda, datos públicos sin hash, alta de clientes desde formulario | `audit/catalog-users`, `audit/browser` |
| Responsabilidades: crear, asignar, actualizar, enviar y aprobar | Frecuencia diaria/semanal/quincenal/mensual, fin de mes y año bisiesto, vencimientos, autoría y evidencias, rechazo/reenvío/aprobación, creación de siguiente entrega una sola vez | `audit/responsibilities`, `audit/browser` |
| Asistencia | Entrada/salida juntas o separadas, horas y descanso, duplicados, fechas inválidas, concurrencia, privacidad, búsqueda y actualización del historial | `audit/attendance-payroll`, `audit/browser`, `security/authorization`, `security/ui` |
| Asignación de horas y nómina | Horas disponibles del servidor, exceso/concurrencia, vista previa, fórmula existente, reparto entre ODTs/cuentas, pago una sola vez, saldo insuficiente y reversión completa | `audit/attendance-payroll`, `audit/browser`, `admin/money-regression` |
| Cotizaciones y nueva ODT | Gastos generales/inventario/mano de obra, total calculado, consulta, creación desde cotización, conservación de porcentaje y límites iniciales | `audit/operations`, `audit/browser`, `admin/money-regression` |
| Límites y gastos generales | Consultar/actualizar límites, rechazo de gasto excesivo, actualización visual, moneda/cuenta válidas y precisión decimal | `audit/operations`, `audit/invalid-operations`, `audit/browser` |
| Abonos de ODT | Cuenta receptora, ingreso inmediato, importes en moneda recibida y equivalencia manual, pendiente, pagos sucesivos, concurrencia/reintento sin duplicar, sobrepago, titularidad e historial | `admin/odt-payments-api`, `admin/odt-payments-page`, `security/authorization` |
| Cierre de ODT y utilidades | Cuenta destino, porcentajes, gastos y nómina, distribución, saldos y movimientos, cierre único, permisos, datos inválidos, reversión ante fallos | `admin/calculations`, `admin/closure-api`, `admin/close_odt`, `admin/odt-payments-api` |
| Cierre en varias monedas | Moneda original/otra recibida/mini cierres conjuntos, gastos por moneda, corrección manual de déficits, cambios reales con débito/crédito explícitos, importes precisos, datos obsoletos y confirmación atómica | `admin/currency-settlement-api`, `admin/currency-settlement-page` |
| Consulta de ODTs abiertas/cerradas y movimientos | Gastos separados de abonos, cuenta/importe de cierre, asignaciones y utilidades por moneda, conservación histórica y acceso de solo lectura | `admin/close_odt`, `admin/odt-payments-page`, `admin/currency-settlement-api`, `security/ui` |
| Inventario consumible/no consumible | Altas, marcas, productos, proveedores, almacenes, medidas, reposición, gasto en ODT, existencias y cinco estados de control, stock insuficiente y reversión | `audit/operations`, `audit/browser` |
| Cuentas, monedas y entidades | Catálogos, alta de cuenta, saldos iniciales para entidades, selección de moneda | `audit/catalog-users`, `audit/operations`, `audit/browser` |
| Ingresos e inversiones | Incremento exacto de saldo/movimientos, decimales grandes, importes inválidos y reversión de operaciones fallidas | `admin/money-regression`, `audit/invalid-operations`, `audit/browser` |
| Gastos administrativos | Débito correcto y movimiento asociado, validación de monto/moneda, formulario | `audit/operations`, `audit/invalid-operations`, `audit/browser` |
| Transferencias y cambios de moneda | Conservación en transferencias, cuentas/entidades/monedas reales, importes de cambio ingresados por la persona, saldo insuficiente, formularios | `admin/money-regression`, `audit/invalid-operations`, `audit/browser` |
| Préstamos y pagos | Deuda y saldo, devolución, cronología, privacidad de datos, rechazo de importes incorrectos y formulario | `admin/money-regression`, `audit/operations`, `audit/invalid-operations`, `audit/browser`, `security/authorization` |
| Balances, registros, cierre de movimientos y gráfico | Saldos por moneda/entidad/cuenta, movimientos e instantáneas, orden estable, inclusión de todo el último día consultado | `audit/operations`, `admin/money-regression`, `admin/pages`, `security/ui` |
| Información, blog y errores | Navegación pública, contenido y respuesta 404 | `audit/browser`, `admin/pages` |
| Solicitudes antiguas de préstamo/cambio | Indicador de función pendiente y botón deshabilitado; las operaciones reales se hacen desde préstamos y cambio de moneda | `audit/browser`, `admin/pages` |
| Base de datos y compilación | Creación desde cero, todas las migraciones, reversión/reaplicación de la última, generación de constantes y compilación de servidor/cliente | `scripts/test.js --build` |

## Correcciones realizadas durante la revisión

- Secuencias de identificadores alineadas con los usuarios, roles y permisos ya importados para evitar colisiones futuras, sin cambiar sus registros.
- Autenticación y autorización centralizadas en el servidor, panel administrativo y pruebas de permisos efectivos. Las asignaciones reales se conservan y `special_user` deja de decidir el acceso administrativo o la consulta de asistencias.
- Transacciones y bloqueos para que asistencia, asignación de horas, nómina y responsabilidades no dupliquen resultados con solicitudes simultáneas.
- El consumo de inventario selecciona y bloquea una única cuenta financiadora, crea el saldo receptor cuando falta y registra débito, crédito y existencias en una sola transacción. Esto corrige un caso donde se debitaba dinero sin el crédito correspondiente.
- Importes monetarios conservados como decimales exactos; se rechazan importes negativos/cero/no numéricos y monedas manipuladas. No se convierten automáticamente valores negativos en positivos.
- Nómina pagada mediante un flujo funcional de selección, cálculo previo, pago y actualización. Se mantiene la fórmula histórica; las pruebas documentan sus tramos.
- Fechas recurrentes corregidas para finales de mes y entregas siguientes; aprobación con autor y evidencias guardados, sin confiar en esos campos enviados desde el navegador.
- Formularios actualizan sus datos después de guardar, conservan entradas cuando hay errores y comprueban la confirmación de contraseña. La navegación espera la verificación de acceso antes de mostrar una pantalla protegida.
- Consultas con orden determinista y rangos de fecha inclusivos. Rutas antiguas que apuntaban a estructuras inexistentes devuelven `410` con indicación del reemplazo.

## Cómo repetir las pruebas

En el equipo con Node, PostgreSQL y Edge configurados:

```sh
npm run test:all
```

El ejecutor crea una base temporal `taionca_test_odt_*`, aplica las migraciones, comprueba la reversión/reaplicación, instala datos ficticios, compila y ejecuta Playwright contra un servidor dedicado. Al terminar elimina esa base y restaura las constantes locales. Los datos de prueba no se insertan en la base de uso habitual.

El resultado detallado queda en `playwright-report/index.html` y `test-results/results.json`. Los fallos conservan captura y traza para diagnóstico. Puede ejecutarse una selección con `npm test -- tests/security` o con la ruta de otro archivo de pruebas.

Esta cobertura comprueba los escenarios registrados; no implica demostrar todos los estados posibles ni constituye una prueba de carga. Las dos pantallas antiguas de solicitud siguen identificadas como pendientes: no se presentan como funciones terminadas. Las operaciones reales de préstamos y cambio de moneda sí están cubiertas.

Véanse también [permisos-y-roles.md](permisos-y-roles.md), [abonos-odts.md](abonos-odts.md) y [cierres-moneda.md](cierres-moneda.md).

## Resultado final — 29 de septiembre de 2026

- `npm run test:all`: **607 aprobadas, 0 fallidas, 0 omitidas y 0 inestables**, en 2 minutos y 41 segundos. Son 218 pruebas de ODT/cálculos/páginas, 194 de auditoría funcional, 193 de seguridad y 2 de inicio de sesión, repartidas en 22 archivos.
- Política comprobada para 47 páginas y 99 combinaciones de método/ruta de API, con 28 operaciones que pueden agruparse en permisos.
- Las 42 migraciones se aplicaron en la base aislada. La última también pasó reversión/reaplicación y validación de secuencias de identificadores importados.
- `npm run build` completó la migración y compilación del proyecto habitual. Permanecen advertencias de las herramientas y componentes existentes; no hubo errores de compilación.
- La comparación de las columnas originales de 63 tablas con el respaldo no encontró diferencias en los registros. Se conservaron usuarios, roles, asignaciones y datos de negocio. Las columnas nuevas de seguridad son cambios de esquema previstos.
- No quedaron bases temporales de pruebas. Se conservó también el archivo README que ya estaba modificado antes de este trabajo.

Código actualizado en `C:\Proyectos\taionca`. Respaldos y evidencia final en `C:\Proyectos\taionca-backups\permisos-20260929`; incluye `before-permisos.dump`, `source-before-permisos.tar.gz`, `verification.json`, el registro de pruebas, el de compilación y los informes HTML/JSON. Los respaldos de las etapas anteriores están junto a esa carpeta.
