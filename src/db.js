import { Client, Pool } from 'pg';
import { database as config } from './config';

export const pool = new Pool(config.pool);
pool.on('connect', client => {
    client.on('notice', msg => console.warn('notice:', msg.message))
})

/**
 * @param  { [ string, any[]? ] } args
 * check {@link https://node-postgres.com/api/client/#clientquery} for more options
 */
export async function query(...args) {
    { // Try to query with pool if possible
        const isPoolMaxed = (pool.totalCount === config.pool.max);
        const isAnyClientIdle = (pool.idleCount > 0);
        if (!isPoolMaxed || isAnyClientIdle) {
            return await pool.query(...args);
        }
    }
    // Otherwise create a disposable client
    const client = new Client(config.client);
    client.on('notice', msg => console.warn('notice:', msg.message))
    try {
        await client.connect();
        return await client.query(...args);
    } finally {
        await client.end();
    }
}

/**
 * Query using [tagged template strings](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#tagged_templates).
 * 
 * For example:
 * 
 * Instead of using `query()` like this
 * ```js
 *  query(`INSERT INTO table (name, description) VALUES ($1, $2)`, [name, description])
 * ```
 * 
 * Call `sql()` like this:
 * ```js
 *  sql`INSERT INTO table (name, description) VALUES (${name}, ${description})`
 * ```
 * This *Tagged template* is equivalent to calling the function like this:
 * ```js
 *  sql(
 *      [
 *          'INSERT INTO table (name, description) VALUES (',
 *          ', ',
 *          ')'
 *      ], // This is what would go into `querySegments`
 *      // Following parameters are aggregated as an array into `params`
 *      name,
 *      description
 *  )
 * ```
 * 
 * @param {string[]} querySegments
 * @param {any[]} params
 */
export async function sql(querySegments, ...params) {
    let queryString = querySegments[0];

    for (let i = 0; i < params.length; i++) {

        const idx = i+1;
        /**
         * This constant `idx` has double purpose / semantic
         * 
         * 1. An index that starts from 1, as required by the `query()` function to refer to params, e.g `$1` `$2`
         * 2. Next `querySegment` that will be concatenated
         */
        queryString += `$${idx}`;
        queryString += querySegments[idx];
    }

    return await query(queryString, params);
}
