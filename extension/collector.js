/**
 * Injected into the current WordPress admin tab.
 * Last expression is a Promise; Chrome waits and returns the result.
 */
(async function collectPluginsFromPage() {
  function text(el) {
    return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim();
  }

  function parseVersion(value) {
    const match = String(value || "").match(/(\d+\.\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.]+)?)/);
    return match ? match[1] : "";
  }

  function siteName() {
    const bar = document.querySelector("#wp-admin-bar-site-name a, #wp-admin-bar-site-name > a");
    if (bar && text(bar)) {
      return text(bar);
    }
    return document.title.replace(/\s*[—–|\-].*$/, "").trim() || location.hostname;
  }

  function siteUrl() {
    const bar = document.querySelector("#wp-admin-bar-site-name a, #wp-admin-bar-site-name > a");
    const href = bar && bar.getAttribute("href");
    if (href) {
      try {
        return new URL(href, location.href).origin;
      } catch (_err) {
        /* fall through */
      }
    }
    return location.origin;
  }

  function wpVersion() {
    const footer = document.querySelector("#footer-upgrade, #wp-version-message");
    return parseVersion(text(footer));
  }

  function adminBase() {
    const match = location.pathname.match(/^(.*\/wp-admin)/);
    return match ? match[1] : "/wp-admin";
  }

  function restSettings() {
    const after = document.getElementById("wp-api-fetch-js-after");
    const blob = after ? after.textContent || "" : "";
    const nonceFromMiddleware = blob.match(/createNonceMiddleware\(\s*["']([a-f0-9]+)["']/i);
    const rootFromMiddleware = blob.match(/createRootURLMiddleware\(\s*["']([^"']+)["']/i);

    let nonce = nonceFromMiddleware ? nonceFromMiddleware[1] : "";
    let root = rootFromMiddleware ? rootFromMiddleware[1] : "";

    for (const script of document.scripts) {
      const source = script.textContent || "";
      if (!nonce) {
        const settings = source.match(/wpApiSettings\s*=\s*(\{[\s\S]*?\});/);
        if (settings) {
          try {
            const parsed = JSON.parse(settings[1]);
            nonce = parsed.nonce || nonce;
            root = parsed.root || root;
          } catch (_err) {
            /* ignore malformed inline JSON */
          }
        }
      }
      if (!nonce) {
        const nonceMatch = source.match(/wp\.apiFetch\.createNonceMiddleware\(\s*["']([a-f0-9]+)["']/);
        if (nonceMatch) {
          nonce = nonceMatch[1];
        }
      }
      if (!root) {
        const rootMatch = source.match(/wp\.apiFetch\.createRootURLMiddleware\(\s*["']([^"']+)["']/);
        if (rootMatch) {
          root = rootMatch[1];
        }
      }
    }

    if (!root) {
      const apiLink = document.querySelector('link[rel="https://api.w.org/"]');
      if (apiLink && apiLink.href) {
        root = apiLink.href.endsWith("/") ? apiLink.href : apiLink.href + "/";
      }
    }

    if (root && !root.endsWith("/")) {
      root += "/";
    }
    return { nonce, root };
  }

  function mapRestPlugin(item) {
    const status = item.status || "inactive";
    return {
      name: item.name || item.plugin || "",
      file: item.plugin || "",
      version: item.version || "",
      status: status,
      mustUse: false,
    };
  }

  async function fetchRestPlugins(root, nonce) {
    const plugins = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= 10) {
      const url = `${root}wp/v2/plugins?per_page=100&page=${page}&context=edit`;
      const headers = { Accept: "application/json" };
      if (nonce) {
        headers["X-WP-Nonce"] = nonce;
      }
      const response = await fetch(url, { credentials: "same-origin", headers: headers });
      if (!response.ok) {
        throw new Error(`REST /wp/v2/plugins returned ${response.status}`);
      }
      const total = response.headers.get("X-WP-TotalPages");
      if (total) {
        totalPages = parseInt(total, 10) || 1;
      }
      const body = await response.json();
      if (!Array.isArray(body)) {
        throw new Error("REST /wp/v2/plugins returned an unexpected payload");
      }
      plugins.push.apply(plugins, body.map(mapRestPlugin));
      if (!total && body.length < 100) {
        break;
      }
      page += 1;
    }
    return plugins;
  }

  function isMustUseView(doc) {
    const current = doc.querySelector(".subsubsub a.current");
    const href = current ? current.getAttribute("href") || "" : "";
    return /plugin_status=mustuse/i.test(href);
  }

  function parsePluginTable(doc, mustUse) {
    const plugins = [];
    const rows = doc.querySelectorAll("#the-list > tr[data-plugin]");
    for (const row of rows) {
      const file = row.getAttribute("data-plugin") || "";
      if (!file || file === "none") {
        continue;
      }
      const nameEl = row.querySelector(".plugin-title strong, strong");
      const name = text(nameEl) || file;
      const meta = text(row.querySelector(".plugin-version-author-uri"));
      const version = parseVersion(meta);
      let status = "inactive";
      if (mustUse || row.classList.contains("mustuse") || row.classList.contains("drop-ins")) {
        status = "active";
      } else if (row.classList.contains("active")) {
        status = /network[-\s]?active/i.test(row.textContent || "") ? "network-active" : "active";
      }
      plugins.push({
        name: name,
        file: file,
        version: version,
        status: status,
        mustUse: Boolean(mustUse),
      });
    }
    return plugins;
  }

  async function fetchHtml(path) {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}`);
    }
    const html = await response.text();
    return new DOMParser().parseFromString(html, "text/html");
  }

  async function scrapeMustUsePlugins() {
    const base = adminBase();
    const muDoc = await fetchHtml(`${base}/plugins.php?plugin_status=mustuse`);
    // WordPress falls back to the full "All" list when there are no must-use
    // plugins, so only trust this page if the Must-Use tab is actually current.
    if (!isMustUseView(muDoc)) {
      return [];
    }
    return parsePluginTable(muDoc, true);
  }

  async function scrapePlugins() {
    const base = adminBase();
    const allDoc = await fetchHtml(`${base}/plugins.php?plugin_status=all`);
    const plugins = parsePluginTable(allDoc, false);
    try {
      plugins.push.apply(plugins, await scrapeMustUsePlugins());
    } catch (_err) {
      /* must-use tab is optional */
    }
    return plugins;
  }

  function normalizeFile(file) {
    return String(file || "")
      .replace(/\.php$/i, "")
      .toLowerCase();
  }

  function dedupe(plugins) {
    const seen = Object.create(null);
    const out = [];
    for (const plugin of plugins) {
      const key = normalizeFile(plugin.file);
      if (!key) {
        continue;
      }
      if (!seen[key]) {
        seen[key] = plugin;
        out.push(plugin);
        continue;
      }
      // Same plugin from REST + a false must-use scrape: keep the REST row.
      if (seen[key].mustUse && !plugin.mustUse) {
        const index = out.indexOf(seen[key]);
        seen[key] = plugin;
        if (index >= 0) {
          out[index] = plugin;
        }
      }
    }
    return out;
  }

  try {
    if (!document.body || !document.body.classList.contains("wp-admin")) {
      return {
        ok: false,
        error: "This tab is not a WordPress admin screen. Open /wp-admin while logged in, then try again.",
      };
    }

    let plugins = [];
    let source = "dom";
    const settings = restSettings();
    if (settings.root) {
      try {
        plugins = await fetchRestPlugins(settings.root, settings.nonce);
        source = "rest";
      } catch (_err) {
        plugins = await scrapePlugins();
        source = "dom";
      }
    } else {
      plugins = await scrapePlugins();
    }

    if (source === "rest") {
      try {
        plugins.push.apply(plugins, await scrapeMustUsePlugins());
      } catch (_err) {
        /* must-use tab is optional */
      }
    }

    plugins = dedupe(plugins);
    if (!plugins.length) {
      return {
        ok: false,
        error: "No plugins found. You may not have permission to view plugins on this site.",
      };
    }

    return {
      ok: true,
      source: source,
      siteUrl: siteUrl(),
      siteName: siteName(),
      wpVersion: wpVersion(),
      collectedAt: new Date().toISOString(),
      plugins: plugins,
    };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
    };
  }
})();
