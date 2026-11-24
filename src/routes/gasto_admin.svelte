<script>
	import {FormGroup, RadioButtonGroup, RadioButton} from "carbon-components-svelte";
	import Gasto_admin_otros from '../components/Gasto_admin_otros.svelte'
	import Gasto_admin_recurrentes from '../components/Gasto_admin_recurrentes.svelte'
	import Gasto_admin_inventariado from '../components/Gasto_admin_inventariado.svelte'

	let opts;

</script>

<!-- <FormGroup legendText="Tipo de gasto">
	<RadioButtonGroup bind:selected={opts}>
		<RadioButton labelText="Inventariado" value="1" />
		<RadioButton labelText="Recurrentes" value="2" />
		<RadioButton labelText="Otros" value="3" />
	</RadioButtonGroup>
</FormGroup>

{#if opts==="1"}

	<Gasto_admin_inventariado/>

{:else if opts==="2"}

	<Gasto_admin_recurrentes/>

{:else if opts==="3"} -->

	<Gasto_admin_otros/>
	
<!-- {/if} -->