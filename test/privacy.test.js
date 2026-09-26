import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeListing, audit, redact, redactNames } from '../scripts/sanitize.js';

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

test('names: removed after explicit cues only, listing facts kept (phrasings from the real Facebook audit)', () => {
  const R = '[name removed]';
  assert.equal(redactNames('Hello, my name is Spencer. I am 25 years old'), `Hello, my name is ${R}. I am 25 years old`);
  assert.equal(redactNames('My name is Jane Doe, and I have a room for $1650/MONTHLY'), `My name is ${R}, and I have a room for $1650/MONTHLY`);
  assert.equal(redactNames("Hey everyone! I’m Sofia, I’m 24"), `Hey everyone! I’m ${R}, I’m 24`);
  assert.equal(redactNames("Hi! I'm Fran, 24, a software engineer"), `Hi! I'm ${R}, 24, a software engineer`);
  assert.equal(redactNames('Yo - I’m Chad and I’m looking for a roommate'), `Yo - I’m ${R} and I’m looking for a roommate`);
  assert.equal(redactNames("I'm Abby, I'm 25"), `I'm ${R}, I'm 25`);
  assert.equal(redactNames('DM Sarah for details. Contact John Smith: or text Kim'), `DM ${R} for details. Contact ${R}: or text ${R}`);
  assert.equal(redactNames('For more information, contact Mr. Robert Pape:'), `For more information, contact Mr. ${R}:`);
  assert.equal(redactNames('📩 Interested? Email Gaine at [email removed]'), `📩 Interested? Email ${R} at [email removed]`);
  assert.equal(redactNames('Reach out if interested!\n\nBest,\nMarco'), `Reach out if interested!\n\nBest,\n${R}`);
  // Not names: no cue, or the cue is followed by an ordinary word.
  for (const keep of [
    "Hi everyone, I'm looking for a roommate in Bed-Stuy",
    "Hey! I'm moving out Oct 1, room is $1,450/mo in Astoria",
    'Contact me for details. DM for info. Message Us anytime',
    'Private room in Williamsburg, available 10/1, $1,300/month, no broker fee',
    "I'm in Bushwick, 5 min to the J",
    'Studio in East Village — Tompkins Square Park, $2,400',
  ]) assert.equal(redactNames(keep), keep, keep);
  // Emails/phones and names together through redact().
  assert.equal(redact('My name is Sam, text 917-555-0123'), `My name is ${R}, text [phone removed]`);
});

test('audit fails if a cued name survives sanitizing', () => {
  const doc = { dataKind: 'REAL', listings: [{ ...mk({ description: 'Hi, my name is Spencer and the room is $1,500' }) }] };
  assert.ok(audit(doc, {}).some((p) => p.includes('personal name')));
  assert.deepEqual(audit({ dataKind: 'REAL', listings: [sanitizeListing(doc.listings[0])] }, {}), []);
});

test('names: third parties introduced in a post, and repeats of a cued name', () => {
  const R = '[name removed]';
  assert.equal(redactNames('Join Danielle in this spacious 4-bedroom. Meet Danielle:\n"I am 23"'), `Join ${R} in this spacious 4-bedroom. Meet ${R}:\n"I am 23"`);
  assert.equal(redactNames('My friend Laurin and I are coming to NYC.\n\nAbout Laurin:\n- communicative'), `My friend ${R} and I are coming to NYC.\n\n${'About'} ${R}:\n- communicative`);
  assert.equal(redactNames('posting on behalf of my friend Amy. Amy also has two cats. Happy to connect you with Amy'), `posting on behalf of my friend ${R}. ${R} also has two cats. Happy to connect you with ${R}`);
  assert.equal(redactNames('Join us in Bushwick! Meet the roommates: two nurses. About the apartment: 3BR'), 'Join us in Bushwick! Meet the roommates: two nurses. About the apartment: 3BR');
  assert.equal(redactNames('I’m from Jamaica, moving to Harlem'), 'I’m from Jamaica, moving to Harlem', 'places after "from" are not names');
});

test('names: redaction is stable — sanitizing twice changes nothing (the audit re-checks it)', () => {
  for (const s of [
    'For more information, contact Mr. Robert Pape:\nEmail: someone@example.com',
    'Hi, my name is Jane Doe. DM Sarah or ask for Dr. Kim. Best,\nMarco',
    'posting for my friend Amy. Amy has a cat. Meet Amy: 29, nurse',
  ]) {
    const once = redact(s);
    assert.equal(redactNames(once), once, s);
  }
});
