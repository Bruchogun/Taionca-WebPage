import fetch from 'node-fetch';
import { exchangeRate } from './currency';

export async function getRate(counterCode, baseCode) {
    const counter = String(counterCode || '').trim().toUpperCase();
    const base = String(baseCode || '').trim().toUpperCase();
    if (!counter || !base) throw new Error('La moneda es obligatoria.');
    if (counter === base) return 1;

    const appId = process.env.OPEN_EXCHANGE_RATES_APP_ID;
    if (!appId) throw new Error('Configura el proveedor de tasas para operaciones entre monedas.');
    const url = new URL('https://openexchangerates.org/api/latest.json');
    url.searchParams.set('app_id', appId);

    let rates;
    try {
        const response = await fetch(url.toString(), { timeout: 5000 });
        if (!response.ok) throw new Error();
        ({ rates } = await response.json());
        if (!rates) throw new Error();
    } catch {
        throw new Error('No se pudieron consultar las tasas de cambio. Vuelve a intentarlo.');
    }
    return exchangeRate(rates, counter, base);
}
