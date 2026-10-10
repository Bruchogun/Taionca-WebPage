# Administración de permisos y roles

Entra con una cuenta que tenga el rol administrador `master`. En el menú lateral, abre **Administrar permisos** (`/administracion_permisos`). Las asignaciones existentes se conservan. Después de instalar esta actualización será necesario volver a iniciar sesión; las contraseñas no se cambian.

## Uso del panel

1. En **Permisos**, escribe un nombre, una descripción y selecciona las operaciones que habilitará. Puedes editarlo después o eliminarlo. Eliminar un permiso lo retira de todos sus roles.
2. En **Roles**, crea un grupo de permisos o modifica uno existente. Eliminar un rol lo retira de todos sus usuarios.
3. En **Usuarios**, selecciona la persona, marca o desmarca sus roles y guarda. La lista de accesos resultantes permite revisar qué podrá hacer antes de confirmar.
4. En **Historial**, consulta quién cambió cada permiso, rol o asignación, y compara los valores anteriores y nuevos. Se muestran los últimos 100 cambios; los anteriores permanecen guardados.

Los usuarios reciben la unión de los permisos de sus roles. No hay asignaciones individuales de permisos. Para retirar un acceso, revisa todos los roles que lo conceden. Los cambios se aplican a las solicitudes siguientes, incluso en sesiones que ya estaban abiertas.

El rol administrador tiene acceso completo, incluido este panel. Puedes asignarlo a otra persona. No se puede eliminar el rol administrador ni dejar el sistema sin al menos una persona que lo tenga. La marca histórica `special_user` no concede acceso a este panel.

## Protección aplicada

- Una política compartida define el acceso a páginas, consultas y escrituras. El servidor valida cada petición; ocultar un enlace es únicamente una ayuda de navegación.
- Las rutas API nuevas requieren una política explícita. Una ruta sin registro queda denegada.
- La navegación interna también comprueba el acceso antes de mostrar la página. Si no puede verificarlo, mantiene la página oculta y ofrece reintentar.
- Los permisos efectivos se consultan en la base de datos en cada solicitud. No se confía en permisos enviados por el navegador ni en una copia antigua almacenada en la sesión.
- Las operaciones de administración comprueban nuevamente el rol dentro de la transacción y serializan los cambios para proteger al último administrador.
- Los identificadores de sesión se renuevan al entrar y al cambiar la contraseña. El cambio de contraseña invalida las demás sesiones. Cerrar sesión destruye la sesión guardada.
- Se limitan los intentos repetidos de contraseña para la misma combinación de usuario y origen de conexión: cinco intentos en quince minutos. El mensaje de credenciales incorrectas no revela si el usuario existe.
- Las escrituras requieren JSON y rechazan orígenes externos. Las cookies utilizan `HttpOnly` y `SameSite=Strict`, y `Secure` en producción.
- La consulta de asistencia y deudas entrega únicamente los datos de la persona, salvo que su rol permita la consulta general.
- Las contraseñas y las cookies de sesión no se incluyen en los registros de solicitudes.
- Las páginas autenticadas y las respuestas de la API indican `Cache-Control: no-store`. El servicio de caché sin conexión solo conserva archivos estáticos y elimina las cachés privadas antiguas.

Los controles propios de las ODTs siguen aplicándose: titularidad de la orden, ODT cerrada, saldo, moneda, disponibilidad de horas, duplicados y validaciones de los importes.

## Referencia técnica

`src/security/policy.json` contiene las operaciones disponibles y su relación con las páginas y los métodos de la API. `access.js` aplica la política compartida; `identity.js` carga la identidad actual. Los middleware `authentication.js` y `authorization.js` verifican sesión, permisos y origen de las escrituras. `management.js` centraliza las modificaciones y su historial; también lo usan las rutas antiguas de administración para evitar caminos alternativos.

La migración `1790712000000_central-role-permissions.js` conserva las asignaciones anteriores y añade las operaciones de cada permiso, una clave estable, la versión de sesión y las tablas de historial e intentos de acceso. Los nombres visibles pueden editarse sin romper las referencias del programa. La eliminación de permisos conserva un registro interno y su clave para mantener el historial y la compatibilidad; no concede acceso ni aparece entre los permisos activos.

Las pruebas específicas están en `tests/security`: autorización de cada ruta y página, permisos mínimos funcionales, sesiones, revocación inmediata, operaciones simultáneas, panel gráfico y presentación móvil. La auditoría funcional completa se documenta en [auditoria-sistemas.md](auditoria-sistemas.md).
