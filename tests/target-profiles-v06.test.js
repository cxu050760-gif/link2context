import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITY_STATUS,
  detectTargetProfile,
  getTargetProfile,
  isLiveVerified,
} from '../extension/core/target-profiles.js';

test('v0.6 target profiles: known hosts map to dedicated adapters', () => {
  assert.equal(detectTargetProfile('chatgpt.com')?.id, 'chatgpt');
  assert.equal(detectTargetProfile('chat.deepseek.com')?.id, 'deepseek');
  assert.equal(detectTargetProfile('www.doubao.com')?.id, 'doubao');
  assert.equal(detectTargetProfile('www.qianwen.com')?.id, 'qianwen');
  assert.equal(detectTargetProfile('app.qwenwork.cn')?.id, 'qianwen');
});

test('v0.6 target profiles: CDP is Qianwen-specific, not a universal default', () => {
  assert.equal(getTargetProfile('qianwen').debugger, 'required-for-current-live-verified-path');
  for (const id of ['chatgpt', 'deepseek', 'doubao']) {
    const profile = getTargetProfile(id);
    assert.equal(profile.debugger, 'not-required-by-default');
    assert.ok(!profile.sendStrategies.some((strategy) => strategy.startsWith('cdp-')));
  }
});

test('v0.6 target profiles: live truth distinguishes verified from planned support', () => {
  assert.equal(isLiveVerified(getTargetProfile('qianwen'), 'manualText'), true);
  assert.equal(isLiveVerified(getTargetProfile('qianwen'), 'autoSend'), true);
  assert.equal(isLiveVerified(getTargetProfile('chatgpt'), 'autoSend'), false);
  assert.equal(getTargetProfile('chatgpt').live.autoSend.status, CAPABILITY_STATUS.UNVERIFIED);
});
