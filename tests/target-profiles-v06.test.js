import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITY_STATUS,
  detectTargetProfile,
  getTargetProfile,
  isLiveVerified,
  planTargetDelivery,
} from '../extension/core/target-profiles.js';

test('v0.6 target profiles: known hosts map to dedicated adapters', () => {
  assert.equal(detectTargetProfile('chatgpt.com')?.id, 'chatgpt');
  assert.equal(detectTargetProfile('chat.deepseek.com')?.id, 'deepseek');
  assert.equal(detectTargetProfile('www.doubao.com')?.id, 'doubao');
  assert.equal(detectTargetProfile('www.qianwen.com')?.id, 'qianwen');
  assert.equal(detectTargetProfile('app.qwenwork.cn')?.id, 'qianwen');
});

test('v0.6 target profiles: CDP remains Qianwen primary and only a bounded auto-send fallback elsewhere', () => {
  assert.equal(getTargetProfile('qianwen').debugger, 'required-for-proven-v053-path');
  assert.equal(getTargetProfile('qianwen').preferredTextStrategy, 'cdp-input-insert-text');
  assert.deepEqual(getTargetProfile('qianwen').sendStrategies, ['cdp-enter']);

  for (const id of ['chatgpt', 'deepseek', 'doubao']) {
    const profile = getTargetProfile(id);
    assert.equal(profile.debugger, 'fallback-only-for-explicit-auto-send');
    assert.equal(profile.preferredTextStrategy, 'dom-browser-edit');
    assert.equal(profile.sendStrategies.at(-1), 'cdp-enter-fallback');
    assert.ok(profile.sendStrategies.includes('target-button'));
    assert.ok(profile.sendStrategies.includes('form-submit'));
  }
});

test('v0.6 target profiles: current live truth stays unverified while V0.5.3 Qianwen evidence is preserved as baseline', () => {
  const qianwen = getTargetProfile('qianwen');
  assert.equal(isLiveVerified(qianwen, 'manualText'), false);
  assert.equal(isLiveVerified(qianwen, 'autoSend'), false);
  assert.equal(isLiveVerified(qianwen, 'mixedMedia'), false);
  assert.equal(qianwen.live.manualText.status, CAPABILITY_STATUS.UNVERIFIED);
  assert.equal(qianwen.baseline.version, '0.5.3');
  assert.equal(qianwen.baseline.manualText, CAPABILITY_STATUS.LIVE_VERIFIED);
  assert.equal(qianwen.baseline.editableText, CAPABILITY_STATUS.LIVE_VERIFIED);
  assert.equal(qianwen.baseline.autoSend, CAPABILITY_STATUS.LIVE_VERIFIED);
  assert.equal(isLiveVerified(getTargetProfile('chatgpt'), 'autoSend'), false);
  assert.equal(getTargetProfile('chatgpt').live.autoSend.status, CAPABILITY_STATUS.UNVERIFIED);
});

test('v0.6 target delivery plans mixed media without confusing safe limits with official platform limits', () => {
  const chatgpt = getTargetProfile('chatgpt');
  assert.deepEqual(planTargetDelivery(chatgpt, { textChars: 2000, assetCount: 2 }), {
    mode: 'mixed', reason: 'structured-text+media', maxAssets: 6,
  });
  assert.deepEqual(planTargetDelivery(chatgpt, { textChars: 200_000, assetCount: 2 }), {
    mode: 'document+assets', reason: 'target-safe-text-threshold', maxAssets: 6,
  });
  assert.deepEqual(planTargetDelivery(chatgpt, { originalBinary: true }), {
    mode: 'attachment', reason: 'original-binary',
  });
});
