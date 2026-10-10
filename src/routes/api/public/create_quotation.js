import { compose } from "compose-middleware";
import { USERS_READ } from "../../../constants/PERMISSIONS";
import { sql } from "../../../db";
import { getRate } from "../../../functions";
import { quotationTotals } from "../../../lib/currency";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

// Rate based in quotation's currency

export const post =
    async (req, res) => {

        const { general_expenses, inv_expenses, currency, id_client, description } = req.body;
        const admin_percent = 0.2;

        let ratesPromises = {};
        async function getRatesCached (...args) {
            const key = args.join("");
            if (!ratesPromises[key]) ratesPromises[key] = getRate(...args);
            return await ratesPromises[key];
        }

    //
        async function create_quotation(){
            await Promise.all(general_expenses.map(async expense => {
                expense.rate = await getRatesCached(currency.code, expense.currency.code);
            }));
            if (inv_expenses.length) {
                const rate = await getRatesCached(currency.code, 'USD');
                inv_expenses.forEach(expense => { expense.rate = rate; });
            }
            return quotationTotals(general_expenses, inv_expenses, admin_percent);
        }

        // inv_expense splitted into spendable_expenses and no_spendable_expenses
        let spendable_expenses = [];
        let no_spendable_expenses = [];
        inv_expenses.forEach(inv_expense => {
            if (inv_expense.item.id_spendable_item)
                spendable_expenses.push(inv_expense)
            else
                no_spendable_expenses.push(inv_expense)
        });

        // flatten `id_currency` attribute
        // general_expenses.forEach(general_expense => {
            
        // });

    //
        const { user_id } = req.session.user;
        const quotation_data = await create_quotation();
        const id_currency = currency.id_currency;
        const {rows: [{id_quotation}]} = await sql`
            SELECT new_create_quotation(
                ${user_id},
                ${JSON.stringify(general_expenses)},
                ${JSON.stringify(spendable_expenses)},
                ${JSON.stringify(no_spendable_expenses)},
                ${currency.id_currency},
                ${id_client},
                ${admin_percent},
                ${description},
                ${quotation_data[2]}
            ) AS id_quotation;
        `;
        res.json({
            success: `Cotización realizada con el id ${id_quotation}`,
            total_general_expenses: quotation_data[0],
            total_inv_expenses: quotation_data[1],
            contract_amount: quotation_data[2],
            admin_percent: quotation_data[3],
            id_quotation
        });
    }