// Revoking an invitation nobody accepted (js/sheets.js confirmRevokeInvite, wired from js/screen-profile.js).
//
// The invite sheet has always said "You can revoke any invite anytime" and the homepage "Revoke any invite in one tap",
// and until now no screen could: js/ read public.athlete_invites in two places and wrote it in one, the insert. A
// signed-in regression against production on 2026-09-16 created a link invitation and found nothing that could end it
// short of deleting the child. These run the real sheet against the harness's in-memory database
// (tools/adult-harness/fake-supabase.js), which holds only synthetic rows, and drive its handlers against a small
// stand-in for the DOM. The two tests that read source rather than run it say so in their names.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/\r\n/g, '\n');
const INVITE = '00000000-0000-4000-8000-0000000000b1';

// The source of one top-level function, found by its header and balanced braces.
function extract(source, header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, 'missing: ' + header);
  for (let i = source.indexOf('{', start + header.length - 1), depth = 0; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced: ' + header);
}

// A stand-in for sheet() and the element operations this sheet uses. An element exists only if the markup carries its
// id, and a button remembers whether it was disabled, which is how a failed revoke is told from a successful one.
function fakeSheets() {
  const opened = [];
  const sheet = html => {
    const els = {};
    const bg = {
      html, removed: false, remove() { this.removed = true; },
      querySelector(sel) {
        const id = sel.startsWith('#') ? sel.slice(1) : null;
        if (!id || !html.includes('id="' + id + '"')) return null;
        return (els[id] ||= { id, textContent: '', innerHTML: '', disabled: false, onclick: null });
      },
    };
    opened.push(bg);
    return bg;
  };
  return { opened, sheet, last: () => opened[opened.length - 1] };
}

// The real sheet over the harness's database, with the browser globals it calls replaced by recorders.
function harness({ failWith = null } = {}) {
  const ui = { toasts: [], renders: [], errors: [] };
  const sheets = fakeSheets();
  const ctx = vm.createContext({
    console: { error(...a) { ui.errors.push(a[0]); }, log() {} },
    crypto: require('node:crypto').webcrypto, URLSearchParams, location: { search: '?scenario=family' },
  });
  ctx.window = ctx;
  vm.runInContext(read('tools/adult-harness/fake-supabase.js'), ctx);
  const client = ctx.window.supabase.createClient();
  // A database that refuses the write, to prove the sheet says so and keeps itself open.
  const sb = failWith ? { from: name => ({ update: () => ({ eq: () => ({ is: () => ({ select: async () => ({ data: null, error: failWith }) }) }) }) }) } : client;
  const globals = {
    sb, sheet: sheets.sheet,
    H: (strings, ...v) => strings.reduce((a, s, i) => a + s + (v[i] ?? ''), ''),
    esc: s => (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    toast: m => ui.toasts.push(m), renderApp: tab => ui.renders.push(tab), reportError: () => {}, console: ctx.console,
  };
  const confirmRevokeInvite = new Function(...Object.keys(globals),
    extract(read('js/sheets.js'), 'function confirmRevokeInvite(invite){') + '\nreturn confirmRevokeInvite;')(...Object.values(globals));
  const db = ctx.window.__harness.db;
  return { confirmRevokeInvite, ui, sheets, db, calls: ctx.window.__harness.calls, invite: () => db.athlete_invites.find(i => i.id === INVITE) };
}

const press = async (bg, id) => { const b = bg.querySelector(id); assert.ok(b, 'no ' + id + ' button'); await b.onclick({ target: b }); return b; };

test('the sheet says what revoking does, and what it does not touch', () => {
  const h = harness();
  h.confirmRevokeInvite(h.invite());
  const html = h.sheets.last().html;
  assert.match(html, /Revoke this invitation\?/);
  assert.match(html, /link and its code stop working/);
  assert.match(html, /already accepted keeps the access/, 'it must not claim to remove access somebody already has');
  assert.match(html, /id="yes"/); assert.match(html, /id="no"/);
});

test('an editor revokes a pending invitation, and the row stays with its history', async () => {
  const h = harness();
  const before = h.invite();
  assert.equal(before.revoked_at, null, 'the harness seeds a live invitation');
  h.confirmRevokeInvite(before);
  await press(h.sheets.last(), '#yes');

  const after = h.invite();
  assert.ok(after, 'the row is kept, not deleted: it records who invited whom');
  assert.ok(after.revoked_at, 'revoked_at is set');
  assert.equal(after.token, before.token, 'the token is left alone; the row is what stops it working');
  assert.equal(after.accepted_at, null);
  assert.deepEqual(h.ui.toasts, ['Invitation revoked']);
  assert.deepEqual(h.ui.renders, ['profile'], 'the screen reloads, which drops it from the pending list');
  assert.equal(h.sheets.last().removed, true);
});

test('a revoked invitation no longer shows as pending, and its access grants are untouched', async () => {
  const h = harness();
  h.confirmRevokeInvite(h.invite());
  await press(h.sheets.last(), '#yes');

  // What the Profile screen's own query would return: unaccepted and not revoked. These lists are built inside the
  // harness's context, so they are compared as JSON rather than with deepEqual, which counts the realm as a difference.
  const pending = h.db.athlete_invites.filter(i => i.accepted_at == null && i.revoked_at == null);
  assert.equal(pending.length, 0, 'nothing is left for the screen to list');
  assert.equal(JSON.stringify(h.calls.filter(([, table]) => table === 'athlete_access')), '[]',
    'access somebody already accepted is not touched');
  assert.equal(JSON.stringify(h.calls.filter(([, table]) => table === 'athlete_invites').map(([op]) => op)), '["update"]',
    'one write, and it is the revoke');
});

test('a second revoke says so and does not move the time it was revoked', async () => {
  const h = harness();
  h.confirmRevokeInvite(h.invite());
  await press(h.sheets.last(), '#yes');
  const when = h.invite().revoked_at;

  h.confirmRevokeInvite(h.invite());
  await press(h.sheets.last(), '#yes');
  assert.equal(h.invite().revoked_at, when, 'the filter is on revoked_at being null, so the second write matches nothing');
  assert.deepEqual(h.ui.toasts, ['Invitation revoked', 'That invitation was already revoked']);
});

test('a database failure keeps the sheet open and says nothing was revoked', async () => {
  const h = harness({ failWith: { code: '42501', message: 'new row violates row-level security policy' } });
  h.confirmRevokeInvite(h.invite());
  const button = await press(h.sheets.last(), '#yes');

  assert.equal(h.invite().revoked_at, null, 'the invitation is still live');
  assert.deepEqual(h.ui.toasts, ['Could not revoke the invitation']);
  assert.deepEqual(h.ui.renders, [], 'nothing is reloaded on a failure');
  assert.equal(h.sheets.last().removed, false, 'the sheet stays, so the parent can try again');
  assert.equal(button.disabled, false, 'and the button comes back');
  assert.equal(button.innerHTML, 'Revoke invitation');
});

test('Keep it closes the sheet and changes nothing', async () => {
  const h = harness();
  h.confirmRevokeInvite(h.invite());
  await press(h.sheets.last(), '#no');
  assert.equal(h.invite().revoked_at, null);
  assert.deepEqual(h.ui.toasts, []);
  assert.equal(h.sheets.last().removed, true);
});

test('source: Profile offers Revoke to an editor only, and binds it to the sheet', () => {
  const profile = read('js/screen-profile.js');
  assert.match(profile, /canEdit\?H`<button class="btn sm ghost" data-revoke-invite="\$\{esc\(i\.id\)\}">Revoke<\/button>`:''/,
    'the control is rendered for an editor and left out for a family viewer');
  assert.match(profile, /querySelectorAll\('\[data-revoke-invite\]'\)/, 'and it is bound');
  assert.match(profile, /confirmRevokeInvite\(row\)/, 'to the confirmation sheet, with the invitation it belongs to');
  assert.match(profile, /athlete_invites'\)\.select\('\*'\)[\s\S]{0,120}is\('revoked_at',null\)/,
    'the list the screen reads already excludes revoked invitations');
});

test('source: the redeem screen already refuses a revoked invitation', () => {
  const invites = read('js/invites.js');
  assert.match(invites, /revoked:'This invite was turned off'/, 'invite_preview reports revoked, and the screen names it');
  assert.match(invites, /\/revoked\/i\.test\(m\)/, 'and accept_invite refusing it is turned into a sentence');
});
