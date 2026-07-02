import { spawnSync } from 'child_process';

/**
 * Wrapper local pour lancer Playwright en fournissant la clé de déchiffrement des
 * secrets EN ARGUMENT (sans casser le parseur CLI de Playwright).
 *
 * Usage :
 *   node scripts/run-e2e.mjs --key=MA_CLE [args playwright…]
 *   (ou via npm : npm run test:key -- --key=MA_CLE [args…])
 *
 * La clé est extraite puis exposée en E2E_SECRETS_KEY ; le reste des arguments est
 * transmis tel quel à `playwright test`.
 */

const args = process.argv.slice(2);
let key;
const passthrough = [];
for (const a of args) {
  const m = a.match(/^--(?:secrets-key|key)=(.+)$/);
  if (m) key = m[1];
  else passthrough.push(a);
}

const env = { ...process.env };
if (key) env.E2E_SECRETS_KEY = key;

const res = spawnSync('npx', ['playwright', 'test', ...passthrough], {
  stdio: 'inherit',
  env,
  shell: true,
});
process.exit(res.status ?? 1);
