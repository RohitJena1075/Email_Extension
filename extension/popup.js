const loginGoogleBtn = document.getElementById("loginGoogle");

// If already logged in, show a button-like flow that still requires a user click to open the panel.
// (Auto-opening on load won't be allowed by Chrome's gesture rule.)
chrome.storage.local.get(["isLoggedIn"], (res) => {
  if (res.isLoggedIn) {
    // Change button text to indicate open action
    loginGoogleBtn.textContent = "Open Email Summarizer";
  }
});

loginGoogleBtn.addEventListener("click", async () => {
  const { isLoggedIn } = await chrome.storage.local.get("isLoggedIn");

  if (!isLoggedIn) {
    // Do login -> then open side panel (same user gesture)
    chrome.runtime.sendMessage({ type: "GOOGLE_LOGIN" }, async (resp) => {
      if (resp?.ok) {
        await chrome.storage.local.set({ isLoggedIn: true });
        await openSidePanelFromPopup(); // <-- user gesture safe
        window.close();
      } else {
        alert(`Google login failed: ${resp?.error}`);
      }
    });
  } else {
    // Already logged in, just open the panel
    await openSidePanelFromPopup(); // <-- user gesture safe
    window.close();
  }
});

// IMPORTANT: call sidePanel.open() from here (popup = user gesture allowed)
async function openSidePanelFromPopup() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "panel.html",
      enabled: true
    });

    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.error("[popup] Failed to open side panel:", e);
  }
}







