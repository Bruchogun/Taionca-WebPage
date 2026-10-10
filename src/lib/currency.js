// Rates are quoted against USD. Normalize database codes before looking them up.
export function exchangeRate(rates, counterCode, baseCode) {
    const counter = String(counterCode || '').trim().toUpperCase();
    const base = String(baseCode || '').trim().toUpperCase();
    if (!counter || !base) throw new Error('La moneda es obligatoria.');
    if (counter === base) return 1;
    const baseRate = base === 'USD' ? 1 : Number(rates[base]);
    const counterRate = counter === 'USD' ? 1 : Number(rates[counter]);
    if (!Number.isFinite(baseRate) || baseRate <= 0 || !Number.isFinite(counterRate) || counterRate <= 0) {
        throw new Error('No hay una tasa de cambio válida para las monedas seleccionadas.');
    }
    return counterRate / baseRate;
}

export function quotationTotals(generalExpenses, inventoryExpenses, adminPercent) {
    const general = generalExpenses.reduce((sum, expense) => sum + Number(expense.amount) * Number(expense.rate), 0);
    // Convert each line once; converting the accumulated subtotal repeatedly overstates it.
    const inventory = inventoryExpenses.reduce((sum, expense) => sum + Number(expense.amount) * Number(expense.quantity) * Number(expense.rate), 0);
    return [general, inventory, (general + inventory) / (1 - adminPercent), adminPercent];
}
