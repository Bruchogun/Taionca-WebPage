import { query } from "../../../db";

// List balance_movements
export const get =
    async (req, res) => {

        const {rows: balance_movements} = await query(
            `select 

            id_balance_movement,
            entitys.name as entity,
            currencys.symbol as currency,
            accounts.name as account,
            balance_movements.amount,
            balance_movements.end_balance,
            balance_movements.id_balance,
            balance_movements.created_at,
            nullif(get_odt_movement(id_movement_category, type_movement_category), 0) as id_odt
            
            from balance_movements
            join balances using(id_balance)
            join entitys using(id_entity)
            join accounts using(id_account)
            join currencys using(id_currency)

            ORDER BY balance_movements.created_at, id_balance_movement;
            `
        );

        res.json({
            success:"Datos cargados",
            balance_movements
        });
    }
