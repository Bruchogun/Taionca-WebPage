import { transaction } from '../../../lib/api-transaction';
import { payrollRows, payrollPreview } from '../../../lib/payroll';
export const post = transaction(async(req,client) => ({payroll:await payrollPreview(client,await payrollRows(client,req.body.payrolls))}));
