/**
 * Cloudflare Pages Function: /api/fve-status
 * Uložte jako: functions/api/fve-status.js
 */
export async function onRequestGet(context) {
  const { env } = context;

  const authKey = env.SHELLY_AUTH_KEY;
  const serverUrl = env.SHELLY_SERVER_URL || 'https://shelly-137-eu.shelly.cloud';
  const deviceIdsRaw = env.SHELLY_DEVICE_IDS || '';

  if (!authKey) {
    return new Response(JSON.stringify({ 
      error: 'SHELLY_AUTH_KEY není nastaven v Cloudflare Environment Secrets.',
      hint: 'Přejděte do Cloudflare Pages -> Settings -> Environment variables a přidejte SHELLY_AUTH_KEY.'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const baseUrl = serverUrl.replace(/\/$/, '');
  let deviceIds = deviceIdsRaw.split(',').map(s => s.trim()).filter(Boolean);

  // Pokud nejsou ID vyplněna v proměnných, stáhneme automaticky seznam všech zařízení z účtu
  if (deviceIds.length === 0) {
    try {
      const listUrl = `${baseUrl}/interface/device/list?auth_key=${encodeURIComponent(authKey)}`;
      const listRes = await fetch(listUrl, { headers: { 'User-Agent': 'Cloudflare-Pages-FVE/1.0' } });
      if (listRes.ok) {
        const listJson = await listRes.json();
        if (listJson.isok && listJson.data && listJson.data.devices) {
          deviceIds = Object.keys(listJson.data.devices);
        }
      }
    } catch (e) {
      // Ignorovat, pokusíme se pokračovat
    }
  }

  if (deviceIds.length === 0) {
    return new Response(JSON.stringify({ 
      error: 'Nenalezena žádná zařízení.',
      hint: 'Zadejte SHELLY_DEVICE_IDS nebo ověřte platnost SHELLY_AUTH_KEY.',
      server: baseUrl
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const results = {};
  const errors = {};

  try {
    for (const devId of deviceIds) {
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
    }

    return new Response(JSON.stringify({ 
      success: Object.keys(results).length > 0, 
      timestamp: Date.now(),
      server: baseUrl,
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