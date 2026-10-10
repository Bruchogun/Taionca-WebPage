<script>
    import { onMount } from 'svelte';
    import { goto } from '@sapper/app';
    import { session } from '../stores';
    let data={users:[],roles:[],permissions:[],events:[],capabilities:[]};
    let tab='Usuarios',busy=false,error='',message='',userId=0,userRoles=[];
    let permissionId=0,permissionName='',description='',capabilities=[],permissionSearch='';
    let roleId=0,roleName='',rolePermissions=[],roleSearch='';
    async function request(path,method='GET',body) {
        const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
        const result=await response.json();
        if(!response.ok) throw Error(result.error||'No se pudo completar la operación.');
        return result;
    }
    async function load(){data=await request('/api/admin/security');}
    onMount(async()=>{busy=true;try{await load();}catch(e){error=e.message;}finally{busy=false;}});
    function loadUser(){userRoles=[...(data.users.find(u=>u.user_id===Number(userId))?.role_ids||[])];}
    function newPermission(){permissionId=0;permissionName='';description='';capabilities=[];}
    function loadPermission(){const p=data.permissions.find(p=>p.permission_id===Number(permissionId));permissionName=p?.name||'';description=p?.description||'';capabilities=[...(p?.capabilities||[])];}
    function newRole(){roleId=0;roleName='';rolePermissions=[];}
    function loadRole(){const r=data.roles.find(r=>r.role_id===Number(roleId));roleName=r?.name||'';rolePermissions=[...(r?.permission_ids||[])];}
    async function perform(fn){
        if(busy)return;busy=true;error='';message='';
        try{const result=await fn();message=result.success;await load();}
        catch(e){error=e.message;}
        finally{busy=false;}
    }
    async function saveUser(){await perform(async()=>{
        const result=await request('/api/admin/users/'+userId+'/roles','PUT',{role_ids:userRoles});
        const profile=await request('/api/user');$session=profile.session;
        if(!profile.session.is_admin) await goto('/attendance');
        return result;
    });}
    async function savePermission(){await perform(async()=>{
        const result=await request('/api/admin/permissions'+(permissionId?'/'+permissionId:''),permissionId?'PATCH':'POST',{name:permissionName,description,capabilities});
        permissionId=result.data.permission_id;return result;
    });}
    async function removePermission(){
        if(!confirm('¿Eliminar este permiso y retirarlo de todos sus roles?'))return;
        await perform(async()=>{const result=await request('/api/admin/permissions/'+permissionId,'DELETE');newPermission();return result;});
    }
    async function saveRole(){await perform(async()=>{
        const result=await request('/api/admin/roles'+(roleId?'/'+roleId:''),roleId?'PATCH':'POST',{name:roleName,permission_ids:rolePermissions});
        if(result.data)roleId=result.data.role_id;return result;
    });}
    async function removeRole(){
        if(!confirm('¿Eliminar este rol y retirarlo de todos sus usuarios?'))return;
        await perform(async()=>{const result=await request('/api/admin/roles/'+roleId,'DELETE');newRole();return result;});
    }
    $: groups=[...new Set(data.capabilities.map(c=>c.group))];
    $: selectedRoles=data.roles.filter(r=>userRoles.includes(r.role_id));
    $: effective=userRoles.includes(1)?data.capabilities:[...new Set(selectedRoles.flatMap(r=>r.permission_ids).flatMap(id=>data.permissions.find(p=>p.permission_id===id)?.capabilities||[]))].map(key=>data.capabilities.find(c=>c.key===key)).filter(Boolean);
</script>
<svelte:head><title>Administración de permisos · Taionca</title></svelte:head>
<section class="security">
    <header><p class="eyebrow">ADMINISTRACIÓN</p><h1>Permisos y roles</h1><p>Define qué puede hacer cada rol y asígnalo a las personas que lo necesitan. Los cambios se aplican a las sesiones abiertas.</p></header>
    <nav aria-label="Secciones de permisos">{#each ['Usuarios','Permisos','Roles','Historial'] as section}<button class:active={tab===section} aria-pressed={tab===section} on:click={()=>{tab=section;error='';message='';}}>{section}</button>{/each}</nav>
    {#if error}<div class="notice error" role="alert">{error}</div>{/if}
    {#if message}<div class="notice" role="status">{message}</div>{/if}
    {#if busy}<p role="status">Procesando…</p>{/if}
    {#if tab==='Usuarios'}
        <div class="columns"><section class="card">
            <h2>Roles de un usuario</h2>
            <label for="security-user">Usuario</label><select id="security-user" bind:value={userId} on:change={loadUser} disabled={busy}><option value={0}>Selecciona una persona</option>{#each data.users as user}<option value={user.user_id}>{user.name} {user.lastname||''} · {user.username}</option>{/each}</select>
            <fieldset disabled={busy || !userId}><legend>Roles asignados</legend>{#each data.roles as role}<label class="check"><input type="checkbox" bind:group={userRoles} value={role.role_id}/><span>{role.name}{#if role.role_id===1}<small>Administrador: acceso completo y gestión de permisos.</small>{/if}</span></label>{/each}</fieldset>
            <button class="primary" disabled={busy || !userId} on:click={saveUser}>Guardar roles del usuario</button>
        </section><section class="card"><h2>Accesos resultantes</h2><p>La persona recibe los accesos de todos sus roles. Para retirar un acceso, quita o modifica los roles que lo conceden.</p>
            {#if effective.length}<ul>{#each effective as cap}<li>{cap.label}</li>{/each}</ul>{:else}<p>Sin operaciones adicionales. Puede gestionar su propia asistencia, responsabilidades, contraseña y deudas.</p>{/if}
        </section></div>
    {:else if tab==='Permisos'}
        <div class="columns"><section class="card"><h2>Crear o editar permiso</h2>
            <label for="permission-search">Buscar permisos</label><input id="permission-search" type="search" bind:value={permissionSearch}/>
            <label for="permission-select">Permiso</label><select id="permission-select" bind:value={permissionId} on:change={loadPermission} disabled={busy}><option value={0}>Nuevo permiso</option>{#each data.permissions.filter(p=>p.name.toLowerCase().includes(permissionSearch.toLowerCase())) as permission}<option value={permission.permission_id}>{permission.name}</option>{/each}</select>
            <button disabled={busy} on:click={newPermission}>Nuevo permiso</button>
            <label for="permission-name">Nombre del permiso</label><input id="permission-name" maxlength="64" bind:value={permissionName} disabled={busy}/>
            <label for="permission-description">Descripción del permiso</label><textarea id="permission-description" maxlength="2048" bind:value={description} disabled={busy}/>
            <div class="actions"><button class="primary" disabled={busy || !permissionName.trim()} on:click={savePermission}>Guardar permiso</button><button class="danger" disabled={busy || !permissionId} on:click={removePermission}>Eliminar permiso</button></div>
        </section><section class="card"><h2>Operaciones permitidas</h2><p>Selecciona las operaciones que este permiso habilitará cuando forme parte de un rol.</p>
            {#each groups as group}<fieldset disabled={busy}><legend>{group}</legend>{#each data.capabilities.filter(c=>c.group===group) as cap}<label class="check"><input type="checkbox" bind:group={capabilities} value={cap.key}/><span>{cap.label}</span></label>{/each}</fieldset>{/each}
        </section></div>
    {:else if tab==='Roles'}
        <div class="columns"><section class="card"><h2>Crear o editar rol</h2>
            <label for="role-select">Rol</label><select id="role-select" bind:value={roleId} on:change={loadRole} disabled={busy}><option value={0}>Nuevo rol</option>{#each data.roles as role}<option value={role.role_id}>{role.name}</option>{/each}</select>
            <button disabled={busy} on:click={newRole}>Nuevo rol</button>
            <label for="role-name">Nombre del rol</label><input id="role-name" maxlength="64" bind:value={roleName} disabled={busy}/>
            {#if Number(roleId)===1}<p class="notice">El rol administrador conserva acceso completo y no puede eliminarse. Debe quedar al menos un usuario con ese rol.</p>{/if}
            <div class="actions"><button class="primary" disabled={busy || !roleName.trim()} on:click={saveRole}>Guardar rol</button><button class="danger" disabled={busy || !roleId || Number(roleId)===1} on:click={removeRole}>Eliminar rol</button></div>
        </section><section class="card"><h2>Permisos del rol</h2><label for="role-search">Filtrar permisos del rol</label><input id="role-search" type="search" bind:value={roleSearch}/>
            <fieldset disabled={busy}><legend>Selecciona los permisos</legend>{#each data.permissions.filter(p=>p.name.toLowerCase().includes(roleSearch.toLowerCase())) as permission}<label class="check"><input type="checkbox" bind:group={rolePermissions} value={permission.permission_id}/><span>{permission.name}{#if permission.description}<small>{permission.description}</small>{/if}<small>{permission.capabilities.length} operaciones</small></span></label>{/each}</fieldset>
        </section></div>
    {:else}
        <section class="card"><h2>Historial de cambios</h2><p>Últimos 100 cambios, con la persona responsable y los valores anteriores y nuevos.</p>
            {#each data.events as event}<details><summary>{new Date(event.created_at).toLocaleString()} · {event.actor_name} · {event.action} · #{event.target_id}</summary><div class="columns"><div><strong>Antes</strong><pre>{JSON.stringify(event.before_data,null,2)}</pre></div><div><strong>Después</strong><pre>{JSON.stringify(event.after_data,null,2)}</pre></div></div></details>{/each}
            {#if !data.events.length}<p>Todavía no hay cambios registrados.</p>{/if}
        </section>
    {/if}
</section>
<style>
.security{max-width:1180px;margin:0 auto;padding:1rem;color:#161616}.eyebrow{color:#0f62fe;font-size:.75rem;letter-spacing:.12em;font-weight:600}h1{font-size:2rem;margin:.35rem 0 .75rem}h2{font-size:1.2rem;margin:0 0 1rem}p{line-height:1.5;margin:.5rem 0 1rem}nav{display:flex;gap:.25rem;border-bottom:1px solid #d0d0d0;margin:1.5rem 0}button{cursor:pointer;border:1px solid #8d8d8d;background:white;padding:.65rem .9rem;font:inherit}button:disabled{cursor:default;opacity:.45}nav button{border:0;border-bottom:3px solid transparent}nav button.active{border-color:#0f62fe;color:#0043ce}.columns{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;align-items:start}.card{background:#f4f4f4;padding:1.25rem;min-width:0}.card>label{display:block;margin-top:1rem;font-weight:600}.card>input,.card>select,.card>textarea{display:block;width:100%;box-sizing:border-box;font:inherit;margin:.4rem 0 .75rem;border:0;border-bottom:1px solid #8d8d8d;padding:.7rem;background:white}select{min-height:2.7rem}textarea{min-height:5rem}fieldset{border:0;border-top:1px solid #ddd;padding:.75rem 0;margin-top:1rem}legend{font-weight:600;padding-right:.6rem}.check{display:flex;align-items:start;gap:.65rem;padding:.4rem 0;cursor:pointer;line-height:1.4}.check input{margin-top:.2rem;accent-color:#0f62fe}.check small{display:block;color:#525252;font-size:.78rem}.actions{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem}.primary{background:#0f62fe;color:white;border-color:#0f62fe}.danger{color:#da1e28;border-color:#da1e28}.notice{background:#e5f6ff;padding:.75rem 1rem;border-left:3px solid #0f62fe;margin:1rem 0}.error{background:#fff1f1;border-color:#da1e28}li{margin:.5rem 0 0 1rem;line-height:1.4}details{border-bottom:1px solid #ddd;padding:.75rem 0}summary{cursor:pointer;line-height:1.5}pre{font-size:.75rem;white-space:pre-wrap;word-break:break-word;max-height:24rem;overflow:auto}input:focus,select:focus,textarea:focus,button:focus-visible{outline:2px solid #0f62fe;outline-offset:2px}@media(max-width:700px){.columns{grid-template-columns:1fr}.security{padding:.5rem}nav{flex-wrap:wrap}h1{font-size:1.6rem}}
</style>
