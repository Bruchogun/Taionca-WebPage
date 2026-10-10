<script>
	import { Button, TextArea, Tile, TextInput } from "carbon-components-svelte";
	import 'carbon-components-svelte/css/white.css';
	import Accounts from "../components/Accounts.svelte";
	import Entitys from "../components/Entitys.svelte";
	import { apiFetch } from "../functions";

	let account_expense;
	let account_income;
	let currency_expense;
	let currency_income;
	let exchange_rate;
	let amount_expense;
	let amount_income;
	let description;
	let id_entity;

	$: {
		exchange_rate= (amount_expense/amount_income) || ""
		if(exchange_rate<=1){
			exchange_rate=1/exchange_rate;
		}
	}

	async function create_exchange_currency(){

		await apiFetch("/api/public/exchange_currency",{
			method: 'POST',
			body: JSON.stringify({
				description,
				expense: {
					id_account: account_expense.id_account,
					id_currency: account_expense.id_currency,
					amount: amount_expense,
					description
				},
				income: {
					id_account: account_income.id_account,
					id_currency: account_income.id_currency,
					amount: amount_income,
					description
				},
				id_entity: id_entity.value
			}),
			headers: {'Content-Type': 'application/json'}
		})

		cleanWindows()
	}

	function cleanWindows(){
		amount_expense=null
		account_expense=null
		currency_expense=null
		amount_income=null
		account_income=null
		currency_income=null
		description=""
		id_entity=null
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

	.icons{
		font-size: 2rem;
		line-height: 2.5;
		width: 1em;
	}
</style>

<div class="OnSameLine">
<TextInput type="number" labelText="Monto a cambiar" placeholder="Ingrese el monto a cambiar..." bind:value={amount_expense} />
<h3 class="icons">➤</h3>
<TextInput type="number" labelText="Monto a cambiado" placeholder="Ingrese el monto cambiado..." bind:value={amount_income} />
</div>

<div class="OnSameLine">
	<div>
		<Accounts orientation="vertical" bind:account={account_expense} bind:currency={currency_expense}/>
	</div>
	<div>
		<Accounts orientation="vertical" bind:account={account_income} bind:currency={currency_income}/>
	</div>
</div>

<Tile>Tasa: {exchange_rate}</Tile>

<Entitys bind:entity={id_entity}/>

<TextArea labelText="Descripción" placeholder="Ingrese la descripción del cambio de moneda..." bind:value={description}/>

<Button on:click={create_exchange_currency}>Enviar</Button>