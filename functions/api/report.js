/* POST /api/report — route binding only. Logic: functions/_lib/reports.mjs.
 * Same one-line shim as every other endpoint here, for the same reason: plain
 * node can import the logic and build/apitest.js can call it. */
export { submitReport as onRequest } from '../_lib/reports.mjs';
