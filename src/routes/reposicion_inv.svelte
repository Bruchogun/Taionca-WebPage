<script>
	import Accounts from "../components/Accounts.svelte";
	import { TextInput, Button} from "carbon-components-svelte";
	import AllInvItems from '../components/All_inv_items.svelte';
	import { apiFetch } from '../functions';

	let item;
    let account;
    let quantity;
    let cost;
	let api;

	async function send_register(api){
		await apiFetch(`${api}`,{
			method: 'POST',
			body: JSON.stringify({
				id_spendable_stock: item.id,
				id_account: account.id_account,
				quantity,
				cost,
				id_item: item.id_item
			}),headers: {'Content-Type': 'application/json'}
		});
		cleanWindows()
	}

	function cleanWindows(){
		item=null
		account=null
		quantity=null
		cost=null
	}

	function apiType(){
		if (item.category==="consumibles"){
			api="/api/public/spendable_inv_odt_incomes"
			send_register(api)
		}else{
			api="/api/public/no_spendable_inv_odt_incomes"
			send_register(api)
		}
	}
	$:console.log(item)
</script>

<AllInvItems bind:item={item}/>

<TextInput type="Number" labelText="Cantidad repuesta" placeholder="Ingrese la cantidad repuesta..." bind:value={quantity}/>

<Accounts orientation="vertical" bind:account={account}/>

<TextInput type="Number" labelText="Monto total gastado" placeholder="Ingrese el monto total gastado..." bind:value={cost}/>

<Button on:click={apiType}>Enviar</Button>