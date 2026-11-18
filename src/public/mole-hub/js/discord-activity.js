const ACTIVITY_READY_EVENT = 'winlew:discord-activity-ready';
const ACTIVITY_ERROR_EVENT = 'winlew:discord-activity-error';

function isDiscordActivityLaunch() {
  try {
    const url = new URL(window.location.href);
    return ['discord', '1', 'true', 'activity'].includes(String(url.searchParams.get('platform') || '').trim().toLowerCase())
      || ['1', 'true', 'yes', 'on'].includes(String(url.searchParams.get('discord_activity') || '').trim().toLowerCase())
      || ['1', 'true', 'yes', 'on'].includes(String(url.searchParams.get('activity') || '').trim().toLowerCase());
  } catch {
    return false;
  }
}

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function readJson(response, fallback) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(fallback || 'discord_activity_invalid_response');
  }
  if (!response.ok) throw new Error(data?.error || fallback || 'discord_activity_request_failed');
  return data || {};
}

async function fetchActivityConfig() {
  const res = await window.WinLEWAuth.hubApiFetch('/api/discord/activity/config', {
    headers: { Accept: 'application/json' },
  });
  return readJson(res, 'discord_activity_config_failed');
}

async function exchangeDiscordCode(code, app) {
  const res = await window.WinLEWAuth.hubApiFetch('/api/discord/activity/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, app }),
  });
  return readJson(res, 'discord_activity_auth_failed');
}

const state = {
  status: 'idle',
  app: 'mole',
  session: '',
  verification: null,
  warning: '',
  discordUserId: '',
  rpcAuthenticated: false,
  error: '',
};

let bootPromise = null;

async function ensureSession() {
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    if (!isDiscordActivityLaunch()) {
      state.status = 'disabled';
      return state;
    }
    if (!window.WinLEWAuth || typeof window.WinLEWAuth.hubApiFetch !== 'function') {
      throw new Error('discord_activity_bridge_missing');
    }

    state.status = 'connecting';
    const config = await fetchActivityConfig();
    if (!config?.enabled || !config?.clientId) {
      state.status = 'disabled';
      state.error = config?.error || 'discord_activity_disabled';
      emit(ACTIVITY_ERROR_EVENT, { ...state });
      return state;
    }

    const { DiscordSDK } = await import('https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk/+esm');
    const discordSdk = new DiscordSDK(config.clientId);
    await discordSdk.ready();

    const authz = await discordSdk.commands.authorize({
      client_id: config.clientId,
      response_type: 'code',
      state: 'mole-hub-activity',
      prompt: 'none',
      scope: Array.isArray(config.scopes) && config.scopes.length ? config.scopes : ['identify'],
    });
    if (!authz?.code) throw new Error('discord_activity_authorize_failed');

    const sessionData = await exchangeDiscordCode(authz.code, config.app || 'mole');
    if (!sessionData?.session || !sessionData?.access_token) {
      throw new Error('discord_activity_session_missing');
    }

    const authKeys = window.WinLEWAuth.AuthKeys || { session: 'winlew.verify.session', app: 'winlew.verify.app' };
    localStorage.setItem(authKeys.session, sessionData.session);
    localStorage.setItem(authKeys.app, sessionData.app || 'mole');
    if (sessionData?.verification?.wallet) window.WinLEWAuth.setCachedWallet(sessionData.verification.wallet);

    let rpcAuthenticated = false;
    try {
      const auth = await discordSdk.commands.authenticate({
        access_token: sessionData.access_token,
      });
      rpcAuthenticated = !!auth;
    } catch (error) {
      console.warn('[discord-activity] authenticate failed:', error);
    }

    state.status = 'ready';
    state.app = sessionData.app || 'mole';
    state.session = sessionData.session;
    state.verification = sessionData.verification || null;
    state.warning = sessionData.warning || '';
    state.discordUserId = sessionData.discordUserId || '';
    state.rpcAuthenticated = rpcAuthenticated;
    state.error = '';

    emit(ACTIVITY_READY_EVENT, { ...state });
    return state;
  })().catch((error) => {
    state.status = 'error';
    state.error = String(error?.message || error || 'discord_activity_boot_failed');
    emit(ACTIVITY_ERROR_EVENT, { ...state });
    throw error;
  });

  return bootPromise;
}

window.WinLEWDiscordActivity = {
  state,
  ensureSession,
};

void ensureSession();
