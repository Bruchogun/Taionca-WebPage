<script>
    import { displayMoney } from '../lib/money';
    export let summary;
    $: hasFinalAmount = summary && summary.settlement_amount != null;
    function formatRate(value) {
        const [integer, decimals = ''] = String(value).split('.');
        const fraction = decimals.replace(/0+$/, '');
        return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '');
    }
</script>

{#if summary && (summary.payments.length || summary.internal_billings?.length || summary.allocations.length || hasFinalAmount)}
    <section aria-label="Historial de abonos" class="history">
        <h3>Historial de abonos</h3>
        {#if hasFinalAmount}
            <p>Importe final: {displayMoney(summary.settlement_amount, summary.currency_code || summary.symbol)} {summary.currency_code}
                · Contrato original: {displayMoney(summary.original_contract_amount, summary.currency_code || summary.symbol)} {summary.currency_code}</p>
        {/if}
        {#each summary.payments as payment (payment.id_odt_payment)}
            <article data-payment-id={payment.id_odt_payment}>
                <strong>{payment.account_name}: {displayMoney(payment.amount, payment.currency_code || payment.symbol)} {payment.currency_code}</strong>
                <p>Abono a la ODT: {displayMoney(payment.amount_odt, summary.currency_code || summary.symbol)} {summary.currency_code}
                    {#if payment.exchange_rate} · Tasa histórica: 1 {summary.currency_code} = {formatRate(payment.exchange_rate)} {payment.currency_code}
                    {:else} · Importe indicado manualmente{/if}
                </p>
                <p>Registrado: {new Date(payment.created_at).toLocaleString('es-CO')} · {payment.user_name} · Abono #{payment.id_odt_payment}</p>
                {#if payment.description}<p>{payment.description}</p>{/if}
            </article>
        {/each}
        {#if summary.internal_billings && summary.internal_billings.length}
            <h3>Facturas entre ODTs</h3>
            {#each summary.internal_billings as billing (billing.id_internal_odt_billing)}
                <p>
                    {#if billing.id_supplier_odt === summary.id_odt}
                        Cliente interno: ODT {billing.id_customer_odt}
                    {:else}
                        Gasto por ODT {billing.id_supplier_odt}
                    {/if}
                    · {displayMoney(billing.amount, billing.currency_code)} {billing.currency_code}
                    · Abono #{billing.id_odt_payment}
                </p>
            {/each}
        {/if}
        {#if summary.allocations.length}
            <h3>Distribución del cierre</h3>
            {#each summary.allocations as allocation}
                <p>{allocation.account_name} · {allocation.entity_name}: {displayMoney(allocation.amount, allocation.currency_code)} {allocation.currency_code}</p>
            {/each}
        {/if}
    </section>
{/if}

<style>
    .history { margin: 1.5rem 0; overflow-wrap: anywhere; }
    h3 { margin: 1rem 0; }
    article { border: 1px solid var(--taionca-border, #c6c6c6); padding: 1rem; margin-bottom: .75rem; }
    p { margin: .5rem 0; }
</style>
