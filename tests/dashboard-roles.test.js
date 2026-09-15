const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const identitySource = source.slice(
  source.indexOf('function dashboardIdentity('),
  source.indexOf('async function authenticateViaWebsiteApi(')
);

function identity(role) {
  const context = {
    result: null,
    profile: { data: { user: { email: 'person@test', fullName: 'Test Person', userId: 'user-1', role } } },
    clean: value => String(value ?? '').replace(/\s+/g, ' ').trim(),
    decodeJwt: () => ({}),
    process: { env: {} }
  };
  vm.runInNewContext(`${identitySource}\nresult = dashboardIdentity({}, profile, 'person@test', '');`, context);
  return context.result;
}

test('Website API roles grant dashboard access only to supported roles', () => {
  assert.equal(identity('Agent').role, 'agent');
  assert.equal(identity('Manager').role, 'manager');
  assert.equal(identity('Administrator').role, 'admin');
  assert.equal(identity('Uploader').role, 'unauthorized');
  assert.equal(identity('').role, 'unauthorized');
});
