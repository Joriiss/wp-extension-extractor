const collectBtn = document.getElementById("collect-btn");
const exportCsvBtn = document.getElementById("export-csv-btn");
const exportJsonBtn = document.getElementById("export-json-btn");
const clearBtn = document.getElementById("clear-btn");
const tabStatus = document.getElementById("tab-status");
const messageEl = document.getElementById("message");
const siteList = document.getElementById("site-list");
const siteCount = document.getElementById("site-count");
const emptyState = document.getElementById("empty-state");

let activeTab = null;
let inventory = {};

function showMessage(text, kind) {
  messageEl.hidden = !text;
  messageEl.textContent = text || "";
  messageEl.className = `message ${kind || ""}`.trim();
}

function isWpAdminUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes("/wp-admin");
  } catch (_err) {
    return false;
  }
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function siteRows() {
  return Object.values(inventory).sort((a, b) =>
    String(a.siteName).localeCompare(String(b.siteName))
  );
}

async function loadInventory() {
  const stored = await chrome.storage.local.get("sites");
  inventory = stored.sites || {};
  renderList();
}

async function saveInventory() {
  await chrome.storage.local.set({ sites: inventory });
  renderList();
}

function renderList() {
  const rows = siteRows();
  siteCount.textContent = String(rows.length);
  siteList.innerHTML = "";
  emptyState.hidden = rows.length > 0;
  exportCsvBtn.disabled = rows.length === 0;
  exportJsonBtn.disabled = rows.length === 0;
  clearBtn.disabled = rows.length === 0;

  for (const site of rows) {
    const item = document.createElement("li");
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = site.siteName || site.siteUrl;
    const meta = document.createElement("div");
    meta.className = "meta";
    const pluginCount = (site.plugins || []).length;
    const when = site.collectedAt ? site.collectedAt.replace("T", " ").slice(0, 16) : "";
    meta.textContent = `${pluginCount} plugin${pluginCount === 1 ? "" : "s"} · ${when}${
      site.wpVersion ? ` · WP ${site.wpVersion}` : ""
    }`;
    info.append(title, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      delete inventory[site.siteUrl];
      await saveInventory();
    });

    item.append(info, remove);
    siteList.append(item);
  }
}

async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  if (!tab || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
    tabStatus.textContent = "Open a WordPress admin tab first.";
    collectBtn.disabled = true;
    return;
  }
  if (!isWpAdminUrl(tab.url)) {
    tabStatus.textContent = "This tab is not wp-admin. Log in, then open the dashboard.";
    collectBtn.disabled = true;
    return;
  }
  let host = tab.url;
  try {
    host = new URL(tab.url).hostname;
  } catch (_err) {
    /* keep raw url */
  }
  tabStatus.textContent = `Ready to collect from ${host}`;
  collectBtn.disabled = false;
}

async function collect() {
  showMessage("");
  if (!activeTab || !activeTab.id) {
    showMessage("No active tab.", "err");
    return;
  }
  collectBtn.disabled = true;
  collectBtn.textContent = "Collecting…";
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["collector.js"],
    });
    const payload = injected && injected[0] ? injected[0].result : null;
    if (!payload || !payload.ok) {
      showMessage((payload && payload.error) || "Could not read plugins from this tab.", "err");
      return;
    }
    inventory[payload.siteUrl] = payload;
    await saveInventory();
    const count = payload.plugins.length;
    showMessage(
      `Saved ${count} plugin${count === 1 ? "" : "s"} from ${payload.siteName} (${payload.source}).`,
      "ok"
    );
  } catch (err) {
    showMessage(err && err.message ? err.message : String(err), "err");
  } finally {
    collectBtn.textContent = "Collect plugins from this site";
    await refreshTab();
  }
}

function pluginCsv() {
  const headers = [
    "site_name",
    "site_url",
    "wp_version",
    "collected_at",
    "plugin_name",
    "plugin_file",
    "version",
    "status",
    "must_use",
    "source",
  ];
  const lines = [headers.join(",")];
  for (const site of siteRows()) {
    for (const plugin of site.plugins || []) {
      lines.push(
        [
          site.siteName,
          site.siteUrl,
          site.wpVersion || "",
          site.collectedAt || "",
          plugin.name,
          plugin.file,
          plugin.version,
          plugin.status,
          plugin.mustUse ? "yes" : "no",
          site.source || "",
        ]
          .map(csvEscape)
          .join(",")
      );
    }
  }
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

function summaryCsv() {
  const grouped = new Map();
  for (const site of siteRows()) {
    for (const plugin of site.plugins || []) {
      const key = plugin.name || plugin.file;
      if (!grouped.has(key)) {
        grouped.set(key, {
          name: key,
          sites: new Set(),
          active: new Set(),
          versions: new Set(),
        });
      }
      const row = grouped.get(key);
      row.sites.add(site.siteUrl);
      if (plugin.status === "active" || plugin.status === "network-active") {
        row.active.add(site.siteUrl);
      }
      if (plugin.version) {
        row.versions.add(plugin.version);
      }
    }
  }
  const lines = ["plugin_name,sites_count,active_count,versions,version_count"];
  const names = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const row = grouped.get(name);
    const versions = [...row.versions].sort();
    lines.push(
      [row.name, row.sites.size, row.active.size, versions.join("; "), versions.length]
        .map(csvEscape)
        .join(",")
    );
  }
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

collectBtn.addEventListener("click", collect);

exportCsvBtn.addEventListener("click", () => {
  const day = stamp();
  download(`wordpress-plugins-${day}.csv`, pluginCsv(), "text/csv;charset=utf-8");
  setTimeout(() => {
    download(`wordpress-plugins-summary-${day}.csv`, summaryCsv(), "text/csv;charset=utf-8");
  }, 400);
});

exportJsonBtn.addEventListener("click", () => {
  download(
    `wordpress-plugins-${stamp()}.json`,
    JSON.stringify(siteRows(), null, 2),
    "application/json"
  );
});

clearBtn.addEventListener("click", async () => {
  if (!confirm("Remove all collected sites from this extension?")) {
    return;
  }
  inventory = {};
  await saveInventory();
  showMessage("Inventory cleared.", "ok");
});

loadInventory();
refreshTab();
