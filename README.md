# MyHome new-apartment watcher

This program watches the supplied MyHome.ge Saburtalo rental search and the
configured SS.ge owner-only Vake-Saburtalo rental search. It opens every previously
unseen listing, reveals the publicly available contact phone, and saves:

- apartment ID and URL
- title and address
- phone number
- price
- room and bedroom counts
- area, floor, and total floors
- posted time, description, and first-seen time

MyHome results are stored in `apartments.csv`; SS.ge results are stored in
`ss-apartments.csv`. Their JSON files are the deduplication databases.
The Chrome window shows `live-results.html`, which refreshes itself every three
seconds so newly found rows appear without reopening Excel.

## Start

Double-click **run.bat**. On its first run it installs Chromium, so setup can take
a few minutes. A browser window opens. If MyHome asks for a security check,
complete it once; the browser profile is kept in `.browser-profile` for later runs.

The first check silently records the current results as a baseline. It does not
open, announce, or export those older listings. Every five seconds the watcher
merges MyHome's first three feed segments, which cover S-VIP, VIP+, VIP, and the
newest ordinary listings. It uses the exact listing ID and original listing age,
not visual position, so old promoted/pinned results are ignored. Press Ctrl+C in
the terminal to stop.

## Command-line options

After setup, examples from this folder:

```powershell
node main.js --once
node main.js --interval 300 --pages 2
node main.js --url "https://www.myhome.ge/your-search-url"
```

Do not poll aggressively. MyHome can change its layout or access controls; the
scraper reports individual listings it cannot parse and continues watching.

## Railway hosting

The included `Dockerfile` runs the watcher headlessly and serves the dashboard on
Railway's assigned `PORT`. Attach a Railway Volume at `/data`; the app automatically
uses `RAILWAY_VOLUME_MOUNT_PATH` for its seen IDs, CSV files, and browser profile.

Recommended service variables:

```text
DASHBOARD_USER=your_username
DASHBOARD_PASSWORD=a_long_random_password
```

After deployment, generate a public domain under the service's Networking settings.
The dashboard is at `/`, with CSV downloads at `/apartments.csv` and
`/ss-apartments.csv`. The first hosted start creates a fresh silent baseline unless
you copy the local JSON data into the Railway volume.
"# GTX_LIVE_WEB_SCRAPER" 
