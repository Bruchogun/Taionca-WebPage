import { transaction,invalid } from '../../../lib/api-transaction';
import { initialDate } from '../../../lib/responsibility-dates';
export const post=transaction(async(req,client)=>{
 const {responsibility,user,deadline,times_remaining}=req.body;
 if(!responsibility||!user||!Number.isInteger(Number(times_remaining))||Number(times_remaining)<1||!Number.isFinite(Date.parse(deadline))) invalid('Seleccione responsabilidad, persona, fecha y repeticiones válidas.');
 const definition=(await client.query('SELECT * FROM recurrent_responsibilitys JOIN time_frequencys USING(id_time_frequency) WHERE id_recurrent_responsibility=$1',[responsibility.id_recurrent_responsibility])).rows[0];
 if(!definition) invalid('Responsabilidad no encontrada.');
 const next=initialDate(deadline,definition.term,definition.days_to_repeat);
 const active=(await client.query('INSERT INTO active_responsibilitys(id_recurrent_responsibility,id_user,times_remaining) VALUES($1,$2,$3) RETURNING *',[definition.id_recurrent_responsibility,user.value,times_remaining])).rows[0];
 const pending=(await client.query('INSERT INTO pending_responsibilitys(id_active_responsibility,deadline) VALUES($1,$2) RETURNING *',[active.id_active_responsibility,next])).rows[0];
 return {success:'Responsabilidad asignada',data:pending};
});
