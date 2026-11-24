<script>
	import Odts from '../components/Odts.svelte';
	import { TextInput, Button, TextArea } from "carbon-components-svelte";
	import Accounts from "../components/Accounts.svelte";
	import { apiFetch } from '../functions';
	import Measures from '../components/Measures.svelte';

	let account;
	let odt;
	let description;
	let amount;
	let measure;
	let quantity;

	async function create_expense(){
		await apiFetch("/api/public/general_expenses",{
			method: 'POST',
			body: JSON.stringify({
				id_account: account.id_account,
				id_odt: odt.value,
				odt_currency_code: odt.code,
				expense_currency_code: account.code,
				amount,
				description,
				id_measure: measure.value,
				quantity
			}),
			headers: {'Content-Type': 'application/json'}
		})
		cleanWindows()
	}

	function cleanWindows(){
		amount=null;
		account=null;
		odt=null;
		description="";
		quantity=null;
		measure=null;
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

<TextInput type="Number" labelText="Monto total gastado" placeholder="Ingrese el monto total del gasto..." bind:value={amount}/>

<Accounts orientation="vertical" bind:account={account}/>

<div class="OnSameLine">
	<TextInput type="Number" placeholder="Ingrese la cantidad..." bind:value={quantity}/>
	<Measures bind:measure={measure} />
</div>

<Odts bind:odt={odt}/>

<TextArea labelText="Descripción" placeholder="Ingrese la descripción del gasto..." bind:value={description}/>

<Button on:click={create_expense}>Enviar</Button>