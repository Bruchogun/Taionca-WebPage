<script>
	import 'carbon-components-svelte/css/white.css';
    import { DataTable, Grid, Row, Column, Button } from "carbon-components-svelte";
	import Odt_payment_history from './Odt_payment_history.svelte';
    import Odts from './Odts.svelte';
	import { apiFetch } from '../functions';
    import PercentInput from './PercentInput.svelte';
    import { tick } from 'svelte';
	import { session } from '../stores';
	import { allows } from '../security/access';

	export let start_date;
	export let end_date;
	export let is_filtered;

	let admin_percent;
	let odt;
    let paymentSummary = null;
    let paymentError = '';
    let paymentSelection;
    $: loadPayments(odt && odt.id_odt);
    async function loadPayments(id) {
        paymentSelection = id; paymentSummary = null; paymentError = '';
        if (!id) return;
        try {
            const result = await apiFetch('/api/public/odt_payments/' + id);
            if (paymentSelection === id) paymentSummary = result.data;
        } catch (err) { if (paymentSelection === id) paymentError = err.message; }
    }
	let balance_movements = [];
	let isDisabled = true;

	$: isDisabled = !allows($session, ['odts.limits']);

	async function update_admin_percent(){
		await apiFetch("/api/public/update_admin_percent",{
			method: 'POST',
			body: JSON.stringify({
				admin_percent,
				id_odt: odt.id_odt}),
			headers: {'Content-Type': 'application/json'}
		});
	}
	
	async function get_odt_movements(){
		admin_percent = Number(odt.admin_percent);
		({balance_movements} = await apiFetch(`/api/public/odt_movements/${odt.id_odt}`));
		await tick();
		set_data_balance_movements();
		set_data_currency_movements();
	}
	//HEADERS
		let headers_balance_movements = [
			{ key: "entity", value: "Entidad"  },
			{ key: "account", value: "Cuenta" },
			{ key: "amount_label", value: "Monto" },
			{ key: "created_at", value: "Fecha" },
	];

	let headers_currencies = [
		{ key: "currency", value: "Moneda"  },
		{ key: "balance", value: "Saldo gastado"  }
	];


	//ROWS
	let rows_balance_movements=[];
	function set_data_balance_movements(){
		rows_balance_movements = balance_movements.map(movement => ({
			id_balance: movement.id_balance,
			entity: movement.entity,
			account: movement.account,
			end_balance: Number(movement.end_balance).toFixed(2),
			created_at: (new Date(movement.created_at)).toLocaleDateString(),
			id: movement.id_balance_movement,
			amount: movement.amount,
			amount_label: `${Number(movement.amount).toFixed(2)} ${movement.symbol}`,
			currency: movement.currency.replace(/(^|\s)\S/g, l => l.toUpperCase())
		}));
	}
	let rows_currencies = [];
	function set_data_currency_movements(){
		if (rows_balance_movements.length>0){
			const currencies_auxiliar = {};
			rows_balance_movements.forEach(movement => {
				if (currencies_auxiliar[movement.currency] === undefined) {
					currencies_auxiliar[movement.currency] = 0;
				}
				currencies_auxiliar[movement.currency] += Number(movement.amount)
			});
			rows_currencies = Object.entries(currencies_auxiliar).map(([currency, balance], id) => ({
				currency,
				balance: Number(balance).toFixed(2),
				id
			}))
		}
	}

	const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
	
</script>

<Odts bind:odt={odt} on:select={get_odt_movements} {is_filtered} {start_date} {end_date}/>

{#if odt} 

	<Grid narrow>
		<Row>
			<Column padding style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Id de la ODT: {odt.id_odt}</h5>
			</Column>
		</Row>
		<Row>
			<Column padding style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Monto de contrato: {Number(odt.amount).toFixed(2)} {odt.symbol}</h5>
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
			<Column style="outline: 1px solid var(--cds-interactive-04)">
				<h5>Porcentaje administrativo:</h5>
			</Column>
			<Column style="outline: 1px solid var(--cds-interactive-04)">
				<PercentInput bind:value={admin_percent}/>
			</Column>
			<Column style="outline: 1px solid var(--cds-interactive-04)">
				<Button disabled={isDisabled} on:click={update_admin_percent} >Actualizar porcentaje</Button>
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
	</Grid>
    {#if paymentSummary}
        <p>Abonado: {paymentSummary.paid_amount} {paymentSummary.currency_code} · Pendiente: {paymentSummary.remaining_amount} {paymentSummary.currency_code}</p>
        {#if allows($session,['odts.payments'])}<p><a href={'/abonos_odt?odt=' + odt.id_odt}>Registrar abonos de esta ODT</a></p>{/if}
        <Odt_payment_history summary={paymentSummary} />
    {/if}
    {#if paymentError}<p role="alert">{paymentError}</p>{/if}

	{#if rows_balance_movements.length!=0 || rows_currencies.length!=0}
		<DataTable size="short" title="Gastos por moneda" sortable headers={headers_currencies} rows={rows_currencies} />
		
		<DataTable size="short" title="Gastos de la ODT" sortable headers={headers_balance_movements} rows={rows_balance_movements} />
	{/if}
{/if}