const REDACTION_PATTERNS = [
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /\/bot[^/\s]{8,}(?=\/)/gi, replacement: '/bot[REDACTED]' },
  { pattern: /bot\d{6,}:[A-Za-z0-9_-]{16,}/gi, replacement: 'bot[REDACTED]' },
  { pattern: /\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, replacement: '[TELEGRAM_TOKEN_REDACTED]' },
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replacement: '[UUID_REDACTED]' },
  { pattern: /\b(ou|cli|oc|chat|msg)_[A-Za-z0-9_-]+\b/gi, replacement: '$1_[REDACTED]' },
  { pattern: /\b(?:app_?secret|appSecret|botToken|access_token|tenant_access_token|refresh_token|DASHBOARD_TOKEN)\b\s*[:=]\s*["']?[^"',\s}]+/gi, replacement: '$1=[REDACTED]' },
  { pattern: /\b(token|secret|password)\b=([^&\s]+)/gi, replacement: '$1=[REDACTED]' },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[EMAIL_REDACTED]' },
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP_REDACTED]' },
  { pattern: /\/Users\/[^\s<>"'`]+/g, replacement: '/Users/[REDACTED]' },
  { pattern: /\bPID\s*[:：=]\s*\d+\b/gi, replacement: 'PID: [REDACTED]' },
  { pattern: /\b\d{8,}\b/g, replacement: '[NUMBER_REDACTED]' }
];

function redactSensitiveText (value) {
  return REDACTION_PATTERNS.reduce((text, rule) => text.replace(rule.pattern, rule.replacement), String(value ?? ''));
}

module.exports = {
  REDACTION_PATTERNS,
  redactSensitiveText
};
