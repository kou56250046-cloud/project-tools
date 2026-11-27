// FIX-024: 配信元で開いたときは台帳を使わせない。ローカルの確認用の配信と file:// は使える
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHostedLocation } from '../src/core/screens.js';

test('GitHub Pages などの配信元では台帳を使わせない。file:// とローカルの配信は使える', () => {
  assert.equal(isHostedLocation('https:', 'kou56250046-cloud.github.io'), true);
  assert.equal(isHostedLocation('http:', 'example.com'), true);
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'dev.localhost']) assert.equal(isHostedLocation('http:', host), false, host);
  assert.equal(isHostedLocation('file:', ''), false);
});
