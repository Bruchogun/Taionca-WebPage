import {units,money} from './money';

function positiveId(value,label){
    if(!Number.isInteger(value)||value<=0||value>2147483647)throw new Error(label+' invalido.');
    return value;
}
function requiredText(value,label,max){
    if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(label+' invalido.');
    return value;
}
export function prepareInternalOdtBilling(input){
    if(!input||typeof input!=='object')throw new Error('Facturacion interna invalida.');
    const event={customerOdtId:positiveId(input.customerOdtId,'ODT cliente'),supplierOdtId:positiveId(input.supplierOdtId,'ODT proveedora'),
        accountId:positiveId(input.accountId,'Cuenta'),existingPaymentId:positiveId(input.existingPaymentId,'Abono existente'),
        measureId:positiveId(input.measureId,'Unidad financiera'),actorUserId:positiveId(input.actorUserId,'Usuario tecnico'),
        amount:money(units(input.amount,true)),description:requiredText(input.description,'Descripcion',512),
        sourceKey:requiredText(input.sourceKey,'Origen del cargo',240),creditSourceKey:requiredText(input.creditSourceKey,'Origen del abono',240)};
    if(event.customerOdtId===event.supplierOdtId||event.sourceKey===event.creditSourceKey)throw new Error('Los dos proyectos y origenes deben ser diferentes.');
    if(!input.evidence||typeof input.evidence!=='object'||Array.isArray(input.evidence))throw new Error('Falta la evidencia de las dos partidas.');
    if(input.occurredAt!==undefined&&input.occurredAt!==null)throw new Error('La fecha original de estas partidas no esta confirmada.');
    return {...event,evidence:input.evidence,occurredAt:null};
}
export async function registerInternalOdtBilling(client,input){
    const event=prepareInternalOdtBilling(input);
    const result=await client.query('SELECT * FROM register_internal_odt_billing($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$10,$11::jsonb,$12::timestamptz)',
        [event.customerOdtId,event.supplierOdtId,event.accountId,event.existingPaymentId,event.amount,event.description,event.measureId,event.actorUserId,
            event.sourceKey,event.creditSourceKey,event.evidence,event.occurredAt]);
    return result.rows[0];
}
export async function getInternalOdtBillingSummaries(client,paymentIds){
    if(!Array.isArray(paymentIds)||paymentIds.length>10000)throw new Error('Lista de abonos invalida.');
    const ids=[...new Set(paymentIds.map(value=>positiveId(value,'Abono')))];
    if(!ids.length)return [];
    const exists=(await client.query("SELECT to_regclass('public.odt_internal_billings') AS name")).rows[0].name;
    if(!exists)return [];
    return (await client.query(`SELECT id_odt_payment,id_customer_odt,id_supplier_odt,amount::text,id_general_expense
        FROM odt_internal_billings WHERE id_odt_payment=ANY($1) ORDER BY id_odt_payment`,[ids])).rows;
}
