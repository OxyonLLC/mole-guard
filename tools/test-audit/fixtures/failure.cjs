'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('INTENTIONAL supervisor probe: child assertion fails', () => {
  assert.fail('Expected failure: supervisor must still write its post-test audit');
});
