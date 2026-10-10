<script>
    import { apiFetch } from '../functions';
    import { Button } from 'carbon-components-svelte';
    let saving=false,done=false;
    async function update(){
        saving=true;done=false;
        try{
            const {pending_responsibilitys}=await apiFetch('/api/public/last_pending_responsibilitys');
            for(const responsibility of pending_responsibilitys.filter(r=>new Date(r.deadline)<=new Date())) await apiFetch('/api/public/update_responsibility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({responsibility})});
            done=true;
        }finally{saving=false;}
    }
</script>
<h1>Actualizar entregas de responsabilidades</h1>
<p>Genera la siguiente entrega de las responsabilidades vencidas que todavía tienen repeticiones pendientes.</p>
<Button disabled={saving} on:click={update}>Actualizar responsabilidades vencidas</Button>
{#if done}<p role="status">Responsabilidades actualizadas.</p>{/if}
