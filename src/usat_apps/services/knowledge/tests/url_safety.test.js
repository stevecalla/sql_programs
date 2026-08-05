'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { host_allowed, is_private_ip, check_url } = require('../url_safety');
const AL = ['usatriathlon.org'];

test('host_allowed matches apex and subdomains only', function () {
  assert.ok(host_allowed('usatriathlon.org', AL));
  assert.ok(host_allowed('www.usatriathlon.org', AL));
  assert.ok(host_allowed('help.usatriathlon.org', AL));
  assert.ok(!host_allowed('usatriathlon.org.evil.com', AL));
  assert.ok(!host_allowed('notusatriathlon.org', AL));
  assert.ok(!host_allowed('example.com', AL));
});

test('is_private_ip blocks internal ranges', function () {
  ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fd00::1'].forEach(function (ip) {
    assert.ok(is_private_ip(ip), ip + ' should be private');
  });
});
test('is_private_ip allows public addresses', function () {
  ['8.8.8.8', '104.18.0.1', '172.15.0.1', '172.32.0.1', '2606:4700::1'].forEach(function (ip) {
    assert.ok(!is_private_ip(ip), ip + ' should be public');
  });
});
test('malformed IP treated as unsafe', function () {
  assert.ok(is_private_ip('999.1.1.1'));
  assert.ok(is_private_ip(''));
});

test('check_url enforces protocol + allowlist', function () {
  assert.ok(check_url('https://www.usatriathlon.org/coaching', AL).ok);
  assert.strictEqual(check_url('ftp://usatriathlon.org', AL).ok, false);
  assert.strictEqual(check_url('http://evil.com', AL).ok, false);
  assert.strictEqual(check_url('not a url', AL).ok, false);
  const good = check_url('https://USATriathlon.org/x', AL);
  assert.strictEqual(good.host, 'usatriathlon.org');
});
