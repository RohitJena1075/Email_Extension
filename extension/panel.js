const summarizeBtn = document.getElementById("summarizeBtn");
const resultSection = document.getElementById("result-section");
const loader = document.getElementById("loader");
const toast = document.getElementById("toast");

// On initial open, enable Analyze if logged in
chrome.storage.local.get(["isLoggedIn"], (res) => {
  if (!res.isLoggedIn) {
    summarizeBtn.classList.add("blurred-btn");
    summarizeBtn.innerText = "Login First in Popup";
    summarizeBtn.disabled = true;
  } else {
    summarizeBtn.classList.remove("blurred-btn");
    summarizeBtn.disabled = false;
    summarizeBtn.innerText = "Analyze Current Email";
  }
});
function showToast(msg) {
  toast.innerText = msg||"Copied!";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1300);
}

async function ensureContentScript(tabId) {
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }); }
  catch (err) { /* ignore, already injected probably */ }
}
function sendMessageWithRetry(tabId, msg, retries=3, delay=333) {
  return new Promise((resolve, reject) => {
    function attempt(count) {
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          if (count < retries) setTimeout(() => attempt(count+1), delay);
          else reject(new Error("Could not access Gmail tab. Please open an email."));
        }
        else resolve(resp);
      });
    }
    attempt(0);
  });
}

summarizeBtn.addEventListener("click", async () => {
  resultSection.classList.remove("show");
  resultSection.innerHTML = ""; loader.style.display = "block";
  summarizeBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    await ensureContentScript(tab.id);
    const emailResp = await sendMessageWithRetry(tab.id, {type:"GET_EMAIL_TEXT"});
    const emailText = emailResp?.text?.trim();
    if (!emailText) {
      throw new Error("Could not extract email text. Please open an email in Gmail first.");
    }
    chrome.runtime.sendMessage({type:"SUMMARIZE_TEXT", text: emailText}, (resp) => {
      loader.style.display = "none";
      summarizeBtn.disabled = false;
      if (!resp?.ok) {
        resultSection.innerHTML = `<div class="error">API error: ${resp?.error || "Unknown error"}</div>`;
        resultSection.classList.add("show"); return;
      }
      const {categories, summary} = resp.data;
      const categoriesHtml = categories.map((cat, i) => (
        `<span class="badge" style="background:linear-gradient(90deg,#a5b4fc${50+i*2},#38bdf8);animation-delay:${i*80}ms;"
        >${cat}</span>`
      )).join('');
      resultSection.innerHTML = `
        <div class="result-section">
          <div class="section-label">Categories</div>
          <div class="categories">${categoriesHtml}</div>
        </div>
        <div class="divider"></div>
        <div class="result-section" style="position:relative;">
          <div class="section-label">Summary 
            <button class="copy-btn" id="copySummary" title="Copy summary to clipboard">📋 Copy</button>
          </div>
          <div class="summary-box" id="summaryBox">${summary}</div>
        </div>`;
      setTimeout(() => resultSection.classList.add("show"), 100);

      setTimeout(() => { // Animate badges popping in sequence
        document.querySelectorAll('.badge').forEach((el, idx) =>
          el.style.animationDelay = (idx*98)+"ms"
        );
      },50);

      document.getElementById("copySummary").onclick = () => {
        const t = document.getElementById("summaryBox").innerText;
        navigator.clipboard.writeText(t);
        showToast("Summary copied!");
      }
    });
  } catch(err) {
    loader.style.display = "none";
    summarizeBtn.disabled = false;
    resultSection.innerHTML = `<div class="error">${err.message}</div>`;
    resultSection.classList.add("show");
  }
});

