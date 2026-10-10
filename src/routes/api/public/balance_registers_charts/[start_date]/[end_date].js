import { sql } from "../../../../../db";

// List balance_registers
export const get =
    async (req, res) => {
        let {start_date, end_date} = req.params;
        start_date = start_date/1000
        end_date = end_date/1000
        // const parsed_range_date = JSON.parse(range_date);
        const balance_registers1_promise = sql`


                select distinct on (id_balance) to_timestamp(${start_date})::date as created_at, balance_registers.balance, balance_registers.id_balance as id_balance, id_account, id_entity, accounts.name as account_name, id_currency, symbol, entitys.name as entity_name
                from balance_registers
                join balances using (id_balance)
                join accounts using (id_account)
                join currencys using (id_currency)
                join entitys using (id_entity)
                where balance_registers.created_at < (select to_timestamp(${start_date})::date)
                ORDER BY id_balance, balance_registers.created_at DESC;

            `
        ;

        const balance_registers2_promise =  sql`

            select  balance_registers.created_at, balance_registers.balance, balance_registers.id_balance, id_account, id_entity, accounts.name as account_name, id_currency, symbol, entitys.name as entity_name
            from balance_registers
            join balances using (id_balance)
            join accounts using (id_account)
            join currencys using (id_currency)
            join entitys using (id_entity)
            where balance_registers.created_at >= (select to_timestamp(${start_date})::date) AND balance_registers.created_at < (select to_timestamp(${end_date})::date + interval '1 day')
            ORDER BY balance_registers.created_at ASC;
            `
        ;

        const {rows: balance_registers1} = await balance_registers1_promise;
        const {rows: balance_registers} = await balance_registers2_promise;

        res.json({
            balance_registers1,
            balance_registers
        }
        );
    }