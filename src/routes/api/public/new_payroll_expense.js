import { transaction } from '../../../lib/api-transaction';
import { payrollRows, payPayroll } from '../../../lib/payroll';
export const post = transaction(async(req,client) => {
    const rows=await payrollRows(client,req.body.payrolls,true);
    return {success:'Nómina pagada',payroll:await payPayroll(client,rows)};
});
