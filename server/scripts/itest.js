// 多用户集成验证（临时 DB，跑完即弃）：
// 1) 首用户注册免邀请码并自动成为管理员
// 2) 管理员生成邀请码
// 3) 普通用户凭邀请码注册
// 4) 邀请码一次性（二次注册失败）
// 5) 登录获取 JWT
// 6) 用户 A 的对话树 / 配置 / 搜索 对用户 B 不可见（数据隔离）
// 7) 密码错误登录失败
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB = path.join(ROOT, 'data', `itest_${Date.now()}.db`);
const PORT = 3099;

process.env.TREECHAT_DB_PATH = DB;
process.env.PORT = String(PORT);
process.env.MOCK_LLM = '1';

const base = `http://localhost:${PORT}`;
const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${extra ? ' :: ' + extra : ''}`);
}

function req(method, p, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      `${base}${p}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json;
          try { json = JSON.parse(buf); } catch { json = buf; }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const server = spawn(process.execPath, ['index.js'], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  // 等待启动
  await new Promise((r) => setTimeout(r, 1500));

  try {
    // 1) 首用户 = 管理员
    const reg1 = await req('POST', '/api/auth/register', { body: { username: 'admin', password: 'admin123' } });
    check('首用户注册返回 201', reg1.status === 201, `status=${reg1.status}`);
    check('首用户为管理员', reg1.body?.user?.is_admin === true);
    const adminToken = reg1.body?.token;
    check('返回 JWT', typeof adminToken === 'string' && adminToken.length > 10);

    // 2) 管理员生成邀请码（通过 CLI 脚本直接写库）
    const codes = await genInviteCodes(1);
    const code = codes[0];
    check('生成邀请码', typeof code === 'string' && code.length >= 16, `code=${code}`);

    // 3) 普通用户凭邀请码注册
    const reg2 = await req('POST', '/api/auth/register', { body: { username: 'alice', password: 'alice123', inviteCode: code } });
    check('普通用户注册 201', reg2.status === 201, `status=${reg2.status} body=${JSON.stringify(reg2.body)}`);
    const aliceToken = reg2.body?.token;
    check('普通用户非管理员', reg2.body?.user?.is_admin === false);

    // 4) 邀请码一次性
    const reg3 = await req('POST', '/api/auth/register', { body: { username: 'eve', password: 'eve123', inviteCode: code } });
    check('重复使用邀请码被拒', reg3.status === 400, `status=${reg3.status} msg=${reg3.body?.error}`);

    // 5) 无邀请码注册被拒（已有用户）
    const reg4 = await req('POST', '/api/auth/register', { body: { username: 'bob', password: 'bob123' } });
    check('缺邀请码注册被拒', reg4.status === 400, `status=${reg4.status}`);

    // 6) 登录
    const login = await req('POST', '/api/auth/login', { body: { username: 'alice', password: 'alice123' } });
    check('登录成功 200', login.status === 200, `status=${login.status}`);
    check('登录返回 JWT', typeof login.body?.token === 'string');
    const loginBad = await req('POST', '/api/auth/login', { body: { username: 'alice', password: 'wrong' } });
    check('密码错误登录失败', loginBad.status === 401, `status=${loginBad.status}`);

    // 7) 未带 token 访问受保护接口
    const noTok = await req('GET', '/api/trees');
    check('无 token 访问被拒 401', noTok.status === 401, `status=${noTok.status}`);

    // 8) 两个用户数据隔离：alice 建树 + 配置，bob 看不到
    const aliceTree = await req('POST', '/api/trees', { token: aliceToken, body: { title: 'alice-tree' } });
    check('alice 建树 201', aliceTree.status === 201, `status=${aliceTree.status}`);
    const aliceTreeId = aliceTree.body?.id;

    const aliceCfg = await req('POST', '/api/configs', { token: aliceToken, body: { name: 'c1', base_url: 'https://x', api_key: 'sk-xxx', model: 'm' } });
    check('alice 建配置 201', aliceCfg.status === 201, `status=${aliceCfg.status}`);

    // bob 注册（用第二个邀请码）
    const codes2 = await genInviteCodes(1);
    const regBob = await req('POST', '/api/auth/register', { body: { username: 'bob', password: 'bob123', inviteCode: codes2[0] } });
    const bobToken = regBob.body?.token;

    const bobTrees = await req('GET', '/api/trees', { token: bobToken });
    check('bob 看不到 alice 的树', Array.isArray(bobTrees.body) && bobTrees.body.length === 0, `bobTrees=${JSON.stringify(bobTrees.body)}`);

    const bobCfgs = await req('GET', '/api/configs', { token: bobToken });
    check('bob 看不到 alice 的配置', Array.isArray(bobCfgs.body) && bobCfgs.body.length === 0, `bobCfgs=${JSON.stringify(bobCfgs.body)}`);

    const aliceTrees = await req('GET', '/api/trees', { token: aliceToken });
    check('alice 能看到自己的树', Array.isArray(aliceTrees.body) && aliceTrees.body.length === 1, `len=${aliceTrees.body?.length}`);

    // bob 尝试按 id 访问 alice 的树 -> 404
    const bobPeek = await req('GET', `/api/trees/${aliceTreeId}`, { token: bobToken });
    check('bob 跨用户访问树被拒(404)', bobPeek.status === 404, `status=${bobPeek.status}`);

    // bob 用 alice 的 token 伪造？不再测，token 本身即身份

    // 9) 搜索隔离：alice 树里写个节点（通过 send），bob 搜不到
    const send = await req('POST', '/api/chat/send', { token: aliceToken, body: { treeId: aliceTreeId, userMessage: '独孤求败的秘密', model: 'm' } });
    check('alice 发消息 200', send.status === 200, `status=${send.status} body=${JSON.stringify(send.body).slice(0,200)}`);

    const aliceSearch = await req('GET', '/api/search?q=独孤求败', { token: aliceToken });
    check('alice 能搜到自己的节点', Array.isArray(aliceSearch.body) && aliceSearch.body.length >= 1, `len=${aliceSearch.body?.length}`);

    const bobSearch = await req('GET', '/api/search?q=独孤求败', { token: bobToken });
    check('bob 搜不到 alice 的节点', Array.isArray(bobSearch.body) && bobSearch.body.length === 0, `len=${bobSearch.body?.length}`);
  } catch (e) {
    console.error('TEST ERROR', e);
    results.push({ name: 'exception', ok: false, extra: e.message });
  } finally {
    server.kill('SIGKILL');
    setTimeout(() => {
      try { fs.unlinkSync(DB); fs.unlinkSync(DB + '-wal'); fs.unlinkSync(DB + '-shm'); } catch {}
      const passed = results.filter((r) => r.ok).length;
      console.log(`\n==== ${passed}/${results.length} passed ====`);
      process.exit(passed === results.length ? 0 : 1);
    }, 300);
  }

  // 调用 gen-invite 脚本生成邀请码（需管理员 token 不便，这里直接复用 setup 的 DB 通过脚本生成）
  async function genInviteCodes(count) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/gen-invite.js', String(count), '7'], {
        cwd: ROOT,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => process.stderr.write(`[gen] ${d}`));
      child.on('close', () => {
        const codes = (out.match(/[0-9a-f]{16,}/gi) || []).filter((c) => c.length >= 16);
        if (codes.length) resolve(codes);
        else reject(new Error('未能从 gen-invite 解析邀请码: ' + out));
      });
    });
  }
}

main();
