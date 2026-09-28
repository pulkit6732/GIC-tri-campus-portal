import {readFileSync} from 'node:fs';

const config=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
const id=config.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || id==='00000000-0000-0000-0000-000000000000') {
 console.error('Set the real Cloudflare D1 database_id in wrangler.jsonc before running a production command.');
 process.exit(1);
}
