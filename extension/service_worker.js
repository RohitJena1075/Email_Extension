console.log("[SW] redirect URL =", chrome.identity.getRedirectURL());
console.log("[SW] Service worker loaded");

const API_URL = "http://127.0.0.1:8000/classify_summarize";
const GOOGLE_CLIENT_ID = "130677489883-ingosll10qjp07ha32fva60247rv6vsc.apps.googleusercontent.com";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email"
].join(" ");

let googleToken = null;
let googleTokenExpiry = 0;

// -------- Helpers --------
async function saveToken(token, expiresInSec) {
  googleToken = token;
  googleTokenExpiry = Date.now() + expiresInSec * 1000;

  await chrome.storage.local.set({
    googleToken,
    googleTokenExpiry,
    isLoggedIn: true
  });

  const refreshTime = Math.max(googleTokenExpiry - 5 * 60 * 1000, Date.now() + 5000);
  chrome.alarms.create("refresh_google_token", { when: refreshTime });
}

async function loadTokenFromStorage() {
  const { googleToken: t, googleTokenExpiry: exp } = await chrome.storage.local.get([
    "googleToken",
    "googleTokenExpiry"
  ]);
  googleToken = t || null;
  googleTokenExpiry = exp || 0;
}

function isTokenValid() {
  return googleToken && Date.now() < googleTokenExpiry;
}

function buildAuthUrl(prompt = "consent") {
  const redirectUri = chrome.identity.getRedirectURL();
  return (
    "https://accounts.google.com/o/oauth2/v2/auth" +
    `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(GOOGLE_SCOPES)}` +
    `&include_granted_scopes=true` +
    `&prompt=${prompt}`
  );
}

function parseHashParams(hash) {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return {
    access_token: params.get("access_token"),
    expires_in: Number(params.get("expires_in") || "3600"),
    scope: params.get("scope")
  };
}

function interactiveLoginWrapper() {
  return new Promise((resolve) => {
    const url = buildAuthUrl("consent");
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, async (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        resolve({ ok: false, error: chrome.runtime.lastError?.message || "Unknown error" });
        return;
      }
      const { access_token, expires_in } = parseHashParams(new URL(redirectUrl).hash);
      if (!access_token) {
        resolve({ ok: false, error: "No access_token in redirect URL" });
        return;
      }
      await saveToken(access_token, expires_in || 3600);
      resolve({ ok: true, token: access_token });
    });
  });
}

async function silentLogin() {
  const url = buildAuthUrl("none");
  return new Promise((resolve) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: false }, async (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) return resolve(false);
      const { access_token, expires_in } = parseHashParams(new URL(redirectUrl).hash);
      if (!access_token) return resolve(false);
      await saveToken(access_token, expires_in || 3600);
      resolve(true);
    });
  });
}

// -------- Summarize API Call --------
async function summarizeText(text) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (!res.ok) {
      console.error("[SW] API Error:", res.status, await res.text());
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    console.log("[SW] API response:", data);
    return { ok: true, data };
  } catch (err) {
    console.error("[SW] summarizeText error:", err);
    return { ok: false, error: err.message };
  }
}

// -------- Events & Message Handlers --------

// Token restoration on load/start
chrome.runtime.onStartup?.addListener(loadTokenFromStorage);
loadTokenFromStorage();

// Token refresh
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "refresh_google_token") {
    const ok = await silentLogin();
    if (!ok) {
      await chrome.storage.local.remove(["googleToken", "googleTokenExpiry"]);
      googleToken = null;
      googleTokenExpiry = 0;
      await chrome.storage.local.set({ isLoggedIn: false });
    }
  }
});

// Main message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[SW] received message:", msg);

  const handlers = {
    GOOGLE_LOGIN: interactiveLoginWrapper,
    SUMMARIZE_TEXT: () => summarizeText(msg.text)
    // We are NOT auto-opening the side panel from SW anymore to avoid the gesture error.
  };

  if (handlers[msg.type]) {
    handlers[msg.type]().then(sendResponse);
    return true; // keeps message port open for async responses
  }

  console.warn("[SW] Unknown message type:", msg.type);
});




