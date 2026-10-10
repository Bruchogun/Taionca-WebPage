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
export function displayMoney(value) {
    if (value === null || value === undefined) return 'Pendiente';
    const [whole, fraction = ''] = String(value).split('.');
    const decimals = fraction.replace(/0+$/, '');
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (decimals ? '.' + decimals : '');
}
