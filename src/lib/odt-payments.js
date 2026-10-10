import { decimal, validId } from './odt-closure';

export function validatePayment(body) {
    if (!body || !validId(body.id_odt)) return 'Selecciona una ODT abierta.';
    if (!validId(body.id_account)) return 'Selecciona la cuenta que recibió el abono.';
    if (!decimal(body.amount, 10, 20) || Number(body.amount) <= 0) return 'El abono debe ser positivo y tener hasta 10 decimales.';
    if (body.amount_odt !== undefined) {
        if (body.exchange_rate !== undefined) return 'Indica el equivalente del abono, sin tasa de cambio.';
        if (!decimal(body.amount_odt, 10, 20) || Number(body.amount_odt) <= 0) return 'Ingresa cuánto representa el abono en la moneda original de la ODT.';
    } else if (!decimal(body.exchange_rate, 10, 20) || Number(body.exchange_rate) <= 0) {
        return 'Ingresa cuánto representa el abono en la moneda original de la ODT.';
    }
    if (typeof body.description !== 'string' || body.description.length > 512) return 'La descripción admite hasta 512 caracteres.';
    if (typeof body.request_key !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(body.request_key)) return 'Falta la referencia del abono. Vuelve a intentarlo.';
    return '';
}

export function paymentKey() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// Only a preview. PostgreSQL computes and validates the posted equivalent with exact decimals.
export function paymentPreview(amount, rate) {
    const result = Number(amount) / Number(rate);
    return Number.isFinite(result) && result > 0 ? result : null;
}
