import { isMessageType, MESSAGE } from "./shared/contracts.js";

const EXTENSION_ORIGIN = `chrome-extension://${chrome.runtime.id}/`;

function isTrustedExtensionPage(sender) {
  return sender.id === chrome.runtime.id &&
    typeof sender.url === "string" && sender.url.startsWith(EXTENSION_ORIGIN) &&
    sender.tab === undefined;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isMessageType(message, MESSAGE.SCAN_ACTIVE_TAB)) return false;
  if (!isTrustedExtensionPage(sender)) {
    sendResponse({ type: MESSAGE.SCAN_ERROR, error: "Only the extension popup can start a scan." });
    return false;
  }

  scanActiveTab().then(sendResponse).catch((error) => {
    sendResponse({ type: MESSAGE.SCAN_ERROR, error: readableScanError(error) });
  });
  return true;
});

async function scanActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active page is available to scan.");
  if (!/^https?:\/\//i.test(tab.url)) {
    throw new Error("This browser page cannot be scanned. Open a regular HTTP or HTTPS form page.");
  }

  // Injecting on demand uses the activeTab grant from the user's popup click.
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["extension/content/content-script.js"]
  });

  const result = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.SCAN_PAGE });
  if (!isMessageType(result, MESSAGE.SCAN_RESULT) || !Array.isArray(result.fields)) {
    throw new Error("The page did not return a valid scan result. Try again on a standard form page.");
  }
  return {
    type: MESSAGE.SCAN_RESULT,
    origin: new URL(tab.url).origin,
    fields: result.fields,
    summary: result.summary
  };
}

function readableScanError(error) {
  const message = String(error?.message ?? "");
  if (/cannot access|permission|restricted|chrome:\/\//i.test(message)) {
    return "This browser page is restricted. Open a regular HTTP or HTTPS page, then scan again.";
  }
  return message || "The form could not be scanned. Try refreshing the page.";
}
