import { invalid } from './api-transaction';

export async function requireOpenOdt(db, id, userId, lock = false) {
    const { rows: [odt] } = await db.query(
        'SELECT id_odt, id_user, id_currency FROM odts WHERE id_odt=$1' + (lock ? ' FOR UPDATE' : ''), [id]
    );
    if (!odt) invalid('La ODT no existe.', 404);
    if (![1, 11, odt.id_user].includes(userId) && odt.id_user !== 1) {
        invalid('No tienes acceso a esta ODT.', 403);
    }
    const { rowCount } = await db.query('SELECT 1 FROM closure_odts WHERE id_odt=$1', [id]);
    if (rowCount) invalid('La ODT ya está cerrada.', 409);
    return odt;
}
