<script>
	import { Button, TextArea, TextInput } from "carbon-components-svelte";
	import 'carbon-components-svelte/css/white.css';
	import Accounts from "../components/Accounts.svelte";
	import Entitys from "../components/Entitys.svelte";

	let account;
	let currency;
	let amount;
	let description;
	let entity;

	function create_request_exchange_currency(){
		alert("It works");
	}

</script>
<p role="status">La solicitud de cambio de moneda todavía no está implementada. Esta pantalla no registra solicitudes.</p>


<TextInput type="number" labelText="Monto necesitado" placeholder="Ingrese el monto..." bind:value={amount}/>

<Accounts orientation="vertical" bind:account={account} bind:currency={currency}/>

<Entitys orientation="vertical" bind:entity={entity}/>

<TextArea labelText="Descripción" placeholder="Ingrese la descripción del cambio de moneda..." bind:value={description}/>

<Button disabled>Enviar</Button>