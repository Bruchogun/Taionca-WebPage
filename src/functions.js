import { initialDate } from './lib/responsibility-dates';
import { displayMoney } from './lib/money';
import {notifications, loadingIsActive} from "./stores"
import fetch from "node-fetch";
import { goto } from '@sapper/app'

/**
 * Validate if `userPermissions` contains all `permissionsRequired`
 *
 * @param {number[]} permissions_ids - List of `permission_id` to be validated
 * @param {number[]} userPermissions - List of `permission_id` the user has
 *
 * @return {boolean}
 */
export const checkPermissions = (permissions_ids, userPermissions) => {
    return permissions_ids.every(permission_id => {  // All *permissions_ids* must pass validation
        return userPermissions.includes(permission_id);
    })
}

/**
 * @param {string} msg message to notify
 */
export function notify(title, kind="error", subtitle="", caption=undefined) {

    const newNotification = {title, subtitle, kind, caption};
    let newIndex;

    notifications.update(notificationsQueue => {
        newIndex = notificationsQueue.length;
        return [...notificationsQueue, newNotification]
    })
    setTimeout(() => {
        notifications.update(notificationsQueue => {
            delete notificationsQueue[newIndex];
            return (notificationsQueue.filter(x=>x).length > 0) // checking if there is any notification active
                ? notificationsQueue
                : []
        })
    }, 5000);
}

export function next_date(deadline, term, days_to_repeat){
    return initialDate(deadline, term, days_to_repeat);
}

export function format_number(amount, option, currency){
    if(option === "currency"){
        return displayMoney(amount, currency);
        
    }else if(option === "percentage"){
        if(0 <= Number(amount) && Number(amount) <= 1){
            return `${(Number(amount)*100).toFixed(2)}%`
        }else{
            return `${Number(amount).toFixed(2)}%`
        }
    }
}

export async function apiFetch (url, options={}) {
    loadingIsActive.set(true);

    let response, data, error, success, warning, redirect;
    try {
        response = await fetch(url, options);
    } catch (err) {
        notify("Error de red", "error", err.message);
        loadingIsActive.set(false);
        throw err;
    }
    loadingIsActive.set(false);
    if (response.status >= 500) {
        notify(response.status, "error", response.statusText)
    }
    {
        let body;
        try {
            body = await response.text();
            ({error, success, warning, redirect, ...data} = JSON.parse(body));
        } catch (err) {
            notify(err.message, "error", body, true);
            throw err;
        }
    }

    if (success) notify(success, "success");
    if (warning) notify(warning, "warning");
    if (redirect) goto(redirect);
    if (error) {
        notify(error);
        throw new Error(error);
    }

    return data;
}

export const api = {
    get: apiFetch,
    post: async (url, bodyObject, headers={}, options={}) =>
        await apiFetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', ...headers},
            body: JSON.stringify(bodyObject),
            ...options
        }),
    patch: async (url, bodyObject, headers={}, options={}) =>
        await apiFetch(url, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json', ...headers},
            body: JSON.stringify(bodyObject),
            ...options
        }),
    delete: (url, options={}) => apiFetch(url, {method: 'DELETE', ...options})
}

/**
 * Examples
 * 
 * GET: `const users = await api.get('api/users')`
 * POST: `await api.post('api/users', newUser)`
 * PATCH: `await api.patch('api/user/123', modifiedUser)`
 * DELETE: `await api.delete('api/user')`
 */
