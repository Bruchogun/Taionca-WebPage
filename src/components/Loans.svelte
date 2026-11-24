<script>
    import { onMount } from 'svelte';
    import { session } from '../stores';
    import { allows } from '../security/access';
    import { DataTable, InlineNotification } from 'carbon-components-svelte';
    import { apiFetch } from '../functions';
    import { amountColumn } from '../lib/money-table';
    import SelectSearch from './Select.svelte';

    let rows;
    let registerRows;
    let companyRows;
    let companyRegisterRows;
    let purchaseRows = [];
    let usersToList = [];
    let error = '';
    let purchasesError = '';
    let loadVersion = 0;
    let loading = false;

    const formatDate = value => value == null ? 'Pendiente' : new Date(value).toLocaleDateString('es-CO');
    const compareDates = (a, b) => a === b ? 0 : (a ?? Infinity) - (b ?? Infinity);
    const capitalizeCurrency = name => name.replace(/(^|\s)\S/g, letter => letter.toUpperCase());
    const amountCell = entry => ({ value: entry.amount, currency: entry.code, symbol: entry.symbol });

    async function loadPurchases(userId, version) {
        try {
            const response = await fetch('/api/public/unassigned_company_purchases');
            if (!response.ok) throw new Error('No se pudieron cargar las compras pendientes de ODT.');
            const { unassigned_company_purchases = [] } = await response.json();
            if (version !== loadVersion) return;
            purchaseRows = unassigned_company_purchases
                .filter(purchase => purchase.owner_user_id === userId)
                .map(purchase => ({
                    id: purchase.id_purchase,
                    owner: [purchase.owner_name, purchase.owner_lastname].filter(Boolean).join(' ').trim(),
                    currency: purchase.currency_code,
                    amount: { value: purchase.amount, currency: purchase.currency_code },
                    description: purchase.description,
                    source: (purchase.sheet_title || purchase.account_name) + '!' + purchase.source_cell,
                    merchant_payment: 'Pagado por propietario',
                    status: 'Pendiente'
                }));
        } catch {
            if (version === loadVersion) purchasesError = 'No se pudieron cargar las compras pendientes de ODT.';
        }
    }

    async function loadLoans(userId) {
        const version = ++loadVersion;
        rows = registerRows = companyRows = companyRegisterRows = null;
        purchaseRows = [];
        error = purchasesError = '';
        loading = true;
        try {
            const [response, { loans_register }] = await Promise.all([
                apiFetch('/api/public/loans'),
                apiFetch('/api/public/loans_registers')
            ]);
            if (version !== loadVersion) return;
            rows = response.loans.filter(loan => loan.id_user === userId && Number(loan.amount) !== 0).map(loan => ({
                id: loan.id_loan,
                currency: capitalizeCurrency(loan.name_plural),
                amount: amountCell(loan)
            }));
            registerRows = loans_register.filter(loan => loan.id_user === userId).map(loan => ({
                id: loan.id_loans_register,
                currency: capitalizeCurrency(loan.name_plural),
                amount: amountCell(loan),
                description: loan.description,
                date: Date.parse(loan.created_at)
            }));
            companyRows = (response.company_debts || []).filter(debt => debt.id_owner_user === userId && Number(debt.amount) !== 0).map(debt => ({
                id: debt.id_company_debt,
                account: debt.account_name,
                currency: capitalizeCurrency(debt.name_plural),
                amount: amountCell(debt)
            }));
            companyRegisterRows = (response.company_debt_registers || []).filter(debt => debt.id_owner_user === userId).map(debt => ({
                id: debt.id_company_debt_movement,
                original_date: debt.occurred_at ? Date.parse(debt.occurred_at) : null,
                recorded_date: Date.parse(debt.created_at),
                account: debt.account_name,
                currency: capitalizeCurrency(debt.name_plural),
                kind: debt.kind !== 'advance' ? 'Devolución' :
                    debt.mode === 'recognize_only' ? 'Reconocimiento de deuda' : 'Adelanto',
                amount: amountCell(debt),
                description: debt.description
            }));
        } catch {
            if (version === loadVersion) error = 'No se pudieron cargar los préstamos y las deudas.';
        }
        if (version !== loadVersion) return;
        await loadPurchases(userId, version);
        if (version === loadVersion) loading = false;
    }

    $: canReadAll = allows($session, ['finance.read', 'finance.loans']);
    $: hasRecords = rows?.length || registerRows?.length || companyRows?.length || companyRegisterRows?.length || purchaseRows.length;
    onMount(async () => {
        if (canReadAll) {
            try {
                const { loan_users = [] } = await apiFetch('/api/public/loans');
                usersToList = loan_users.map(({ user_id, name, lastname }) => ({
                    value: user_id, label: [name, lastname].filter(Boolean).join(' ').trim()
                }));
            } catch {
                error = 'No se pudo cargar la lista de usuarios.';
            }
        } else if ($session) {
            await loadLoans($session.user_id);
        }
    });

    const headers = [
        { key: 'currency', value: 'Moneda' },
        { ...amountColumn, value: 'Saldo adeudado' }
    ];
    const companyHeaders = [
        { key: 'account', value: 'Cuenta' },
        { key: 'currency', value: 'Moneda' },
        { ...amountColumn, value: 'Saldo adeudado' }
    ];
    const companyRegisterHeaders = [
        { key: 'original_date', value: 'Fecha original', display: formatDate, sort: compareDates },
        { key: 'recorded_date', value: 'Registrado', display: formatDate, sort: compareDates },
        { key: 'account', value: 'Cuenta' },
        { key: 'currency', value: 'Moneda' },
        { key: 'kind', value: 'Tipo' },
        { ...amountColumn, value: 'Importe' },
        { key: 'description', value: 'Comentario' }
    ];
    const purchaseHeaders = [
        { key: 'owner', value: 'Propietario' },
        { key: 'currency', value: 'Moneda', sort: false },
        { ...amountColumn, value: 'Importe' },
        { key: 'description', value: 'Concepto' },
        { key: 'source', value: 'Celda de origen' },
        { key: 'merchant_payment', value: 'Pago al comercio', sort: false },
        { key: 'status', value: 'ODT', sort: false }
    ];
    const registerHeaders = [
        { key: 'date', value: 'Registrado', display: formatDate, sort: compareDates },
        { key: 'currency', value: 'Moneda' },
        { ...amountColumn, value: 'Saldo' },
        { key: 'description', value: 'Comentario' }
    ];
</script>

<h5>Gestión de deudas</h5>

{#if canReadAll}
    <SelectSearch on:select={event => loadLoans(event.detail.value)} items={usersToList} isClearable={false}
        placeholder="Usuarios..." inputAttributes={{ 'aria-label': 'Seleccionar usuario de deudas' }}/>
{:else}
    <p>Mis deudas</p>
{/if}

{#if error}
    <InlineNotification kind="error" title={error} hideCloseButton />
{:else if loading && !hasRecords}
    <p role="status">Cargando deudas…</p>
{:else if rows && !loading && !purchasesError && !hasRecords}
    <InlineNotification kind="info" role="status" title="Sin saldos ni movimientos registrados." hideCloseButton />
{/if}

{#if rows?.length}
    <div class="table-scroll">
        <DataTable size="short" title="El usuario debe a Taionca" sortable {headers} {rows} />
    </div>
{/if}

{#if registerRows?.length}
    <div class="table-scroll loan-history">
        <DataTable size="short" title="Registro de préstamos" sortable headers={registerHeaders} rows={registerRows} />
    </div>
{/if}

{#if companyRows?.length}
    <div class="table-scroll">
        <DataTable size="short" title="Taionca debe al usuario" sortable headers={companyHeaders} rows={companyRows} />
    </div>
{/if}

{#if companyRegisterRows?.length}
    <div class="table-scroll company-history">
        <DataTable size="short" title="Registro de adelantos a Taionca" sortable headers={companyRegisterHeaders} rows={companyRegisterRows} />
    </div>
{/if}

{#if purchasesError}<InlineNotification kind="warning" title={purchasesError} hideCloseButton />{/if}

{#if purchaseRows.length}
    <div class="bx--data-table-header">
        <h4 class="bx--data-table-header__title">Compras de Taionca pendientes de ODT ({purchaseRows.length})</h4>
    </div>
    <div class="table-scroll purchase-history">
        <DataTable size="short" sortable headers={purchaseHeaders} rows={purchaseRows} />
    </div>
{/if}

<style>
    .table-scroll { width: 100%; min-width: 0; overflow-x: auto; }
    .purchase-history :global(.bx--data-table) { min-width: 60rem; table-layout: fixed; }
    .purchase-history :global(.bx--data-table th), .purchase-history :global(.bx--data-table td) { white-space: normal; overflow-wrap: anywhere; }
    .purchase-history :global(.bx--data-table th:nth-child(1)) { width: 16%; }
    .purchase-history :global(.bx--data-table th:nth-child(2)) { width: 9%; }
    .purchase-history :global(.bx--data-table th:nth-child(3)) { width: 11%; }
    .purchase-history :global(.bx--data-table th:nth-child(4)) { width: 22%; }
    .purchase-history :global(.bx--data-table th:nth-child(5)) { width: 17%; }
    .purchase-history :global(.bx--data-table th:nth-child(6)) { width: 13%; }
    .purchase-history :global(.bx--data-table th:nth-child(7)) { width: 12%; }
    .purchase-history :global(.bx--data-table td:nth-child(3)) { white-space: nowrap; }
    @media (max-width: 40rem) {
        .loan-history :global(.bx--data-table) { min-width: 32rem; }
        .company-history :global(.bx--data-table) { min-width: 56rem; }
    }
</style>
