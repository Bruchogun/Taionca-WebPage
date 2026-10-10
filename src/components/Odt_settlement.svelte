<script>
    import { onMount, createEventDispatcher } from 'svelte';
    import { Button, TextInput } from 'carbon-components-svelte';
    import PercentInput from './PercentInput.svelte';
    import Users_profit from './Users_profit.svelte';
    import { apiFetch } from '../functions';
    import { initialSettlement, calculateSettlement } from '../lib/odt-settlement';
    import { displayMoney, units, money } from '../lib/money';
    export let id_odt;
    export let saving = false;
    const dispatch=createEventDispatcher();
    let source=null;
    let input=null;
    let modeChoice='split';
    let chosenCurrency='';
    let loading=true;
    let error='';
    let needsRefresh=false;
    let expensesOpen=false;
    let reviewedExchange=false;
    onMount(load);
    async function load() {
        loading=true;error='';needsRefresh=false;
        try {
            const result=await apiFetch('/api/public/odt_settlement/'+id_odt);
            source=result.data;
            chosenCurrency=String(source.currencies[0] && source.currencies[0].id_currency || source.odt.id_currency);
            modeChoice='split'; reset();
        } catch(err) {error=err.message;}
        finally {loading=false;}
    }
    function reset() {
        const mode=modeChoice==='split'?'split':'single';
        const target=modeChoice==='original'?source.odt.id_currency:Number(chosenCurrency);
        input=initialSettlement(source,mode,target);
        reviewedExchange=false;
    }
    function currencyCode(id) {
        if(Number(id)===source.odt.id_currency)return source.odt.currency_code;
        const currency=source.currencies.find(c=>c.id_currency===Number(id));
        return currency?currency.code:'';
    }
    function changeExpense(index) {
        const original=source.expenses[index];
        input.expenses[index].amount=Number(input.expenses[index].id_currency)===original.source_currency && original.source_amount!==null ? original.source_amount : '';
        input=input;
    }
    function addExchange() {input.exchanges=[...input.exchanges,{id_account_from:'',amount_from:'',amount_to:''}];input=input;reviewedExchange=false;}
    function setIncome(currency,amount) {
        const values=input.income_values.filter(v=>v.id_currency!==currency);
        input.income_values=[...values,{id_currency:currency,amount}];input=input;
    }
    $: preview=source && input ? calculateSettlement(source,input) : null;
    $: openForDeficit(preview && preview.errors);
    function openForDeficit(errors) {if(errors && errors.some(e=>e.kind==='deficit'||e.expense_key))expensesOpen=true;}
    $: targetAccounts=source && input ? source.accounts.filter(a=>a.id_currency===Number(input.id_currency)) : [];
    $: targetAccount=source && input ? source.accounts.find(a=>a.id_account===Number(input.id_account)) : null;
    $: requiredIncome=source && input && input.mode==='single' && Number(input.id_currency)!==source.odt.id_currency ? source.currencies.filter(c=>c.id_currency!==Number(input.id_currency)) : [];
    async function close() {
        if(saving || !preview || !preview.valid || needsRefresh || (input.exchanges.length && !reviewedExchange))return;
        saving=true;error='';
        try {
            const {data}=await apiFetch('/api/public/odt_settlement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
            dispatch('closed',data);
        } catch(err) {
            error=err.message;
            if(/cambiaron|ya está cerrada/.test(error))needsRefresh=true;
        } finally {saving=false;}
    }
</script>

{#if loading}<p role="status">Preparando cierres por moneda…</p>{/if}
{#if error}<p class="error" role="alert">{error}</p><Button type="button" kind="secondary" on:click={load} disabled={saving}>Recargar cierre</Button>{/if}
{#if source && input}
    <section aria-label="Cierre por moneda">
        <label class="field">Forma de cierre
            <select aria-label="Forma de cierre" bind:value={modeChoice} on:change={reset} disabled={saving}>
                <option value="split">Mini cierres separados por moneda</option>
                <option value="original">Repartir en la moneda original de la ODT ({source.odt.currency_code})</option>
                <option value="received">Repartir en otra moneda recibida</option>
            </select>
        </label>
        {#if modeChoice==='received'}
            <label class="field">Moneda del reparto
                <select aria-label="Moneda del reparto" bind:value={chosenCurrency} on:change={reset} disabled={saving}>
                    {#each source.currencies as currency}<option value={String(currency.id_currency)}>{currency.code}</option>{/each}
                </select>
            </label>
        {/if}
        <p>Los importes se conservan por moneda. Cambiar la modalidad reinicia las asignaciones de este formulario.</p>
        {#if modeChoice==='split'}
            <p>Cada mini cierre usa los ingresos y gastos de su moneda. El reparto se realiza en las cuentas que recibieron los abonos y todos los mini cierres se confirman juntos.</p>
        {:else}
            <p>El reparto se pagará desde una cuenta en {currencyCode(input.id_currency)}. El cálculo no cambia por sí solo el dinero de otras cuentas.</p>
            {#if modeChoice==='original'}<p>Los ingresos usan los equivalentes en {source.odt.currency_code} que registraste en los abonos.</p>{/if}
            <label class="field">Cuenta para pagar el reparto
                <select aria-label="Cuenta para pagar el reparto" bind:value={input.id_account} disabled={saving}>
                    <option value={null}>Selecciona una cuenta</option>
                    {#each targetAccounts as account}<option value={account.id_account}>{account.name} ({account.code})</option>{/each}
                </select>
            </label>
            {#if targetAccount}<p>Saldo actual de Taionca: {displayMoney(targetAccount.balance)} {targetAccount.code}.</p>{/if}
            {#each requiredIncome as currency}
                <TextInput type="number" labelText={'¿Cuánto representan ' + displayMoney(currency.amount) + ' ' + currency.code + ' en ' + currencyCode(input.id_currency) + '?'}
                    value={(input.income_values.find(v=>v.id_currency===currency.id_currency)||{}).amount || ''}
                    on:input={event=>setIncome(currency.id_currency,event.target.value)} min="0" step="any" disabled={saving} />
            {/each}
        {/if}

        <details bind:open={expensesOpen} class="expenses">
            <summary>Revisar o reasignar gastos manualmente ({source.expenses.length})</summary>
            <p>Reasignar un gasto cambia qué cierre lo asume. Su movimiento bancario original se conserva y no se cobra de nuevo.</p>
            {#if !source.expenses.length}<p>No hay gastos registrados para esta ODT.</p>{/if}
            {#each source.expenses as expense,index (expense.expense_key)}
                <article data-expense={expense.expense_key}>
                    <strong>{expense.description || expense.expense_key}</strong>
                    <p>{expense.expense_key} · {expense.source_amount!==null ? 'Original: '+displayMoney(expense.source_amount)+' '+expense.source_code : 'No hay importe contable histórico: indica el monto que debe asumir el cierre.'}</p>
                    <label class="field">Moneda que asume este gasto
                        <select aria-label={'Moneda del gasto ' + expense.expense_key} bind:value={input.expenses[index].id_currency} on:change={()=>changeExpense(index)} disabled={saving}>
                            <option value={null}>Selecciona la moneda</option>
                            {#each input.parts as part}<option value={part.id_currency}>{currencyCode(part.id_currency)}</option>{/each}
                        </select>
                    </label>
                    <TextInput type="number" labelText={'Importe del gasto ' + expense.expense_key + ' en ' + currencyCode(input.expenses[index].id_currency)}
                        bind:value={input.expenses[index].amount} min="0" step="any"
                        disabled={saving || (expense.source_currency===Number(input.expenses[index].id_currency) && expense.source_amount!==null)} />
                    {#if expense.source_currency!==Number(input.expenses[index].id_currency)}<p>Escribe el importe exacto en la moneda destino. No se aplicará una tasa automáticamente.</p>{/if}
                </article>
            {/each}
        </details>

        {#each input.parts as settings,index (settings.id_currency)}
            <section class="part" data-part-currency={settings.id_currency}>
                <h3>{input.mode==='split'?'Mini cierre':'Cierre'} en {currencyCode(settings.id_currency)}</h3>
                {#each preview.parts.filter(p=>p.id_currency===settings.id_currency) as part}
                    <div data-testid={'part-summary-'+part.id_currency}>
                        <p>Ingresos: <strong>{displayMoney(part.amount)} {part.code}</strong></p>
                        <p>Gastos generales: {displayMoney(part.general_expense)} {part.code} · Inventario: {displayMoney(part.inv_expense)} {part.code}</p>
                        <p>Administración: {displayMoney(part.admin_amount)} {part.code}</p>
                        <p class:negative={part.gross_profit.startsWith('-')}>Utilidad para comisiones: <strong>{displayMoney(part.gross_profit)} {part.code}</strong></p>
                        <p>Para Taionca, incluidos gastos recuperados: {displayMoney(part.taionca_profit)} {part.code}</p>
                        <p>Administración y comisiones a repartir: {displayMoney(money(part.commissions.reduce((sum,c)=>sum+units(c.profit),units(part.admin_amount))))} {part.code}</p>
                    </div>
                {/each}
                <PercentInput label={'Administración en '+currencyCode(settings.id_currency)} bind:value={input.parts[index].admin_percent} />
                <PercentInput label={'Presidente en '+currencyCode(settings.id_currency)} bind:value={input.parts[index].ceo_percent} />
                <details>
                    <summary>Usuarios y comisiones en {currencyCode(settings.id_currency)}</summary>
                    <Users_profit label="Usuarios administrativos" bind:users_profit={input.parts[index].admin_users} />
                    <Users_profit label="Usuarios operativos" bind:users_profit={input.parts[index].operative_users} />
                    <Users_profit label="Usuarios supervisores" bind:users_profit={input.parts[index].supervisor_users} />
                </details>
            </section>
        {/each}

        {#if input.mode==='single'}
            <details class="exchanges">
                <summary>Cambios de moneda para disponer de saldo en la cuenta de reparto</summary>
                <p>Opcional. Registra únicamente cambios que quieras reflejar en los saldos: el importe de salida y el de llegada se escriben por separado.</p>
                {#each input.exchanges as exchange,index}
                    <article>
                        <label class="field">Cuenta de origen
                            <select aria-label={'Origen del cambio '+(index+1)} bind:value={input.exchanges[index].id_account_from} disabled={saving}>
                                <option value="">Selecciona una cuenta</option>
                                {#each source.accounts.filter(a=>a.id_currency!==Number(input.id_currency) && source.payment_accounts.some(p=>p.id_account===a.id_account)) as account}
                                    <option value={account.id_account}>{account.name} ({account.code})</option>
                                {/each}
                            </select>
                        </label>
                        <TextInput type="number" labelText={'Monto que sale en el cambio '+(index+1)} bind:value={input.exchanges[index].amount_from} on:input={()=>reviewedExchange=false} min="0" step="any" disabled={saving} />
                        <TextInput type="number" labelText={'Monto que llega en '+currencyCode(input.id_currency)+' en el cambio '+(index+1)} bind:value={input.exchanges[index].amount_to} on:input={()=>reviewedExchange=false} min="0" step="any" disabled={saving} />
                        <Button type="button" kind="tertiary" on:click={()=>{input.exchanges=input.exchanges.filter((e,i)=>i!==index);input=input;reviewedExchange=false;}} disabled={saving}>Quitar cambio</Button>
                    </article>
                {/each}
                <Button type="button" kind="secondary" on:click={addExchange} disabled={saving}>Agregar cambio manual</Button>
            </details>
            {#if input.exchanges.length}
                <div class="cash-confirmation">
                    {#each preview.exchanges as exchange}<p>Se descontarán {displayMoney(exchange.amount_from)} de {source.accounts.find(a=>a.id_account===exchange.account_from).name} y se acreditarán {displayMoney(exchange.amount_to)} {currencyCode(input.id_currency)} en {targetAccount ? targetAccount.name : 'la cuenta de reparto'}.</p>{/each}
                    <label><input type="checkbox" bind:checked={reviewedExchange} disabled={saving} /> Confirmo los cambios de moneda y sus movimientos de saldo al cerrar.</label>
                </div>
            {/if}
        {/if}
        {#each preview.errors as issue}<p class="error" role="status">{issue.message}</p>{/each}
        <Button type="button" on:click={close} disabled={saving || !preview.valid || needsRefresh || (input.exchanges.length>0 && !reviewedExchange)}>{saving?'Cerrando ODT…':'Cerrar ODT'}</Button>
    </section>
{/if}

<style>
    .field { display: block; margin: 1rem 0; font-weight: 600; }
    select { display: block; width: 100%; max-width: 100%; padding: .65rem; margin-top: .5rem; background: white; border: 1px solid #8d8d8d; }
    p, h3 { margin: 1rem 0; }
    .part, article, .cash-confirmation { border: 1px solid #c6c6c6; padding: 1rem; margin: 1rem 0; min-width: 0; overflow-wrap: anywhere; }
    details { margin: 1.5rem 0; }
    summary { cursor: pointer; font-weight: 600; }
    .error, .negative { color: #a2191f; }
    .cash-confirmation { background: #fff1e6; }
</style>
