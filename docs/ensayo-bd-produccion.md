# Ensayo de actualización de la base de producción a beta

## Copia local del 18 de noviembre de 2026

`beta/.env` apunta a `taionca_beta_prod_20261118` en `127.0.0.1:55433`. El PostgreSQL de ensayo es 13.23 y solo escucha en loopback. Se eligió la misma versión mayor que producción (13.15) porque el esquema histórico define `array_merge_agg(anyarray)` con `array_cat`. PostgreSQL 14 y posteriores usan la firma `anycompatiblearray` para ese agregado. Un respaldo de PostgreSQL 13 puede requerir adaptar esa definición si se restaura en PostgreSQL 17. La migración inicial de beta ya elige la firma correspondiente en bases nuevas. La actualización ensayada conserva la definición histórica con PostgreSQL 13.

La configuración previa quedó en `.local-runtime/beta-env-previo-20261118`. Corresponde a `taionca_migracion_20261010` en `127.0.0.1:55432` y tiene su propio clúster. `npm run dev:local` identifica la base de `.env`, arranca su clúster si hace falta y usa el puerto HTTP 3000. Con el archivo actual arranca la copia de producción con Node 24. Si se restaura el `.env` anterior, se recupera el lanzador del entorno de importación. Con el clúster correspondiente ya iniciado, `npm run dev` sigue disponible.

Si hay que reiniciar el PostgreSQL del ensayo, desde `beta` se puede ejecutar lo siguiente en PowerShell. Después, en la misma carpeta, iniciar la aplicación con Node 24 y `npm run dev`.

```powershell
$pgData = Join-Path $PWD '.local-runtime/pgdata-production-pg13'
$pgLog = Join-Path $PWD '.local-runtime/postgresql-production-pg13.log'
& 'C:/Program Files/PostgreSQL/13/bin/pg_ctl.exe' status -D $pgData
if ($LASTEXITCODE -ne 0) {
    & 'C:/Program Files/PostgreSQL/13/bin/pg_ctl.exe' start -D $pgData -l $pgLog -w
}
```

El archivo `produccion-dev-pg13.dump` y los inventarios del ensayo están en `C:/Proyectos/taionca-backups/beta-desde-produccion-20261118-143704`. Son archivos locales con datos de producción. Mantenerlos fuera de Git y compartirlos solo por los canales aprobados para esos datos.

## Cambios requeridos en el esquema

El respaldo contiene 38 migraciones aplicadas. La última es `1720296506624_SQL-closure-odts-2`, el esquema de cierre único. Los 38 nombres coinciden, en orden, con las primeras migraciones de `beta`. Se aplicaron las siguientes 15 con el migrador normal del proyecto. El esquema llegó a 53 migraciones y agregó 20 tablas vacías. La restauración tampoco requirió modificar el código de la aplicación.

1. Proteger el cierre único y agregar abonos, asignaciones y cierres por moneda. Los 192 cierres existentes conservan sus datos y quedan marcados como históricos (`settlement_mode='legacy'`, `settled_from_payments=false`). El esquema arranca con cero abonos nuevos y conserva las 218 ODT abiertas.
2. Añadir capacidades a los permisos existentes, versionado de sesión, registro de auditoría y protección del acceso. Se conservan los 41 permisos, 6 roles y 19 usuarios con sus asignaciones. Se verifica que las secuencias de IDs queden por encima de los registros existentes. Hay 20 permisos que reciben capacidades y 21 códigos CRUD históricos que se conservan sin capacidades asignadas por el mapa. Las operaciones de administración de roles y usuarios se rigen por la [política de permisos de beta](permisos-y-roles.md). Revisar el acceso efectivo de cada rol operativo antes de publicar y asignar solo las capacidades que correspondan.
3. Incorporar los registros de deudas, importes de cobro, aperturas de cuenta, ajustes de ahorros, facturación interna y retiros de utilidad. Estas migraciones habilitan operaciones futuras. En el ensayo se conservaron las 28 cuentas, 588 saldos y 3.777 movimientos originales.
4. Conservar seis gastos históricos con tasas fuera del rango válido, correspondientes a tres ODT abiertas. `valid_general_expense_rate` queda como `NOT VALID` para preservar esas filas y validar nuevos registros. El cierre de esas órdenes debe usar importes equivalentes documentados cuando haga falta la conversión. El flujo manual conserva los importes originales y registra la asignación en el cierre. Véase [cierres por moneda](cierres-moneda.md#gastos-y-utilidades-negativas).

Antes de migrar se compararon los conteos y la huella del contenido de las 59 tablas originales con el mismo snapshot usado por el respaldo. Después se cotejaron las columnas originales de 58 tablas. `pgmigrations` se verificó por separado contra los nombres de los 53 archivos presentes en el checkout. Las cifras anteriores corresponden a ese snapshot y deberán volverse a calcular para el corte real.

La migración `1791686000000_profit-withdrawals-category` agrega el valor de enum `profit_withdrawals` y lo confirma antes de que la siguiente migración lo utilice. Esa frontera divide el lote en transacciones. Si falla una ejecución, verificar `pgmigrations`, el valor del enum y la causa antes de continuar. En un destino de ensayo descartable, volver a restaurar desde el respaldo da un punto de partida verificable.

## Pruebas del ensayo

- La etapa de migraciones pasó en su clúster descartable. Verificó el cierre histórico, su contabilidad, las secuencias y el tratamiento de tasas históricas.
- La suite completa compiló la aplicación y pasó los 629 casos de Playwright en el navegador estándar configurado. La compilación emitió avisos de Svelte y Rollup.
- En `http://127.0.0.1:3000` se comprobó el inicio de sesión del administrador existente y el rechazo de una consulta sin sesión. Con la copia PostgreSQL 13 abierta se consultaron las 218 ODT abiertas, los 192 cierres, 588 saldos y 41 permisos. Se recuperó un resumen de cierre histórico y el formulario identificó las seis tasas inválidas al preparar el cierre de las tres ODT abiertas. No se registraron abonos ni cierres sobre la copia de producción para esta verificación.

## Procedimiento para publicar

1. Fijar el commit de `beta` a publicar y verificar compilación, pruebas y el historial aplicado de la base vigente. Confirmar que el release contiene los 53 archivos ensayados. En este checkout los tres archivos `1791690000000`, `1791690001000` y `1791690002000` aún no forman parte de un commit. Tomar un respaldo lógico consistente de producción con `pg_dump --format=custom` y una conexión de solo lectura. Guardar el archivo y comprobar que se puede restaurar. El tamaño del archivo por sí solo no verifica la copia.
2. Restaurar en una base nueva con la misma versión mayor de PostgreSQL para el primer corte. Usar un nombre y credenciales del destino claramente diferenciados. El ensayo usó `pg_restore --single-transaction --exit-on-error --no-owner --no-acl` para que los objetos pertenezcan al usuario local. En infraestructura de producción, preparar y validar los propietarios y privilegios de base que correspondan al entorno.
3. Verificar el destino con `SELECT current_database(), inet_server_addr(), inet_server_port()` y cotejar el prefijo de `pgmigrations`. Asignar `DATABASE_URL` explícitamente al **destino** antes de ejecutar `npm run migrate -- up` con el código del release. La compilación de `beta` es independiente de las credenciales de base. El proceso web recibe su `DATABASE_URL` al arrancar.
4. Comparar conteos y contenido original. Verificar las ODT abiertas y cerradas, abonos, gastos, comisiones, saldos por cuenta y moneda, permisos efectivos y el historial del cierre único. Ensayar la escritura con datos diseñados para pruebas. Si los datos históricos presentan excepciones, conciliarlas con sus comprobantes antes de cerrar las órdenes afectadas.
5. Durante el cambio de tráfico, establecer un único destino de escritura. Si se va a publicar usando una base restaurada, congelar las escrituras en la aplicación anterior y tomar la copia final dentro de esa ventana, o sincronizar de forma comprobable hasta ese punto. Ejecutar y verificar en la copia final los mismos pasos del ensayo, y después habilitar el tráfico en el release de `beta`.
6. Conservar la base original y el respaldo para recuperación. Antes de habilitar escrituras en el destino nuevo, se puede volver al servicio anterior. Una vez que la nueva base recibe escrituras, cualquier retorno requiere preservar y conciliar esos movimientos antes de redirigir tráfico. Preparar y ensayar esa recuperación antes del corte.
