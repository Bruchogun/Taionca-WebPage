const { test, expect } = require('@playwright/test');
const { loadSource } = require('../helpers/source');
const { prepareGeneralExpense, recordGeneralExpense } = loadSource('lib/general-expense');

const input = { id_odt: 51, id_account: 3, id_measure: 1, amount: '5.25', quantity: '2', description: 'Gasto' };
const owner = 201;

function expenseDb(accountCurrency) {
    const statements = [];
    return {
        statements,
        async query(sql) {
            statements.push(sql);
            if (sql.includes('FROM odts')) return { rows: [{ id_odt: input.id_odt, id_user: owner, id_currency: 1 }] };
            if (sql.includes('FROM closure_odts')) return { rowCount: 0 };
            if (sql.includes('FROM accounts')) return { rows: [{ id_currency: accountCurrency }] };
            if (sql.includes('FROM currencys')) {
                return { rows: [{ id_currency: 1, code: 'USD' }, { id_currency: accountCurrency, code: accountCurrency === 2 ? 'VES' : 'COP' }] };
            }
            throw new Error('Unexpected query: ' + sql);
        }
    };
}

test('la tasa del gasto se obtiene sin bloqueos y se comprueban las monedas antes de escribir', async () => {
    const db = expenseDb(2);
    const valuation = await prepareGeneralExpense(db, input, owner, async (counter, base) => {
        expect([counter, base]).toEqual(['USD', 'VES']);
        expect(db.statements.every(sql => !/FOR (UPDATE|SHARE)/.test(sql))).toBe(true);
        return 0.05;
    });
    expect(valuation.rate).toBe(0.05);
    const changed = expenseDb(3);
    await expect(recordGeneralExpense(changed, input, owner, valuation)).rejects.toMatchObject({ status: 409 });
    expect(changed.statements[0]).toContain('FOR UPDATE');
    expect(changed.statements.every(sql => /^SELECT/.test(sql))).toBe(true);
});

test('un fallo del proveedor detiene el gasto antes de iniciar una escritura', async () => {
    const db = expenseDb(2);
    await expect(prepareGeneralExpense(db, input, owner, async () => {
        throw new Error('No se pudo consultar la tasa.');
    })).rejects.toMatchObject({ status: 503 });
    expect(db.statements.every(sql => /^SELECT/.test(sql) && !/FOR (UPDATE|SHARE)/.test(sql))).toBe(true);
});
