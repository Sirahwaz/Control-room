const REPOSITORY = 'Sirahwaz/Control-room';
const WORKFLOW = 'midad-mncf-ephemeral-runner.yml';
const REF = 'main';
const API = 'https://api.github.com';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function encodeJson(value) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToDer(value) {
  if (typeof value !== 'string' || value.length > 20000) throw new Error('GITHUB_APP_PRIVATE_KEY_INVALID');
  const normalized = value.replace(/\\n/g, '\n').trim();
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) throw new Error('GITHUB_APP_PRIVATE_KEY_INVALID');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function validateEvent(event) {
  if (!event || event.v !== 1 || !ID.test(event.event_id || '') ||
      !ID.test(event.task_id || '') || !ID.test(event.owner_id || '')) {
    throw new Error('WAKE_EVENT_INVALID');
  }
  return {
    event_id: event.event_id,
    task_id: event.task_id,
    owner_id: event.owner_id,
  };
}

async function createAppJwt(appId, privateKeyPem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const payload = encodeJson({ iss: appId, iat: nowSeconds - 60, exp: nowSeconds + 540 });
  const unsigned = header + '.' + payload;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  return unsigned + '.' + encodeBase64Url(new Uint8Array(signature));
}

function configured(env) {
  const values = [
    env.MIDAD_GITHUB_APP_ID,
    env.MIDAD_GITHUB_INSTALLATION_ID,
    env.MIDAD_GITHUB_APP_PRIVATE_KEY,
  ];
  const present = values.filter(value => typeof value === 'string' && value.trim().length > 0).length;
  if (present === 0) return false;
  if (present !== values.length) throw new Error('GITHUB_APP_CONFIGURATION_INCOMPLETE');
  if (!/^\d{1,20}$/.test(env.MIDAD_GITHUB_APP_ID) ||
      !/^\d{1,20}$/.test(env.MIDAD_GITHUB_INSTALLATION_ID)) {
    throw new Error('GITHUB_APP_IDENTIFIERS_INVALID');
  }
  return true;
}

/**
 * Dispatch an identifier-only event to the allowlisted repository workflow.
 * Installation tokens are minted per event and never returned or logged.
 */
export async function dispatchGitHubWorkflow(eventValue, env = {}, fetchImpl = fetch) {
  const event = validateEvent(eventValue);
  if (!configured(env)) {
    return { dispatched: false, reason: 'GITHUB_APP_NOT_CONFIGURED' };
  }

  const jwt = await createAppJwt(env.MIDAD_GITHUB_APP_ID, env.MIDAD_GITHUB_APP_PRIVATE_KEY);
  const tokenResponse = await fetchImpl(
    `${API}/app/installations/${env.MIDAD_GITHUB_INSTALLATION_ID}/access_tokens`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: 'Bearer ' + jwt,
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ permissions: { actions: 'write' } }),
    },
  );
  if (!tokenResponse.ok) throw new Error('GITHUB_APP_TOKEN_MINT_FAILED_' + tokenResponse.status);
  const tokenBody = await tokenResponse.json();
  if (typeof tokenBody.token !== 'string' || tokenBody.token.length < 20 ||
      tokenBody.permissions?.actions !== 'write') {
    throw new Error('GITHUB_APP_ACTIONS_WRITE_REQUIRED');
  }

  const dispatchResponse = await fetchImpl(
    `${API}/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: 'Bearer ' + tokenBody.token,
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ref: REF,
        inputs: {
          event_id: event.event_id,
          task_id: event.task_id,
          owner_id: event.owner_id,
        },
      }),
    },
  );
  if (dispatchResponse.status !== 204) {
    throw new Error('GITHUB_WORKFLOW_DISPATCH_FAILED_' + dispatchResponse.status);
  }

  return { dispatched: true, repository: REPOSITORY, workflow: WORKFLOW, ref: REF };
}
