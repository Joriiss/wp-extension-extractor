# WP Plugin Inventory

Chrome / Edge extension for agencies that manage many WordPress sites.

Log into a site’s **wp-admin**, collect its plugins, repeat for the next site, then export one spreadsheet. No SSH, WP-CLI, or Application Passwords.

## Features

- Works from the WordPress session you already have
- Records plugin name, file, version, and status (active / inactive / network-active)
- Includes must-use plugins when that tab is actually in use (does not duplicate the normal plugin list)
- Stores results locally in the extension until you export or clear them
- Export CSV (Excel), a summary CSV, and JSON

## Install (unpacked)

The extension is not on the public Chrome Web Store. Load it locally:

1. Clone this repository
2. Open `chrome://extensions` (or `edge://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the [`extension`](extension) folder

To update after a `git pull`, open `chrome://extensions` and click **Reload** on WP Plugin Inventory.

## Usage

1. Log into a site’s `/wp-admin` as a user who can view plugins
2. Click the **WP Plugin Inventory** icon
3. Click **Collect plugins from this site**
4. Repeat for each site (collecting the same site again replaces the previous snapshot)
5. Click **Export CSV** or **Export JSON**

You must be on a `/wp-admin` page. The login screen is not enough.

### CSV columns

`wordpress-plugins-YYYY-MM-DD.csv`

| Column | Description |
| --- | --- |
| `site_name` | Name from the WordPress admin bar |
| `site_url` | Site origin |
| `wp_version` | WordPress version, when it can be read from admin |
| `collected_at` | ISO timestamp |
| `plugin_name` | Display name |
| `plugin_file` | Plugin file / slug |
| `version` | Installed version |
| `status` | `active`, `inactive`, or `network-active` |
| `must_use` | `yes` / `no` |
| `source` | `rest` or `dom` |

A second file, `wordpress-plugins-summary-YYYY-MM-DD.csv`, groups plugins across sites (how many installs, how many active, distinct versions).

## How it works

On the current tab, the extension:

1. Calls the WordPress REST API (`/wp-json/wp/v2/plugins`) with your logged-in cookie
2. If REST is blocked, reads `/wp-admin/plugins.php` instead
3. Adds must-use plugins only when WordPress is actually showing that list

Nothing is sent to a remote server. Data stays in `chrome.storage.local` on your machine.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Run only on the tab you click the extension on |
| `scripting` | Inject the collector into that wp-admin page |
| `storage` | Remember collected sites until you export or clear |

There is no `<all_urls>` host permission. The extension cannot read a site until you open wp-admin and click Collect.

## Repository layout

```
extension/
  manifest.json      Chrome Manifest V3
  popup.html         Popup UI
  popup.js           Collect, store, export
  popup.css
  collector.js       Injected into wp-admin
  icons/
```

Do not commit inventory exports (`*.csv`, `wordpress-plugins-*.json`). They often contain client site names and plugin lists.

## Chrome Web Store (optional)

To share it with colleagues without Developer mode, you can publish it **unlisted** on the Chrome Web Store (not searchable; install via the listing URL). That still requires a $5 developer account, a privacy policy URL, a demo WordPress login for reviewers, and Google’s review.

See [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish) and set **Visibility → Unlisted** on the Distribution tab.

## License

Add a `LICENSE` file before making the repository public if you want others to reuse this code (for example MIT).
