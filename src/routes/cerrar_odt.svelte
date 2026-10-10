<script context="module">
    export function preload({ query }) { return { initialOdt: query.odt || null }; }
</script>

<script>
    import { TextInput, Button } from 'carbon-components-svelte';
    import 'carbon-components-svelte/css/white.css';
    import Odt_settlement from '../components/Odt_settlement.svelte';
    import Odt_payment_history from '../components/Odt_payment_history.svelte';
    import Accounts from '../components/Accounts.svelte';
    import Odts from '../components/Odts.svelte';
    import Users_profit from '../components/Users_profit.svelte';
    import PercentInput from '../components/PercentInput.svelte';
    import { apiFetch, format_number } from '../functions';
    import { validateClosure } from '../lib/odt-closure';

    export let initialOdt = null;
    let paymentSummary = null;
    let loadingPayments = false;
    let loadVersion = 0;
    let odt = null;
    let account = null;
    let amount = '';
    let admin_users = [];
    let operative_users = [];
    let supervisor_users = [];
    let ceo_percent = 0.1;
    let admin_percent = 0;
    let saving = false;
    let error = '';
    let receipt = null;
    let refresh = 0;
    let selectedOdt = null;

    // Also handles clearing the selector and changing between ODTs in the same currency.
    $: resetForOdt(odt && odt.id_odt);
    function resetForOdt(id) {
        if (id === selectedOdt) return;
        selectedOdt = id;
        paymentSummary = null;
        loadPayments(id);
        account = null;
        amount = odt ? String(odt.amount).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : '';
        admin_percent = odt ? odt.admin_percent : 0;
        admin_users = [];
        operative_users = [];
        supervisor_users = [];
        ceo_percent = 0.1;
        error = '';
    }

    async function loadPayments(id) {
        const version = ++loadVersion;
        loadingPayments = !!id;
        if (!id) return;
        try {
            const result = await apiFetch('/api/public/odt_payments/' + id);
            if (version !== loadVersion) return;
            paymentSummary = result.data;
            if (paymentSummary.payments.length) amount = paymentSummary.paid_amount;
        } catch (err) { if (version === loadVersion) error = err.message; }
        finally { if (version === loadVersion) loadingPayments = false; }
    }
    $: hasPayments = !!(paymentSummary && paymentSummary.payments.length);
    $: payload = {
        id_odt: odt && odt.id_odt,
        id_account: hasPayments ? null : account && account.id_account,
        settle_payments: hasPayments,
        amount, admin_percent, ceo_percent,
        admin_users: admin_users.map(({ id_user, profit_percent }) => ({ id_user, profit_percent })),
        operative_users: operative_users.map(({ id_user, profit_percent }) => ({ id_user, profit_percent })),
        supervisor_users: supervisor_users.map(({ id_user, profit_percent }) => ({ id_user, profit_percent }))
    };
    $: validation = loadingPayments ? 'Consultando abonos…' : odt && !paymentSummary ? 'No se pudieron consultar los abonos. Vuelve a seleccionar la ODT.' : hasPayments && Number(paymentSummary.remaining_amount) !== 0 ? 'La ODT debe estar completamente pagada antes de cerrarla.' : validateClosure(payload);

    async function closeOdt() {
        if (hasPayments) return;
        if (saving) return;
        error = validation;
        if (error) return;
        saving = true;
        receipt = null;
        try {
            const { data } = await apiFetch('/api/public/closure_odt', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            receipt = data;
            odt = null;
            account = null;
            refresh += 1;
        } catch (err) {
            error = err.message;
        } finally {
            saving = false;
        }
    }
    function currencyClosed(event) {
        receipt=event.detail;odt=null;account=null;refresh+=1;
    }
</script>

<svelte:head><title>Cerrar ODT | Taionca</title></svelte:head>

<h1>Cerrar ODT</h1>
<p>Selecciona la ODT para revisar sus pagos y confirmar el cierre. Al cerrar se calculan administración y comisiones.</p>

{#if receipt}
    <div class="receipt" role="status">
        {#if receipt.settled_from_payments}
            ODT {receipt.id_odt} cerrada con sus abonos: {receipt.symbol}{format_number(receipt.amount, 'currency')} ({receipt.currency_code.toUpperCase()}).
            Cuentas: {receipt.account_name}. El cierre no volvió a ingresar el dinero.
        {:else}
            ODT {receipt.id_odt} cerrada. Se registraron {receipt.symbol}{format_number(receipt.amount, 'currency')}
            en {receipt.account_name} ({receipt.currency_code.toUpperCase()}).
        {/if}
    </div>
{/if}

<form on:submit|preventDefault={closeOdt}>
    <fieldset disabled={saving}>
        <legend>Datos del cierre</legend>
        {#key refresh}<Odts bind:odt initial_id={initialOdt} />{/key}
        {#if odt}<p><a href={'/abonos_odt?odt=' + odt.id_odt}>Registrar abonos en una o varias cuentas</a></p>{/if}
        {#if hasPayments}
            <div class="destination" data-testid="closure-payment-summary">
                <p>Abonado: {format_number(paymentSummary.paid_amount, 'currency')} {paymentSummary.currency_code}</p>
                <p>Pendiente: {format_number(paymentSummary.remaining_amount, 'currency')} {paymentSummary.currency_code}</p>
                <p>Selecciona cómo calcular y repartir las utilidades. Los abonos ya están registrados y no se ingresarán de nuevo.</p>
            </div>
        {:else}
        <TextInput type="number" labelText="Monto pagado" placeholder="Ingrese el monto..." bind:value={amount} min="0" step="any" />
        {#if odt}
            {#key odt.id_odt}
                <Accounts id_currency_filter={odt.id_currency} bind:account label="Cuenta de destino del pago" placeholder="Selecciona la cuenta de destino..." />
            {/key}
            <p class="hint">Se muestran las cuentas en {odt.code.toUpperCase()}, la moneda de esta ODT.</p>
        {/if}
        {/if}
        {#if hasPayments}
            {#key odt.id_odt}<Odt_settlement id_odt={odt.id_odt} bind:saving on:closed={currencyClosed} />{/key}
        {:else}
        <div class="percent"><h4>Porcentaje administrativo</h4><PercentInput label="Porcentaje administrativo" bind:value={admin_percent} /></div>
        <Users_profit label="Usuarios administrativos" bind:users_profit={admin_users} />
        <Users_profit label="Usuarios operativos" bind:users_profit={operative_users} />
        <Users_profit label="Usuarios supervisores" bind:users_profit={supervisor_users} />
        <div class="percent"><h4>Presidente</h4><PercentInput label="Porcentaje del presidente" bind:value={ceo_percent} /></div>
        {#if !hasPayments && account && amount}
            <p class="destination">Destino: <strong>{account.name} ({account.code.toUpperCase()})</strong> · Monto: {account.symbol}{format_number(amount, 'currency')}</p>
        {/if}
        {#if validation}<p class="hint" role="status">{validation}</p>{/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <Button type="submit" disabled={saving || !!validation}>{saving ? 'Cerrando ODT…' : 'Cerrar ODT'}</Button>
        {/if}
    </fieldset>
</form>
<Odt_payment_history summary={paymentSummary} />

<style>
    h1, p, :global(form .selectContainer), .percent { margin-bottom: 1rem; }
    fieldset { border: 0; padding: 0; min-width: 0; }
    legend { font-weight: 600; margin-bottom: 1rem; }
    .percent { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .hint { color: #525252; margin-top: .5rem; }
    .error { color: #a2191f; }
    .receipt, .destination { padding: 1rem; background: #defbe6; margin: 1rem 0; }
</style>
