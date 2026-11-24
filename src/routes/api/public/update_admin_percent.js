import { invalid, transaction } from '../../../lib/api-transaction';
import { requireOpenOdt } from '../../../lib/odt-access';
import { decimal, validId } from '../../../lib/odt-closure';

export const post = transaction(async (req, client) => {
    const { admin_percent, id_odt } = req.body || {};
    if (!validId(id_odt)) invalid('Selecciona una ODT válida.');
    if (!decimal(admin_percent, 5, 1) || Number(admin_percent) > 1) {
        invalid('El porcentaje administrativo debe estar entre 0 y 100%, con hasta 3 decimales porcentuales.');
    }
    await requireOpenOdt(client, id_odt, req.user.user_id, true);
    const { rows: [data] } = await client.query(
        'UPDATE odts SET admin_percent=$1 WHERE id_odt=$2 RETURNING *', [admin_percent, id_odt]
    );
    return { success: 'Porcentaje de administración actualizado.', data };
});
