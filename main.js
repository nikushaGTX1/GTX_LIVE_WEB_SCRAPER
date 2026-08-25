'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const DISTRICT_SEARCHES = [
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
const STATE_PATH = path.join(DATA_ROOT, 'watcher-state.json');
const PROFILE_PATH = process.env.WATCHER_PROFILE || path.join(DATA_ROOT, '.browser-profile');
const IS_HOSTED = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);

const EXCLUDED_DESCRIPTION_PHRASES = [
  'აგენტებმა არ დამირეკოთ',
  'agentebma ar damirekot',
  'აგენტებმა არ დარეკოთ',
  'agentebma ar darekot',
  'არანაირი შემოთავაზებით',
  'aranairi shemotavazebit',
  'ვარ აგენტი',
  'var agenti',
  'მაკლერებმა არ დარეკოთ',
  'maklerebma ar darekot',
  'არანაირი პირობით',
  'aranairi pirobit',
  'თავი შეიკავეთ',
  'tavi sheikavet',
  'აგენტებთან არ ვთანამშრომლობ',
  'agentebtan ar vtanamshromlob'
];

const FIELDS = [
  'apartment_id', 'district', 'assigned_agent_id', 'title', 'phone', 'price', 'rooms', 'bedrooms', 'area_m2',
  'floor', 'total_floors', 'address', 'posted', 'description', 'url', 'first_seen'
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

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizedDescription(value) {
  return clean(value).normalize('NFKC').toLocaleLowerCase('ka-GE');
}

function hasExcludedDescription(value) {
  const description = normalizedDescription(value);
  return EXCLUDED_DESCRIPTION_PHRASES.some(phrase => description.includes(phrase));
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
  const options = { searches: DISTRICT_SEARCHES, interval: 5, pages: 5, once: false, headless: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--once') options.once = true;
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--url') options.searches = [{ district: 'Custom', url: argv[++i] }];
    else if (arg === '--interval') options.interval = Number(argv[++i]);
    else if (arg === '--pages') options.pages = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node main.js [--once] [--interval 5] [--pages 5] [--url URL] [--headless]');
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!Number.isFinite(options.interval) || options.interval < 5) {
    throw new Error('--interval must be at least 5 seconds');
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

function writeDashboard() {
  const combined = [
    ...Object.values(readJsonFile(DATA_PATH)).map(item => ({ ...item, source: item.source || 'MyHome' })),
    ...Object.values(readJsonFile(SS_DATA_PATH)).map(item => ({ ...item, source: 'SS.ge' }))
  ].filter(item => !item._baseline && !item._excluded && !hasExcludedDescription(item.description))
    .sort((a, b) => String(b.first_seen).localeCompare(String(a.first_seen)));

  const rows = combined.map(item => `<tr data-district="${html(item.district || 'Other')}">
    <td><span class="source ${item.source === 'SS.ge' ? 'ss' : ''}">${html(item.source)}</span></td>
    <td>${html(item.district || 'Other')}</td>
    <td>${html(item.assigned_agent_id || 'Pending')}</td>
    <td>${html(item.posted || item.first_seen)}</td>
    <td><a href="${html(item.url)}" target="_blank">${html(item.apartment_id)}</a></td>
    <td class="price">${html(item.price)}</td>
    <td><a href="tel:${html(item.phone)}">${html(item.phone)}</a></td>
    <td>${html(item.rooms)}</td><td>${html(item.area_m2)}</td>
    <td>${html(item.floor)}${item.total_floors ? `/${html(item.total_floors)}` : ''}</td>
    <td>${html(item.address)}</td>
  </tr>`).join('\n');

  if (!fs.existsSync(DASHBOARD_TEMPLATE_PATH)) {
    throw new Error(`Dashboard template is missing: ${DASHBOARD_TEMPLATE_PATH}`);
  }
  const content = combined.length
    ? `<table><thead><tr><th>Source</th><th>District</th><th>Assigned agent</th><th>Uploaded</th><th>ID</th><th>Price</th><th>Phone</th><th>Rooms</th><th>m²</th><th>Floor</th><th>Address</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">Waiting for a new apartment…</div>';
  const document = fs.readFileSync(DASHBOARD_TEMPLATE_PATH, 'utf8')
    .replace('{{LISTING_COUNT}}', String(combined.length))
    .replace('{{DASHBOARD_CONTENT}}', content);
  fs.writeFileSync(DASHBOARD_PATH, document, 'utf8');
}

function dashboardAuthorized(request, response) {
  const expectedUser = process.env.DASHBOARD_USER;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  if (!expectedUser || !expectedPassword) return true;
  const supplied = request.headers.authorization || '';
  const expected = `Basic ${Buffer.from(`${expectedUser}:${expectedPassword}`).toString('base64')}`;
  if (supplied === expected) return true;
  response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Apartment Watcher"' });
  response.end('Authentication required');
  return false;
}

function startWebServer() {
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (!dashboardAuthorized(request, response)) return;
    const files = {
      '/': [DASHBOARD_PATH, 'text/html; charset=utf-8'],
      '/live-results.html': [DASHBOARD_PATH, 'text/html; charset=utf-8'],
      '/dashboard.css': [DASHBOARD_CSS_PATH, 'text/css; charset=utf-8'],
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
    .filter(row => !row._baseline && !row._excluded && !hasExcludedDescription(row.description))
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
  return {
    apartment_id: id,
    district,
    source: 'MyHome',
    title: clean(source.dynamic_title),
    phone,
    price: gel == null ? '' : `${Number(gel).toLocaleString('en-US')}₾`,
    rooms: clean(source.room ?? source.room_type_id),
    bedrooms: clean(source.bedroom ?? source.bedroom_type_id),
    area_m2: clean(source.area),
    floor: clean(source.floor),
    total_floors: clean(source.total_floors),
    address: clean(source.address),
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

  const candidates = page.locator('button, a');
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const element = candidates.nth(i);
    try {
      const label = clean(await element.innerText({ timeout: 750 }));
      if (label && REVEAL_RE.test(label) && await element.isVisible()) {
        await element.click({ timeout: 3000 });
        await page.waitForTimeout(1200);
        break;
      }
    } catch { /* Try the next matching control. */ }
  }
  phone = await visiblePhone(page);
  if (phone) return phone;
  return normalizePhone(clean(await page.locator('body').innerText()));
}

async function meta(page, selector) {
  return clean(await page.locator(selector).first().getAttribute('content').catch(() => ''));
}

async function extractDetail(page, card) {
  if (card.api) {
    const detail = await getMyHomeStatement(card.id);
    const source = { ...card.api, ...detail };
    const correctUrl = myHomeUrl(source, card.id);
    let phone = normalizePhone(source.comment || '');
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
  let address = '';

  for (const data of await getJsonLd(page)) {
    for (const node of walkJson(data)) {
      if (node.offers && !Array.isArray(node.offers) && node.offers.price) {
        price = clean(`${node.offers.price} ${node.offers.priceCurrency || ''}`);
      }
      if (node.address && !Array.isArray(node.address) && typeof node.address === 'object') {
        const parts = ['streetAddress', 'addressLocality', 'addressRegion', 'addressCountry']
          .map(key => node.address[key]).filter(Boolean);
        address = clean(parts.join(', '));
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
    address,
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
  websiteApiToken = payload.token || payload.accessToken || payload.access_token || payload.jwt || payload.data?.token || payload.data?.accessToken || '';
  if (!websiteApiToken) throw new Error('Website API login response did not contain a bearer token');
  return true;
}

async function getDistributionAgents() {
  if (websiteApiAgents.length) return websiteApiAgents;
  if (!websiteApiToken && !await loginWebsiteApi()) return [];
  const payload = await websiteApiRequest('/api/Agents');
  const available = responseItems(payload)
    .map(agent => ({ ...agent, id: String(agent.userId ?? agent.user_id ?? agent.id ?? '') }))
    .filter(agent => agent.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const configuredIds = String(process.env.WEBSITE_API_AGENT_IDS || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  websiteApiAgents = configuredIds.length
    ? configuredIds.map(id => available.find(agent => agent.id === id)).filter(Boolean)
    : available;
  if (!websiteApiAgents.length) {
    throw new Error('Website API returned no agents for apartment distribution');
  }
  if (configuredIds.length && websiteApiAgents.length !== configuredIds.length) {
    const found = new Set(websiteApiAgents.map(agent => agent.id));
    const missing = configuredIds.filter(id => !found.has(id));
    throw new Error(`Configured Website API agent IDs were not found: ${missing.join(', ')}`);
  }
  return websiteApiAgents;
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
  return responseItems(payload).some(apartment =>
    String(apartment.description || '').includes(item.url) || String(apartment.description || '').includes(`MyHome ID: ${item.apartment_id}`)
  );
}

async function uploadApartmentToWebsite(item, agentId) {
  if (await websiteApiHasApartment(item)) return { existing: true };
  const form = new FormData();
  form.set('UploadedByUserId', agentId);
  form.set('Title', item.title || `Apartment ${item.apartment_id}`);
  form.set('Description', `${item.description || ''}\n\nSource: ${item.url}\nMyHome ID: ${item.apartment_id}`.trim());
  form.set('City', 'Tbilisi');
  form.set('Region', 'Tbilisi');
  form.set('District', item.district || 'Other');
  if (item.address) form.set('Address', item.address);
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
  return websiteApiRequest('/api/Apartments', { method: 'POST', body: form });
}

async function syncPendingWebsiteApartments(data, state) {
  if (!process.env.WEBSITE_API_EMAIL || !process.env.WEBSITE_API_PASSWORD) return 0;
  const pending = Object.values(data)
    .filter(item => !item._baseline && !item._excluded && !item._api_uploaded)
    .sort((a, b) => String(a.first_seen).localeCompare(String(b.first_seen)));
  if (!pending.length) return 0;
  const agents = await getDistributionAgents();
  let uploaded = 0;
  for (const item of pending) {
    const index = Number(state.api_assignment_index || 0) % agents.length;
    const agent = agents[index];
    try {
      await uploadApartmentToWebsite(item, agent.id);
      item.assigned_agent_id = agent.id;
      item._api_uploaded = true;
      item._api_uploaded_at = new Date().toISOString();
      delete item._api_error;
      state.api_assignment_index = Number(state.api_assignment_index || 0) + 1;
      saveData(data);
      saveState(state);
      uploaded += 1;
      console.log(`Uploaded MyHome ID ${item.apartment_id} to agent ${agent.id}.`);
    } catch (error) {
      item._api_error = error.message;
      saveData(data);
      console.error(`Website API upload failed for MyHome ID ${item.apartment_id}: ${error.message}`);
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
  const address = source.address || {};
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
    address: clean([address.streetTitle, address.streetNumber, address.subdistrictTitle].filter(Boolean).join(' ')),
    posted: clean(source.createDate),
    description: clean(source.description).slice(0, 2000),
    url: card.url,
    first_seen: new Date().toISOString()
  };
}

async function scan(context, data, state, options) {
  const cards = await collectDistrictCards(options.searches, options.pages);
  const byId = new Map(cards.map(card => [card.id, card]));
  const activeSearchKey = options.searches
    .map(search => `${search.district}:${searchKey(search.url, options.pages)}`)
    .sort().join('||');
  if (!state.initialized || state.engine_version !== 3 || state.myhome_search_key !== activeSearchKey) {
    for (const card of cards) {
      if (!data[card.id]) {
        data[card.id] = {
          apartment_id: card.id,
          district: card.district,
          url: card.url,
          first_seen: new Date().toISOString(),
          _baseline: true
        };
      }
    }
    state.initialized = true;
    state.engine_version = 3;
    state.myhome_search_key = activeSearchKey;
    state.initialized_at = new Date().toISOString();
    saveData(data);
    saveState(state);
    console.log(`Baseline ready with ${byId.size} current IDs from ${options.searches.length} district(s), ${options.pages} page(s) each. Waiting for newer uploads.`);
    return 0;
  }

  const unseen = cards.filter(card => !data[card.id]);
  // quantity_of_day is the age of the original listing. VIP renewals can update
  // last_updated, but they retain a non-zero age and are therefore not "new".
  const newest = unseen.filter(card => Number(card.api.quantity_of_day) === 0);
  const skippedOld = unseen.length - newest.length;
  console.log(`Checked ${byId.size} listings across all priority tiers; ${newest.length} are genuinely new.`);

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
  if (skippedOld) console.log(`Ignored ${skippedOld} unseen promoted/older listing(s).`);
  // Remember ignored IDs so pinned ads are not reconsidered every two minutes.
  for (const card of unseen.filter(card => Number(card.api.quantity_of_day) !== 0)) {
    data[card.id] = {
      apartment_id: card.id,
      district: card.district,
      url: card.url,
      first_seen: new Date().toISOString(),
      _baseline: true
    };
  }
  if (skippedOld) saveData(data);
  try {
    await syncPendingWebsiteApartments(data, state);
  } catch (error) {
    console.error(`Website API synchronization failed: ${error.message}`);
  }
  if (!newest.length) return 0;

  const detailPage = await context.newPage();
  let saved = 0;
  try {
    for (const card of newest.reverse()) {
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
        await sleep(1500);
      } catch (error) {
        console.error(`Could not read ID ${card.id}: ${error.message}`);
      }
    }
  } finally {
    await detailPage.close();
  }
  try {
    await syncPendingWebsiteApartments(data, state);
  } catch (error) {
    console.error(`Website API synchronization failed: ${error.message}`);
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
        await sleep(1500);
      } catch (error) {
        console.error(`Could not read SS.ge ID ${card.id}: ${error.message}`);
      }
    }
  } finally {
    await detailPage.close();
  }
  return saved;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const data = loadData();
  const ssData = loadSsData();
  const state = loadState();
  const excludedMyHome = markExcludedDescriptions(data);
  const excludedSs = markExcludedDescriptions(ssData);
  saveData(data);
  saveData(ssData, SS_DATA_PATH, SS_CSV_PATH);
  if (excludedMyHome + excludedSs) {
    console.log(`Filtered ${excludedMyHome + excludedSs} existing listing(s) by description.`);
  }
  console.log(`Saving results to ${CSV_PATH}`);
  console.log(`Saving SS.ge results to ${SS_CSV_PATH}`);
  console.log(`Watching MyHome districts: ${options.searches.map(search => search.district).join(', ')} (${options.pages} pages each).`);
  console.log(process.env.WEBSITE_API_EMAIL && process.env.WEBSITE_API_PASSWORD
    ? `Website API upload enabled at ${WEBSITE_API_URL}.`
    : 'Website API upload disabled; set WEBSITE_API_EMAIL and WEBSITE_API_PASSWORD to enable it.');
  console.log('Press Ctrl+C to stop. Current listings are the baseline; only newer uploads are saved.');

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
        await scan(context, data, state, options);
        await scanSs(context, ssData, state);
      } catch (error) {
        console.error(`Scan failed: ${error.message}`);
      }
      if (options.once) break;
      console.log(`Next check in ${options.interval} seconds.`);
      await sleep(options.interval * 1000);
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
