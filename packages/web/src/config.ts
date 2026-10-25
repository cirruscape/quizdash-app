// Runtime configuration, written to /config.json by the deploy, so one build serves every
// environment (PLAN §9).
export interface AppConfig {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  eventsHttpDomain: string;
  eventsRealtimeDomain: string;
}

let config: AppConfig | undefined;

export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`could not load /config.json (${res.status})`);
  config = (await res.json()) as AppConfig;
  return config;
}

export function appConfig(): AppConfig {
  if (!config) throw new Error('config not loaded');
  return config;
}
