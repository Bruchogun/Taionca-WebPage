<script context="module">
    export function preload({ query }) { return { initialOdt: query.odt || null }; }
</script>

<script>
    import 'carbon-components-svelte/css/white.css';
    import { TextInput, Button } from 'carbon-components-svelte';
    import Odts from '../components/Odts.svelte';
    import Accounts from '../components/Accounts.svelte';
    import Odt_payment_history from '../components/Odt_payment_history.svelte';
    import { apiFetch, format_number } from '../functions';
    import { validatePayment, paymentKey } from '../lib/odt-payments';

    export let initialOdt = null;
    let odt = null;
    let account = null;
    let amount = '';
    let equivalent = '';
    let description = '';
    let key = '';
    let summary = null;
    let selected = null;
    let selectedAccount = null;
    let loading = false;
    let saving = false;
    let error = '';
    let receipt = '';
    let pending = null;
    let selectionVersion = 0;

    $: selectOdt(odt && odt.id_odt);
    async function selectOdt(id) {
        if (id === selected) return;
        selected = id;
        const version = ++selectionVersion;
        account = null; amount = ''; equivalent = ''; description = ''; summary = null; error = ''; receipt = ''; pending = null;
        if (!id) return;
        loading = true;
        key = paymentKey();
        try {
            pending = JSON.parse(sessionStorage.getItem('odt-payment-' + id) || 'null');
            const result = await apiFetch('/api/public/odt_payments/' + id);
            if (version === selectionVersion) summary = result.data;
        } catch (err) { if (version === selectionVersion) error = err.message; }
        finally { if (version === selectionVersion) loading = false; }
    }
    $: selectAccount(account && account.id_account, odt && odt.id_currency);
    function selectAccount(id, currency) {
        if (selectedAccount === id + ':' + currency) return;
        selectedAccount = id + ':' + currency;
        equivalent = '';
    }
    $: payload = { id_odt: odt && odt.id_odt, id_account: account && account.id_account,
        amount, amount_odt: account && odt && account.id_currency === odt.id_currency ? amount : equivalent, description, request_key: key };
    $: validation = validatePayment(payload);


    async function savePayment() {
        if (saving || (!pending && (validation || !summary))) return;
        saving = true; error = ''; receipt = '';
        try {
            // Persist the exact request before sending; retries and page reloads reuse its key.
            if (!pending) {
                sessionStorage.setItem('odt-payment-' + selected, JSON.stringify(payload));
                pending = { ...payload };
            }
            const response = await fetch('/api/public/odt_payments', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending)
            });
            const result = await response.json();
            if (!response.ok || result.error) {
                if (response.status >= 400 && response.status < 500) {
                    sessionStorage.removeItem('odt-payment-' + selected);
                    pending = null;
                }
                throw new Error(result.error || 'No se pudo confirmar el abono.');
            }
            summary = result.data;
            sessionStorage.removeItem('odt-payment-' + selected);
            pending = null;
            receipt = 'Abono #' + result.id_odt_payment + ' registrado. El dinero ya está disponible en la cuenta seleccionada.';
            amount = ''; equivalent = ''; description = ''; key = paymentKey();
        } catch (err) {
            error = pending ? 'No se confirmó la respuesta. Pulsa «Reintentar abono» para consultar o completar la misma operación sin duplicarla.' : err.message;
        } finally { saving = false; }
    }
</script>

<svelte:head><title>Abonos de ODT | Taionca</title></svelte:head>
<h1>Abonos de ODT</h1>
<p>Registra cada pago en la cuenta y moneda donde lo recibiste. El saldo de Taionca aumenta al guardar el abono.</p>
<form on:submit|preventDefault={savePayment}>
    <fieldset disabled={saving || !!pending}>
        <legend>Registrar un abono</legend>
        <Odts bind:odt initial_id={initialOdt} />
        {#if loading}<p role="status">Cargando abonos…</p>{/if}
        {#if summary}
            <div class="summary" data-testid="payment-summary">
                <p>Valor de la ODT: <strong>{format_number(summary.amount, 'currency')} {summary.currency_code}</strong></p>
                <p>Abonado: <strong>{format_number(summary.paid_amount, 'currency')} {summary.currency_code}</strong></p>
                <p>Pendiente: <strong>{format_number(summary.remaining_amount, 'currency')} {summary.currency_code}</strong></p>
            </div>
            {#if !summary.closed && Number(summary.remaining_amount) > 0}
                {#key odt.id_odt}<Accounts bind:account label="Cuenta que recibió el abono" placeholder="Selecciona la cuenta del abono..." />{/key}
                <TextInput type="number" labelText={account ? 'Monto del abono (' + account.code.toUpperCase() + ')' : 'Monto del abono'} bind:value={amount} min="0" step="any" />
                {#if account && account.id_currency !== odt.id_currency}
                    <TextInput type="number" labelText={'Equivalente del abono en ' + summary.currency_code} bind:value={equivalent} min="0" step="any" />
                    <p>Escribe cuánto representa este pago en la moneda original de la ODT. No se calculará ninguna tasa.</p>
                {:else if account}<p>La cuenta y la ODT tienen la misma moneda; el equivalente es el monto del abono.</p>{/if}
                <TextInput labelText="Referencia o descripción del abono" bind:value={description} maxlength={512} />
            {:else}
                <p role="status">{summary.closed ? 'La ODT está cerrada.' : 'La ODT está completamente pagada. Ya puedes revisar y confirmar su cierre.'}</p>
            {/if}
        {/if}
    </fieldset>
    {#if pending}<p role="status">Hay un abono pendiente de confirmación. Reintenta la misma operación antes de registrar otro.</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if receipt}<p class="receipt" role="status">{receipt}</p>{/if}
    {#if pending || !summary || (!summary.closed && Number(summary.remaining_amount) > 0)}
        {#if validation && !pending}<p class="hint">{validation}</p>{/if}
        <Button type="submit" disabled={saving || loading || (!pending && (!!validation || !summary))}>{saving ? 'Registrando abono…' : pending ? 'Reintentar abono' : 'Registrar abono'}</Button>
    {/if}
</form>
{#if summary && !summary.closed}<p class="close-link"><a href={'/cerrar_odt?odt=' + summary.id_odt}>Revisar y cerrar esta ODT</a></p>{/if}
<Odt_payment_history {summary} />

<style>
    h1, p { margin-bottom: 1rem; }
    fieldset { border: 0; min-width: 0; padding: 0; }
    legend { margin-bottom: 1rem; font-weight: 600; }
    .summary, .receipt { padding: 1rem; background: #defbe6; margin: 1rem 0; }
    .summary p { margin-bottom: .5rem; }
    .hint { color: #525252; }
    .error { color: #a2191f; }
    .close-link { margin: 1.5rem 0; }
</style>
