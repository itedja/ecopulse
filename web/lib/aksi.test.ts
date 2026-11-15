import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, noteFor, toggleReaction, aksiError, ago, weekDots, jakartaDay, REACTIONS, FLAG_REASONS } from './aksi';

test('both languages have the same wording keys, rules and error messages', () => {
  assert.deepEqual(Object.keys(A.id).sort(), Object.keys(A.en).sort());
  assert.equal(A.id.rules.length, A.en.rules.length);
  assert.deepEqual(Object.keys(A.id.errors).sort(), Object.keys(A.en.errors).sort());
  for (const r of REACTIONS) assert.ok(A.id.reactions[r] && A.en.reactions[r]);
  for (const f of FLAG_REASONS) assert.ok(A.id.flagReasons[f] && A.en.flagReasons[f]);
});

test('the rules cover children, safety near fires, and accusations', () => {
  const all = A.en.rules.join(' ');
  assert.match(all, /under 18/);
  assert.match(all, /Do not go near fires/);
  assert.match(all, /Do not accuse/);
});

test('a rejection reason is shown in the reader’s language', () => {
  const note = 'Wajah anak terlihat. / A child’s face is visible.';
  assert.equal(noteFor(note, 'id'), 'Wajah anak terlihat.');
  assert.equal(noteFor(note, 'en'), 'A child’s face is visible.');
  assert.equal(noteFor('Only one language', 'id'), 'Only one language');
  assert.equal(noteFor(null, 'en'), '');
});

test('tapping a quick comment adds it, tapping again removes it', () => {
  const p = { reactions: { proud: 2 }, my_reactions: [] as ('proud' | 'good_job' | 'congrats' | 'thanks')[] };
  const on = toggleReaction(p, 'proud');
  assert.equal(on.reactions.proud, 3); assert.deepEqual(on.my_reactions, ['proud']);
  const off = toggleReaction(on, 'proud');
  assert.equal(off.reactions.proud, 2); assert.deepEqual(off.my_reactions, []);
  assert.equal(toggleReaction({ reactions: {}, my_reactions: ['thanks'] as 'thanks'[] }, 'thanks').reactions.thanks, 0);
});

test('database error codes are recognised', () => {
  assert.equal(aksiError(new Error('P0001: adults_only')), 'adults_only');
  assert.equal(aksiError({ message: 'duplicate_photo' }), 'duplicate_photo');
  assert.equal(aksiError('boom'), 'generic');
});

test('times read naturally', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  assert.equal(ago('2026-11-15T11:30:00Z', now, 'en'), '30 min ago');
  assert.equal(ago('2026-11-15T09:00:00Z', now, 'id'), '3 jam lalu');
  assert.equal(ago('2026-11-13T12:00:00Z', now, 'en'), '2 d ago');
});

test('the week row runs Monday to Sunday in Jakarta time', () => {
  // Sunday 15 Nov 2026, 23:30 in Jakarta is still Sunday there (16:30 UTC).
  const now = Date.parse('2026-11-15T16:30:00Z');
  assert.equal(jakartaDay(now), '2026-11-15');
  assert.equal(jakartaDay(Date.parse('2026-11-15T17:30:00Z')), '2026-11-16');   // past midnight in Jakarta
  const w = weekDots(['2026-11-09', '2026-11-15', '2026-11-01'], now);
  assert.equal(w.length, 7);
  assert.equal(w[0].date, '2026-11-09'); assert.equal(w[6].date, '2026-11-15');
  assert.deepEqual(w.map((d) => d.done), [true, false, false, false, false, false, true]);
  assert.equal(w[6].today, true);
  const mid = weekDots([], Date.parse('2026-11-11T03:00:00Z'));
  assert.deepEqual(mid.map((d) => d.future), [false, false, false, true, true, true, true]);
});
