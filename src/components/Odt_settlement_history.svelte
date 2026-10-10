<script>
    import { displayMoney } from '../lib/money';
    export let details;
    const roles={ceo:'Presidente',admin:'Administración',operative:'Operación',supervisor:'Supervisión'};
</script>
{#if details && details.settlement_mode!=='legacy'}
    <section aria-label="Resultados del cierre por moneda">
        <h3>{details.settlement_mode==='split'?'Mini cierres por moneda':'Cierre en una moneda'}</h3>
        {#each details.parts as part}
            <article>
                <h4>{part.code} · Ingresos: {displayMoney(part.amount)}</h4>
                <p>Gastos generales: {displayMoney(part.general_expense)} {part.code}</p>
                <p>Inventario: {displayMoney(part.inv_expense)} {part.code}</p>
                <p>Administración: {displayMoney(part.admin_amount)} {part.code}</p>
                <p>Utilidad para comisiones: {displayMoney(part.gross_profit)} {part.code}</p>
                <p>Para Taionca, incluidos gastos recuperados: {displayMoney(part.taionca_profit)} {part.code}</p>
                {#each part.commissions as commission}<p>{roles[commission.role]} · {commission.user_name}: {displayMoney(commission.profit)} {part.code}</p>{/each}
            </article>
        {/each}
        <h4>Importes de ingresos utilizados</h4>
        {#each details.revenues as revenue}<p>{displayMoney(revenue.source_amount)} {revenue.source_code} → {displayMoney(revenue.amount)} {revenue.code}
            ({revenue.valuation_source==='manual'?'importe manual':revenue.valuation_source==='payment_equivalent'?'equivalente registrado en los abonos':'moneda original del ingreso'})</p>{/each}
        {#if details.expenses.length}
            <h4>Gastos asumidos por cada cierre</h4>
            {#each details.expenses as expense}<p>{expense.description} · {expense.source_amount===null?'Sin importe histórico':displayMoney(expense.source_amount)+' '+expense.source_code} → {displayMoney(expense.amount)} {expense.code}</p>{/each}
        {/if}
        {#if details.exchanges.length}
            <h4>Cambios de moneda registrados</h4>
            {#each details.exchanges as exchange}<p>{exchange.account_from}: −{displayMoney(exchange.amount_from)} {exchange.source_code} → {exchange.account_to}: +{displayMoney(exchange.amount_to)} {exchange.code}</p>{/each}
        {/if}
    </section>
{/if}
<style>
    section { margin: 1.5rem 0; overflow-wrap: anywhere; }
    article { border: 1px solid #c6c6c6; padding: 1rem; margin: 1rem 0; }
    h3,h4,p { margin-bottom: 1rem; }
</style>
