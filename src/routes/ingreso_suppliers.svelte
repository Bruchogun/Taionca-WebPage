<script>
	import { TextInput, Button, TextArea } from "carbon-components-svelte";
	import { apiFetch } from '../functions';
    
	let name;
	let phone_number1;
	let phone_number2;
	let email;
	let address;
	let description;

	async function add_supplier(){
		await apiFetch("/api/public/new_supplier",{
			method: 'POST',
			body: JSON.stringify({
				name,
				phone_number1,
				phone_number2,
				email,
				address,
				description
			}),
			headers: {'Content-Type': 'application/json'}
		})
		cleanWindows()
	}

	function cleanWindows(){
		name=null
		phone_number1=null
		phone_number2=null
		email=null
		address=null
		description=""
	}
</script>

<TextInput type="Text" labelText="Proveedor" placeholder="Ingrese el nombre..." bind:value={name}/>

<TextInput type="Text" labelText="Teléfono de contacto 1" placeholder="Ingrese el número..." bind:value={phone_number1}/>

<TextInput type="Text" labelText="Teléfono de contacto 2" placeholder="Ingrese el número..." bind:value={phone_number2}/>

<TextInput type="email" labelText="Dirección de correo electrónico" placeholder="Ingrese el email..." bind:value={email}/>

<TextInput type="address" labelText="Dirección" placeholder="Ingrese la dirección..." bind:value={address}/>

<TextArea labelText="Descripción" placeholder="Ingrese la descripción del proveedor..." bind:value={description}/>

<Button on:click={add_supplier}>Enviar</Button>