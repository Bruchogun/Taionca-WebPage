# Taionca

## Desarrollo local

Usa Node.js 24 LTS y una base PostgreSQL de desarrollo. Instala las dependencias con `npm ci`, copia `.env.template` a `.env` y configura `DATABASE_URL` y `SECRET_SESSION`. Configura `OPEN_EXCHANGE_RATES_APP_ID` para las operaciones que consultan tasas de monedas distintas. Los equivalentes manuales de abonos y cierres se registran sin ese proveedor.

```powershell
npm run migrate -- up
npm run dev
```

Ejecuta migraciones solo con la conexión del entorno que se está preparando. `npm run build` compila cliente, servidor y service worker de forma independiente. La imagen Docker tampoco requiere una conexión a PostgreSQL para construirse. `npm start` sirve la compilación con la configuración del entorno en el que se ejecuta.

En este equipo, `npm run dev:local` inicia el clúster local según `DATABASE_URL`. La configuración de importación usa la vista previa anterior. La [copia de producción](docs/ensayo-bd-produccion.md) usa Node 24 y su propio PostgreSQL 13. El lanzador requiere esos archivos del equipo. Por ejemplo, `powershell -File .\start-local.ps1 -Port 3001` cambia el puerto inicial. Las pruebas usan bases independientes.

## Pruebas

Las etapas con PostgreSQL arrancan un clúster temporal en loopback y lo eliminan al terminar. En este equipo usan los binarios de `.local-runtime/pgsql/bin`. En otros equipos, `initdb` y `pg_ctl` deben estar en `PATH`.

```powershell
npm run test:stage -- migrations
npm run test:all
```

Para usar un clúster descartable existente, define `TEST_ADMIN_DATABASE_URL` con una URL de PostgreSQL en loopback y un usuario que pueda crear bases. La aplicación de pruebas recibe una base nueva y una clave de sesión temporal. La selección del clúster de pruebas es independiente de `DATABASE_URL` y de `.env`. En Windows se usa Edge para las pruebas estándar. Para el chequeo en el motor de Safari, instala WebKit con `npx playwright install webkit` y ejecuta `npm run test:stage -- webkit`.

| Etapa de `npm run test:stage -- <etapa>` | Cobertura |
| --- | --- |
| `unit` | Casos autónomos de contabilidad, acceso y compras. |
| `migrations` | Actualización desde el esquema del cierre único, conservación del cierre y movimientos históricos, y secuencias de permisos. |
| `finance` | Cierres directos, abonos, distribuciones por moneda, gastos, saldos y retiros de utilidad. |
| `security` | Inicio de sesión, permisos, sesiones, revocaciones y control de acceso. |
| `ui` | Flujos del navegador, regresiones de interfaz y pantallas pequeñas. |
| `build` | Compilación independiente de la base. |
| `webkit` | Recorridos críticos de ODT, interfaz y permisos en WebKit. |

`npm run test:all` ejecuta la compilación, pruebas autónomas, actualización de esquema, retiros y todas las especificaciones versionadas de Playwright con el motor configurado. Los auxiliares de importación históricos del equipo dependen de sus datos y se ejecutan por separado. `npm test -- --grep "texto"` sirve para repetir un caso Playwright. El servidor de pruebas toma un puerto libre. Define `TEST_PORT` para elegir un puerto específico. Los resultados de Playwright quedan en `test-results` y `playwright-report`.

## Permisos y roles

Desde **Administración de permisos**, un administrador puede crear y eliminar permisos, definir sus capacidades y asignarlos a roles. Este flujo actualiza las sesiones abiertas y registra los cambios en el historial. Las operaciones disponibles se definen en [la política de acceso](src/security/policy.json).

Para cambios versionados con migraciones, `npm run create:permission -- nombre` genera una migración de permiso y `npm run create:crudPermissions -- recurso` genera los cuatro permisos CRUD. Los códigos heredados conocidos conservan su mapeo de capacidades. Configura las capacidades de nombres nuevos en el panel o explícitamente en la migración.

## Publicación

Consulta el [ensayo con la base de producción](docs/ensayo-bd-produccion.md) para la restauración, la verificación del historial y el corte de tráfico.

Prepara la publicación con una base de destino restaurada y validada. Ejecuta la migración explícita en ese destino antes de cambiar el tráfico. Mantén una sola base autorizada para escrituras durante el cambio. Separa la compilación y la configuración de Fly.io, Vercel u otro alojamiento de las credenciales de migración.
