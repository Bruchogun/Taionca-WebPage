// Shared form/API validation. PostgreSQL remains authoritative for all money calculations.
export function validId(value) {
    return (typeof value === 'number' || typeof value === 'string') &&
        /^[1-9]\d*$/.test(String(value)) && Number(value) <= 2147483647;
}

export function decimal(value, scale, integerDigits) {
    if (typeof value !== 'number' && typeof value !== 'string') return false;
    let text = String(value).trim();
    if (typeof value === 'number' && value > 0 && value < 1 && text.includes('e')) {
        text = value.toFixed(scale);
        if (Number(text) !== value) return false;
    }
    return new RegExp(`^\\d{1,${integerDigits}}(?:\\.\\d{1,${scale}})?$`).test(text) && Number.isFinite(Number(text));
}

export function validateClosure(body) {
    if (!body || typeof body !== 'object') return 'Los datos del cierre son obligatorios.';
    if (!validId(body.id_odt)) return 'Selecciona una ODT abierta.';
    if (body.settle_payments !== undefined && typeof body.settle_payments !== 'boolean') return 'El tipo de cierre es inválido.';
    if (body.settle_payments === true && body.id_account != null) return 'El cierre utiliza las cuentas de los abonos registrados.';
    if (!body.settle_payments && !validId(body.id_account)) return 'Selecciona la cuenta de destino.';
    if (!decimal(body.amount, 10, 20) || Number(body.amount) <= 0) {
        return 'El monto pagado debe ser mayor que cero y tener como máximo 10 decimales.';
    }
    for (const key of ['admin_percent', 'ceo_percent']) {
        if (!decimal(body[key], 5, 1) || Number(body[key]) > 1) {
            return 'Los porcentajes deben estar entre 0 y 100%, con hasta 3 decimales porcentuales.';
        }
    }
    // Integer units avoid rejecting a mathematically exact 100% because of floating point.
    let commissionUnits = Math.round(Number(body.ceo_percent) * 100000);
    for (const key of ['admin_users', 'operative_users', 'supervisor_users']) {
        if (!Array.isArray(body[key])) return 'Las listas de comisiones son obligatorias.';
        const seen = new Set();
        for (const user of body[key]) {
            if (!user || !validId(user.id_user)) return 'Selecciona un usuario en cada comisión o elimina la fila vacía.';
            if (seen.has(Number(user.id_user))) return 'Un usuario no puede repetirse dentro del mismo grupo de comisiones.';
            seen.add(Number(user.id_user));
            if (!decimal(user.profit_percent, 5, 1) || Number(user.profit_percent) > 1) {
                return 'Cada comisión debe estar entre 0 y 100%.';
            }
            commissionUnits += Math.round(Number(user.profit_percent) * 100000);
        }
    }
    if (commissionUnits > 100000) return 'La suma de las comisiones, incluido el presidente, no puede superar el 100%.';
    return '';
}
