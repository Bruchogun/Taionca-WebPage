<script>
    import SelectSearch from './Select.svelte';
    import { onMount } from 'svelte';
    import { apiFetch } from '../functions';

    export let account;
    export let id_currency_filter = null;
    export let isMulti = false;
    export let default_account;
    export let label = '';
    export let placeholder = 'Cuentas...';
    let accounts = [];
    let loaded = false;
    let error = '';
    let defaultApplied = false;

    onMount(async () => {
        try {
            ({ accounts } = await apiFetch('/api/public/accounts'));
            loaded = true;
        } catch (err) {
            error = 'No se pudieron cargar las cuentas. Recarga la página para volver a intentarlo.';
        }
    });

    $: accountsToList = accounts
        .filter(({ id_currency }) => !id_currency_filter || Number(id_currency) === Number(id_currency_filter))
        .map(item => ({ ...item, value: item.id_account, label: `${item.name} (${item.symbol})` }));

    $: applyDefault(loaded, default_account, accountsToList, isMulti);
    function applyDefault(ready, defaultId, items, multi) {
        if (!ready || !defaultId || defaultApplied) return;
        const item = items.find(item => item.id_account === Number(defaultId));
        if (item) {
            account = multi ? [item] : item;
            defaultApplied = true;
        }
    }
    $: reconcileAccount(loaded, accountsToList, isMulti);
    function reconcileAccount(ready, items, multi) {
        if (!ready || !account) return;
        const allowed = new Set(items.map(item => item.id_account));
        if (multi && Array.isArray(account)) {
            if (account.some(item => !allowed.has(item.id_account))) account = account.filter(item => allowed.has(item.id_account));
        } else if (!multi && !allowed.has(account.id_account)) {
            account = null;
        }
    }
</script>

{#if label}<p class="account-label">{label}</p>{/if}
<SelectSearch on:select on:change {placeholder} bind:selected={account} items={accountsToList} {isMulti} />
{#if error}<p role="alert">{error}</p>{/if}
{#if loaded && accountsToList.length === 0}<p role="status">No hay cuentas disponibles para esta moneda. Crea una cuenta antes de continuar.</p>{/if}

<style>.account-label { margin: 1rem 0 .5rem; font-weight: 600; }</style>
