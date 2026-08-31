# MyHome new-apartment watcher

This program watches only the filtered MyHome.ge searches explicitly added by an
admin. Optional SS.ge scraping is disabled unless enabled by environment variable.
It opens every previously unseen listing, reveals the publicly available contact
phone, and saves:

- apartment ID and URL
- title
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
On Railway, users authenticate through the configured dashboard authentication
mode, and only accounts resolved as admins can change these settings.
The same panel reports live scanning/import progress, listing counts, the last
successful completion time, pause state, and the latest scraper error.
Each imported apartment is uploaded and assigned immediately instead of waiting
for the full page range to finish. Any older pending assignments are processed on
the next Start, and the admin panel shows their count plus API credential status.
Local agent ownership is committed before the Website API upload, in persistent
round-robin order. A street-catalog or network error therefore does not leave the
dashboard owner as `Pending`; the same agent is retained while the API upload
retries. Street resolution is intentionally not used. New scraped apartments are sent directly to `/api/Apartments`; street IDs are not required by this watcher.

Agents can review their assigned rows with a green checkmark or red ×. Rejecting
plays a red removal animation and persistently hides the apartment. Accepting
plays a green animation, opens a comment editor, and stores the comment plus the
reviewing account and time. The editor spans a separate row directly below the
apartment rather than expanding in the right-side action cell. It stays collapsed
on page load—even when a saved comment exists—and opens only when the green
checkmark beside the red × is clicked. The server prevents agents from reviewing another
agent's apartment; admins may review any row.
District filtering never opens comment rows, and the results table wraps long IDs
instead of forcing a horizontal scrollbar.

Admins and managers have an `Accepted apartments` management view at
`/?view=accepted`. Clicking ✓ immediately marks the apartment accepted. The Accepted apartments view is a strict accepted-only subset, while All apartments continues to show every non-rejected scraped apartment. The queue includes accepted apartments across every agent plus the saved
comment, reviewer email, and review time. Managers are restricted to this accepted
queue; admins can switch between all and accepted views.
The management navigation includes `Copy accepted links`, which copies every
accepted MyHome/SS.ge URL together with its saved comment. The accepted queue
shows comments and reviewer details directly to admins/managers, and clipboard
output uses a `link` line followed by `Comment: ...` for each apartment.
The Stop button safely ends an active import after its current apartment, retains
all completed work, leaves remaining IDs ready for the next Start, and pauses the
dashboard's three-second page refresh until scraping is started again.
Each active search badge has a remove button. Removing the final link pauses the
scraper; an empty saved search list stays empty after restarts until an admin
pastes and saves another filtered MyHome URL.

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

No district is scraped by default. After this configuration migration, the
watcher starts paused with an empty search list while preserving apartment
history. An admin must paste and save each desired filtered MyHome URL. SS.ge is
also disabled by default; set `ENABLE_SS_SCRAPER=true` only when it is explicitly
needed.
Admin controls include opt-in preset toggles for Saburtalo, Vake, Didi Dighomi,
and Digomi. A preset is added only when clicked, is highlighted while active, and
can be removed by clicking it again. Preset state uses the same persistent search
configuration as manually pasted URLs.

## Website API integration

Scraped MyHome and SS.ge records stay in the scraper's private dataset and are
never published to the Velven Apartments API. Website API credentials may still
be used for dashboard authentication, but they do not enable apartment uploads.

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

To let users sign in with their existing Website API email/password, use the
recommended API authentication mode:

```text
DASHBOARD_AUTH_MODE=api
WEBSITE_API_URL=https://websiteapi-production-c970.up.railway.app
DASHBOARD_ADMIN_EMAILS=admin@whitetower.com
```

The browser's Username field accepts the Website API email, and its Password field
accepts that user's existing Website API password. The scraper forwards them to
`/api/Auth/login` over HTTPS, keeps no password, reads `/api/Profile/me` and JWT
claims for identity/role, and caches only the resolved session identity for ten
minutes. `DASHBOARD_ADMIN_EMAILS` is a comma-separated fallback for admin accounts
if the API token does not include an admin role. Other authenticated users are
treated as agents and filtered by their authenticated user ID.

API clients may send the same Website API JWT as `Authorization: Bearer <token>`.
`POST /api/owners/upsert` accepts `{ "row": [...] }`, identifies the central
Administrator owner record by the first (owner ID) column, and atomically inserts
it or merges its non-empty values. This is the endpoint used by the browser
extension so uploads made while connected as an Agent still appear in the
Administrator Owners view and MyHome/SS.ge IDs safely accumulate in one row.
The first Administrator read migrates rows written by older per-account versions
into this central database.

For recovery and backward compatibility, API mode also accepts a matching legacy
`DASHBOARD_USER`/`DASHBOARD_PASSWORD` or `DASHBOARD_ACCOUNTS` entry if Website API
authentication rejects those credentials.

For separate dashboard-only passwords, set `DASHBOARD_AUTH_MODE=accounts` and use
`DASHBOARD_ACCOUNTS` instead. Store it as one JSON-line Railway variable:

```json
[{"email":"admin@example.com","password":"unique-admin-password","role":"admin","name":"Administrator"},{"email":"agent1@example.com","password":"unique-agent-password","role":"agent","agentId":"agent-user-id-1","name":"Agent 1"},{"email":"agent2@example.com","password":"unique-agent-password","role":"agent","agentId":"agent-user-id-2","name":"Agent 2"}]
```

Each email/password works in the browser sign-in popup (enter the email in its
Username field). Admins see all apartments, scraper controls, and CSV downloads.
Agents see only apartments whose `assigned_agent_id` matches their `agentId`, and
server-side authorization blocks them from changing controls or downloading the
full CSV. Dashboard passwords should be unique and should not reuse Website API
account passwords. When `DASHBOARD_ACCOUNTS` is set, it replaces the legacy single
`DASHBOARD_USER`/`DASHBOARD_PASSWORD` login.

After deployment, generate a public domain under the service's Networking settings.
The dashboard is at `/`, with CSV downloads at `/apartments.csv` and
`/ss-apartments.csv`. The first hosted start creates a fresh silent baseline unless
you copy the local JSON data into the Railway volume.
"# GTX_LIVE_WEB_SCRAPER" 


## Dashboard/API behavior update

- The dashboard apartment table no longer shows street/address data.
- `All apartments` contains every non-rejected scraped apartment, including accepted ones.
- `Accepted apartments` contains only rows marked accepted with ✓.
- Every newly scraped MyHome apartment is sent immediately to the Website API.
- When SS.ge scraping is enabled, newly scraped SS.ge apartments are also sent immediately to the Website API.
- Website uploads do not resolve or require StreetId.
- The dashboard Website column shows Uploaded, Pending, or Retrying so API synchronization is visible.
