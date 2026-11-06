const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vault = require('../glassplayer-vault.cjs');

async function runTests() {
  console.log('[1] Testing Vault Directory...');
  const vaultDir = vault.getVaultDir();
  assert(fs.existsSync(vaultDir), 'Vault dir should exist');
  console.log('  PASS: Vault dir is', vaultDir);

  console.log('[2] Testing Document Read...');
  const manifest = await vault.getManifest();
  assert(manifest && typeof manifest.revision === 'number', 'Manifest should have revision');
  console.log('  PASS: Manifest revision is', manifest.revision);

  console.log('[3] Testing SHA-256 Dirty Checking...');
  const userModel = await vault.readEntry('userModel.json');
  assert(userModel && userModel.buffer, 'userModel.json should exist');
  const dirtyRes = await vault.writeEntry('userModel.json', userModel.buffer);
  assert.strictEqual(dirtyRes.written, false, 'Should not write identical content');
  assert.strictEqual(dirtyRes.reason, 'sha256_clean', 'Reason should be sha256_clean');
  console.log('  PASS: Unchanged write skipped via SHA-256 dirty checking');

  console.log('[4] Testing OCC (Optimistic Concurrency Control)...');
  try {
    await vault.writeEntry('manifest.json', JSON.stringify({ revision: manifest.revision + 1 }), { 'X-GP-Base': String(manifest.revision - 1) });
    assert.fail('OCC should have rejected mismatched revision');
  } catch (err) {
    assert.strictEqual(err.status, 409, 'Status should be 409 Conflict');
    console.log('  PASS: Mismatched X-GP-Base rejected with 409 Conflict');
  }

  console.log('[5] Testing Cover Deduplication...');
  const coversDir = path.join(vaultDir, 'covers');
  const coverFiles = fs.existsSync(coversDir) ? fs.readdirSync(coversDir) : [];
  if (coverFiles.length > 0) {
    const testCover = 'covers/' + coverFiles[0];
    const dedupRes = await vault.writeEntry(testCover, Buffer.from('dummy-duplicate-data'));
    assert.strictEqual(dedupRes.written, false, 'Should skip existing cover');
    assert.strictEqual(dedupRes.reason, 'cover_dedup', 'Reason should be cover_dedup');
    console.log('  PASS: Existing cover write skipped via deduplication');
  }

  console.log('[6] Testing Path Validation...');
  assert.strictEqual(vault.isValidPath('manifest.json'), true);
  assert.strictEqual(vault.isValidPath('local.json'), true);
  assert.strictEqual(vault.isValidPath('trackCache.json'), true);
  assert.strictEqual(vault.isValidPath('trackFeatures.json'), true);
  assert.strictEqual(vault.isValidPath('behaviorEvents.json'), true);
  assert.strictEqual(vault.isValidPath('userModel.json'), true);
  assert.strictEqual(vault.isValidPath('recommendations.json'), true);
  assert.strictEqual(vault.isValidPath('covers/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png'), true);
  assert.strictEqual(vault.isValidPath('covers/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.webp'), true);
  assert.strictEqual(vault.isValidPath('malicious/../hack.js'), false);
  assert.strictEqual(vault.isValidPath('random.txt'), false);
  console.log('  PASS: Path validation passes for valid docs and covers, rejects invalid paths');

  console.log('[7] Testing Protocol Web Request Handling...');
  const getReq = new Request('app://glassplayer/db/manifest.json', { method: 'GET' });
  const getRes = await vault.handleProtocolRequest(getReq);
  assert.strictEqual(getRes.status, 200);
  const data = await getRes.json();
  assert(data && typeof data.revision === 'number');
  console.log('  PASS: Protocol GET /db/manifest.json -> 200 OK, revision:', data.revision);

  const forbiddenReq = new Request('app://glassplayer/db/manifest.json', { method: 'PUT', body: JSON.stringify({ revision: 99 }) });
  const forbiddenRes = await vault.handleProtocolRequest(forbiddenReq);
  assert.strictEqual(forbiddenRes.status, 403);
  console.log('  PASS: Protocol PUT without X-GP -> 403 Forbidden');

  const conflictReq = new Request('app://glassplayer/db/manifest.json', {
    method: 'PUT',
    headers: { 'X-GP': '1', 'X-GP-Base': '999' },
    body: JSON.stringify({ revision: 1000 })
  });
  const conflictRes = await vault.handleProtocolRequest(conflictReq);
  assert.strictEqual(conflictRes.status, 409);
  console.log('  PASS: Protocol PUT with mismatched X-GP-Base -> 409 Conflict');

  const notFoundReq = new Request('app://glassplayer/db/invalid-file.txt', { method: 'GET' });
  const notFoundRes = await vault.handleProtocolRequest(notFoundReq);
  assert.strictEqual(notFoundRes.status, 404);
  console.log('  PASS: Protocol GET invalid path -> 404 Not Found');

  console.log('[8] Testing Package.json...');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.strictEqual(pkg.main, 'main.cjs');
  assert.strictEqual(pkg.scripts.start, 'electron .');
  console.log('  PASS: package.json has main: main.cjs and start: electron .');

  console.log('\n========================================');
  console.log('ALL VAULT & ELECTRON CONFIG TESTS PASSED!');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
