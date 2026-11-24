import { invalid, transaction } from '../../../lib/api-transaction';
import { money, units } from '../../../lib/money';
import { requireOpenOdt } from '../../../lib/odt-access';
import { validId } from '../../../lib/odt-closure';

export const post = transaction(async (req, client) => {
    const { id_odt, id_account, amount } = req.body || {};
    if (!validId(id_odt) || !validId(id_account)) invalid('Selecciona una ODT y una cuenta válidas.');
    let limit;
    try {
        limit = money(units(amount));
    } catch (error) {
        invalid(error.message);
    }
    await requireOpenOdt(client, id_odt, req.user.user_id, true);
    const { rows: [data] } = await client.query(
        `INSERT INTO limit_resources (id_odt, id_account, amount) VALUES ($1, $2, $3)
        ON CONFLICT (id_odt, id_account) DO UPDATE SET amount=EXCLUDED.amount RETURNING *`,
        [id_odt, id_account, limit]
    );
    return { success: 'Límite de recursos actualizado.', data };
});
