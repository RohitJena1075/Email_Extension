// content.js
console.log("[content.js] loaded!");
function getEmailText() {
  // Try to extract the visible email body from Gmail DOM
  const emailBody = document.querySelector(".a3s"); // Gmail email body class
  return emailBody ? emailBody.innerText : "";
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_EMAIL_TEXT") {
    const text = getEmailText();
    sendResponse({ text });
  }
});