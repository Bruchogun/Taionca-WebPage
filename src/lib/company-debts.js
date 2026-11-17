import { units, money } from './money';

function positiveId(value, label) {
    if (!Number.isInteger(value) || value<=0 || value>2147483647) throw new Error(label+' invalido.');
    return value;
}

export function prepareCompanyDebtEvent(input) {
    if (!input || !['advance','repayment'].includes(input.kind)) throw new Error('Tipo de deuda invalido.');
    const ownerUserId=positiveId(input.ownerUserId,'Propietario');
    const accountId=positiveId(input.accountId,'Cuenta');
    const currencyId=positiveId(input.currencyId,'Moneda');
    const amount=money(units(input.amount,true));
    const mode=input.mode || (input.kind==='advance'?'credit_cash':'debit_cash');
    const modes=input.kind==='advance'?['credit_cash','recognize_only']:['debit_cash','recognize_only'];
    if (!modes.includes(mode)) throw new Error('Modo de registro invalido.');
    if (typeof input.description!=='string' || !input.description.trim() || input.description.length>512) {
        throw new Error('Indique una descripcion de hasta 512 caracteres.');
    }
    if (typeof input.sourceKey!=='string' || !input.sourceKey.trim() || input.sourceKey.length>240) {
        throw new Error('Indique una referencia de origen de hasta 240 caracteres.');
    }
    let occurredAt=null;
    if (input.occurredAt!==undefined && input.occurredAt!==null) {
        const parts=typeof input.occurredAt==='string' &&
            /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(input.occurredAt);
        const year=parts && Number(parts[1]);
        const month=parts && Number(parts[2]);
        const day=parts && Number(parts[3]);
        const leap=year%4===0 && (year%100!==0 || year%400===0);
        const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
        if (!parts || !year || month<1 || month>12 || day<1 || day>days[month-1] ||
            Number(parts[4])>23 || Number(parts[5])>59 || Number(parts[6])>59 ||
            Number(parts[7]||0)>15 || Number(parts[8]||0)>59 || !Number.isFinite(Date.parse(input.occurredAt))) {
            throw new Error('La fecha debe indicar una hora y zona horaria comprobadas.');
        }
        occurredAt=input.occurredAt;
    }
    return {kind:input.kind,ownerUserId,accountId,currencyId,amount,mode,
        description:input.description,sourceKey:input.sourceKey,occurredAt};
}

export async function registerCompanyDebtEvent(client,input) {
    const event=prepareCompanyDebtEvent(input);
    const name=event.kind==='advance'?'register_company_advance':'register_company_repayment';
    const result=await client.query(`SELECT * FROM ${name}($1,$2,$3::numeric,$4,$5,$6::timestamptz,$7,$8)`,
        [event.ownerUserId,event.accountId,event.amount,event.description,event.sourceKey,
            event.occurredAt,event.mode,event.currencyId]);
    return result.rows[0];
}
