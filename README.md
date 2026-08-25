# MyHome new-apartment watcher

This program watches the supplied MyHome.ge Didi Dighomi rental search and the
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

Edit `dashboard.html` and `dashboard.css` to change the dashboard design. The
generated `live-results.html` is rebuilt automatically and should not be edited.
Open `live-results.html` (or `http://localhost:3000`) to view real scraper data;
opening `dashboard.html` directly shows only a design preview.

Refreshing the dashboard or restarting the watcher does not remove saved
apartments. Existing records are preserved even if the watcher state file must be
rebuilt or the district configuration changes.

Authenticated dashboard admins can paste another filtered MyHome URL, select
1–10 pages, set a polling interval (minimum 3 seconds), and pause or start MyHome
scraping. These controls are stored in `watcher-config.json` and survive restarts.
On Railway, `DASHBOARD_USER` and `DASHBOARD_PASSWORD` are required before the
settings endpoint accepts changes.
The same panel reports live scanning/import progress, listing counts, the last
successful completion time, pause state, and the latest scraper error.
The Stop button safely ends an active import after its current apartment, retains
all completed work, and leaves remaining IDs ready for the next Start.

## Start

Double-click **run.bat**. On its first run it installs Chromium, so setup can take
a few minutes. A browser window opens. If MyHome asks for a security check,
complete it once; the browser profile is kept in `.browser-profile` for later runs.

The first check imports every apartment found across the first five filtered
MyHome result pages. Later checks revisit those five pages and import any listing
ID that has not already been saved. Promoted and older listings are included;
exact listing IDs prevent duplicates. Press Ctrl+C in the terminal to stop.

## Command-line options

After setup, examples from this folder:

```powershell
node main.js --once
node main.js --interval 300 --pages 2
node main.js --url "https://www.myhome.ge/your-search-url" --pages 5
```

Paste the complete URL after applying any filters on MyHome. The watcher passes
all query-string filters to every page and changes only the `page` value. It scans
five pages by default; `--pages` accepts values from 1 through 10. Changing the
URL or page count updates the persisted search configuration. Every listing from
the selected page range is imported, not only newly posted listings.

By default, MyHome scans five pages each for Saburtalo, Vake, Didi Dighomi, and
Digomi. The dashboard buttons filter saved results by those districts.

## Website API integration

New MyHome apartments can be uploaded to the Website API and distributed in a
stable round-robin across all configured agents. Set:

```text
WEBSITE_API_URL=https://websiteapi-production-c970.up.railway.app
WEBSITE_API_EMAIL=agent@example.com
WEBSITE_API_PASSWORD=your_password
WEBSITE_API_AGENT_IDS=agent-id-1,agent-id-2,agent-id-3,agent-id-4,agent-id-5,agent-id-6,agent-id-7,agent-id-8
DASHBOARD_DISPLAY_USER=Administrator
```

The account must be able to log in and access both `/api/Agents` and
`/api/Apartments`. Uploaded records store their assigned agent locally, and failed
uploads are retried. If the credentials are omitted, API uploading is disabled.
Set `WEBSITE_API_AGENT_IDS` to control which agents participate and their assignment
order. Any positive number of agents is supported. If omitted, every agent returned
by `/api/Agents` is used. The scraper dashboard shows all apartments and the agent
ID assigned to each one; API-wide admin visibility is governed by the admin account's
permissions in the Website API.
The dashboard displays `DASHBOARD_DISPLAY_USER`, or the API login email when no
display name is configured, so viewers can see which account the scraper uses.

Do not poll aggressively. MyHome can change its layout or access controls; the
scraper reports individual listings it cannot parse and continues watching.

## Railway hosting

The included `Dockerfile` runs the watcher headlessly and serves the dashboard on
Railway's assigned `PORT`. Attach a Railway Volume at `/data`; the app automatically
uses `RAILWAY_VOLUME_MOUNT_PATH` for its seen IDs, CSV files, and browser profile.
The Volume is required for scraper history to survive Railway redeploys. Apartments
already uploaded to the Website API remain stored in that API's database as well.

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
