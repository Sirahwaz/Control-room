const api = globalThis.chrome;
const $ = (selector) => document.querySelector(selector);
let lastExtraction = null;

function callApi(method, ...args) {
  return new Promise((resolve, reject) => {
    method(...args, (result) => {
      const error = api.runtime.lastError;
      if (error) reject(new Error(error.message || "browser_api_failed"));
      else resolve(result);
    });
  });
}

function status(message, isError = false) {
  $("#status").textContent = message;
  $("#status").classList.toggle("error", isError);
}

async function loadPrevious() {
  try {
    const saved = await callApi(api.storage.local.get, ["lastExtraction"]);
    if (saved.lastExtraction) {
      lastExtraction = saved.lastExtraction;
      $("#preview").textContent = JSON.stringify(lastExtraction, null, 2);
      $("#export").disabled = false;
      status("Previous local extraction loaded.");
    }
  } catch {
    status("Local extraction storage is unavailable.", true);
  }
}

async function requestSourcePermission(source) {
  const permission = { tabs: "tabs", bookmarks: "bookmarks", history: "history", downloads: "downloads" }[source];
  if (!permission) return true;
  const granted = await callApi(api.permissions.request, { permissions: [permission] });
  return granted === true;
}

$("#extract").addEventListener("click", async () => {
  $("#extract").disabled = true;
  try {
    const source = $("#source").value;
    const granted = await requestSourcePermission(source);
    if (!granted) throw new Error("permission_not_granted");
    status("Extracting selected source locally…");
    const result = await callApi(api.runtime.sendMessage, { type: "MIDAD_EXTRACT", source });
    if (!result?.ok) throw new Error(result?.error || "extraction_failed");
    lastExtraction = result.data;
    $("#preview").textContent = JSON.stringify(lastExtraction, null, 2);
    $("#export").disabled = false;
    status("Extracted " + result.data.count + " item(s). Nothing was uploaded.");
  } catch (error) {
    status(String(error?.message || "extraction_failed"), true);
  } finally {
    $("#extract").disabled = false;
  }
});

$("#grantSites").addEventListener("click", async () => {
  $("#grantSites").disabled = true;
  try {
    const granted = await callApi(api.permissions.request, { origins: ["https://*/*"] });
    status(granted
      ? "All-HTTPS host access granted by the browser. It is not used for automatic extraction in this MVP."
      : "Host access was not granted.", !granted);
  } catch (error) {
    status(String(error?.message || "host_permission_failed"), true);
  } finally {
    $("#grantSites").disabled = false;
  }
});

$("#export").addEventListener("click", () => {
  if (!lastExtraction) return;
  const blob = new Blob([JSON.stringify(lastExtraction, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "midad-browser-extraction.json";
  anchor.click();
  URL.revokeObjectURL(url);
});

loadPrevious();
