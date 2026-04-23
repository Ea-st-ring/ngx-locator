import test from 'node:test';
import assert from 'node:assert/strict';

import { extractOwner } from '../scripts/publish-github.mjs';

test('extractOwner handles git+https repository URL', () => {
  assert.equal(extractOwner('git+https://github.com/Ea-st-ring/ngx-locator.git'), 'Ea-st-ring');
});

test('extractOwner handles https repository URL', () => {
  assert.equal(extractOwner('https://github.com/openai/example-repo.git'), 'openai');
});

test('extractOwner handles ssh repository URL', () => {
  assert.equal(extractOwner('git@github.com:octocat/Hello-World.git'), 'octocat');
});

test('extractOwner returns null for non-github URL', () => {
  assert.equal(extractOwner('https://gitlab.com/org/repo.git'), null);
});

test('extractOwner returns null for invalid URL', () => {
  assert.equal(extractOwner('not-a-repo-url'), null);
  assert.equal(extractOwner(''), null);
  assert.equal(extractOwner(undefined), null);
});
