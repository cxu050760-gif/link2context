export const CAPABILITY_STATUS = Object.freeze({
  OFFICIAL: 'official',
  L2C_SAFE: 'l2c-safe',
  LIVE_VERIFIED: 'live-verified',
  UNVERIFIED: 'unverified',
  UNSUPPORTED: 'unsupported',
});

const PROFILES = Object.freeze({
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    hosts: ['chatgpt.com'],
    handoff: ['text', 'attachment', 'mixed'],
    safeTextChars: 120_000,
    maxContextImages: 6,
    preferredTextStrategy: 'dom-browser-edit',
    sendStrategies: ['target-button', 'form-submit', 'cdp-enter-fallback'],
    debugger: 'fallback-only-for-explicit-auto-send',
    live: {
      manualText: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      mixedMedia: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      autoSend: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
    },
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    hosts: ['chat.deepseek.com'],
    handoff: ['text', 'attachment', 'mixed'],
    safeTextChars: 100_000,
    maxContextImages: 4,
    preferredTextStrategy: 'dom-browser-edit',
    sendStrategies: ['target-button', 'form-submit', 'cdp-enter-fallback'],
    debugger: 'fallback-only-for-explicit-auto-send',
    live: {
      manualText: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      mixedMedia: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      autoSend: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
    },
  },
  doubao: {
    id: 'doubao',
    label: 'Doubao / 豆包',
    hosts: ['doubao.com'],
    handoff: ['text', 'attachment', 'mixed'],
    safeTextChars: 100_000,
    maxContextImages: 6,
    preferredTextStrategy: 'dom-browser-edit',
    sendStrategies: ['target-button', 'form-submit', 'cdp-enter-fallback'],
    debugger: 'fallback-only-for-explicit-auto-send',
    live: {
      manualText: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      mixedMedia: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      autoSend: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
    },
  },
  qianwen: {
    id: 'qianwen',
    label: 'Qianwen / 千问',
    hosts: ['qianwen.com', 'qwenwork.cn'],
    handoff: ['text', 'attachment', 'mixed'],
    safeTextChars: 180_000,
    maxContextImages: 6,
    preferredTextStrategy: 'cdp-input-insert-text',
    sendStrategies: ['cdp-enter'],
    debugger: 'required-for-proven-v053-path',
    live: {
      manualText: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      editableText: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      mixedMedia: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      autoSend: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
    },
    baseline: {
      version: '0.5.3',
      verifiedAt: '2026-08-22',
      manualText: CAPABILITY_STATUS.LIVE_VERIFIED,
      editableText: CAPABILITY_STATUS.LIVE_VERIFIED,
      autoSend: CAPABILITY_STATUS.LIVE_VERIFIED,
    },
  },
});

function hostMatches(host, known) {
  return host === known || host.endsWith(`.${known}`);
}

export function targetProfiles() {
  return Object.values(PROFILES).map((profile) => structuredClone(profile));
}

export function getTargetProfile(id) {
  const profile = PROFILES[String(id || '').toLowerCase()];
  return profile ? structuredClone(profile) : null;
}

export function detectTargetProfile(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!host) return null;
  for (const profile of Object.values(PROFILES)) {
    if (profile.hosts.some((known) => hostMatches(host, known))) return structuredClone(profile);
  }
  return null;
}

export function capabilityEvidence(profile, capability) {
  const entry = profile?.live?.[capability];
  if (!entry) return { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null };
  return { status: entry.status || CAPABILITY_STATUS.UNVERIFIED, verifiedAt: entry.verifiedAt || null };
}

export function isLiveVerified(profile, capability) {
  return capabilityEvidence(profile, capability).status === CAPABILITY_STATUS.LIVE_VERIFIED;
}

export function planTargetDelivery(profile, {
  textChars = 0,
  assetCount = 0,
  originalBinary = false,
} = {}) {
  if (originalBinary) return { mode: 'attachment', reason: 'original-binary' };
  const safeTextChars = Math.max(1, Number(profile?.safeTextChars) || 100_000);
  const allowedAssets = Math.max(0, Number(profile?.maxContextImages) || 0);
  if (textChars > safeTextChars) {
    return {
      mode: assetCount > 0 ? 'document+assets' : 'document',
      reason: 'target-safe-text-threshold',
      maxAssets: allowedAssets,
    };
  }
  if (assetCount > 0 && profile?.handoff?.includes('mixed')) {
    return { mode: 'mixed', reason: 'structured-text+media', maxAssets: allowedAssets };
  }
  return { mode: 'text', reason: 'structured-inline', maxAssets: allowedAssets };
}
