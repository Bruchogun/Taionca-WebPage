<script>
	import { TextInput, Button } from "carbon-components-svelte";
	import { apiFetch } from '../functions';
	import Currency from '../components/Currency.svelte';
    
	let name;
	let currency;

	async function add_account(){
		await apiFetch("/api/public/create_account",{
			method: 'POST',
			body: JSON.stringify({
				name,
				id_currency: currency.id_currency
			}),
			headers: {'Content-Type': 'application/json'}
		})
		cleanWindows()
	}

	function cleanWindows(){
		name=null;
	}
</script>

<Currency bind:currency={currency}/>

<TextInput type="Text" labelText="Cuenta" placeholder="Ingrese el nombre..." bind:value={name}/>

<Button on:click={add_account}>Enviar</Button>