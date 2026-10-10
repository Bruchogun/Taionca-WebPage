import { transaction,invalid } from '../../../lib/api-transaction';
import { nextResponsibility } from '../../../lib/responsibilities';
export const post=transaction(async(req,client)=>{
 const id=req.body.responsibility && req.body.responsibility.id_pending_responsibility;
 if(!id) invalid('Seleccione la responsabilidad pendiente.');
 const row=(await client.query('SELECT * FROM pending_responsibilitys WHERE id_pending_responsibility=$1',[id])).rows[0];
 if(!row||+new Date(row.deadline)>Date.now()) return {data:null};
 return {data:await nextResponsibility(client,row)};
});
