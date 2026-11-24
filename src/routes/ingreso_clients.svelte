<script>
	import { TextInput, Button, TextArea } from "carbon-components-svelte";
	import { apiFetch } from '../functions';
    
	let name;
	let phone_number1;
	let phone_number2;
	let email;
	let address;
	let description;
	let legal_id;

	async function add_client(){
		await apiFetch("/api/public/new_client",{
			method: 'POST',
			body: JSON.stringify({
				name,
				phone_number1,
				phone_number2,
				email,
				address,
				description,
				legal_id
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
		legal_id=null
	}
</script>

<TextInput type="Text" labelText="Cliente" placeholder="Ingrese el nombre..." bind:value={name}/>

<TextInput type="Text" labelText="Identificación legal" placeholder="Ingrese la cédula o el RIF..." bind:value={legal_id}/>

<TextInput type="Text" labelText="Teléfono de contacto 1" placeholder="Ingrese el número..." bind:value={phone_number1}/>

<TextInput type="Text" labelText="Teléfono de contacto 2" placeholder="Ingrese el número..." bind:value={phone_number2}/>

<TextInput type="email" labelText="Dirección de correo electrónico" placeholder="Ingrese el email..." bind:value={email}/>

<TextInput type="address" labelText="Dirección" placeholder="Ingrese la dirección..." bind:value={address}/>

<TextArea labelText="Descripción" placeholder="Ingrese la descripción del cliente..." bind:value={description}/>

<Button on:click={add_client}>Enviar</Button>