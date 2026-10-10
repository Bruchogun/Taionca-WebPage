<script>
    import 'carbon-components-svelte/css/white.css';
    import { DataTable, Button, ButtonSet } from "carbon-components-svelte";
	import { apiFetch } from '../functions';
	import { onMount } from 'svelte';

	let awaiting_approval_responsibilitys = [];
	let id = 0;
	async function get_responsibilitys(){
		({awaiting_approval_responsibilitys} = await apiFetch('/api/public/all_awaiting_approval_responsibilitys'));
	}

	onMount(async ()=>{
		get_responsibilitys();
	})
    const headers=[
        { key: 'responsable', value: 'Responsable' },
        { key: 'name', value: 'Nombre' },
        { key: 'description', value: 'Descripción' },
        { key: 'evidence', value: 'Evidencia' },
        { key: 'date', value: 'Fecha de entrega' }
    ]

	let rows=[];
	$: if (awaiting_approval_responsibilitys){
		id = 0;
		rows = awaiting_approval_responsibilitys.map(responsibility => ({
			
			id: id++,
			responsable: `${responsibility.responsable_name} ${responsibility.responsable_last_name}`,
			name: responsibility.name,
			description: responsibility.description,
			evidence: responsibility.evidence,
			date: new Date(responsibility.created_at).toLocaleString()
		}));
	}

	let selectedRowIds;

	async function approve_responsibility(){
		await apiFetch("/api/public/new_approved_responsibility",{
			method: 'POST',
			body: JSON.stringify({
				id_recurrent_responsibility: awaiting_approval_responsibilitys[selectedRowIds[0]].id_recurrent_responsibility,
				id_user_who_made: awaiting_approval_responsibilitys[selectedRowIds[0]].id_user, 
				description_evidence: awaiting_approval_responsibilitys[selectedRowIds[0]].evidence, 
				id_pending_responsibility: awaiting_approval_responsibilitys[selectedRowIds[0]].id_pending_responsibility, 
				id_awaiting_approval_responsibility: awaiting_approval_responsibilitys[selectedRowIds[0]].id_awaiting_approval_responsibility,
				created_at: awaiting_approval_responsibilitys[selectedRowIds[0]].created_at
			}),
			headers: {'Content-Type': 'application/json'}
		})
		get_responsibilitys();
	}

	async function reject_responsibility(){
		
		await apiFetch("/api/public/rejected_responsibility",{
			method: 'POST',
			body: JSON.stringify({
				id_awaiting_approval_responsibility: awaiting_approval_responsibilitys[selectedRowIds[0]].id_awaiting_approval_responsibility
			}),
			headers: {'Content-Type': 'application/json'}
		})
		get_responsibilitys();
	}
    
</script>
        
<DataTable title="Responsabilidades" description="Seleccione la responsabilidad completada" sortable radio bind:selectedRowIds {headers} {rows} />

<ButtonSet>
	<Button disabled={!selectedRowIds || !selectedRowIds.length} on:click={reject_responsibility} kind="danger">Rechazar</Button>
	<Button disabled={!selectedRowIds || !selectedRowIds.length} on:click={approve_responsibility}>Aprobar</Button>
</ButtonSet>
