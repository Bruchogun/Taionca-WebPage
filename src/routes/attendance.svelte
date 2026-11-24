<script>
	import { allows } from '../security/access';
    import { Button, ContentSwitcher, DataTable, Switch, TextInput, Toolbar, ToolbarContent, ToolbarSearch } from "carbon-components-svelte";
	import { apiFetch } from '../functions';
    import { onMount, tick } from 'svelte';
    import { session } from '../stores';
    
	let entry_time = '';
	let departure_time = '';
	let selectedIndex = 0;
    let attendances;
    let user_id;
	let value = "";
	let filteredRows;
	let options = {  year: 'numeric', month: 'numeric', day: 'numeric',hour: '2-digit', minute:'2-digit'}

	onMount(async ()=>{
		({attendances, user_id} = await apiFetch('/api/public/get_attendance'));
		await tick();
		await set_chart_data();
		await tick();
		filter_rows();
	})
	
	function set_date(time){
		const year = new Date().getFullYear();
		const month = new Date().getMonth();
		const day = new Date().getDate();
		if(time){
			let hours = Number(time[0] + time[1]);
			let minutes = Number(time[3] + time[4]);
			return new Date(year, month, day, hours, minutes)
		}else{
			return null;
		}

	}
	
	async function send_attendance(){
		
		await apiFetch("/api/public/attendance",{
			method: 'POST',
			body: JSON.stringify({ 
				entry_date: set_date(entry_time), //Hora de llegada
				departure_date: set_date(departure_time) //Hora de salida
			}),
			headers: {'Content-Type': 'application/json'}
		});

		({attendances, user_id} = await apiFetch('/api/public/get_attendance'));
		await set_chart_data();
		filter_rows();
		cleanWindows();
	}

	function cleanWindows(){
		entry_time = '';
		departure_time = '';
	}

	//Asistance viewer

	let headers = [
			{ key: 'user', value: 'Usuario' }, 
			{ key: 'entry_date', value: 'Llegada' },
			{ key: 'departure_date', value: 'Salida' },
			{ key: 'created_at', value: 'Hora de registro' }
    ]

	let rows= [];
	async function set_chart_data(){
		let attendance_filtered;
		if(allows($session,['attendance.read_all'])){
			headers = [
				{ key: 'user', value: 'Usuario' }, 
				{ key: 'entry_date', value: 'Llegada' },
				{ key: 'departure_date', value: 'Salida' },
				{ key: 'created_at', value: 'Hora de registro' }
			];
			attendance_filtered = attendances;
		}else{
			headers = [
				{ key: 'entry_date', value: 'Llegada' },
				{ key: 'departure_date', value: 'Salida' },
				{ key: 'created_at', value: 'Hora de registro' }
			];
			attendance_filtered = attendances.filter(({id_user}) => id_user === user_id);
		}
		rows = Array.from(attendance_filtered).map(( attendance ) => ({
					id: attendance.id_attendance,
					user: attendance.name,
					entry_date: new Date(attendance.entry_date).toLocaleString([], options),
					departure_date: attendance.departure_date ? new Date(attendance.departure_date).toLocaleString([], options) : 'Pendiente',
					created_at: new Date(attendance.created_at).toLocaleString([], options),
		}));
	}
	
	function filter_rows(event){
		if(event){
			filteredRows = rows.filter((row) => {
				value = event.target.value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, "");
				if (value.trim().length === 0) return row;
				return (
					row.id.toString().includes(value) || 
					row.user.toLowerCase().toString().normalize('NFD').replace(/\p{Diacritic}/gu, "").includes(value) || 
					row.entry_date.toLowerCase().toString().includes(value) || 
					row.departure_date.toLowerCase().toString().includes(value) || 
					row.created_at.toLowerCase().toString().includes(value));
			});
		}else{
			filteredRows = rows.filter((row) => {
				value = value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, "");
				if (value.trim().length === 0) return row;
				return (
					row.id.toString().includes(value) || 
					row.user.toLowerCase().toString().normalize('NFD').replace(/\p{Diacritic}/gu, "").includes(value) || 
					row.entry_date.toLowerCase().toString().includes(value) || 
					row.departure_date.toLowerCase().toString().includes(value) || 
					row.created_at.toLowerCase().toString().includes(value));
			});
		}
	}

</script>

<div class="attendance-form">
	<ContentSwitcher aria-label="Tipo de registro de asistencia" on:change={cleanWindows} bind:selectedIndex>
		<Switch text="Llegada"/>
		<Switch text="Salida"/>
		<Switch text="Ambos"/>
	</ContentSwitcher>
	<form on:submit|preventDefault={send_attendance}>
		<div class="attendance-times">
			{#if selectedIndex === 0 || selectedIndex === 2}
				<TextInput id="entry_time" type="time" labelText="Hora de llegada" bind:value={entry_time} />
			{/if}
			{#if selectedIndex === 1 || selectedIndex === 2}
				<TextInput id="departure_time" type="time" labelText="Hora de salida" bind:value={departure_time} />
			{/if}
		</div>
		<Button type="submit">Enviar</Button>
	</form>
</div>

<DataTable stickyHeader size="compact" title="Registro de asistencia" sortable {headers} rows={filteredRows}>
	<Toolbar>
		<ToolbarContent>
			<ToolbarSearch
				persistent
				bind:value
				on:input={filter_rows}
			/>
		</ToolbarContent>
	</Toolbar>
</DataTable>

<style>
	.attendance-form {
		max-width: 34rem;
		margin-bottom: 1.5rem;
	}

	.attendance-times {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
		gap: 1rem;
		margin: 1rem 0;
	}
</style>
