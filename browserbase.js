'use strict';

async function launchBrowserbase(chromium, { env = process.env, request = fetch, contextId } = {}) {
  const api = async (route, body) => {
    let response;
    try {
      response = await request(`https://api.browserbase.com/v1/${route}`, {
        method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { 'X-BB-API-Key': env.BROWSERBASE_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch {
      throw new Error('Browserbase API could not be reached.');
    }
    // Do not print responses or connection errors containing credentials.
    if (!response.ok) throw new Error(`Browserbase API returned HTTP ${response.status}. Check your key, plan and session limits.`);
    return response.json();
  };
  const project = env.BROWSERBASE_PROJECT_ID ? { projectId: env.BROWSERBASE_PROJECT_ID } : {};
  const body = { ...project, browserSettings: { solveCaptchas: false } };
  if (contextId) body.browserSettings.context = { id: contextId, persist: true };
  const session = await api('sessions', body);
  const release = () => api(`sessions/${encodeURIComponent(session.id)}`, { ...project, status: 'REQUEST_RELEASE' });
  let browser;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Missing browser context');
    context._browserbaseSessionUrl = `https://www.browserbase.com/sessions/${encodeURIComponent(session.id)}`;
    context._browserbaseExpiresAt = Date.parse(session.expiresAt);
    browser.on('disconnected', () => { context._browserbaseDisconnected = true; });
    context.close = async () => {
      try { await browser.close(); } finally { await release(); }
    };
    return context;
  } catch {
    if (browser) await browser.close().catch(() => {});
    await release().catch(() => {});
    throw new Error('Could not connect to the Browserbase session. Check your account and session availability.');
  }
}

module.exports = { launchBrowserbase };
