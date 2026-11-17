import { createHash } from 'crypto';
import { units, money } from './money';

const ZERO = BigInt(0);
function positiveId(value, label) {
    if (!Number.isInteger(value) || value <= 0 || value > 2147483647) throw new Error(label + ' invalido.');
    return value;
}
function text(value, maximum, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(label + ' invalido.');
    return value;
}
function fields(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !allowed.includes(key))) throw new Error(label + ' contiene campos no admitidos.');
}
function canonical(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    }
    throw new Error('La evidencia debe contener solo datos JSON.');
}
function timestamp(value) {
    if (value === null || value === undefined) return null;
    const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
    const year = match && Number(match[1]);
    const month = match && Number(match[2]);
    const day = match && Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!match || !year || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
        Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 ||
        Number(match[7] || 0) > 15 || Number(match[8] || 0) > 59 || !Number.isFinite(Date.parse(value))) {
        throw new Error('La fecha debe indicar una hora y zona horaria comprobadas.');
    }
    return value;
}

export function prepareProfitWithdrawal(input) {
    fields(input, ['version', 'externalUuid', 'actorUserId', 'accountId', 'currencyId', 'amount',
        'description', 'source', 'occurredAt', 'documentaryOdt', 'parts'], 'El retiro');
    if (input.version !== undefined && input.version !== 1) throw new Error('Version de retiro no admitida.');
    if (typeof input.externalUuid !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.externalUuid)) {
        throw new Error('UUID externo invalido.');
    }
    const amount = units(input.amount, true);
    fields(input.source, ['namespace', 'key', 'evidenceHash', 'amount', 'currency', 'rawEvidence'], 'La fuente');
    if (input.source.currency !== 'USD' || typeof input.source.amount !== 'string' ||
        !input.source.amount.startsWith('-') || units(input.source.amount.slice(1), true) !== amount) {
        throw new Error('El retiro debe corresponder al movimiento original negativo en USD.');
    }
    if (!input.source.rawEvidence || typeof input.source.rawEvidence !== 'object' || Array.isArray(input.source.rawEvidence)) {
        throw new Error('Falta la evidencia original de la fuente.');
    }
    const evidence = canonical(input.source.rawEvidence);
    if (Buffer.byteLength(evidence, 'utf8') > 262144 || typeof input.source.evidenceHash !== 'string' ||
        !/^[0-9a-f]{64}$/.test(input.source.evidenceHash) ||
        createHash('sha256').update(evidence).digest('hex') !== input.source.evidenceHash) {
        throw new Error('La evidencia original no coincide con su hash.');
    }
    if (!Array.isArray(input.parts) || !input.parts.length || input.parts.length > 100) throw new Error('Indique los destinatarios del retiro.');
    const users = new Set();
    let total = ZERO;
    const parts = input.parts.map(part => {
        fields(part, ['userId', 'entityId', 'amount'], 'El destinatario');
        const userId = positiveId(part.userId, 'Usuario');
        const entityId = positiveId(part.entityId, 'Entidad');
        if (users.has(userId)) throw new Error('Hay un destinatario repetido.');
        users.add(userId);
        const value = units(part.amount, true);
        total += value;
        return { userId, entityId, amount: money(value) };
    }).sort((a, b) => a.userId - b.userId);
    if (total !== amount) throw new Error('Los destinatarios deben sumar exactamente el movimiento original.');
    const request = {
        version: 1, externalUuid: input.externalUuid.toLowerCase(),
        actorUserId: positiveId(input.actorUserId, 'Usuario tecnico'),
        accountId: positiveId(input.accountId, 'Cuenta'), currencyId: positiveId(input.currencyId, 'Moneda'),
        amount: money(amount), description: text(input.description, 512, 'Descripcion'),
        source: {
            namespace: text(input.source.namespace, 240, 'Identificador de fuente'),
            key: text(input.source.key, 240, 'Celda de origen'), evidenceHash: input.source.evidenceHash,
            amount: '-' + money(amount), currency: 'USD', rawEvidence: JSON.parse(evidence)
        },
        occurredAt: timestamp(input.occurredAt),
        documentaryOdt: input.documentaryOdt === null || input.documentaryOdt === undefined ? null : positiveId(input.documentaryOdt, 'ODT documental'),
        parts
    };
    const body = canonical(request);
    return { request, body, digest: createHash('sha256').update(body).digest('hex') };
}

// The native function is one atomic statement; a surrounding caller transaction remains caller-owned.
export async function registerProfitWithdrawal(client, input) {
    const prepared = prepareProfitWithdrawal(input);
    const { rows } = await client.query('SELECT register_profit_withdrawal($1::jsonb,$2) AS withdrawal', [prepared.body, prepared.digest]);
    return rows[0].withdrawal;
}
