import { writable } from 'svelte/store';

export const session = writable(null);
export const notifications = writable([]);
