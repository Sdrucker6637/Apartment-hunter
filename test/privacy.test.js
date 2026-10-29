import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeListing, audit } from '../scripts/sanitize.js';

const mk = (over) => ({ id: 'roomster:1', source: 'roomster', dataKind: 'REAL', title: 'Room', description: '', contactEmails: [], contactPhones: [], address: null, ...over });

test('contact details in posts are published as posted', () => {
  const text = 'Hi, my name is Sam. Text me at (917) 555-0123 or email jo.doe+nyc@example.com. $1,450/mo, available 11/01/2026';
  const l = sanitizeListing(mk({ title: 'Call Sam 917-555-0123', description: text, contactPhones: ['9175550123'], contactEmails: ['jo.doe+nyc@example.com'] }));
  assert.equal(l.description, text);
  assert.equal(l.title, 'Call Sam 917-555-0123');
  assert.deepEqual(l.contactPhones, ['9175550123']);
  assert.deepEqual(l.contactEmails, ['jo.doe+nyc@example.com']);
  assert.deepEqual(audit({ dataKind: 'REAL', listings: [l] }, { dataKind: 'REAL' }), [], 'contact details do not fail the audit');
});

test('street addresses of individual posters are still dropped', () => {
  assert.equal(sanitizeListing(mk({ address: '12 Main St Apt 3' })).address, null);
  assert.equal(sanitizeListing(mk({ source: 'junehomes', address: '100 Business Ave' })).address, '100 Business Ave', 'business addresses kept');
});

test('audit fails on non-REAL data and on listing text in status.json', () => {
  assert.ok(audit({ listings: [mk({ dataKind: 'SAMPLE' })] }, {}).some((p) => /not REAL/.test(p)));
  const text = 'A long enough description of a lovely room in Bushwick near the train';
  assert.ok(audit({ listings: [mk({ description: text })] }, { note: text }).includes('status.json contains listing text'));
  assert.ok(audit({ listings: [] }, { note: 'a@b.co' }).includes('status.json contains an email address'));
});
