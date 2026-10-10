// A close racing an expense must return an actionable response, not an unhandled rejection.
export function safeOdtExpense(handler) {
    return async (req,res) => {
        try { return await handler(req,res); }
        catch (error) {
            if (error.code==='P0001') {
                res.statusCode=/cerrada/.test(error.message)?409:400;
                return res.json({error:error.message});
            }
            res.statusCode=['23503','23514','22P02','22003'].includes(error.code)?400:500;
            return res.json({error:res.statusCode===400?'Revisa los datos y el saldo del gasto.':'No se pudo registrar el gasto.'});
        }
    };
}
