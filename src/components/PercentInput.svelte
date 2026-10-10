<script>
    import { TextInput } from 'carbon-components-svelte';
    export let value;
    export let label = 'Porcentaje de comisión';
    let input = '';
    let previous;
    $: if (value !== previous) {
        previous = value;
        input = value === null || value === undefined || value === '' ? '' : String(Number((Number(value) * 100).toFixed(3)));
    }
    function update(event) {
        input = event.target.value;
        const number = Number(input);
        value = input.trim() === '' || !Number.isFinite(number) ? null : Number((number / 100).toFixed(5));
        previous = value;
    }
</script>

<TextInput type="number" inline labelText={`${label} (%)`} placeholder="Porcentaje de comisión" min="0" max="100" step="0.001" value={input} on:input={update} />
