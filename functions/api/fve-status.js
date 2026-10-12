import defaultConfig from '../../fve-config.json';

// Záložní výchozí ID zařízení (přesné hex ID ze Shelly Cloud)
const FALLBACK_DEVICE_IDS = [
  '9454c5b957a0',      // El-celkove (Grid Guard / Pro 3EM)
  '485519035845',      // VE500 (Victron střídač 500VA / 1PM)
  'e8db84d2c3c9',      // VE2000 (Victron střídač 2000VA / 1PM)
  '5c013b1e5db4',      // Xtra-rs485 (EPEver solární regulátor)
  'e4b32335d7cc',      // Solar okruh power (Pro EM Gen3 / BMS & predikce)
  'b48a0a214a54',      // Fv dobijeni (Plus 1PM)
  'XB211299191617650'  // Meteostanice WS90
];

/**
 * Cloudflare Pages Function: /api/fve-status
 * Používá hromadný endpoint /device/all_status (1 jediný POST požadavek)
 */
export async function onRequestGet(context) {
  const { env } = context;

  const authKey = env.SHELLY_AUTH_KEY || 'NjVlYjl1aWQ08E562AFF6F24770E4F4CB793CFB0651ED7A5D2180550D800E57DE2EEA593B2E9ABC22585559FF56';
  const serverUrl = env.SHELLY_SERVER_URL || defaultConfig?.shellyServerUrl || 'https://shelly-137-eu.shelly.cloud';
  const deviceIdsRaw = env.SHELLY_DEVICE_IDS || '';

  const baseUrl = serverUrl.replace(/\/$/, '');
  let deviceIds = [];
  let configSource = 'fallback';

  if (deviceIdsRaw) {
    deviceIds = deviceIdsRaw.split(',').map(s => s.trim().replace(/^shelly[a-z0-9]+-/, '')).filter(Boolean);
    if (deviceIds.length > 0) configSource = 'env (SHELLY_DEVICE_IDS)';
  }

  if (deviceIds.length === 0 && defaultConfig?.devices) {
    if (Array.isArray(defaultConfig.devices)) {
      deviceIds = defaultConfig.devices
        .map(d => (typeof d === 'string' ? d : (d.id || d.device_id)))
        .map(id => id ? id.replace(/^shelly[a-z0-9]+-/, '') : id)
        .filter(Boolean);
    } else if (typeof defaultConfig.devices === 'object') {
      deviceIds = Object.keys(defaultConfig.devices);
    }
    if (deviceIds.length > 0) configSource = 'fve-config.json';
  }

  if (deviceIds.length === 0) {
    deviceIds = [...FALLBACK_DEVICE_IDS];
    configSource = 'built-in fallback';
  }

  try {
    // 1 jediný rychlý POST dotaz pro všechna zařízení (bez rate limitů a subrequest limitů)
    const formData = new URLSearchParams();
    formData.append('auth_key', authKey);

    const res = await fetch(`${baseUrl}/device/all_status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Cloudflare-Pages-FVE/2.0'
      },
      body: formData.toString()
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ 
        error: `Shelly Cloud vrátil HTTP ${res.status}`,
        status: res.status 
      }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const json = await res.json();
    if (!json.isok || !json.data || !json.data.devices_status) {
      return new Response(JSON.stringify({ 
        error: 'Chyba Shelly Cloud API', 
        details: json 
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const allStatuses = json.data.devices_status;
    const results = {};

    for (const devId of deviceIds) {
      if (allStatuses[devId]) {
        results[devId] = allStatuses[devId];
      }
    }

    return new Response(JSON.stringify({ 
      success: Object.keys(results).length > 0, 
      timestamp: Date.now(),
      server: baseUrl,
      configSource: configSource,
      configuredDeviceCount: deviceIds.length,
      devices: results
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
