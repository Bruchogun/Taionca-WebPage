<script>
    export let summary;
    function number(value) {
        const [integer, decimals = ''] = String(value).split('.');
        const fraction = decimals.replace(/0+$/, '');
        return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '');
    }
</script>

{#if summary && summary.payments.length}
    <section aria-label="Historial de abonos" class="history">
        <h3>Historial de abonos</h3>
        {#each summary.payments as payment (payment.id_odt_payment)}
            <article data-payment-id={payment.id_odt_payment}>
                <strong>{payment.account_name}: {number(payment.amount)} {payment.currency_code}</strong>
                <p>Equivalente: {number(payment.amount_odt)} {summary.currency_code}
                    {#if payment.exchange_rate} · Tasa histórica: 1 {summary.currency_code} = {number(payment.exchange_rate)} {payment.currency_code}
                    {:else} · Importe indicado manualmente{/if}
                </p>
                <p>{new Date(payment.created_at).toLocaleString('es-CO')} · {payment.user_name} · Abono #{payment.id_odt_payment}</p>
                {#if payment.description}<p>{payment.description}</p>{/if}
            </article>
        {/each}
        {#if summary.allocations.length}
            <h3>Distribución del cierre</h3>
            {#each summary.allocations as allocation}
                <p>{allocation.account_name} · {allocation.entity_name}: {number(allocation.amount)} {allocation.currency_code}</p>
            {/each}
        {/if}
    </section>
{/if}

<style>
    .history { margin: 1.5rem 0; overflow-wrap: anywhere; }
    h3 { margin: 1rem 0; }
    article { border: 1px solid #c6c6c6; padding: 1rem; margin-bottom: .75rem; }
    p { margin: .5rem 0; }
</style>
