<script>
	import OpenOdts from '../components/Open_odts.svelte';
	import ClosedOdts from '../components/Closed_odts_review.svelte';
    import { ContentSwitcher, Switch } from 'carbon-components-svelte';

	let selectedIndex = 0;
</script>

<ContentSwitcher bind:selectedIndex >
	<Switch text="ODTs abiertas" />
	<Switch text="ODTs cerradas" />
</ContentSwitcher>

{#if selectedIndex === 0}
	<OpenOdts/>
{:else}
	<ClosedOdts/>
{/if}