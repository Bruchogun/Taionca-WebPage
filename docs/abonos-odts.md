# Abonos progresivos de ODT

La versión actual permite ingresar directamente cuánto representa cada abono en la moneda original de la ODT y elegir cómo cerrar sus utilidades por moneda.

Consulta [Cierres por moneda e importes manuales](cierres-moneda.md) para las instrucciones completas, ejemplos, reglas contables y pruebas.

En **Gestión de ODTs → Abonos de ODT**, selecciona la ODT, la cuenta y el monto recibido. Si las monedas son distintas, escribe el equivalente en la moneda de la ODT. El ingreso se registra inmediatamente en Taionca, dentro de esa cuenta; se muestra el total abonado y lo pendiente.

Al completar el pago, en **Cerrar ODT** puedes repartir en la moneda original, en otra moneda recibida o preparar mini cierres separados por moneda. Los mini cierres se confirman juntos. Los equivalentes de ingresos, las reasignaciones de gastos y los cambios de dinero entre cuentas se indican manualmente: no se deducen tasas.

El historial conserva los abonos y las decisiones del cierre. Los pagos registrados antes de esta actualización mantienen su tasa histórica. Los reintentos de una solicitud usan la misma referencia para evitar duplicados.

El respaldo de la ampliación inicial de abonos se conserva en `C:\Proyectos\taionca-backups\abonos-20260929`. La verificación de esa versión aprobó 170 pruebas y conservó todos los registros originales; los resultados de la versión actual se documentan en la guía de cierres por moneda.
