<script>
	import { onMount } from 'svelte';
    import { DataTable, DatePickerInput } from "carbon-components-svelte";
	import Entitys from "../components/Entitys.svelte";
	import { apiFetch, notify } from '../functions';
	import { compareMoney, displayMoney } from '../lib/money';
	
	// Movements
	
	let balance_movements = [];
	let movements_filtered = [];
	let rows_movements = [];
    let DatePicker;
	let date1;
	let date2;

	onMount(async ()=>{
		({balance_movements} = await apiFetch ('/api/public/balance_movements'));
        if (!DatePicker) DatePicker = (await import('carbon-components-svelte/src/DatePicker/DatePicker.svelte')).default;
	})

    //HEADERS
	let headers_movements = [
	{ key: "entity", value: "Entidad"  },
	{ key: "odt", value: "ODT"  },
    { key: "account", value: "Cuenta" },
    { key: "amount", value: "Monto", sort: compareMoney },
    { key: "created_at", value: "Fecha" },
	];
	
	const _1D_in_ms = 1000*60*60*24;
	//ROWS
	$: if (balance_movements != undefined && balance_movements.length>0){
		let date_inicial=new Date(date1);
		let date_final=new Date( Date.parse(date2) + _1D_in_ms);
		movements_filtered = balance_movements.filter(({created_at}) => {
			return date_inicial<=(new Date(created_at)) && (new Date(created_at))<=date_final
		});
		rows_movements = movements_filtered.map(movement => ({
			id_balance: movement.id_balance,
			id: movement.id_balance_movement,
			entity: movement.entity,
			odt: movement.id_odt,
			account: `${movement.account} ${movement.currency}`,
			amount: movement.amount,
			currency: movement.currency,
			created_at: (new Date(movement.created_at)).toLocaleDateString()
		}));
	}
	
// Balances_PAST
	
	let entity;
	let balances = [];
	let rows_balances = [];
	onMount(async ()=>{
		({balances} = await apiFetch('/api/public/balances'));
	})

    //HEADERS
	let headers_balances = [
		{ key: "name", value: "Cuentas"  },
		{ key: "balance_inicial", value: "Saldo inicial", sort: compareMoney },
		{ key: "balance_final", value: "Saldo final", sort: compareMoney }
	];
	
	
	//ROWS
	let balances_filtered = [];
	$: if (entity && balances.length>0) balances_filtered = balances.filter(({id_entity}) => id_entity === entity.value);
	$: if (entity && balances.length>0 && movements_filtered.length>0){
		rows_balances = balances_filtered.map(balance => {
			const currencyCode = balance.code || balance.symbol;
			const movements_filtered_by_entity_and_account = movements_filtered.filter( movement => (balance.id_balance === movement.id_balance) )

			let balance_inicial = Number(balance.balance);
			let balance_final = Number(balance.balance);
			if (movements_filtered_by_entity_and_account.length > 0) {
				balance_inicial = Number(movements_filtered_by_entity_and_account[0].end_balance) - Number(movements_filtered_by_entity_and_account[0].amount);
				balance_final = Number(movements_filtered_by_entity_and_account[movements_filtered_by_entity_and_account.length-1].end_balance);
			}

			// Validate balance
			let validate_balance_final = balance_inicial;
			movements_filtered_by_entity_and_account.forEach( movement => {
					validate_balance_final += Number(movement.amount);
			});
			const error_margin= (balance_final === validate_balance_final || (validate_balance_final===0 && balance_final<0.0000000001) )
									? 1
									: balance_final/validate_balance_final;
			if (!(0.9999999999<=error_margin && error_margin<=1.0000000001)) {
				console.error({validate_balance_final, balance_final});
				notify("Error", "error", `Balance final no concuerda. Esto no debe pasar, avisar inmediatamente a maurito. ${displayMoney(validate_balance_final, currencyCode)} - ${displayMoney(balance_final, currencyCode)}`);
				return;
			}

			return {
				amount: balance.balance,
				id: balance.id_balance,
				balance_inicial,
				balance_final,
				name: `(${balance.symbol}) ${balance.name}`,
				currency: balance.name_plural.replace(/(^|\s)\S/g, l => l.toUpperCase()),
				symbol: balance.symbol,
				currencyCode
			}
		});
	}

	
    //HEADERS
	let headers_currencies = [
		{ key: "currency", value: "Moneda"  },
		{ key: "balance_inicial", value: "Saldo inicial", sort: compareMoney },
		{ key: "balance_final", value: "Saldo final", sort: compareMoney }
	];

	let rows_currencies = [];
	$: if (entity && rows_balances.length>0){
		const currencies_auxiliar = {};
		rows_balances.forEach(balance => {
			if (currencies_auxiliar[balance.currency] === undefined) {
				return currencies_auxiliar[balance.currency] = {...balance};
			}
			currencies_auxiliar[balance.currency].balance_final += balance.balance_final;
			currencies_auxiliar[balance.currency].balance_inicial += balance.balance_inicial;
		});
		rows_currencies = Object.entries(currencies_auxiliar).map(([key, balance]) => balance)
	}
</script>

<style>
	.OnSameLine{
		display: flex;
		justify-content: space-around;
	}

	.OnSameLine > :global(*){
		width: 100%;
	}
</style>

<div class="OnSameLine">
{#if DatePicker}
	<svelte:component this={DatePicker} bind:value={date1} datePickerType="single" locale={navigator.language}>
		<DatePickerInput placeholder="Fecha inicial" />
	</svelte:component>
	<svelte:component this={DatePicker} bind:value={date2} datePickerType="single" locale={navigator.language}>
		<DatePickerInput placeholder="Fecha final" />
	</svelte:component>
{/if}	
</div>

<DataTable size="short" title="Movimientos" sortable headers={headers_movements} rows={rows_movements}>
	<span slot="cell" let:cell let:row>
		{#if cell.key === 'amount'}{displayMoney(cell.value, row.currency)}{:else}{cell.value}{/if}
	</span>
</DataTable>

<Entitys bind:entity={entity}/>

<div class="OnSameLine">
	{#if rows_balances.length!=0}
		<DataTable size="short" title="Balance" sortable headers={headers_balances} rows={rows_balances}>
			<span slot="cell" let:cell let:row>
				{#if cell.key === 'name'}{cell.value}{:else}{displayMoney(cell.value, row.currencyCode)} {row.symbol}{/if}
			</span>
		</DataTable>
	{/if}
</div>

<DataTable size="short" title="Balance de monedas" sortable headers={headers_currencies} rows={rows_currencies}>
	<span slot="cell" let:cell let:row>
		{#if cell.key === 'currency'}{cell.value}{:else}{displayMoney(cell.value, row.currencyCode)} {row.symbol}{/if}
	</span>
</DataTable>
