'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { hasExcludedDescription } = require('./description-filter');

const DISTRICT_SEARCHES = [];
const SEARCH_PRESETS = [
  { district: 'Saburtalo', url: 'https://www.myhome.ge/udzravi-qoneba/qiravdeba/bina/tbilisi/saburtalo/?deal_types=2&real_estate_types=1&cities=1&urbans=47&districts=4&currency_id=1&CardView=1&page=1&owner_type=physical' },
  { district: 'Vake', url: 'https://www.myhome.ge/udzravi-qoneba/qiravdeba/bina/tbilisi/vake/?deal_types=2&real_estate_types=1&cities=1&urbans=38&districts=4&currency_id=1&CardView=1&page=1&owner_type=physical' },
  { district: 'Didi Dighomi', url: 'https://www.myhome.ge/udzravi-qoneba/qiravdeba/bina/tbilisi/didi-dighomi/?deal_types=2&real_estate_types=1&cities=1&urbans=29&districts=4&currency_id=1&CardView=1&page=1&owner_type=physical' },
  { district: 'Digomi', url: 'https://www.myhome.ge/udzravi-qoneba/qiravdeba/bina/tbilisi/digomi/?deal_types=2&real_estate_types=1&cities=1&urbans=24&districts=4&currency_id=1&CardView=1&page=1&owner_type=physical' }
];
const WEBSITE_API_URL = process.env.WEBSITE_API_URL || 'https://websiteapi-production-c970.up.railway.app';
const SS_URL = 'https://home.ss.ge/ka/udzravi-qoneba/l/bina/qiravdeba?cityIdList=95&subdistrictIds=2%2C3%2C4%2C5%2C26%2C27%2C44%2C45%2C46%2C47%2C48%2C49%2C50&currencyId=1&advancedSearch=%7B%22individualEntityOnly%22%3Atrue%7D';
const ROOT = __dirname;
const DATA_ROOT = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || ROOT;
fs.mkdirSync(DATA_ROOT, { recursive: true });
const DATA_PATH = path.join(DATA_ROOT, 'apartments.json');
const CSV_PATH = path.join(DATA_ROOT, 'apartments.csv');
const SS_DATA_PATH = path.join(DATA_ROOT, 'ss-apartments.json');
const SS_CSV_PATH = path.join(DATA_ROOT, 'ss-apartments.csv');
const DASHBOARD_PATH = path.join(DATA_ROOT, 'live-results.html');
const DASHBOARD_TEMPLATE_PATH = path.join(ROOT, 'dashboard.html');
const DASHBOARD_CSS_PATH = path.join(ROOT, 'dashboard.css');
const FAVICON_PATH = path.join(ROOT, 'favicon.svg');
const STATE_PATH = path.join(DATA_ROOT, 'watcher-state.json');
const WATCHER_CONFIG_PATH = path.join(DATA_ROOT, 'watcher-config.json');
const OWNERS_PATH = path.join(DATA_ROOT, 'owners.json');
const ADMIN_OWNERS_PATH = path.join(DATA_ROOT, 'owners-admin.json');
const PROFILE_PATH = process.env.WATCHER_PROFILE || path.join(DATA_ROOT, '.browser-profile');
const IS_HOSTED = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
const SS_SCRAPER_ENABLED = String(process.env.ENABLE_SS_SCRAPER || '').toLowerCase() === 'true';

const FIELDS = [
  'apartment_id', 'district', 'assigned_agent_id', 'title', 'phone', 'price', 'rooms', 'bedrooms', 'area_m2',
  'floor', 'total_floors', 'posted', 'description', 'url', 'first_seen'
];
// MyHome has used both /udzravi-qoneba/25764728/... and
// /udzravi-qoneba/qiravdeba-...-25764728/ detail URL formats.
const LISTING_RE = /\/udzravi-qoneba\/(?:([0-9]+)(?:\/|\?|$)|[^/?#]*-([0-9]+)(?:\/|\?|$))/i;
const MOBILE_RE = /(?:^|\D)(?:(?:\+|00)?995[\s-]?)?(5\d{2})[\s-]?(\d{2})[\s-]?(\d{2})[\s-]?(\d{2})(?!\d)/;
const AREA_RE = /(\d+(?:[.,]\d+)?)\s*(?:m²|m2|მ²)/i;
const ROOM_RE = /(\d+\+?)\s*(?:ოთახი|ოთახიანი|room(?:s)?|комнат)/i;
const BEDROOM_RE = /(\d+\+?)\s*(?:საძინებელი|bedroom(?:s)?|спальн)/i;
const FLOOR_RE = /(\d+)\s*(?:სართული|floor|этаж)\s*\/\s*(\d+)/i;
const FLOOR_PAIR_RE = /(?:^|\D)(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/;
const PRICE_RE = /(?:[$€₾]\s*[\d,.]+|[\d,.]+\s*(?:₾|GEL|USD|EUR|ლარი|დოლარი))/i;
const DATE_RE = /(?:\d{1,2}[:.]\d{2}|\d{1,2}\s+(?:იან|თებ|მარ|აპრ|მაი|ივნ|ივლ|აგვ|სექ|ოქტ|ნოე|დეკ|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/i;
const REVEAL_RE = /(ტელეფონ|ნომრის ნახვა|ნომერი|show phone|show number|phone|показать номер|телефон)/i;
let ssAuthToken = '';
let websiteApiToken = '';
let websiteApiAgents = [];
let dashboardUploadAgents = [];
let dashboardUploadsRefreshedAt = 0;
let dashboardUploadsRefreshPromise = null;
let watcherRuntime = null;
let liveMyHomeData = null;
let liveSsData = null;
const watcherStatus = {
  state: 'starting', message: 'Starting scraper…', found: 0, imported: 0,
  importTotal: 0, lastStartedAt: null, lastCompletedAt: null, lastError: null
};
const dashboardApiSessions = new Map();

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clearLegacyStreetUploadErrors(data) {
  let changed = 0;
  for (const item of Object.values(data)) {
    if (!item._api_uploaded && /canonical street|resolve-street|street[_-]?id|street-name/i.test(String(item._api_error || ''))) {
      delete item._api_error;
      changed += 1;
    }
  }
  return changed;
}

function clearLegacyStreetData(data) {
  let changed = 0;
  for (const item of Object.values(data)) {
    if (Object.prototype.hasOwnProperty.call(item, 'address')) {
      delete item.address;
      changed += 1;
    }
  }
  return changed;
}

function markExcludedDescriptions(data) {
  let count = 0;
  for (const item of Object.values(data)) {
    if (hasExcludedDescription(item.description)) {
      item._baseline = true;
      item._excluded = true;
      count += 1;
    }
  }
  return count;
}

function match(pattern, text, group = 1) {
  const found = String(text ?? '').match(pattern);
  return found ? clean(found[group]) : '';
}

function normalizePhone(value) {
  const found = String(value ?? '').match(MOBILE_RE);
  return found ? `+995${found.slice(1).join('')}` : '';
}

function normalizeContactPhone(value) {
  const georgian = normalizePhone(value);
  if (georgian) return georgian;
  const international = String(value ?? '').match(/(?:^|\D)(\+[1-9](?:[\s()-]*\d){7,14})(?!\d)/);
  return international ? international[1].replace(/[^+\d]/g, '') : '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const options = { searches: DISTRICT_SEARCHES, interval: 3, pages: 5, once: false, headless: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--once') options.once = true;
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--url') options.searches = [{ district: 'Custom', url: argv[++i] }];
    else if (arg === '--interval') options.interval = Number(argv[++i]);
    else if (arg === '--pages') options.pages = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node main.js [--once] [--interval 3] [--pages 5] [--url URL] [--headless]');
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!Number.isFinite(options.interval) || options.interval < 3) {
    throw new Error('--interval must be at least 3 seconds');
  }
  if (!Number.isInteger(options.pages) || options.pages < 1 || options.pages > 10) {
    throw new Error('--pages must be a whole number between 1 and 10');
  }
  return options;
}

function pageUrl(base, number) {
  const url = new URL(base);
  url.searchParams.set('page', String(number));
  return url.toString();
}

function loadData() {
  if (!fs.existsSync(DATA_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read apartments.json: ${error.message}`);
  }
}

function loadSsData() {
  if (!fs.existsSync(SS_DATA_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SS_DATA_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ss-apartments.json: ${error.message}`);
  }
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { initialized: false };
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { initialized: false };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function html(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return {}; }
}

const OWNER_HEADERS = ['მესაკუთრის ID', 'მესაკუთრის ნომერი', 'უბანი', 'ოთახები და საძინებელი', 'კვადრატულობა', 'ფასი', 'ჩემი ID MYHOME', 'ჩემი ID SS.GE', 'კომენტარი/შეთანხმება'];

const DEFAULT_OWNERS = {
  headers: OWNER_HEADERS,
  rows: [
    ['25727280', '555 911 019', 'საბურთალო', '3 ოთახი 2 საძ', '90 კვ', '750$', '25735017', '36412922', 'ინდივიდი არ არის შეთანხმებული'],
    ['25727267', '575 750 160', 'საბურთალო', '2 ოთახი 1 საძ', '56 კვ', '700$', '25735131', '36413137', 'ინდივიდი და არ არის'],
    ['18448245', '595 754 645', 'საბურთალო', '3 ოთახი 2 საძ', '90 კვ', '1500$', '25728442', '36413248', 'რუსები და ცხოველები შეთანხმდება'],
    ['25676903', '599 270 209', 'საბურთალო', '3 ოთახი 2 საძ', '86 კვ', '1300$', '25729067', '36413817', 'სტანდარტული შეთანხმება'],
    ['25635438', '598 107 830', 'საბურთალო', '2 ოთახი 1 საძ', '60 კვ', '650$', '25730804', '36416280', 'მოკლედ სტანდარტული შეთანხმება'],
    ['25635442', '557 112 221', 'საბურთალო', '3 ოთახი 2 საძ', '79 კვ', '800$', '25731218', '36416719', 'სტანდარტული შეთანხმება'],
    ['25690933', '555 478 767', 'საბურთალო', '4 ოთახი 3 საძ', '140 კვ', '1400$', '25732203', '36417844', 'სტანდარტული შეთანხმება'],
    ['25568180', '593 644 173', 'საბურთალო', '3 ოთახი 1 საძ', '60 კვ', '750$', '25735396', '36417892', 'შეთანხმება ცხოველებზე'],
    ['25709538', '591 410 500', 'საბურთალო', '3 ოთახი 2 საძ', '63 კვ', '700$', '25735514', '36417947', 'დავუკავშირდეთ შეთანხმებისთვის'],
    ['25595443', '591 995 594', 'საბურთალო', '2 ოთახი 1 საძ', '54 კვ', '500$', '25735629', '36417988', 'სტანდარტული შეთანხმება']
  ]
};

function ownerAccountKey(viewer) {
  const identity = clean(viewer?.email || viewer?.agentId || viewer?.name || 'local-viewer').toLowerCase();
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

function ownersPathFor(viewer) {
  if (viewer?.role === 'admin') return ADMIN_OWNERS_PATH;
  return path.join(DATA_ROOT, `owners-${ownerAccountKey(viewer)}.json`);
}

function myHomePhoneInfo(source = {}) {
  const values = [source.user_phone_number, source.additional_phone_number, source.comment];
  for (const value of values) {
    const phone = normalizeContactPhone(value);
    if (phone) return { phone, masked: '' };
  }
  const masked = values.map(clean).find(value => /5\d{5}[\s-]*\*{3}/.test(value)) || '';
  return { phone: '', masked };
}

function normalizedOwnersData(saved) {
  if (!Array.isArray(saved.rows)) return { headers: OWNER_HEADERS, rows: [] };
  const savedHeaders = Array.isArray(saved.headers) ? saved.headers.map(clean) : [];
  const rows = saved.rows.map(row => OWNER_HEADERS.map((header, columnIndex) => {
    const matchingIndex = savedHeaders.indexOf(header);
    const sourceIndex = matchingIndex >= 0 ? matchingIndex : columnIndex;
    return clean(Array.isArray(row) ? row[sourceIndex] : '');
  }));
  return { headers: OWNER_HEADERS, rows };
}

function mergeOwnerRows(targetRows, sourceRows) {
  const merged = targetRows.map(row => [...row]);
  const indexes = new Map(merged.map((row, index) => [clean(row[0]), index]).filter(([ownerId]) => ownerId));
  for (const source of sourceRows) {
    const incoming = OWNER_HEADERS.map((_, index) => clean(source[index]));
    const ownerId = incoming[0];
    if (!ownerId) continue;
    const existingIndex = indexes.get(ownerId);
    if (existingIndex == null) {
      indexes.set(ownerId, merged.length);
      merged.push(incoming);
    } else {
      merged[existingIndex] = OWNER_HEADERS.map((_, columnIndex) => incoming[columnIndex] || merged[existingIndex][columnIndex]);
    }
  }
  return merged;
}

function ownersData(viewer) {
  const accountPath = ownersPathFor(viewer);
  if (viewer?.role === 'admin' && !fs.existsSync(accountPath)) {
    let rows = [];
    const legacyPaths = fs.readdirSync(DATA_ROOT)
      .filter(name => /^owners-[a-f0-9]{24}\.json$/i.test(name))
      .map(name => path.join(DATA_ROOT, name));
    if (fs.existsSync(OWNERS_PATH)) legacyPaths.unshift(OWNERS_PATH);
    for (const legacyPath of legacyPaths) rows = mergeOwnerRows(rows, normalizedOwnersData(readJsonFile(legacyPath)).rows);
    fs.writeFileSync(accountPath, JSON.stringify({ headers: OWNER_HEADERS, rows }, null, 2), 'utf8');
    return { headers: OWNER_HEADERS, rows };
  }
  return normalizedOwnersData(readJsonFile(accountPath));
}

function buildOwnersContent(viewer) {
  const data = ownersData(viewer);
  const head = `${data.headers.map(header => `<th>${html(header)}</th>`).join('')}<th class="owner-actions-column">Actions</th>`;
  const rows = data.rows.map((row, rowIndex) => `<tr data-owner-row="${rowIndex}">${data.headers.map((_, columnIndex) => `<td class="owner-cell" contenteditable="true" spellcheck="false" data-owner-index="${rowIndex}" data-owner-column="${columnIndex}">${html(row[columnIndex] ?? '')}</td>`).join('')}<td class="owner-row-actions"><button class="owner-remove" type="button" data-owner-index="${rowIndex}" aria-label="Remove owner row">Remove</button></td></tr>`).join('\n');
  return `<section class="owners-panel" aria-labelledby="owners-title">
    <div class="owners-toolbar">
      <div><p class="eyebrow">Owner database</p><h2 id="owners-title">Owners</h2><p id="owners-import-status">${data.rows.length} saved row(s)</p></div>
      <div class="owners-actions">
        <input id="owners-file" type="file" accept=".xlsx,.xls,.csv" hidden>
        <button id="owners-add-row" type="button">Add row</button>
        <button id="owners-import" class="save-button" type="button">Import Excel</button>
        <button id="owners-append" type="button">Append Excel</button>
        <button id="owners-remove-all" type="button">Remove all</button>
      </div>
    </div>
    <div class="owners-table-wrap"><table class="owners-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>
  </section>`;
}

function buildDashboard(viewer = null, view = 'all') {
  let combined = [
    ...Object.values(readJsonFile(DATA_PATH)).map(item => ({ ...item, source: item.source || 'MyHome' })),
    ...Object.values(readJsonFile(SS_DATA_PATH)).map(item => ({ ...item, source: 'SS.ge' }))
  ].filter(item => !item._baseline && !item._excluded && item._review_status !== 'rejected' && !hasExcludedDescription(item.description))
    .sort((a, b) => String(b.first_seen).localeCompare(String(a.first_seen)));
  if (viewer?.role === 'agent') {
    combined = combined.filter(item =>
      String(item.assigned_agent_id || '') === String(viewer.agentId || '') &&
      (view === 'accepted' ? item._review_status === 'accepted' : item._review_status !== 'accepted')
    );
  } else if (view === 'accepted' || viewer?.role === 'manager') {
    combined = combined.filter(item => item._review_status === 'accepted');
  }
  const showManagementComments = view === 'accepted' || viewer?.role === 'manager';

  const rows = combined.map(item => {
    const websiteStatus = item._api_uploaded
      ? `<span class="website-upload uploaded">Uploaded${item._website_api_apartment_id ? ` #${html(item._website_api_apartment_id)}` : ''}</span>`
      : item._api_error
        ? `<span class="website-upload error" title="${html(item._api_error)}">Retrying</span>`
        : '<span class="website-upload pending">Pending</span>';
    return `<tr data-apartment-id="${html(item.apartment_id)}" data-district="${html(item.district || 'Other')}" class="apartment-row ${item._review_status === 'accepted' ? 'review-accepted' : ''}">
      <td><span class="source ${item.source === 'SS.ge' ? 'ss' : ''}">${html(item.source)}</span></td>
      <td>${html(item.apartment_id)}</td>
      <td>${html(item.district || 'Other')}</td>
      <td>${html(item.assigned_agent_name || item.assigned_agent_id || 'Pending')}</td>
      <td>${html(item.rooms || '—')}</td>
      <td>${html(item.bedrooms || '—')}</td>
      <td>${html(item.area_m2 ? `${item.area_m2} m²` : '—')}</td>
      <td>${html(item.floor ? `${item.floor}${item.total_floors ? ` / ${item.total_floors}` : ''}` : '—')}</td>
      <td class="price">${html(item.price || '—')}</td>
      <td class="${item.phone ? '' : 'masked-phone'}">${html(item.phone || item._masked_phone || '—')}</td>
      <td><a class="listing-link" href="${html(item.url)}" target="_blank" rel="noopener noreferrer">Open listing ↗</a></td>
      <td>${websiteStatus}</td>
      ${showManagementComments ? `<td class="accepted-agent"><strong>${html(item._reviewed_by || 'Unknown agent')}</strong><small>${item._reviewed_at ? html(item._reviewed_at) : ''}</small></td><td class="management-comment"><strong>${html(item._review_comment || '—')}</strong></td>` : ''}
      <td class="review-cell">
        <div class="review-buttons">
          ${view === 'accepted' ? '' : `<button class="review-button accept-button${item._review_status === 'accepted' ? ' selected' : ''}" type="button" title="${item._review_status === 'accepted' ? 'Accepted' : 'Accept apartment'}" aria-label="Accept apartment" aria-pressed="${item._review_status === 'accepted' ? 'true' : 'false'}">✓</button>`}
          <button class="review-button reject-button" type="button" title="Reject apartment" aria-label="Reject apartment">×</button>
        </div>
      </td>
    </tr>`;
  }).join('\n');

  if (!fs.existsSync(DASHBOARD_TEMPLATE_PATH)) {
    throw new Error(`Dashboard template is missing: ${DASHBOARD_TEMPLATE_PATH}`);
  }
  const content = view === 'owners' ? buildOwnersContent(viewer) : combined.length
    ? `<table><thead><tr><th>Source</th><th>ID</th><th>District</th><th>Assigned agent</th><th>Rooms</th><th>Bedrooms</th><th>Area</th><th>Floor</th><th>Price</th><th>Phone</th><th>Link</th><th>Website</th>${showManagementComments ? '<th>Accepted by</th><th>Comment</th>' : ''}<th>Review</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">Waiting for a new apartment…</div>';
  const document = fs.readFileSync(DASHBOARD_TEMPLATE_PATH, 'utf8')
    .replace('{{LISTING_COUNT}}', String(view === 'owners' ? ownersData(viewer).rows.length : combined.length))
    .replace('{{LOGGED_IN_AS}}', html(viewer?.name || viewer?.email || process.env.DASHBOARD_DISPLAY_USER || process.env.WEBSITE_API_EMAIL || 'Local viewer'))
    .replace('{{LOGGED_IN_ROLE}}', html(viewer?.role || 'admin'))
    .replace('{{CURRENT_VIEW}}', view === 'owners' ? 'owners' : (view === 'accepted' || viewer?.role === 'manager' ? 'accepted' : 'all'))
    .replace('{{DASHBOARD_CONTENT}}', content);
  return document;
}

function writeDashboard() {
  const document = buildDashboard();
  fs.writeFileSync(DASHBOARD_PATH, document, 'utf8');
}

function dashboardAccounts() {
  if (process.env.DASHBOARD_ACCOUNTS) {
    let accounts;
    try { accounts = JSON.parse(process.env.DASHBOARD_ACCOUNTS); } catch { throw new Error('DASHBOARD_ACCOUNTS must be valid JSON'); }
    if (!Array.isArray(accounts)) throw new Error('DASHBOARD_ACCOUNTS must be a JSON array');
    return accounts.map(account => ({
      email: clean(account.email).toLowerCase(),
      password: String(account.password || ''),
      role: ['admin', 'manager'].includes(String(account.role || '').toLowerCase()) ? String(account.role).toLowerCase() : 'agent',
      agentId: String(account.agentId || ''),
      name: clean(account.name || account.email)
    })).filter(account => account.email && account.password && (['admin', 'manager'].includes(account.role) || account.agentId));
  }
  if (process.env.DASHBOARD_USER && process.env.DASHBOARD_PASSWORD) {
    return [{ email: process.env.DASHBOARD_USER.toLowerCase(), password: process.env.DASHBOARD_PASSWORD, role: 'admin', agentId: '', name: process.env.DASHBOARD_DISPLAY_USER || process.env.DASHBOARD_USER }];
  }
  return [];
}

function rejectDashboardLogin(response) {
  response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Apartment Watcher"' });
  response.end('Authentication required');
  return null;
}

function tokenFromPayload(payload) {
  return payload?.token || payload?.accessToken || payload?.access_token || payload?.jwt || payload?.data?.token || payload?.data?.accessToken || '';
}

function decodeJwt(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

function dashboardIdentity(payload, profile, email, token) {
  const claims = decodeJwt(token);
  const user = profile?.data?.user || profile?.user || profile?.data || profile || payload?.user || payload?.data?.user || {};
  const claimEmail = claims.email || claims.unique_name || claims['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] || '';
  const roleValue = user.role || user.crmRole || payload?.role || payload?.data?.role || claims.role || claims['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] || '';
  const roles = Array.isArray(roleValue) ? roleValue : [roleValue];
  const adminEmails = String(process.env.DASHBOARD_ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const role = roles.some(value => /admin/i.test(String(value))) || adminEmails.includes(email.toLowerCase())
    ? 'admin' : roles.some(value => /manager/i.test(String(value))) ? 'manager' : 'agent';
  const agentId = String(user.userId || user.user_id || claims.sub || claims.nameid || claims['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] || user.id || '');
  return {
    email: clean(user.email || claimEmail || email).toLowerCase(),
    name: clean(user.fullName || user.name || user.displayName || claims.name || email),
    role,
    agentId
  };
}

async function authenticateViaWebsiteApi(email, password, cacheKey) {
  const cached = dashboardApiSessions.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.account;
  const loginResponse = await fetch(`${WEBSITE_API_URL}/api/Auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  if (!loginResponse.ok) return null;
  const payload = await loginResponse.json();
  const token = tokenFromPayload(payload);
  if (!token) return null;
  const profileResponse = await fetch(`${WEBSITE_API_URL}/api/Profile/me`, { headers: { authorization: `Bearer ${token}` } });
  const profile = profileResponse.ok ? await profileResponse.json().catch(() => ({})) : {};
  const account = dashboardIdentity(payload, profile, email, token);
  if (account.role === 'agent' && !account.agentId) return null;
  dashboardApiSessions.set(cacheKey, { account, expiresAt: Date.now() + 10 * 60 * 1000 });
  return account;
}

async function authenticateBearerViaWebsiteApi(token) {
  const cacheKey = crypto.createHash('sha256').update(`bearer:${token}`).digest('hex');
  const cached = dashboardApiSessions.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.account;
  const profileResponse = await fetch(`${WEBSITE_API_URL}/api/Profile/me`, { headers: { authorization: `Bearer ${token}` } });
  if (!profileResponse.ok) return null;
  const profile = await profileResponse.json().catch(() => ({}));
  const claims = decodeJwt(token);
  const email = clean(claims.email || claims.unique_name || claims['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] || claims.sub);
  const account = dashboardIdentity({}, profile, email, token);
  if (!account.email || (account.role === 'agent' && !account.agentId)) return null;
  dashboardApiSessions.set(cacheKey, { account, expiresAt: Date.now() + 10 * 60 * 1000 });
  return account;
}

async function authenticateDashboard(request, response) {
  const accounts = dashboardAccounts();
  const apiMode = String(process.env.DASHBOARD_AUTH_MODE || 'api').toLowerCase() === 'api';
  if (!apiMode && !accounts.length && !IS_HOSTED) return { email: 'local', role: 'admin', agentId: '', name: 'Local admin' };
  const supplied = request.headers.authorization || '';
  if (apiMode && supplied.startsWith('Bearer ')) {
    const token = supplied.slice(7).trim();
    if (!token) return rejectDashboardLogin(response);
    return await authenticateBearerViaWebsiteApi(token) || rejectDashboardLogin(response);
  }
  let credentials = '';
  try { if (supplied.startsWith('Basic ')) credentials = Buffer.from(supplied.slice(6), 'base64').toString('utf8'); } catch { /* Reject below. */ }
  const separator = credentials.indexOf(':');
  const email = separator >= 0 ? credentials.slice(0, separator).toLowerCase() : '';
  const password = separator >= 0 ? credentials.slice(separator + 1) : '';
  if (apiMode) {
    if (!email || !password) return rejectDashboardLogin(response);
    const cacheKey = crypto.createHash('sha256').update(supplied).digest('hex');
    const account = await authenticateViaWebsiteApi(email, password, cacheKey);
    if (account) return account;
    const fallbackAccount = accounts.find(candidate => candidate.email === email && candidate.password === password);
    return fallbackAccount || rejectDashboardLogin(response);
  }
  const account = accounts.find(candidate => candidate.email === email && candidate.password === password);
  if (account) return account;
  return rejectDashboardLogin(response);
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 5_000_000) reject(new Error('Request body is too large'));
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON body')); }
    });
    request.on('error', reject);
  });
}

function publicWatcherConfig(viewer = { role: 'admin' }) {
  const apiEnabled = Boolean(process.env.WEBSITE_API_EMAIL && process.env.WEBSITE_API_PASSWORD);
  const savedApartments = viewer.role === 'admin'
    ? [...Object.values(readJsonFile(DATA_PATH)), ...Object.values(readJsonFile(SS_DATA_PATH))]
    : [];
  const pendingAssignments = viewer.role === 'admin'
    ? savedApartments.filter(item => !item._baseline && !item._excluded && !item._api_uploaded && !hasExcludedDescription(item.description)).length
    : 0;
  const assignmentError = savedApartments.find(item => item._api_error)?._api_error || null;
  return {
    enabled: watcherRuntime.enabled,
    pages: watcherRuntime.pages,
    interval: watcherRuntime.interval,
    searches: viewer.role === 'admin' ? watcherRuntime.searches : [],
    presets: viewer.role === 'admin' ? SEARCH_PRESETS : [],
    status: watcherStatus,
    canAdmin: viewer.role === 'admin',
    canManage: viewer.role === 'admin' || viewer.role === 'manager',
    viewer: { email: viewer.email, name: viewer.name, role: viewer.role, agentId: viewer.agentId },
    assignment: { enabled: apiEnabled, pending: pendingAssignments, lastError: assignmentError }
  };
}

async function updateWatcherConfig(request, response) {
  try {
    const body = await readRequestJson(request);
    if (typeof body.enabled === 'boolean') {
      watcherRuntime.enabled = body.enabled;
      if (!body.enabled) {
        watcherStatus.state = 'stopping';
        watcherStatus.message = 'Stopping after the current apartment…';
      } else if (watcherStatus.state === 'paused' || watcherStatus.state === 'stopping') {
        watcherStatus.state = 'starting';
        watcherStatus.message = 'Scraper will start on the next check…';
      }
    }
    if (body.pages != null) {
      const pages = Number(body.pages);
      if (!Number.isInteger(pages) || pages < 1 || pages > 10) throw new Error('Pages must be between 1 and 10');
      watcherRuntime.pages = pages;
    }
    if (body.interval != null) {
      const interval = Number(body.interval);
      if (!Number.isFinite(interval) || interval < 3 || interval > 3600) throw new Error('Interval must be between 3 and 3600 seconds');
      watcherRuntime.interval = interval;
    }
    if (body.url) {
      const url = validateMyHomeUrl(body.url);
      const district = clean(body.district) || districtNameFromUrl(url);
      const canonical = searchKey(url, watcherRuntime.pages).split('|pages=')[0];
      const existing = watcherRuntime.searches.find(search => searchKey(search.url, watcherRuntime.pages).split('|pages=')[0] === canonical);
      if (existing) Object.assign(existing, { district, url });
      else watcherRuntime.searches.push({ district, url });
    }
    if (body.removeUrl) {
      const removeUrl = validateMyHomeUrl(body.removeUrl);
      const canonical = searchKey(removeUrl, watcherRuntime.pages).split('|pages=')[0];
      watcherRuntime.searches = watcherRuntime.searches.filter(search =>
        searchKey(search.url, watcherRuntime.pages).split('|pages=')[0] !== canonical
      );
      if (!watcherRuntime.searches.length) watcherRuntime.enabled = false;
      watcherStatus.state = watcherRuntime.searches.length && watcherRuntime.enabled ? 'starting' : 'paused';
      watcherStatus.message = watcherRuntime.searches.length
        ? 'Search removed. Refreshing the active district queue…'
        : 'No MyHome search links configured.';
    }
    if (watcherRuntime.enabled && !watcherRuntime.searches.length) {
      watcherRuntime.enabled = false;
      throw new Error('Add a filtered MyHome URL before starting the scraper');
    }
    saveWatcherConfig(watcherRuntime);
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(publicWatcherConfig()));
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: error.message }));
  }
}

async function reviewApartment(request, response, viewer, apartmentId) {
  try {
    if (!/^\d+$/.test(apartmentId)) throw new Error('Invalid apartment ID');
    const body = await readRequestJson(request);
    if (!['accepted', 'rejected', 'manager-selection'].includes(body.action)) throw new Error('Invalid review action');
    const comment = clean(body.comment || '').slice(0, 2000);
    const myHomeData = liveMyHomeData || loadData();
    const ssData = liveSsData || loadSsData();
    const data = myHomeData[apartmentId] ? myHomeData : ssData;
    const item = data[apartmentId];
    if (!item) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Apartment not found' }));
      return;
    }
    if (!['admin', 'manager'].includes(viewer.role) &&
        String(item.assigned_agent_id || '') !== String(viewer.agentId || '')) {
      response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'This apartment is assigned to another agent' }));
      return;
    }
    if (body.action === 'manager-selection') {
      if (!['admin', 'manager'].includes(viewer.role)) {
        response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Management access is required' }));
        return;
      }
      item._manager_selected = body.selected === true;
      item._manager_selected_by = viewer.email;
      item._manager_selected_at = new Date().toISOString();
      if (data === myHomeData) saveData(data);
      else saveData(data, SS_DATA_PATH, SS_CSV_PATH);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true, selected: item._manager_selected }));
      return;
    }
    item._review_status = body.action;
    item._review_comment = comment;
    item._reviewed_by = viewer.name || viewer.email;
    item._reviewed_by_email = viewer.email;
    item._reviewed_at = new Date().toISOString();
    if (data === myHomeData) saveData(data);
    else saveData(data, SS_DATA_PATH, SS_CSV_PATH);
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, status: item._review_status, comment: item._review_comment }));
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: error.message }));
  }
}

function startWebServer() {
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    const pathname = requestUrl.pathname;
    if (pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    const viewer = await authenticateDashboard(request, response);
    if (!viewer) return;
    if (pathname === '/api/watcher/config' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(publicWatcherConfig(viewer)));
      return;
    }
    if (pathname === '/api/watcher/config' && request.method === 'POST') {
      if (viewer.role !== 'admin') {
        response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Admin access is required to change scraper settings' }));
        return;
      }
      await updateWatcherConfig(request, response);
      return;
    }
    if (pathname === '/api/apartments/accepted-links' && request.method === 'GET') {
      if (!['admin', 'manager'].includes(viewer.role)) {
        response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Management access is required' }));
        return;
      }
      const accepted = [...Object.values(liveMyHomeData || {}), ...Object.values(liveSsData || {})]
        .filter(item => item._review_status === 'accepted' && item.url)
        .sort((a, b) => String(a._reviewed_at || '').localeCompare(String(b._reviewed_at || '')));
      const entries = accepted.map(item => {
        const apartmentId = Number(item._website_api_apartment_id);
        const link = Number.isInteger(apartmentId) && apartmentId > 0
          ? `${String(item.url).split('#')[0]}#nikas-api-apartment-id=${apartmentId}`
          : item.url;
        return { link, comment: item._review_comment || '', apiApartmentId: Number.isInteger(apartmentId) ? apartmentId : null };
      });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ entries }));
      return;
    }
    if (pathname === '/api/apartments' && request.method === 'DELETE') {
      if (viewer.role !== 'admin') {
        response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Admin access is required to remove a district' }));
        return;
      }
      const district = clean(requestUrl.searchParams.get('district'));
      if (!district) {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'District is required' }));
        return;
      }
      const normalizedDistrict = district.toLocaleLowerCase('en-US');
      const sources = [
        { data: liveMyHomeData || loadData(), save: data => saveData(data) },
        { data: liveSsData || loadSsData(), save: data => saveData(data, SS_DATA_PATH, SS_CSV_PATH) }
      ];
      let removed = 0;
      for (const source of sources) {
        let changed = false;
        for (const item of Object.values(source.data)) {
          if (clean(item.district).toLocaleLowerCase('en-US') !== normalizedDistrict || item._excluded) continue;
          item._excluded = true;
          item._excluded_reason = `District removed by ${viewer.email}`;
          item._excluded_at = new Date().toISOString();
          removed += 1;
          changed = true;
        }
        if (changed) source.save(source.data);
      }
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true, district, removed }));
      return;
    }
    if (pathname === '/api/owners' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(ownersData(viewer)));
      return;
    }
    if (pathname === '/api/owners/upsert' && request.method === 'POST') {
      try {
        const body = await readRequestJson(request);
        if (!Array.isArray(body.row)) throw new Error('Owner row is required');
        const incoming = OWNER_HEADERS.map((_, index) => clean(body.row[index]).slice(0, 4000));
        if (!incoming[0]) throw new Error('Owner ID is required');
        const adminViewer = { role: 'admin', email: 'owners-inbox' };
        const data = ownersData(adminViewer);
        let rowIndex = data.rows.findIndex(row => clean(row[0]) === incoming[0]);
        const created = rowIndex < 0;
        if (created) {
          data.rows.unshift(incoming);
          rowIndex = 0;
        } else {
          data.rows[rowIndex] = OWNER_HEADERS.map((_, columnIndex) => incoming[columnIndex] || clean(data.rows[rowIndex][columnIndex]));
        }
        fs.writeFileSync(ownersPathFor(adminViewer), JSON.stringify(data, null, 2), 'utf8');
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ ok: true, created, rowIndex, rowCount: data.rows.length }));
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    if (pathname === '/api/owners' && request.method === 'POST') {
      try {
        const body = await readRequestJson(request);
        if (!Array.isArray(body.headers) || !body.headers.length || !Array.isArray(body.rows)) throw new Error('The worksheet is empty');
        if (body.headers.length > 100 || body.rows.length > 50_000) throw new Error('The worksheet is too large');
        const importedHeaders = body.headers.map(value => clean(value) || 'Column').slice(0, 100);
        const importedRows = body.rows.map(row => OWNER_HEADERS.map((header, columnIndex) => {
          const matchingIndex = importedHeaders.indexOf(header);
          const sourceIndex = matchingIndex >= 0 ? matchingIndex : columnIndex;
          return clean(Array.isArray(row) ? row[sourceIndex] : '');
        }));
        let data = { headers: OWNER_HEADERS, rows: importedRows };
        if (body.append) {
          const current = ownersData(viewer);
          data = { headers: OWNER_HEADERS, rows: [...importedRows, ...current.rows] };
        }
        fs.writeFileSync(ownersPathFor(viewer), JSON.stringify(data, null, 2), 'utf8');
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ ok: true, rowCount: data.rows.length }));
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    if (pathname === '/api/owners' && request.method === 'PATCH') {
      try {
        const body = await readRequestJson(request);
        const data = ownersData(viewer);
        if (body.addRow === true) data.rows.unshift(data.headers.map(() => ''));
        else {
          const rowIndex = Number(body.rowIndex);
          const columnIndex = Number(body.columnIndex);
          if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= data.rows.length) throw new Error('Owner row was not found');
          if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= data.headers.length) throw new Error('Owner column was not found');
          data.rows[rowIndex][columnIndex] = clean(body.value);
        }
        fs.writeFileSync(ownersPathFor(viewer), JSON.stringify(data, null, 2), 'utf8');
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ ok: true, rowCount: data.rows.length }));
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    if (pathname === '/api/owners' && request.method === 'DELETE') {
      try {
        const data = ownersData(viewer);
        if (requestUrl.searchParams.get('all') === 'true') data.rows = [];
        else {
          const index = Number(requestUrl.searchParams.get('index'));
          if (!Number.isInteger(index) || index < 0 || index >= data.rows.length) throw new Error('Owner row was not found');
          data.rows.splice(index, 1);
        }
        fs.writeFileSync(ownersPathFor(viewer), JSON.stringify(data, null, 2), 'utf8');
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ ok: true, rowCount: data.rows.length }));
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    if ((pathname === '/' || pathname === '/live-results.html') && request.method === 'GET') {
      const requested = requestUrl.searchParams.get('view');
      const requestedView = requested === 'owners' ? 'owners' : (requested === 'accepted' ? 'accepted' : 'all');
      if(requestedView!=='owners')await Promise.race([
        refreshListingUploadHistory(),
        new Promise(resolve=>setTimeout(resolve,4000))
      ]);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, max-age=0' });
      response.end(buildDashboard(viewer, requestedView));
      return;
    }
    const reviewMatch = pathname.match(/^\/api\/apartments\/(\d+)\/review$/);
    if (reviewMatch && request.method === 'POST') {
      await reviewApartment(request, response, viewer, reviewMatch[1]);
      return;
    }
    if ((pathname === '/apartments.csv' || pathname === '/ss-apartments.csv') && viewer.role !== 'admin') {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Admin access is required for CSV downloads');
      return;
    }
    const files = {
      '/dashboard.css': [DASHBOARD_CSS_PATH, 'text/css; charset=utf-8'],
      '/favicon.svg': [FAVICON_PATH, 'image/svg+xml'],
      '/favicon.ico': [FAVICON_PATH, 'image/svg+xml'],
      '/apartments.csv': [CSV_PATH, 'text/csv; charset=utf-8'],
      '/ss-apartments.csv': [SS_CSV_PATH, 'text/csv; charset=utf-8']
    };
    const selected = files[pathname];
    if (!selected || !fs.existsSync(selected[0])) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': selected[1],
      'cache-control': 'no-store, max-age=0'
    });
    fs.createReadStream(selected[0]).pipe(response);
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Dashboard listening on http://0.0.0.0:${port}`);
  });
  return server;
}

async function launchBrowserContext(options) {
  const common = {
    headless: IS_HOSTED || options.headless,
    viewport: { width: 1440, height: 900 },
    locale: 'ka-GE'
  };
  if (IS_HOSTED) return chromium.launchPersistentContext(PROFILE_PATH, common);
  try {
    return await chromium.launchPersistentContext(PROFILE_PATH, { ...common, channel: 'chrome' });
  } catch (error) {
    if (!/channel|executable|chrome/i.test(error.message)) throw error;
    return chromium.launchPersistentContext(PROFILE_PATH, common);
  }
}

function saveData(data, dataPath = DATA_PATH, csvPath = CSV_PATH) {
  const tempPath = `${dataPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, dataPath);

  const rows = Object.values(data)
    .filter(row => !row._baseline && !row._excluded && row._review_status !== 'rejected' && !hasExcludedDescription(row.description))
    .sort((a, b) => String(b.first_seen).localeCompare(String(a.first_seen)));
  const csv = [FIELDS.map(csvCell).join(',')];
  for (const row of rows) csv.push(FIELDS.map(field => csvCell(row[field])).join(','));
  fs.writeFileSync(csvPath, `\uFEFF${csv.join('\r\n')}\r\n`, 'utf8');
  writeDashboard();
}

function georgiaDateParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tbilisi', day: 'numeric', month: 'numeric'
  }).formatToParts(new Date());
  return {
    day: Number(parts.find(part => part.type === 'day').value),
    month: Number(parts.find(part => part.type === 'month').value)
  };
}

function cardIsFromToday(text) {
  const value = clean(text).toLowerCase();
  if (/დღეს|წუთის წინ|წამის წინ|today|сегодня/.test(value)) return true;
  const months = {
    'იან': 1, 'თებ': 2, 'მარ': 3, 'აპრ': 4, 'მაი': 5, 'ივნ': 6,
    'ივლ': 7, 'აგვ': 8, 'სექ': 9, 'ოქტ': 10, 'ნოე': 11, 'დეკ': 12
  };
  const found = value.match(/(?:^|\s)(\d{1,2})\s*(იან|თებ|მარ|აპრ|მაი|ივნ|ივლ|აგვ|სექ|ოქტ|ნოე|დეკ)(?:\s|,|$)/);
  if (!found) return false;
  const today = georgiaDateParts();
  return Number(found[1]) === today.day && months[found[2]] === today.month;
}

function apiUrl(searchUrl, pageNumber) {
  const source = new URL(searchUrl);
  const target = new URL('https://api-statements.tnet.ge/v1/statements');
  for (const [key, value] of source.searchParams) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey !== 'cardview' && normalizedKey !== 'page') {
      target.searchParams.append(key, value);
    }
  }
  target.searchParams.set('page', String(pageNumber));
  return target.toString();
}

function districtNameFromUrl(value) {
  const slug = new URL(value).pathname.split('/').filter(Boolean).at(-1) || 'custom';
  const names = { saburtalo: 'Saburtalo', vake: 'Vake', 'didi-dighomi': 'Didi Dighomi', digomi: 'Digomi' };
  return names[slug] || slug.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function validateMyHomeUrl(value) {
  const url = new URL(value);
  if (!/(^|\.)myhome\.ge$/i.test(url.hostname)) throw new Error('Only myhome.ge search URLs are allowed');
  if (!url.pathname.includes('/udzravi-qoneba/')) throw new Error('Enter a MyHome real-estate search URL');
  return url.toString();
}

function saveWatcherConfig(config) {
  fs.writeFileSync(WATCHER_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function loadWatcherConfig(options) {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(WATCHER_CONFIG_PATH, 'utf8')); } catch { /* Use CLI defaults. */ }
  const currentConfig = saved?.version === 2;
  const config = {
    version: 2,
    enabled: currentConfig ? saved.enabled !== false : options.searches.length > 0,
    pages: currentConfig && Number.isInteger(saved.pages) && saved.pages >= 1 && saved.pages <= 10 ? saved.pages : options.pages,
    interval: currentConfig && Number.isFinite(saved.interval) && saved.interval >= 3 ? saved.interval : options.interval,
    searches: currentConfig && Array.isArray(saved.searches) ? saved.searches : options.searches
  };
  config.searches = config.searches.map(search => ({
    district: clean(search.district) || districtNameFromUrl(search.url),
    url: validateMyHomeUrl(search.url)
  }));
  saveWatcherConfig(config);
  return config;
}

function searchKey(searchUrl, pageCount) {
  const url = new URL(searchUrl);
  url.hash = '';
  url.searchParams.delete('page');
  url.searchParams.delete('CardView');
  url.searchParams.sort();
  return `${url.toString()}|pages=${pageCount}`;
}

async function collectApiCards(searchUrl, pageCount, district = 'Unknown') {
  const requests = [];
  for (let number = 1; number <= pageCount; number += 1) {
    requests.push(fetch(apiUrl(searchUrl, number), {
      headers: {
        'x-website-key': 'myhome',
        locale: 'ka',
        referer: 'https://www.myhome.ge/'
      }
    }));
  }
  const responses = await Promise.all(requests);
  const byId = new Map();
  for (const response of responses) {
    if (!response.ok) throw new Error(`MyHome feed returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload.result || !Array.isArray(payload.data?.data)) {
      throw new Error(payload.errors?.message?.join?.(', ') || 'Unexpected MyHome feed response');
    }
    for (const item of payload.data.data) {
      const id = String(item.id);
      const slug = item.dynamic_slug || item.href_lang?.ka || item.middle_slug || 'gancxadeba';
      byId.set(id, {
        id,
        district,
        url: `https://www.myhome.ge/udzravi-qoneba/${slug}-${id}/`,
        text: `${item.dynamic_title || ''} ${item.last_updated || ''}`,
        api: item
      });
    }
  }
  return [...byId.values()].sort((a, b) =>
    String(b.api.last_updated || '').localeCompare(String(a.api.last_updated || ''))
  );
}

async function collectDistrictCards(searches, pageCount) {
  const groups = await Promise.all(searches.map(search =>
    collectApiCards(search.url, pageCount, search.district)
  ));
  const byId = new Map();
  for (const card of groups.flat()) if (!byId.has(card.id)) byId.set(card.id, card);
  return [...byId.values()].sort((a, b) =>
    String(b.api.last_updated || '').localeCompare(String(a.api.last_updated || ''))
  );
}

async function getMyHomeStatement(id) {
  const response = await fetch(`https://api-statements.tnet.ge/v1/statements/${id}`, {
    headers: {
      'x-website-key': 'myhome',
      locale: 'ka',
      referer: 'https://www.myhome.ge/'
    }
  });
  if (!response.ok) throw new Error(`MyHome detail feed returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.result || !payload.data?.statement) throw new Error('MyHome detail record is not ready');
  return payload.data.statement;
}

function myHomeUrl(source, id) {
  const slug = source.dynamic_slug || source.href_lang?.ka || source.middle_slug || 'gancxadeba';
  return `https://www.myhome.ge/udzravi-qoneba/${slug}-${id}/`;
}

function myHomeApartment(source, id, phone, firstSeen = new Date().toISOString(), district = '') {
  const gel = source.price?.['1']?.price_total;
  const phoneInfo = myHomePhoneInfo(source);
  return {
    apartment_id: id,
    district,
    source: 'MyHome',
    title: clean(source.dynamic_title),
    phone: phone || phoneInfo.phone,
    _masked_phone: phone || phoneInfo.phone ? '' : phoneInfo.masked,
    price: gel == null ? '' : `${Number(gel).toLocaleString('en-US')}₾`,
    rooms: clean(source.room ?? source.room_type_id),
    bedrooms: clean(source.bedroom ?? source.bedroom_type_id),
    area_m2: clean(source.area),
    floor: clean(source.floor),
    total_floors: clean(source.total_floors),
    posted: clean(source.created_at || source.last_updated),
    description: clean(source.comment).slice(0, 2000),
    url: myHomeUrl(source, id),
    first_seen: firstSeen
  };
}

async function acquireSsToken(context) {
  const page = await context.newPage();
  try {
    const requestPromise = page.waitForRequest(
      request => /api-gateway\.ss\.ge\/v1\/RealEstate\/LegendSearch/i.test(request.url()),
      { timeout: 90000 }
    );
    await page.goto(SS_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const request = await requestPromise;
    const authorization = request.headers().authorization || '';
    if (!authorization.startsWith('Bearer ')) throw new Error('SS.ge did not provide a search token');
    ssAuthToken = authorization;
  } finally {
    await page.close().catch(() => {});
  }
}

async function requestSsCards(context, retry = true) {
  if (!ssAuthToken) await acquireSsToken(context);
  const fetchPage = page => fetch('https://api-gateway.ss.ge/v1/RealEstate/LegendSearch', {
    method: 'POST',
    headers: {
      authorization: ssAuthToken,
      accept: 'application/json, text/plain, */*',
      'accept-language': 'ka',
      'content-type': 'application/json',
      origin: 'https://home.ss.ge',
      os: 'web',
      referer: 'https://home.ss.ge/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36'
    },
    body: JSON.stringify({
      realEstateType: 5,
      realEstateDealType: 1,
      cityIdList: [95],
      subdistrictIds: [2, 3, 4, 5, 26, 27, 44, 45, 46, 47, 48, 49, 50],
      currencyId: 1,
      advancedSearch: { individualEntityOnly: true },
      page,
      pageSize: 16
    })
  });
  const responses = await Promise.all([1, 2, 3, 4, 5].map(fetchPage));
  if (responses.some(response => response.status === 401 || response.status === 403) && retry) {
    ssAuthToken = '';
    await acquireSsToken(context);
    return requestSsCards(context, false);
  }
  const failed = responses.find(response => !response.ok);
  if (failed) throw new Error(`SS.ge feed returned HTTP ${failed.status}`);
  const payloads = await Promise.all(responses.map(response => response.json()));
  const byId = new Map();
  for (const payload of payloads) {
    if (!Array.isArray(payload.realStateItemModel)) throw new Error('Unexpected SS.ge feed response');
    for (const item of payload.realStateItemModel) {
      if (item.applicationId != null) byId.set(String(item.applicationId), item);
    }
  }
  return [...byId.values()].map(item => {
    const id = String(item.applicationId);
    return {
      id,
      url: `https://home.ss.ge/ka/udzravi-qoneba/${item.detailUrl}`,
      api: item
    };
  }).sort((a, b) => new Date(b.api.createDate) - new Date(a.api.createDate));
}

async function waitThroughChallenge(page, timeoutMs = 180000) {
  // Cloudflare can render a blank shell briefly before the challenge text appears.
  await page.waitForTimeout(1500);
  const deadline = Date.now() + timeoutMs;
  let warned = false;
  while (Date.now() < deadline) {
    const title = clean(await page.title()).toLowerCase();
    const body = clean(await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).toLowerCase();
    const challenged = title.includes('just a moment') || body.includes('checking your browser') ||
      body.includes('verify you are human') || body.includes('enable javascript and cookies') ||
      body.includes('performing security verification') || body.includes('protect against malicious bots');
    if (!challenged) return;
    if (!warned) {
      console.log('MyHome security check is open. Complete it in the browser window...');
      warned = true;
    }
    await sleep(2000);
  }
  throw new Error('The MyHome security check was not completed within 3 minutes.');
}

async function collectCards(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitThroughChallenge(page);
  try {
    await page.waitForFunction(
      () => [...document.links].some(a => /\/udzravi-qoneba\/(?:\d+|[^/?#]*-\d+)(?:\/|\?|$)/i.test(a.href)),
      undefined,
      { timeout: 45000 }
    );
  } catch {
    console.log(`No listing links found on ${url}`);
    return [];
  }
  const raw = await page.locator('a[href*="/udzravi-qoneba/"]').evaluateAll(elements =>
    elements.map(a => ({ href: a.href, text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim() }))
  );
  const unique = new Map();
  for (const candidate of raw) {
    const found = candidate.href.match(LISTING_RE);
    const id = found ? (found[1] || found[2]) : '';
    if (id && !unique.has(id)) {
      unique.set(id, { id, url: candidate.href.split('#')[0], text: clean(candidate.text) });
    }
  }
  return [...unique.values()];
}

function* walkJson(value) {
  if (Array.isArray(value)) {
    for (const child of value) yield* walkJson(child);
  } else if (value && typeof value === 'object') {
    yield value;
    for (const child of Object.values(value)) yield* walkJson(child);
  }
}

async function getJsonLd(page) {
  const output = [];
  const values = await page.locator('script[type="application/ld+json"]').allTextContents();
  for (const value of values) {
    try { output.push(JSON.parse(value)); } catch { /* Ignore malformed analytics data. */ }
  }
  return output;
}

async function visiblePhone(page) {
  const hrefs = await page.locator('a[href^="tel:"]').evaluateAll(elements => elements.map(e => e.href));
  for (const href of hrefs) {
    const phone = normalizePhone(href);
    if (phone) return phone;
  }
  return '';
}

async function extractPhone(page) {
  let phone = await visiblePhone(page);
  if (phone) return phone;

  let responsePhone = '';
  const capturePhone = async response => {
    if (responsePhone || !/myhome\.ge|tnet\.ge/i.test(response.url())) return;
    try {
      const contentType = response.headers()['content-type'] || '';
      if (!/json|text/i.test(contentType)) return;
      responsePhone = normalizeContactPhone(await response.text());
    } catch { /* The response body may no longer be available. */ }
  };
  page.on('response', capturePhone);
  const candidates = page.locator('button, a');
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const element = candidates.nth(i);
    try {
      const label = clean(await element.innerText({ timeout: 750 }));
      if (label && REVEAL_RE.test(label) && await element.isVisible()) {
        await element.click({ timeout: 3000 });
        for (let attempt = 0; attempt < 6 && !responsePhone; attempt += 1) {
          await page.waitForTimeout(500);
          const visible = await visiblePhone(page);
          if (visible) {
            page.off('response', capturePhone);
            return visible;
          }
        }
        break;
      }
    } catch { /* Try the next matching control. */ }
  }
  page.off('response', capturePhone);
  if (responsePhone) return responsePhone;
  phone = await visiblePhone(page);
  if (phone) return phone;
  return normalizePhone(clean(await page.locator('body').innerText()));
}

async function repairMissingMyHomePhones(context, cards, data) {
  const retryAfterMs = 10 * 60 * 1000;
  const now = Date.now();
  const pending = cards.filter(card => {
    const saved = data[card.id];
    const lastAttempt = new Date(saved?._phone_last_attempt_at || 0).getTime();
    return saved && !saved._baseline && !saved._excluded && !saved.phone && now - lastAttempt >= retryAfterMs;
  }).slice(0, 5);
  if (!pending.length) return 0;

  let repaired = 0;
  let repairPage = null;
  try {
    if (!IS_HOSTED) repairPage = await context.newPage();
    for (const card of pending) {
      const saved = data[card.id];
      saved._phone_last_attempt_at = new Date().toISOString();
      saved._phone_attempts = Number(saved._phone_attempts || 0) + 1;
      try {
        const detail = await getMyHomeStatement(card.id);
        const phoneInfo = myHomePhoneInfo(detail);
        saved._masked_phone = phoneInfo.masked || saved._masked_phone || '';
        let phone = phoneInfo.phone;
        if (!phone && repairPage) {
          await repairPage.goto(myHomeUrl(detail, card.id), { waitUntil: 'domcontentloaded', timeout: 90000 });
          await waitThroughChallenge(repairPage);
          phone = await extractPhone(repairPage);
        }
        if (phone) {
          saved.phone = phone;
          saved._masked_phone = '';
          saved._phone_repaired_at = new Date().toISOString();
          repaired += 1;
          console.log(`REPAIRED MyHome phone for ID ${card.id}: ${phone}`);
        }
      } catch (error) {
        console.error(`Could not repair MyHome phone for ID ${card.id}: ${error.message}`);
      }
    }
  } finally {
    if (repairPage) await repairPage.close();
    saveData(data);
  }
  return repaired;
}

async function meta(page, selector) {
  return clean(await page.locator(selector).first().getAttribute('content').catch(() => ''));
}

async function extractDetail(page, card) {
  if (card.api) {
    const detail = await getMyHomeStatement(card.id);
    const source = { ...card.api, ...detail };
    const correctUrl = myHomeUrl(source, card.id);
    let phone = myHomePhoneInfo(source).phone;
    if (!phone) {
      if (IS_HOSTED) {
        // MyHome presents an interactive Cloudflare challenge to Railway's
        // datacenter browser. There is no person or visible window to solve it,
        // so preserve the new listing immediately instead of blocking scans for
        // three minutes and rediscovering the same ID on the next cycle.
        console.log(`MyHome phone for ID ${card.id} is hidden behind the hosted security check; saving the listing without it.`);
      } else {
        await page.goto(correctUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await waitThroughChallenge(page);
        await page.waitForTimeout(750);
        phone = await extractPhone(page);
      }
    }
    return myHomeApartment(source, card.id, phone, new Date().toISOString(), card.district);
  }

  await page.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitThroughChallenge(page);
  await page.waitForTimeout(1000);

  const body = clean(await page.locator('body').innerText({ timeout: 20000 }));
  const combined = `${card.text} ${body}`;
  let title = '';
  if (await page.locator('h1').count()) title = clean(await page.locator('h1').first().innerText());
  if (!title) title = await meta(page, 'meta[property="og:title"]');
  let description = await meta(page, 'meta[property="og:description"]');
  let price = match(PRICE_RE, card.text, 0) || match(PRICE_RE, body, 0);
  for (const data of await getJsonLd(page)) {
    for (const node of walkJson(data)) {
      if (node.offers && !Array.isArray(node.offers) && node.offers.price) {
        price = clean(`${node.offers.price} ${node.offers.priceCurrency || ''}`);
      }
      if (!description && node.description) description = clean(node.description);
    }
  }

  const floor = combined.match(FLOOR_RE) || combined.match(FLOOR_PAIR_RE);
  const titleRooms = match(ROOM_RE, title);
  return {
    apartment_id: card.id,
    district: card.district,
    title,
    phone: await extractPhone(page),
    price,
    rooms: titleRooms || match(ROOM_RE, combined),
    bedrooms: match(BEDROOM_RE, combined),
    area_m2: match(AREA_RE, combined),
    floor: floor ? clean(floor[1]) : '',
    total_floors: floor ? clean(floor[2]) : '',
    posted: match(DATE_RE, card.text, 0),
    description: description.slice(0, 2000),
    url: card.url,
    first_seen: new Date().toISOString()
  };
}

function notify(item) {
  console.log(`NEW ${item.source || 'MyHome'}  ID ${item.apartment_id} | ${item.price || '?'} | ${item.rooms || '?'} rooms | ${item.area_m2 || '?'} m² | ${item.phone || 'no phone found'}`);
  console.log(`     ${item.title}\n     ${item.url}`);
  process.stdout.write('\x07');
}

function responseItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['data', 'items', 'results', 'agents', 'apartments', '$values']) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.[key]?.items)) return payload[key].items;
  }
  return [];
}

function listingUploadItems(payload) {
  const items = responseItems(payload);
  const uploads=items.length?items:(payload&&typeof payload==='object'&&payload.publishedListingId?[payload]:[]);
  return uploads.filter(upload=>upload.platform!=='myhome'||Number(upload.publishedListingId)>=20_000_000);
}

async function forEachConcurrent(items,limit,worker){
  let cursor=0;
  const runners=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(cursor<items.length){const index=cursor++;await worker(items[index],index);}
  });
  await Promise.all(runners);
}

function agentDisplayName(agent) {
  const person = agent?.user || agent?.profile || agent;
  return clean(person?.fullName || person?.name || person?.displayName ||
    [person?.firstName, person?.lastName].filter(Boolean).join(' ') || person?.email || agent?.id);
}

async function websiteApiRequest(pathname, options = {}, retry = true) {
  const headers = new Headers(options.headers || {});
  if (websiteApiToken) headers.set('authorization', `Bearer ${websiteApiToken}`);
  const response = await fetch(`${WEBSITE_API_URL}${pathname}`, { ...options, headers });
  if (response.status === 401 && retry && process.env.WEBSITE_API_EMAIL && process.env.WEBSITE_API_PASSWORD) {
    websiteApiToken = '';
    websiteApiAgents = [];
    await loginWebsiteApi();
    return websiteApiRequest(pathname, options, false);
  }
  if (!response.ok) {
    const details = clean(await response.text().catch(() => '')).slice(0, 500);
    throw new Error(`Website API ${pathname} returned HTTP ${response.status}${details ? `: ${details}` : ''}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function loginWebsiteApi() {
  const email = process.env.WEBSITE_API_EMAIL;
  const password = process.env.WEBSITE_API_PASSWORD;
  if (!email || !password) return false;
  const response = await fetch(`${WEBSITE_API_URL}/api/Auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error(`Website API login returned HTTP ${response.status}`);
  const payload = await response.json();
  websiteApiToken = tokenFromPayload(payload);
  if (!websiteApiToken) throw new Error('Website API login response did not contain a bearer token');
  return true;
}

async function getDistributionAgents() {
  if (websiteApiAgents.length) return websiteApiAgents;
  if (!websiteApiToken && !await loginWebsiteApi()) return [];
  const payload = await websiteApiRequest('/api/Agents');
  const available = responseItems(payload)
    .map(agent => ({ ...agent, id: String(agent.userId ?? agent.user_id ?? agent.user?.id ?? agent.id ?? '') }))
    .filter(agent => agent.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const configuredIds = String(process.env.WEBSITE_API_AGENT_IDS || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  const distributionCount = Number(process.env.AGENT_DISTRIBUTION_COUNT || 8);
  if (!Number.isInteger(distributionCount) || distributionCount < 1) {
    throw new Error('AGENT_DISTRIBUTION_COUNT must be a positive whole number');
  }
  websiteApiAgents = configuredIds.length
    ? configuredIds.map(id => available.find(agent => agent.id === id)).filter(Boolean)
    : available.slice(0, distributionCount);
  if (configuredIds.length && websiteApiAgents.length !== configuredIds.length) {
    const found = new Set(websiteApiAgents.map(agent => agent.id));
    const missing = configuredIds.filter(id => !found.has(id));
    throw new Error(`Configured Website API agent IDs were not found: ${missing.join(', ')}`);
  }
  if (websiteApiAgents.length !== distributionCount) {
    throw new Error(`Round-robin requires exactly ${distributionCount} agents; resolved ${websiteApiAgents.length}`);
  }
  return websiteApiAgents;
}

async function hydrateAssignedAgentNames(data) {
  if (!process.env.WEBSITE_API_EMAIL || !process.env.WEBSITE_API_PASSWORD) return 0;
  const agents = await getDistributionAgents();
  const names = new Map(agents.map(agent => [agent.id, agentDisplayName(agent)]));
  let updated = 0;
  for (const item of Object.values(data)) {
    const name = names.get(String(item.assigned_agent_id || ''));
    if (name && item.assigned_agent_name !== name) {
      item.assigned_agent_name = name;
      updated += 1;
    }
  }
  return updated;
}

async function hydrateListingUploadHistory() {
  if (!process.env.WEBSITE_API_EMAIL || !process.env.WEBSITE_API_PASSWORD) return;
  if (Date.now() - dashboardUploadsRefreshedAt < 30_000) return;
  if (!websiteApiToken && !await loginWebsiteApi()) return;

  const agentPayload = await websiteApiRequest('/api/Agents');
  dashboardUploadAgents = responseItems(agentPayload)
    .map(agent => ({
      id: String(agent.userId ?? agent.user_id ?? agent.user?.id ?? agent.id ?? ''),
      name: agentDisplayName(agent)
    }))
    .filter(agent => agent.id)
    .sort((left, right) => left.name.localeCompare(right.name));

  const sources = [
    { data: liveMyHomeData || loadData(), save: data => saveData(data) },
    { data: liveSsData || loadSsData(), save: data => saveData(data, SS_DATA_PATH, SS_CSV_PATH) }
  ];
  for (const source of sources) {
    let changed = false;
    const items = Object.values(source.data).filter(item => !item._baseline && !item._excluded && item._review_status !== 'rejected');
    await forEachConcurrent(items,12,async item=>{
      try {
        const apartmentId = Number(item._website_api_apartment_id);
        const sourcePlatform = item.source === 'SS.ge' ? 'ssge' : 'myhome';
        const uploadPaths = [`/api/ListingUploads?sourcePlatform=${sourcePlatform}&sourceListingId=${encodeURIComponent(item.apartment_id)}`];
        if(Number.isInteger(apartmentId)&&apartmentId>0)uploadPaths.push(`/api/Apartments/${apartmentId}/uploads`);
        const uploadGroups=await Promise.all(uploadPaths.map(path=>websiteApiRequest(path).then(listingUploadItems)));
        const uploads=[...new Map(uploadGroups.flat().map(upload=>[
          String(upload.id||`${upload.agentUserId}:${upload.platform}:${upload.publishedListingId}`),upload
        ])).values()].sort((left,right)=>String(left.uploadedAt||'').localeCompare(String(right.uploadedAt||'')));
        for (const upload of uploads) {
          const id=String(upload.agentUserId||'');if(!id)continue;
          if(!dashboardUploadAgents.some(agent=>agent.id===id))dashboardUploadAgents.push({id,name:clean(upload.agentName)||id});
        }
        if (JSON.stringify(item._listing_uploads || []) !== JSON.stringify(uploads)) {
          item._listing_uploads = uploads;
          changed = true;
        }
      } catch (error) {
        item._listing_uploads_error = error.message;
      }
    });
    if (changed) source.save(source.data);
  }
  dashboardUploadAgents.sort((left,right)=>left.name.localeCompare(right.name));
  dashboardUploadsRefreshedAt = Date.now();
}

function refreshListingUploadHistory(){
  if(!dashboardUploadsRefreshPromise){
    dashboardUploadsRefreshPromise=hydrateListingUploadHistory()
      .catch(error=>console.error(`Could not refresh listing upload history: ${error.message}`))
      .finally(()=>{dashboardUploadsRefreshPromise=null;});
  }
  return dashboardUploadsRefreshPromise;
}

function positiveNumber(value) {
  const number = Number(String(value ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, ''));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function integer(value, minimum = 0) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= minimum ? number : null;
}

async function websiteApiHasApartment(item) {
  const query = new URLSearchParams({ search: item.apartment_id, pageSize: '50' });
  const payload = await websiteApiRequest(`/api/Apartments?${query}`);
  const sourceLabel = item.source === 'SS.ge' ? 'SS.ge' : 'MyHome';
  return responseItems(payload).find(apartment => {
    const description = String(apartment.description || '');
    return description.includes(item.url) ||
      description.includes(`${sourceLabel} ID: ${item.apartment_id}`) ||
      description.includes(`Source ID: ${item.apartment_id}`) ||
      String(apartment.sourceListingId || '') === String(item.apartment_id);
  }) || null;
}

function websiteApartmentFromResponse(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return payload.apartment || payload.data?.apartment || payload.data || payload.result || payload;
}

async function uploadApartmentToWebsite(item, agentId) {
  const existing = await websiteApiHasApartment(item);
  if (existing) return { existing: true, apartment: existing };

  const sourceLabel = item.source === 'SS.ge' ? 'SS.ge' : 'MyHome';
  const form = new FormData();
  form.set('UploadedByUserId', agentId);
  form.set('Title', item.title || `${sourceLabel} apartment ${item.apartment_id}`);
  form.set('Description', `${item.description || ''}\n\nSource: ${item.url}\n${sourceLabel} ID: ${item.apartment_id}\nSource ID: ${item.apartment_id}`.trim());
  form.set('City', 'Tbilisi');
  form.set('Region', 'Tbilisi');
  form.set('District', item.district || 'Other');
  if (item.phone) form.set('PhoneNumber', item.phone);

  const price = positiveNumber(item.price);
  const size = positiveNumber(item.area_m2);
  const bedrooms = integer(item.bedrooms);
  const floor = integer(item.floor);
  const totalFloors = integer(item.total_floors, 1);
  if (price) form.set('Price', String(price));
  if (size) form.set('SizeSquareMeters', String(size));
  if (bedrooms != null) form.set('Bedrooms', String(bedrooms));
  if (floor != null) form.set('Floor', String(floor));
  if (totalFloors != null) form.set('TotalFloors', String(totalFloors));

  // Streets are intentionally NOT resolved or submitted. The website apartment
  // is created directly in the normal Apartments collection using the scraped
  // apartment data above.
  return websiteApiRequest('/api/Apartments', { method: 'POST', body: form });
}

async function syncPendingWebsiteApartments(data, state, onlyApartmentId = null, dataPath = DATA_PATH, csvPath = CSV_PATH) {
  if (!process.env.WEBSITE_API_EMAIL || !process.env.WEBSITE_API_PASSWORD) return 0;
  const pending = Object.values(data)
    .filter(item => !item._baseline && !item._excluded && !item._api_uploaded && !hasExcludedDescription(item.description) &&
      (onlyApartmentId == null || String(item.apartment_id) === String(onlyApartmentId)))
    .sort((a, b) => String(a.first_seen).localeCompare(String(b.first_seen)));
  if (!pending.length) return 0;

  const agents = await getDistributionAgents();
  let uploaded = 0;
  for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
    const item = pending[pendingIndex];
    const sourceLabel = item.source === 'SS.ge' ? 'SS.ge' : 'MyHome';
    watcherStatus.state = 'assigning';
    watcherStatus.message = `Assigning ${sourceLabel} apartment ${pendingIndex + 1} of ${pending.length} to agents…`;
    let agent = item.assigned_agent_id
      ? agents.find(candidate => candidate.id === String(item.assigned_agent_id))
      : null;
    if (!agent) {
      const index = Number(state.api_assignment_index || 0) % agents.length;
      agent = agents[index];
      item.assigned_agent_id = agent.id;
      item.assigned_agent_name = agentDisplayName(agent);
      item._assigned_at = new Date().toISOString();
      state.api_assignment_index = Number(state.api_assignment_index || 0) + 1;
      saveData(data, dataPath, csvPath);
      saveState(state);
    } else if (!item.assigned_agent_name) {
      item.assigned_agent_name = agentDisplayName(agent);
      saveData(data, dataPath, csvPath);
    }
    try {
      watcherStatus.state = 'uploading';
      watcherStatus.message = `Uploading ${sourceLabel} apartment ${pendingIndex + 1} of ${pending.length} for ${item.assigned_agent_name || agent.id}…`;
      const uploadedResult = await uploadApartmentToWebsite(item, agent.id);
      const websiteApartment = websiteApartmentFromResponse(uploadedResult?.apartment || uploadedResult);
      const websiteId = Number(websiteApartment?.id ?? websiteApartment?.apartmentId ?? websiteApartment?.apartment_id);
      if (Number.isInteger(websiteId) && websiteId > 0) item._website_api_apartment_id = websiteId;
      item._api_uploaded = true;
      item._api_uploaded_at = new Date().toISOString();
      delete item._api_error;
      saveData(data, dataPath, csvPath);
      saveState(state);
      uploaded += 1;
      console.log(`Uploaded ${sourceLabel} ID ${item.apartment_id} to agent ${agent.id}${item._website_api_apartment_id ? ` as apartment ${item._website_api_apartment_id}` : ''}.`);
    } catch (error) {
      item._api_error = error.message;
      saveData(data, dataPath, csvPath);
      console.error(`Website API upload failed for ${sourceLabel} ID ${item.apartment_id}: ${error.message}`);
    }
  }
  return uploaded;
}

async function extractSsDetail(page, card) {
  const source = card.api;
  let phone = normalizeContactPhone(source.description || '');
  if (!phone) {
    await page.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitThroughChallenge(page);
    await page.waitForTimeout(750);
    phone = await extractPhone(page);
  }
  const rooms = match(/(\d+\+?)\s*ოთახ/i, source.title || '');
  return {
    apartment_id: card.id,
    source: 'SS.ge',
    title: clean(source.title),
    phone,
    price: source.price?.priceGeo == null ? '' : `${Number(source.price.priceGeo).toLocaleString('en-US')}₾`,
    rooms,
    bedrooms: clean(source.numberOfBedrooms),
    area_m2: clean(source.totalArea),
    floor: clean(source.floorNumber),
    total_floors: clean(source.totalAmountOfFloor),
    posted: clean(source.createDate),
    description: clean(source.description).slice(0, 2000),
    url: card.url,
    first_seen: new Date().toISOString()
  };
}

async function scan(context, data, state, options) {
  watcherStatus.state = 'scanning';
  watcherStatus.message = `Reading ${options.pages} page(s) across ${options.searches.length} search(es)…`;
  watcherStatus.lastStartedAt = new Date().toISOString();
  watcherStatus.lastError = null;
  watcherStatus.found = 0;
  watcherStatus.imported = 0;
  watcherStatus.importTotal = 0;
  const cards = await collectDistrictCards(options.searches, options.pages);
  const byId = new Map(cards.map(card => [card.id, card]));
  watcherStatus.found = byId.size;
  const activeSearchKey = options.searches
    .map(search => `${search.district}:${searchKey(search.url, options.pages)}`)
    .sort().join('||');
  if (!state.initialized || state.engine_version !== 4 || state.myhome_search_key !== activeSearchKey) {
    state.initialized = true;
    state.engine_version = 4;
    state.myhome_search_key = activeSearchKey;
    state.initialized_at = new Date().toISOString();
    saveState(state);
    console.log(`Search configured for ${byId.size} current listings from ${options.searches.length} district(s), ${options.pages} page(s) each. Importing the complete result set.`);
  }

  const toImport = cards.filter(card => {
    const saved = data[card.id];
    return !saved || (saved._baseline && !saved._excluded && !saved.title);
  });
  watcherStatus.importTotal = toImport.length;
  console.log(`Checked ${byId.size} listings across the configured pages; ${toImport.length} still need importing.`);

  const repairs = cards.filter(card => {
    const saved = data[card.id];
    return saved && !saved._baseline && (!saved.title || /\/null-\d+\//.test(saved.url || ''));
  });
  for (const card of repairs) {
    try {
      const detail = await getMyHomeStatement(card.id);
      const repaired = myHomeApartment(detail, card.id, data[card.id].phone, data[card.id].first_seen, card.district || data[card.id].district);
      repaired._baseline = false;
      data[card.id] = repaired;
      saveData(data);
      console.log(`REPAIRED MyHome ID ${card.id} | ${repaired.url}`);
    } catch (error) {
      console.error(`Could not repair MyHome ID ${card.id}: ${error.message}`);
    }
  }
  await repairMissingMyHomePhones(context, cards, data);
  try {
    await syncPendingWebsiteApartments(data, state);
  } catch (error) {
    console.error(`Website API synchronization failed: ${error.message}`);
  }
  if (!toImport.length) {
    watcherStatus.state = 'idle';
    watcherStatus.message = `Up to date — ${byId.size} apartments checked.`;
    watcherStatus.lastCompletedAt = new Date().toISOString();
    return 0;
  }

  const detailPage = await context.newPage();
  let saved = 0;
  try {
    const importQueue = toImport.reverse();
    for (let index = 0; index < importQueue.length; index += 1) {
      if (!options.enabled) {
        watcherStatus.state = 'paused';
        watcherStatus.message = `Stopped safely — ${importQueue.length - index} apartment(s) remain to import.`;
        break;
      }
      const currentSearchKey = options.searches
        .map(search => `${search.district}:${searchKey(search.url, options.pages)}`)
        .sort().join('||');
      if (currentSearchKey !== activeSearchKey) {
        watcherStatus.state = 'starting';
        watcherStatus.message = 'District selection changed. Refreshing the apartment queue…';
        break;
      }
      const card = importQueue[index];
      watcherStatus.state = 'importing';
      watcherStatus.message = `Importing apartment ${index + 1} of ${importQueue.length} (ID ${card.id})…`;
      try {
        const item = await extractDetail(detailPage, card);
        if (hasExcludedDescription(item.description)) {
          item._baseline = true;
          item._excluded = true;
          data[item.apartment_id] = item;
          saveData(data);
          console.log(`FILTERED MyHome ID ${item.apartment_id} because its description contains an excluded phrase.`);
          continue;
        }
        item._baseline = false;
        data[item.apartment_id] = item;
        saveData(data);
        notify(item);
        saved += 1;
        watcherStatus.imported = saved;
        try {
          await syncPendingWebsiteApartments(data, state, item.apartment_id);
        } catch (error) {
          console.error(`Immediate Website API assignment failed for MyHome ID ${item.apartment_id}: ${error.message}`);
        }
        await sleep(1500);
      } catch (error) {
        console.error(`Could not read ID ${card.id}: ${error.message}`);
      }
    }
  } finally {
    await detailPage.close();
  }
  if (options.enabled) {
    try {
      await syncPendingWebsiteApartments(data, state);
    } catch (error) {
      console.error(`Website API synchronization failed: ${error.message}`);
    }
  }
  if (options.enabled) {
    watcherStatus.state = 'idle';
    watcherStatus.message = `Completed — checked ${byId.size}, imported ${saved}.`;
    watcherStatus.lastCompletedAt = new Date().toISOString();
  }
  return saved;
}

async function scanSs(context, data, state) {
  const cards = await requestSsCards(context);
  if (!state.ss_initialized || state.ss_engine_version !== 4) {
    for (const card of cards) {
      if (!data[card.id]) {
        data[card.id] = {
          apartment_id: card.id,
          url: card.url,
          first_seen: new Date().toISOString(),
          _baseline: true
        };
      }
    }
    state.ss_initialized = true;
    state.ss_engine_version = 4;
    state.ss_initialized_at = new Date().toISOString();
    saveData(data, SS_DATA_PATH, SS_CSV_PATH);
    saveState(state);
    console.log(`SS.ge baseline ready with ${cards.length} current IDs.`);
    return 0;
  }

  const baselineTime = new Date(state.ss_initialized_at).getTime();
  const unseen = cards.filter(card => !data[card.id]);
  const newest = unseen.filter(card => new Date(card.api.createDate).getTime() > baselineTime);
  const older = unseen.filter(card => new Date(card.api.createDate).getTime() <= baselineTime);
  for (const card of older) {
    data[card.id] = {
      apartment_id: card.id,
      url: card.url,
      first_seen: new Date().toISOString(),
      _baseline: true
    };
  }
  if (older.length) saveData(data, SS_DATA_PATH, SS_CSV_PATH);
  console.log(`Checked ${cards.length} SS.ge listings; ${newest.length} are genuinely new.`);
  if (!newest.length) return 0;

  const detailPage = await context.newPage();
  let saved = 0;
  try {
    for (const card of newest.reverse()) {
      try {
        const item = await extractSsDetail(detailPage, card);
        if (hasExcludedDescription(item.description)) {
          item._baseline = true;
          item._excluded = true;
          data[item.apartment_id] = item;
          saveData(data, SS_DATA_PATH, SS_CSV_PATH);
          console.log(`FILTERED SS.ge ID ${item.apartment_id} because its description contains an excluded phrase.`);
          continue;
        }
        item._baseline = false;
        data[item.apartment_id] = item;
        saveData(data, SS_DATA_PATH, SS_CSV_PATH);
        notify(item);
        saved += 1;
        try {
          await syncPendingWebsiteApartments(data, state, item.apartment_id, SS_DATA_PATH, SS_CSV_PATH);
        } catch (error) {
          console.error(`Immediate Website API upload failed for SS.ge ID ${item.apartment_id}: ${error.message}`);
        }
        await sleep(1500);
      } catch (error) {
        console.error(`Could not read SS.ge ID ${card.id}: ${error.message}`);
      }
    }
  } finally {
    await detailPage.close();
  }
  try {
    await syncPendingWebsiteApartments(data, state, null, SS_DATA_PATH, SS_CSV_PATH);
  } catch (error) {
    console.error(`Website API synchronization failed for SS.ge: ${error.message}`);
  }
  return saved;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  watcherRuntime = loadWatcherConfig(options);
  const accounts = dashboardAccounts();
  const dashboardApiAuth = String(process.env.DASHBOARD_AUTH_MODE || 'api').toLowerCase() === 'api';
  if (IS_HOSTED && !dashboardApiAuth && !accounts.length) {
    throw new Error('Configure DASHBOARD_ACCOUNTS or DASHBOARD_USER/DASHBOARD_PASSWORD before starting the hosted dashboard');
  }
  const data = loadData();
  const ssData = loadSsData();
  liveMyHomeData = data;
  liveSsData = ssData;
  const state = loadState();
  const excludedMyHome = markExcludedDescriptions(data);
  const excludedSs = markExcludedDescriptions(ssData);
  const clearedStreetErrors = clearLegacyStreetUploadErrors(data) + clearLegacyStreetUploadErrors(ssData);
  const clearedStreetData = clearLegacyStreetData(data) + clearLegacyStreetData(ssData);
  try {
    const named = await hydrateAssignedAgentNames(data) + await hydrateAssignedAgentNames(ssData);
    if (named) console.log(`Resolved display names for ${named} assigned apartment(s).`);
  } catch (error) {
    console.error(`Could not resolve existing agent display names: ${error.message}`);
  }
  saveData(data);
  saveData(ssData, SS_DATA_PATH, SS_CSV_PATH);
  if (clearedStreetErrors) console.log(`Cleared ${clearedStreetErrors} obsolete street-resolution upload error(s); those apartments will retry without streets.`);
  if (clearedStreetData) console.log(`Removed street/address data from ${clearedStreetData} saved apartment(s).`);
  if (excludedMyHome + excludedSs) {
    console.log(`Filtered ${excludedMyHome + excludedSs} existing listing(s) by description.`);
  }
  console.log(`Saving results to ${CSV_PATH}`);
  console.log(`Saving SS.ge results to ${SS_CSV_PATH}`);
  console.log(`Watching MyHome districts: ${watcherRuntime.searches.map(search => search.district).join(', ')} (${watcherRuntime.pages} pages each).`);
  console.log(dashboardApiAuth
    ? `Dashboard authentication uses ${WEBSITE_API_URL}/api/Auth/login.`
    : `Dashboard accounts: ${accounts.length} (${accounts.filter(account => account.role === 'admin').length} admin, ${accounts.filter(account => account.role === 'manager').length} manager, ${accounts.filter(account => account.role === 'agent').length} agent).`);
  console.log(process.env.WEBSITE_API_EMAIL && process.env.WEBSITE_API_PASSWORD
    ? `Website API upload enabled at ${WEBSITE_API_URL}.`
    : 'Website API upload disabled; set WEBSITE_API_EMAIL and WEBSITE_API_PASSWORD to enable it.');
  console.log('Press Ctrl+C to stop. Every apartment in the configured page range is imported once.');

  writeDashboard();
  const server = startWebServer();
  let context;
  try {
    context = await launchBrowserContext(options);
    writeDashboard();
    if (!IS_HOSTED) {
      const dashboardPage = context.pages()[0] || await context.newPage();
      await dashboardPage.goto(pathToFileURL(DASHBOARD_PATH).href);
    }
    while (true) {
      console.log(`\n[${new Date().toLocaleString()}] Checking MyHome...`);
      try {
        if (watcherRuntime.enabled) await scan(context, data, state, watcherRuntime);
        else {
          watcherStatus.state = 'paused';
          watcherStatus.message = 'MyHome scraping is paused by the admin.';
          console.log('MyHome watcher is paused by the admin.');
        }
        if (SS_SCRAPER_ENABLED) await scanSs(context, ssData, state);
      } catch (error) {
        watcherStatus.state = 'error';
        watcherStatus.message = 'The last scraper check failed.';
        watcherStatus.lastError = error.message;
        console.error(`Scan failed: ${error.message}`);
      }
      if (options.once) break;
      console.log(`Next check in ${watcherRuntime.interval} seconds.`);
      await sleep(watcherRuntime.interval * 1000);
    }
  } finally {
    saveData(data);
    saveData(ssData, SS_DATA_PATH, SS_CSV_PATH);
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  process.exitCode = 1;
});
