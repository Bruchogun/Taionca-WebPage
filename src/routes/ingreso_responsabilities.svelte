<script>
	import { TextInput, Button, TextArea, NumberInput } from "carbon-components-svelte";
	import { apiFetch } from '../functions';
	import TimeFrequency from '../components/Time_frequency.svelte';
    
	let name;
	let description;
	let importance;
    let time_frequency;
    let days;

	async function add_recurrent_responsibility(){
        if (days === 0){
            days = null;
        }
		await apiFetch("/api/public/new_recurrent_responsibility",{
			method: 'POST',
			body: JSON.stringify({
				name,
				description,
				importance,
				time_frequency,
				days,
			}),
			headers: {'Content-Type': 'application/json'}
		})
		cleanWindows()
	}

	function cleanWindows(){
		name=null;
		description="";
		time_frequency=null;
		days = null;
	}

</script>

<TextInput type="Text" labelText="Nombre" placeholder="Ingrese el nombre de la responsabilidad..." bind:value={name}/>

<NumberInput allowEmpty={true} label="Importancia" invalid = { importance < 0 || importance > 100} invalidText = "Número fuera de rango" placeholder="Ingrese un número de 0 a 100" bind:value={importance}/>

<TimeFrequency bind:time_frequency={time_frequency} />

{#if time_frequency && time_frequency.value === 'every x days'}

    <NumberInput allowEmpty label="Ingrese la cantidad de días" invalid = { days <= 1 } invalidText = "Número fuera de rango" placeholder="Ingrese la cantidad de días" bind:value={days}/>

{/if}

<TextArea labelText="Descripción" placeholder="Ingrese la descripción de la responsabilidad..." bind:value={description}/>

<Button on:click={add_recurrent_responsibility}>Enviar</Button>