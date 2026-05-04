const { execFile } = require('child_process');

const PROCESS_NAMES = {
  '/Applications/Telegram': 'Telegram',
  Telegram: 'Telegram',
  '/Applications/Google Chrome.app': 'Google Chrome',
  '/Applications/Google Chrome': 'Google Chrome',
  'Google Chrome': 'Google Chrome',
  '/Applications/M-iM': '飞书/Lark',
  '/Applications/Lark.app': '飞书/Lark',
  Lark: '飞书/Lark',
  Feishu: '飞书/Lark',
  claude: 'Claude',
  '/Library/Input': '输入法',
  input: '输入法',
  Spotlight: 'Spotlight (聚焦搜索)',
  mds_stores: 'mds_stores (索引)',
  corespotlightd: 'corespotlightd (索引)',
  Terminal: 'Terminal (终端)',
  node: 'Node.js',
  '/usr/local/bin/node': 'Node.js',
  python: 'Python',
  'O+Connect': 'OPPO Connect',
  WeChatAppEx: '微信',
  WeChat: '微信',
  'com.tencent.xinWeChat': '微信',
  '/Applications/M-eM': '微信'
};

function getProcessDisplayName (cmd) {
  if (!cmd) return '?';
  for (const [key, val] of Object.entries(PROCESS_NAMES)) {
    if (cmd.includes(key)) return val;
  }
  const m = cmd.match(/\/([^/\s]+)\.app\//);
  if (m) {
    const app = m[1];
    if (app.startsWith('M-iM')) return '飞书/Lark';
    if (app.includes('Telegram')) return 'Telegram';
    if (app.includes('Google')) return 'Google Chrome';
    if (app.includes('Lark') || app.includes('Feishu')) return '飞书/Lark';
    if (app.includes('Claude')) return 'Claude';
    if (app.includes('O+Connect')) return 'OPPO Connect';
    return app;
  }
  if (cmd.startsWith('/usr/local/bin/') || cmd.startsWith('/usr/bin/')) return cmd.split('/').pop();
  if (cmd.startsWith('/')) return cmd.split('/').pop();
  return cmd;
}

function aggregateProcesses (processes) {
  const grouped = {};
  for (const p of processes) {
    const key = p.name;
    if (!grouped[key]) {
      grouped[key] = { name: p.name, memMb: 0, user: p.user, count: 0 };
    }
    grouped[key].memMb += parseFloat(p.memMb);
    grouped[key].count++;
  }
  return Object.values(grouped)
    .map((g) => ({ ...g, memMb: g.memMb.toFixed(1) }))
    .sort((a, b) => parseFloat(b.memMb) - parseFloat(a.memMb));
}

function getTopMemoryProcesses (limit = 25) {
  return new Promise((resolve) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
    execFile('ps', ['axo', 'rss=,user=,command='], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve([]);
        return;
      }
      const processes = stdout.trim().split('\n').map((line) => {
        const parts = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
        if (!parts) return null;
        const rssKb = Number(parts[1]);
        return {
          memMb: Number.isFinite(rssKb) ? (rssKb / 1024).toFixed(1) : '0.0',
          user: parts[2],
          cmd: parts[3],
          name: getProcessDisplayName(parts[3])
        };
      }).filter(Boolean)
        .sort((a, b) => parseFloat(b.memMb) - parseFloat(a.memMb))
        .slice(0, safeLimit);
      resolve(aggregateProcesses(processes));
    });
  });
}

module.exports = {
  aggregateProcesses,
  getProcessDisplayName,
  getTopMemoryProcesses
};
