import { createHash } from 'crypto';
import { isIP } from 'net';
import { query } from '../db';

const ORIGIN_LIMIT = 120;
const ACCOUNT_LIMIT = 20;
const PAIR_LIMIT = 5;
const EXPIRED = "login_attempts.window_start <= now() - interval '15 minutes'";
const ADVANCE_WINDOW = `attempts=CASE WHEN ${EXPIRED} THEN 1 ELSE login_attempts.attempts+1 END,
    window_start=CASE WHEN ${EXPIRED} THEN now() ELSE login_attempts.window_start END`;

function ipAddress(value) {
    const address = String(value || '').trim().toLowerCase().split('%')[0].replace(/^::ffff:(?=\d+\.)/, '');
    const version = isIP(address);
    if (version === 6) return new URL(`http://[${address}]/`).hostname.slice(1, -1);
    return version === 4 ? address : null;
}

export function loginOrigin(req, trusted = process.env.LOGIN_TRUSTED_PROXY_IPS || '') {
    const socket = ipAddress(req.socket?.remoteAddress);
    if (!socket) return 'local';
    const proxies = new Set(trusted.split(',').map(ipAddress).filter(Boolean));
    const forwarded = req.headers?.['x-forwarded-for'];
    if (!proxies.has(socket) || typeof forwarded !== 'string') return socket;
    for (const hop of forwarded.split(',').reverse()) {
        const address = ipAddress(hop);
        if (!address) return socket;
        if (!proxies.has(address)) return address;
    }
    return socket;
}

function key(scope, ...values) {
    return scope + ':' + createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

export async function registerLoginAttempt(username, origin) {
    const originKey = key('origin', origin);
    const accountKey = key('account', username);
    const pairKey = key('pair', username, origin);

    // Check the origin first so a blocked origin cannot create buckets for more usernames.
    const { rows: [attempt] } = await query(`WITH origin_attempt AS (
        INSERT INTO login_attempts(key,attempts) VALUES($1,1)
        ON CONFLICT(key) DO UPDATE SET ${ADVANCE_WINDOW}
        WHERE ${EXPIRED} OR login_attempts.attempts<$4
        RETURNING window_start::text AS window_start
    ), pair_attempt AS (
        INSERT INTO login_attempts(key,attempts)
        SELECT $3,1 FROM origin_attempt
        ON CONFLICT(key) DO UPDATE SET ${ADVANCE_WINDOW}
        WHERE ${EXPIRED} OR login_attempts.attempts<$6
        RETURNING key
    ), account_attempt AS (
        INSERT INTO login_attempts(key,attempts)
        SELECT $2,1 FROM pair_attempt
        ON CONFLICT(key) DO UPDATE SET ${ADVANCE_WINDOW}
        WHERE ${EXPIRED} OR login_attempts.attempts<$5
        RETURNING key
    ) SELECT NOT EXISTS(SELECT 1 FROM account_attempt) AS blocked,
        (SELECT window_start FROM origin_attempt) AS origin_window`,
    [originKey, accountKey, pairKey, ORIGIN_LIMIT, ACCOUNT_LIMIT, PAIR_LIMIT]);

    if (Math.random() < 1 / 64) {
        await query(`DELETE FROM login_attempts WHERE ctid IN (
            SELECT ctid FROM login_attempts WHERE ${EXPIRED} LIMIT 1024 FOR UPDATE SKIP LOCKED
        )`).catch(error => console.error('No se pudieron limpiar los intentos de acceso caducados.', error.code));
    }

    return { blocked: attempt.blocked, originKey, originWindow: attempt.origin_window, accountKey, pairKey };
}

export async function clearLoginAttempt({ originKey, originWindow, accountKey, pairKey }) {
    // Keep failures from this origin while releasing the attempt reserved for this valid login.
    await query(`WITH origin_release AS (
        UPDATE login_attempts SET attempts=greatest(attempts-1,0)
        WHERE key=$1 AND window_start=$2::timestamptz
        RETURNING key
    ), pair_release AS (
        DELETE FROM login_attempts WHERE key=$3 AND EXISTS(SELECT 1 FROM origin_release)
        RETURNING key
    ) DELETE FROM login_attempts WHERE key=$4 AND EXISTS(SELECT 1 FROM pair_release)`,
    [originKey, originWindow, pairKey, accountKey]);
}
