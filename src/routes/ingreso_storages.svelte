<script>
	import { TextInput, Button, TextArea } from "carbon-components-svelte";
	import { apiFetch } from '../functions';
    
	let description;
	let name;
	let location;

	async function add_item(){
		await apiFetch("/api/public/new_storage",{
			method: 'POST',
			body: JSON.stringify({
				name,
				location,
				description
			}),
			headers: {'Content-Type': 'application/json'}
		})
		cleanWindows()
	}

	function cleanWindows(){
		description=""
		location=""
		name=null
	}
</script>

<TextInput type="Text" labelText="Almacén" placeholder="Ingrese el nombre..." bind:value={name}/>

<TextArea labelText="Descripción" placeholder="Ingrese la descripción del artículo..." bind:value={description}/>

<TextArea labelText="Localización" placeholder="Ingrese el lugar del almacén..." bind:value={location}/>

<Button on:click={add_item}>Enviar</Button>