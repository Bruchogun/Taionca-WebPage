// Fixed-point decimal money. No exchange rates, binary floating point or implicit currency conversion.
const ZERO = BigInt(0);
const SCALE = BigInt('10000000000');
const LIMIT = BigInt('1000000000000000000000000000000');
export function units(value, positive = false) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Ingresa un importe válido.');
    const text = String(value).trim();
    if (!/^\d{1,20}(?:\.\d{1,10})?$/.test(text)) throw new Error('Los importes admiten hasta 20 enteros y 10 decimales.');
    const [whole, fraction = ''] = text.split('.');
    const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(10, '0'));
    if (result >= LIMIT || (positive && result === ZERO)) throw new Error('El importe debe ser positivo y menor que 100000000000000000000.');
    return result;
}
export function money(value) {
    const negative = value < ZERO;
    const text = (negative ? -value : value).toString().padStart(11, '0');
    return (negative ? '-' : '') + text.slice(0, -10) + '.' + text.slice(-10);
}
export function roundedRatio(numerator, denominator) {
    if (numerator < ZERO || denominator <= ZERO) throw new Error('No se puede calcular el reparto.');
    return (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
}
export function percentage(amount, value) {
    const text = String(value);
    if (!/^\d(?:\.\d{1,5})?$/.test(text)) throw new Error('Porcentaje inválido.');
    const [whole, fraction = ''] = text.split('.');
    const rate = BigInt(whole) * BigInt(100000) + BigInt(fraction.padEnd(5, '0'));
    if (rate > BigInt(100000)) throw new Error('El porcentaje no puede superar 100%.');
    return roundedRatio(amount * rate, BigInt(100000));
}

function signedUnits(value) {
    const text = String(value).trim();
    return text.startsWith('-') ? -units(text.slice(1)) : units(text);
}

export function compareMoney(left, right) {
    try {
        const difference = signedUnits(left) - signedUnits(right);
        return difference < ZERO ? -1 : Number(difference > ZERO);
    } catch {
        return Number(left) - Number(right) || 0;
    }
}

export function displayMoney(value, currency) {
    if (value === null || value === undefined) return 'Pendiente';
    const code = String(currency ?? '').trim().toUpperCase();
    const digits = ['BTC', '₿', 'BITCOIN', 'BITCOINS'].includes(code) ? 5 : 2;
    const text = String(value).trim();
    const decimal = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(text);
    if (!decimal) {
        const approximate = Number(text);
        if (!text || !Number.isFinite(approximate)) return 'Pendiente';
        const formatted = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        }).format(approximate);
        return formatted.replace(/^-0(?=\.0+$)/, '0');
    }

    const [, sign, whole, fraction = ''] = decimal;
    const atScale = BigInt(whole + fraction.slice(0, digits).padEnd(digits, '0'));
    const rounded = atScale + BigInt(fraction[digits] >= '5' ? 1 : 0);
    const scaled = rounded.toString().padStart(digits + 1, '0');
    const prefix = sign === '-' && rounded !== ZERO ? '-' : '';
    return prefix + scaled.slice(0, -digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + scaled.slice(-digits);
}
