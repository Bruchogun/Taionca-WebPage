<script>
    import { DataTable, Grid, Row, Column } from "carbon-components-svelte";
	import Odt_settlement_history from './Odt_settlement_history.svelte';
    import Odt_payment_history from './Odt_payment_history.svelte';
    import { compareMoney, displayMoney } from '../lib/money';
    import Closed_odts from './Closed_odts.svelte';
	import { apiFetch,  format_number } from '../functions';
	import { session } from '../stores';
	import { allows } from '../security/access';

	export let start_date;
	export let end_date;
	export let is_filtered;

	let admin_percent;
	let odt;
	let balance_movements = [];
	let odt_closure_resume = null;
    let payments = null;
    let currency_settlement = null;
    let commission_supplements = [];
    const supplementRoles = { admin: 'Administración', operative: 'Operación' };
    let loadVersion = 0;
	let isDisabled = true;
	let admin_profit;
	let taionca_profit;
	let general_expenses;
	let inv_expenses;

	$: isDisabled = !allows($session, ['odts.limits']);
	
    async function get_odt_movements(event) {
        const selected = event.detail;
        const version = ++loadVersion;
        odt_closure_resume = null;
        if (!selected) return;
        try {
            const [movements, closure] = await Promise.all([
                apiFetch('/api/public/odt_movements/' + selected.id_odt),
                apiFetch('/api/public/odt_closure_resume/' + selected.id_odt)
            ]);
            if (version !== loadVersion || odt?.id_odt !== selected.id_odt) return;
            ({ balance_movements } = movements);
            ({ odt_closure_resume, payments, currency_settlement, commission_supplements = [] } = closure);
            set_data_balance_movements();
            set_data_currency_movements();
            if (odt_closure_resume) set_data_closure_resume();
        } catch {
            // apiFetch surfaces the failure and the selection can be retried.
        }
    }
	//HEADERS
		let headers_balance_movements = [
			{ key: "entity", value: "Entidad"  },
			{ key: "account", value: "Cuenta" },
			{ key: "amount", value: "Monto", sort: compareMoney },
		{ key: "created_at", value: "Registrado" },
	];

	let headers_currencies = [
		{ key: "currency", value: "Moneda"  },
		{ key: "balance", value: "Saldo gastado", sort: compareMoney }
	];

	let headers_commissions = [
		{ key: "user", value: "Usuario"  },
		{ key: "position", value: "Cargo"  },
		{ key: "percentage", value: "%"  },
		{ key: "profit", value: "Monto", sort: compareMoney, display: value => odt.symbol + displayMoney(value, odt.code || odt.symbol) }
	];


	//ROWS
	let rows_balance_movements=[];
	function set_data_balance_movements(){
		rows_balance_movements = balance_movements.map(movement => ({
			id_balance: movement.id_balance,
			entity: movement.entity,
			account: movement.account,
			created_at: (new Date(movement.created_at)).toLocaleDateString(),
			id: movement.id_balance_movement,
			amount: movement.amount,
			currency_code: movement.currency_code || movement.symbol,
			symbol: movement.symbol,
			currency: movement.currency.replace(/(^|\s)\S/g, l => l.toUpperCase())
		}));
	}
	let rows_currencies = [];
	function set_data_currency_movements(){
		rows_currencies = [];
		const totals = new Map();
		for (const movement of rows_balance_movements) {
			if (!totals.has(movement.currency)) totals.set(movement.currency, { amount: 0, code: movement.currency_code });
			totals.get(movement.currency).amount += Number(movement.amount);
		}
		rows_currencies = Array.from(totals, ([currency, total], id) => ({
			currency,
			balance: total.amount,
			currency_code: total.code,
			id
		}));
	}

	let rows_commissions = [];
	function set_data_closure_resume(){
		rows_commissions = [];
		admin_percent = Number(odt_closure_resume.admin_expense_percent);
		admin_profit = displayMoney(odt_closure_resume.admin_profit, odt.code || odt.symbol)
		taionca_profit = displayMoney(odt_closure_resume.taionca_profit, odt.code || odt.symbol)
		general_expenses = displayMoney(odt_closure_resume.general_expenses, odt.code || odt.symbol)
		inv_expenses = displayMoney(odt_closure_resume.inv_expenses, odt.code || odt.symbol)

		if (odt_closure_resume.ceo_commissions.length > 0 || odt_closure_resume.admin_commissions.length > 0 || odt_closure_resume.operative_commissions.length > 0 || odt_closure_resume.supervisor_commissions.length > 0){

			let id = 0;
			let all_commissions = [
                ...odt_closure_resume.ceo_commissions, ...odt_closure_resume.admin_commissions,
                ...odt_closure_resume.operative_commissions, ...odt_closure_resume.supervisor_commissions
            ];

			rows_commissions = all_commissions.map((user) => ({
				user: `${user.user_name} ${user.user_lastname}`,
				position: user.user_position,
				percentage: format_number(user.percent, "percentage"),
				profit: user.profit,
				id: id++
			}))
		}
	}

	const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
</script>
<style>
	.margin{
		margin: 10px;
	}
    .commission-supplements { margin: 1rem 0; overflow-wrap: anywhere; }
    .commission-supplements h3 { font-size: 1.25rem; margin-bottom: 0.75rem; }
    .commission-supplements p { margin-bottom: 0.5rem; }
    .expense-history { width: 100%; min-width: 0; overflow-x: auto; }
    .expense-history :global(.bx--data-table) { min-width: 32rem; }
</style>

<Closed_odts bind:odt={odt} on:select={get_odt_movements} {is_filtered} {start_date} {end_date}/>

{#if odt && odt_closure_resume} 

    {#if commission_supplements.length}
        <section class="commission-supplements" aria-label="Ajustes complementarios de comisiones">
            <h3>Ajustes complementarios</h3>
            {#each commission_supplements as supplement (supplement.source_id ?? supplement.id_part)}
                <p>{supplement.user_name}
                    {#if supplementRoles[supplement.role]}
                        · {supplementRoles[supplement.role]} · Complemento al {format_number(supplement.percent, 'percentage')} de la utilidad ·
                    {:else}
                        · {format_number(supplement.percent, 'percentage')} de la utilidad ·
                    {/if}
                    {displayMoney(supplement.amount, supplement.currency)} {supplement.currency}</p>
                <p>{supplement.account} · Registrado: {new Date(supplement.recorded_at).toLocaleDateString()}</p>
            {/each}
        </section>
    {/if}

	<Grid narrow>
        {#if odt_closure_resume.id_account === null && !odt_closure_resume.settled_from_payments && Number(odt_closure_resume.paid_amount) === 0}
            <Row><Column><h5>Cierre sin ingreso</h5></Column></Row>
        {:else}
            <Row><Column><h5>Cuenta de destino: {odt_closure_resume.account_name}</h5></Column></Row>
            <Row><Column><h5>{currency_settlement && currency_settlement.settlement_mode!=='legacy'?'Equivalente total en la moneda original':'Monto recibido'}: {odt.symbol}{displayMoney(odt_closure_resume.paid_amount, odt.code || odt.symbol)}</h5></Column></Row>
        {/if}
		<Row>
			<Column padding style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Id de la ODT: {odt.id_odt}</h5>
			</Column>
		</Row>
		<Row>
			<Column padding style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Monto de contrato: {odt.symbol}{displayMoney(odt.amount, odt.code || odt.symbol)}</h5>
			</Column>
		</Row>
		<Row>
			<Column padding style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Cliente: {odt.name}</h5>
			</Column>
		</Row>
		<Row>
			<Column padding style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Responsable: {odt.user_name}</h5>
			</Column>
		</Row>
		<Row>
			<Column padding style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Fecha de apertura: {(new Date(odt.created_at)).toLocaleString("es-ES",options)}</h5>
			</Column>
		</Row>
		<Row>
			<Column padding style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Fecha de registro del cierre: {(new Date(odt.closed_at)).toLocaleString("es-ES",options)}</h5>
			</Column>
		</Row>
		<Row>
			<Column padding style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Descripción del trabajo:</h5>
			</Column>
			<Column sm={2} style="outline: 1px solid var(--cds-interactive-04)">
				<h5>{odt.description}</h5>
			</Column>
		</Row>		
        {#if !currency_settlement || currency_settlement.settlement_mode==='legacy'}
		<Row>
			<Column style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Dinero para Taionca: {odt.symbol}{taionca_profit}</h5>
			</Column>
		</Row>
		<Row>
			<Column style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Dinero para Administración: {odt.symbol}{admin_profit} | {format_number(admin_percent, "percentage")}</h5>
			</Column>
		</Row>
		<Row>
			<Column style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Dinero utilizado para gastos generales: {odt.symbol}{general_expenses}</h5>
			</Column>
		</Row>
		<Row>
			<Column style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Dinero utilizado para gastos de inventario: {odt.symbol}{inv_expenses}</h5>
			</Column>
		</Row>
        {/if}
	</Grid>
    <Odt_payment_history summary={payments} />
    <Odt_settlement_history details={currency_settlement} supplements={commission_supplements} />

	{#if rows_commissions.length!=0}
		<div class="margin">
			<DataTable size="short" title='Comisiones de la ODT {odt.id_odt}' sortable headers={headers_commissions} rows={rows_commissions} />
		</div>
	{/if}

	{#if rows_balance_movements.length!=0 || rows_currencies.length!=0}
		<div class="margin">
			<DataTable size="short" title="Gastos por moneda" sortable headers={headers_currencies} rows={rows_currencies}>
			<svelte:fragment slot="cell" let:cell let:row>
				{#if cell.key === 'balance'}{displayMoney(cell.value, row.currency_code)}{:else}{cell.value}{/if}
			</svelte:fragment>
		</DataTable>
		</div>	
		<div class="margin">
            <div class="bx--data-table-header">
                <h4 class="bx--data-table-header__title">Gastos de la ODT</h4>
            </div>
            <div class="expense-history">
                <DataTable size="short" sortable headers={headers_balance_movements} rows={rows_balance_movements}>
				<svelte:fragment slot="cell" let:cell let:row>
					{#if cell.key === 'amount'}{row.symbol} {displayMoney(cell.value, row.currency_code)}{:else}{cell.value}{/if}
				</svelte:fragment>
			</DataTable>
            </div>
		</div>
	{/if}
{/if}
