import { transaction, invalid } from '../../../lib/api-transaction';
export const post = transaction(async(req,client) => {
    const {id_user,id_odt,hours_spent}=req.body;
    if (!Number.isFinite(Number(hours_spent)) || Number(hours_spent)<=0) invalid('Ingrese horas válidas.');
    // Lock ODT first, in the same order used by closing and paying payroll.
    const odt=(await client.query('SELECT * FROM odts WHERE id_odt=$1 FOR UPDATE',[id_odt])).rows[0];
    if (!odt) invalid('ODT no encontrada.');
    const available=(await client.query('SELECT * FROM payroll_not_assign_hours WHERE id_user=$1 FOR UPDATE',[id_user])).rows[0];
    if (!available || Number(hours_spent)>Number(available.hours)) invalid('Las horas superan la disponibilidad registrada.');
    const row=(await client.query(`INSERT INTO payroll_odt_hours(id_supervisor,id_odt,id_user,hours_spent) VALUES($1,$2,$3,$4) RETURNING *`,[req.session.user.user_id,id_odt,id_user,hours_spent])).rows[0];
    await client.query('UPDATE payroll_not_assign_hours SET hours=hours-$2 WHERE id_user=$1',[id_user,row.hours_spent]);
    return {success:'Horas asignadas',hour_asigned:row};
});
