import { followingDate } from './responsibility-dates';
// Active assignment stores occurrences still to be emitted, including the latest emitted one.
export async function nextResponsibility(client,pending) {
    const active=(await client.query(`SELECT a.*,r.days_to_repeat,t.term FROM active_responsibilitys a JOIN recurrent_responsibilitys r USING(id_recurrent_responsibility)
        JOIN time_frequencys t USING(id_time_frequency) WHERE id_active_responsibility=$1 FOR UPDATE OF a`,[pending.id_active_responsibility])).rows[0];
    if(!active || active.times_remaining<=1) return null;
    const latest=(await client.query('SELECT * FROM pending_responsibilitys WHERE id_active_responsibility=$1 ORDER BY deadline DESC,id_pending_responsibility DESC LIMIT 1',[active.id_active_responsibility])).rows[0];
    if(!latest || latest.id_pending_responsibility!==pending.id_pending_responsibility) return null;
    const next=followingDate(latest.deadline,active.term,active.days_to_repeat);
    const created=(await client.query('INSERT INTO pending_responsibilitys(id_active_responsibility,deadline) VALUES($1,$2) RETURNING *',[active.id_active_responsibility,next])).rows[0];
    await client.query('UPDATE active_responsibilitys SET times_remaining=times_remaining-1 WHERE id_active_responsibility=$1',[active.id_active_responsibility]);
    return created;
}
