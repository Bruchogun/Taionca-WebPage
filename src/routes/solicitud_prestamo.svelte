<script>
	import 'carbon-components-svelte/css/white.css';
	import Currency from "../components/Currency.svelte";
    import { TextInput, TextArea, Button } from "carbon-components-svelte";
    
    let amount;
    let description;
    let selectedCurrency;

</script>
<p role="status">La solicitud de préstamo todavía no está implementada. Esta pantalla no registra solicitudes.</p>


    <TextInput type="number" placeholder="Ingrese el monto..." bind:value={amount}/>
    <Currency bind:selectedCurrency/>
    <TextArea labelText="Descripción" placeholder="Explique por que necesita el prestamo..." bind:value={description}/>
    <Button disabled>Enviar solicitud</Button>