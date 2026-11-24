<script>
	import { Button, TextInput, TextArea } from "carbon-components-svelte";
	import All_inv_items from '../components/All_inv_items.svelte';
	import Odts from "../components/Odts.svelte";
	import { apiFetch } from '../functions';

	let amount;
	let item;
	let description;
	let odt;
	let api;
	
	async function create_expense(api){
		await apiFetch(`${api}`,{
			method: 'POST',
			body: JSON.stringify({
				id_spendable_stock: item.id,
				amount,
				id_odt: odt.value,
				description,
				currency_code: odt.code
			}),headers: {'Content-Type': 'application/json'}
		});
		cleanWindows()
	}

	function cleanWindows(){
		item=null
		amount=null
		odt=null
		description=""
	}

	function apiType(){
		if (item.category==="consumibles"){
			api="/api/public/spendable_inv_odt_expenses"
		}else{
			api="/api/public/no_spendable_inv_odt_expenses"
		}
		create_expense(api)
	}

</script>

<All_inv_items bind:item={item}/>

<TextInput type="Number" labelText="Cantidad gastada" placeholder="Ingrese la cantidad gastada..." bind:value={amount}/>

<Odts bind:odt={odt}/>

<TextArea labelText="Descripción" placeholder="Ingrese la descripción del gasto..." bind:value={description}/>

<Button on:click={apiType}>Enviar</Button>