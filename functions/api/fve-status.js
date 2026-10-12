import defaultConfig from '../../fve-config.json';

// Záložní výchozí ID zařízení, pokud by config nebyl k dispozici
const FALLBACK_DEVICE_IDS = [
  'shellypro3em-9454c5b957a0', // El-celkove (Grid Guard)
  'shellypro1-5c013b1e5db4',   // Xtra-rs485 (EPEver solární regulátor)
  'shellyemg3-e4b32335d7cc',   // Solar okruh power (BMS + Victron)
  'shellyplus1pm-b48a0a214a54', // Fv dobijeni
  'XB211299191617650'          // Meteo stanice WS90
];

/**
 * Cloudflare Pages Function: /api/fve-status
 * Uložte jako: functions/api/fve-status.js
 */
export async function onRequestGet(context) {
  const { env } = context;

  const authKey = env.SHELLY_AUTH_KEY;
  const serverUrl = env.SHELLY_SERVER_URL || defaultConfig?.shellyServerUrl || 'https://shelly-137-eu.shelly.cloud';
  const deviceIdsRaw = env.SHELLY_DEVICE_IDS || '';

  if (!authKey) {
    return new Response(JSON.stringify({ 
      error: 'SHELLY_AUTH_KEY není nastaven v Cloudflare Environment Secrets.',
      hint: 'Přejděte do Cloudflare Pages -> Settings -> Environment variables a přidejte SHELLY_AUTH_KEY (zaškrtněte Encrypt/Secret).'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const baseUrl = serverUrl.replace(/\/$/, '');
  let deviceIds = [];
  let configSource = 'fallback';

  // 1. Priorita: Nastavení v proměnných prostředí Cloudflare (SHELLY_DEVICE_IDS)
  if (deviceIdsRaw) {
    deviceIds = deviceIdsRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (deviceIds.length > 0) configSource = 'env (SHELLY_DEVICE_IDS)';
  }

  // 2. Priorita: Konfigurace ze souboru fve-config.json
  if (deviceIds.length === 0 && defaultConfig?.devices) {
    if (Array.isArray(defaultConfig.devices)) {
      deviceIds = defaultConfig.devices
        .map(d => (typeof d === 'string' ? d : (d.id || d.device_id)))
        .filter(Boolean);
    } else if (typeof defaultConfig.devices === 'object') {
      deviceIds = Object.keys(defaultConfig.devices);
    }
    if (deviceIds.length > 0) configSource = 'fve-config.json';
  }

  // 3. Priorita: Bezpečný fallback (známá FVE zařízení)
  if (deviceIds.length === 0) {
    deviceIds = [...FALLBACK_DEVICE_IDS];
    configSource = 'built-in fallback';
  }

  // Ochrana před limitem Cloudflare Workers (max 50 subrequestů na volání workeru)
  // Nikdy nenecháme překročit bezpečnou mez, aby nedošlo k chybě 502 Too many subrequests
  if (deviceIds.length > 40) {
    deviceIds = deviceIds.slice(0, 40);
  }

  const results = {};
  const errors = {};

  try {
    // Paralelní stažení stavu všech vybraných zařízení pro maximální rychlost
    await Promise.all(
      deviceIds.map(async (devId) => {
        try {
          const url = `${baseUrl}/device/status?id=${encodeURIComponent(devId)}&auth_key=${encodeURIComponent(authKey)}`;
          const res = await fetch(url, { headers: { 'User-Agent': 'Cloudflare-Pages-FVE/1.0' } });
          if (res.ok) {
            const json = await res.json();
            if (json.isok && json.data) {
              results[devId] = json.data.device_status;
            } else {
              errors[devId] = json.errors || json;
            }
          } else {
            errors[devId] = `HTTP ${res.status}`;
          }
        } catch (fetchErr) {
          errors[devId] = fetchErr.message;
        }
      })
    );

    return new Response(JSON.stringify({ 
      success: Object.keys(results).length > 0, 
      timestamp: Date.now(),
      server: baseUrl,
      configSource: configSource,
      configuredDeviceCount: deviceIds.length,
      devices: results,
      errors: Object.keys(errors).length > 0 ? errors : undefined
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
