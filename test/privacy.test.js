import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeListing, audit, redact } from '../scripts/sanitize.js';

const mk = (over) => ({ id: 'roomster:1', source: 'roomster', dataKind: 'REAL', title: 'Room', description: '', contactEmails: [], contactPhones: [], address: null, ...over });

test('sanitize removes emails and phone numbers but keeps prices, dates and listing numbers', () => {
  assert.equal(redact('Text me at (917) 555-0123 or 917.555.0199, email jo.doe+nyc@example.com'), 'Text me at [phone removed] or [phone removed], email [email removed]');
  assert.equal(redact('$1,450/mo, available 11/01/2026, 2 blocks from the J, 1,200 sq ft'), '$1,450/mo, available 11/01/2026, 2 blocks from the J, 1,200 sq ft');
  const l = sanitizeListing(mk({ description: 'Call 212-555-0100', contactPhones: ['2125550100'], address: '12 Main St Apt 3' }));
  assert.equal(l.description, 'Call [phone removed]');
  assert.deepEqual(l.contactPhones, []);
  assert.equal(l.address, null, 'addresses of individual posters are dropped');
  assert.equal(sanitizeListing(mk({ source: 'junehomes', address: '100 Business Ave' })).address, '100 Business Ave', 'business addresses kept');
});

test('audit fails on unsanitized output and on listing text in status.json', () => {
  const dirty = { listings: [mk({ description: 'email me: a@b.co' })] };
  assert.ok(audit(dirty, {}).some((p) => /email/.test(p)));
  const clean = { listings: [sanitizeListing(dirty.listings[0])] };
  assert.deepEqual(audit(clean, { sources: [] }), []);
  const text = 'A long enough description of a lovely room in Bushwick near the train';
  assert.ok(audit({ listings: [mk({ description: text })] }, { note: text }).includes('status.json contains listing text'));
});
