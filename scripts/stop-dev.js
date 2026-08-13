// 快速关闭 TreeChat 开发服务：只杀掉占用 3001（后端）与 5173（前端）端口的进程。
// 跨平台：Windows 用 netstat -ano 取 PID 再 taskkill（避免 Get-NetTCPConnection 拿不到 PID 的坑），其它走 lsof。
import { execSync } from 'node:child_process';

const PORTS = [3001, 5173];

function stopPort(port) {
  if (process.platform === 'win32') {
    let out = '';
    try {
      out = execSync(`netstat -ano | findstr /R ":${port}\\>`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      // findstr 无匹配时会以非 0 退出，视为该端口无监听
      console.log(`· ${port} 无监听进程`);
      return;
    }
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/LISTENING\s+(\d+)\s*$/);
      if (m) pids.add(m[1]);
    }
    if (pids.size === 0) {
      console.log(`· ${port} 无监听进程`);
      return;
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
        console.log(`✓ 已关闭占用 ${port} 的进程 (PID ${pid})`);
      } catch {
        // 忽略个别进程已退出的情况
      }
    }
  } else {
    try {
      execSync(`lsof -ti tcp:${port} | xargs -r kill`, { stdio: 'ignore' });
      console.log(`✓ 已尝试关闭占用 ${port} 的进程`);
    } catch {
      console.log(`· ${port} 无监听进程`);
    }
  }
}

console.log('正在关闭 TreeChat 开发服务…');
for (const p of PORTS) stopPort(p);
console.log('完成。');
