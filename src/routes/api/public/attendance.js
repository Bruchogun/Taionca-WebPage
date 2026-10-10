import { transaction, invalid } from '../../../lib/api-transaction';
export const post = transaction(async(req,client) => {
    const id = req.session.user.user_id;
    const {entry_date, departure_date} = req.body;
    if ((!entry_date && !departure_date) || [entry_date,departure_date].some(d=>d && !Number.isFinite(Date.parse(d)))) invalid('Ingrese horas válidas de llegada o salida.');
    // Serialize attendance for this person, including their first ever entry.
    await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE',[id]);
    const open = (await client.query('SELECT * FROM attendances WHERE id_user=$1 AND departure_date IS NULL FOR UPDATE',[id])).rows;
    if (entry_date && open.length) invalid('Existe un registro anterior abierto.',409);
    if (!entry_date && !open.length) invalid('No existe un registro anterior abierto.',409);
    const start = entry_date || open[0].entry_date;
    if (departure_date && +new Date(departure_date) <= +new Date(start)) invalid('La salida debe ser posterior a la llegada.');
    let attendance;
    if (entry_date) attendance=(await client.query('INSERT INTO attendances(id_user,entry_date,departure_date) VALUES($1,$2,$3) RETURNING *',[id,entry_date,departure_date||null])).rows[0];
    else attendance=(await client.query('UPDATE attendances SET departure_date=$2 WHERE id_attendance=$1 RETURNING *',[open[0].id_attendance,departure_date])).rows[0];
    if (departure_date) {
        const hours=(+new Date(departure_date)-+new Date(start))/3600000;
        await client.query(`INSERT INTO payroll_not_assign_hours(id_user,hours) VALUES($1,$2)
            ON CONFLICT(id_user) DO UPDATE SET hours=coalesce(payroll_not_assign_hours.hours,0)+excluded.hours`,[id,hours>7?hours-1:hours]);
    }
    return {success:'Asistencia registrada.',data:attendance};
});
