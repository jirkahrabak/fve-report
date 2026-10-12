export async function onRequestGet(context) {
  const { env } = context;

  const authKey = env.SHELLY_AUTH_KEY;
  const serverUrl = env.SHELLY_SERVER_URL || 'https://shelly-137-eu.shelly.cloud';
  const deviceIdsRaw = env.SHELLY_DEVICE_IDS || '';

  if (!authKey) {
    return new Response(JSON.stringify({ 
      error: 'SHELLY_AUTH_KEY není nastaven v Cloudflare Environment Secrets.' 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const deviceIds = deviceIdsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const baseUrl = serverUrl.replace(/\/$/, '');
  const results = {};

  try {
    for (const devId of deviceIds) {
      const url = `${baseUrl}/device/status?id=${encodeURIComponent(devId)}&auth_key=${encodeURIComponent(authKey)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Cloudflare-Pages-FVE/1.0' } });
      if (res.ok) {
        const json = await res.json();
        if (json.isok && json.data) {
          results[devId] = json.data.device_status;
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      timestamp: Date.now(),
      server: baseUrl,
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