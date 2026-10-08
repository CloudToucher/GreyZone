import { existsSync } from 'node:fs';
// Node's dotenv reader preserves variables explicitly supplied by the shell.
export function loadLocalEnv() {
  if (existsSync('.env')) process.loadEnvFile('.env');
}
