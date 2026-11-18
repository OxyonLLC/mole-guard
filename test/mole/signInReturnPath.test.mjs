// The "Sign in" return path — an open-redirect guard (2026-08-20).
//
// The sign-in control carries ?next=<path> so that signing in returns you to
// the page you were actually using. That parameter is attacker-controllable:
// an unchecked `next` turns winlew.co/linked-role/mole into an open redirect.
// The victim sees a genuine winlew.co link, approves a genuine Discord prompt,
// and lands somewhere else with the trust of the whole flow behind it.
//
// safeNextPath() is the only thing standing between those two facts, so every
// bypass shape is pinned here rather than left to a reading of the regex.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCORD_CLIENT_SECRET ||= 'test';
process.env.DISCORD_REDIRECT_URI ||= 'http://localhost/cb';
process.env.WINLEW_MINT ||= 'DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump';

const { safeNextPath } = await import('../../src/mole/web.js');

describe('safeNextPath: same-origin paths only', () => {
  test('ordinary internal paths survive intact', () => {
    assert.equal(safeNextPath('/events/'), '/events/');
    assert.equal(safeNextPath('/quiz/?a=1'), '/quiz/?a=1');
    assert.equal(safeNextPath('/verify/profile.html'), '/verify/profile.html');
  });

  test('protocol-relative is refused', () => {
    // "//evil.example" inherits the current scheme and is a full URL.
    assert.equal(safeNextPath('//evil.example/x'), null);
    assert.equal(safeNextPath('///evil.example'), null);
  });

  test('absolute URLs are refused, whatever the scheme', () => {
    assert.equal(safeNextPath('https://evil.example'), null);
    assert.equal(safeNextPath('http://evil.example'), null);
    assert.equal(safeNextPath('javascript:alert(1)'), null);
    assert.equal(safeNextPath('data:text/html,x'), null);
  });

  test('backslashes are refused — some parsers normalise them to slashes', () => {
    assert.equal(safeNextPath('/\\evil.example'), null);
    assert.equal(safeNextPath('\\\\evil.example'), null);
  });

  test('anything not starting with a single slash is refused', () => {
    assert.equal(safeNextPath('events/'), null);
    assert.equal(safeNextPath(''), null);
    assert.equal(safeNextPath(null), null);
    assert.equal(safeNextPath(undefined), null);
  });

  test('length is bounded, so a hostile value cannot bloat the session record', () => {
    const long = '/' + 'a'.repeat(5000);
    assert.equal(safeNextPath(long).length, 300);
  });

  test('leading and trailing whitespace cannot smuggle a scheme past the check', () => {
    assert.equal(safeNextPath('  https://evil.example  '), null);
    assert.equal(safeNextPath('  /events/  '), '/events/');
  });
});
