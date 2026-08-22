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
    handoff: ['text', 'attachment'],
    preferredTextStrategy: 'dom-or-browser-input',
    sendStrategies: ['target-button', 'form-submit', 'browser-enter'],
    debugger: 'not-required-by-default',
    live: {
      manualText: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      autoSend: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
    },
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    hosts: ['chat.deepseek.com'],
    handoff: ['text', 'attachment'],
    preferredTextStrategy: 'dom-or-browser-input',
    sendStrategies: ['target-button', 'form-submit', 'browser-enter'],
    debugger: 'not-required-by-default',
    live: {
      manualText: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      autoSend: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
    },
  },
  doubao: {
    id: 'doubao',
    label: 'Doubao / 豆包',
    hosts: ['doubao.com'],
    handoff: ['text', 'attachment'],
    preferredTextStrategy: 'dom-or-browser-input',
    sendStrategies: ['target-button', 'form-submit', 'browser-enter'],
    debugger: 'not-required-by-default',
    live: {
      manualText: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
      autoSend: { status: CAPABILITY_STATUS.UNVERIFIED, verifiedAt: null },
    },
  },
  qianwen: {
    id: 'qianwen',
    label: 'Qianwen / 千问',
    hosts: ['qianwen.com', 'qwenwork.cn'],
    handoff: ['text', 'attachment'],
    preferredTextStrategy: 'cdp-input-insert-text',
    sendStrategies: ['cdp-enter'],
    debugger: 'required-for-current-live-verified-path',
    live: {
      manualText: { status: CAPABILITY_STATUS.LIVE_VERIFIED, verifiedAt: '2026-08-22' },
      editableText: { status: CAPABILITY_STATUS.LIVE_VERIFIED, verifiedAt: '2026-08-22' },
      autoSend: { status: CAPABILITY_STATUS.LIVE_VERIFIED, verifiedAt: '2026-08-22' },
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
