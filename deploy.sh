#!/usr/bin/env bash
#
# TreeChat 一键部署脚本（Nginx + PM2）
# 适用：Debian / Ubuntu 服务器，已联网。
#
# 用法：
#   sudo REPO_URL=git@github.com:you/tree-chat.git \
#        [DOMAIN=tree.example.com] \
#        bash deploy.sh
#
# 说明：API 方案（base_url / api_key / model）不再通过 .env 静态配置，
#       部署后请在浏览器「⚙ API」界面中添加并启用你的 API 方案。
#       本脚本只写入运维项（PORT、可选 MOCK_LLM）和加密密钥 .masterkey。
#
# 可覆盖的环境变量（不传则用默认值）：
#   REPO_URL            仓库地址（必填，私有库需先配好 SSH key）
#   DEPLOY_DIR          部署目录，默认 /var/www/treechat
#   DOMAIN              Nginx server_name，默认用 _（任意主机名）
#   INSTALL_SYSTEM_DEPS 是否安装 node/nginx/pm2，默认 1（0 跳过，适用于已装好环境的机器）
#   NODE_MAJOR          Node 大版本，默认 20
#   MOCK_LLM            离线 mock 开关（可选调试），默认 0
#
# 幂等：目录已存在则 git pull 更新；.env / .masterkey 已存在则保留，绝不覆盖。
# 重跑本脚本即可完成版本升级（拉新代码→重新构建→PM2 reload）。

set -euo pipefail

# ---------- 配置 ----------
REPO_URL="${REPO_URL:-}"
DEPLOY_DIR="${DEPLOY_DIR:-/var/www/treechat}"
DOMAIN="${DOMAIN:-_}"
INSTALL_SYSTEM_DEPS="${INSTALL_SYSTEM_DEPS:-1}"
NODE_MAJOR="${NODE_MAJOR:-20}"

MOCK_LLM="${MOCK_LLM:-0}"

# ---------- 颜色 ----------
if [ -t 1 ]; then
  C_BLUE='\033[0;34m'; C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_YELLOW='\033[0;33m'; C_RESET='\033[0m'
else
  C_BLUE=''; C_GREEN=''; C_RED=''; C_YELLOW=''; C_RESET=''
fi
log()  { echo -e "${C_BLUE}[deploy]${C_RESET} $*"; }
ok()   { echo -e "${C_GREEN}[ ok ]${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}[warn]${C_RESET} $*"; }
die()  { echo -e "${C_RED}[fail]${C_RESET} $*" >&2; exit 1; }

# ---------- 前置检查 ----------
[ "$(id -u)" -eq 0 ] || die "请使用 root 运行（需要安装系统包 / 写 Nginx 配置）：sudo bash deploy.sh"
[ -n "$REPO_URL" ] || die "必须设置 REPO_URL，例如 REPO_URL=git@github.com:you/tree-chat.git"

command -v git >/dev/null 2>&1 || die "未找到 git，请先安装"

# ---------- 1. 安装系统依赖 ----------
if [ "$INSTALL_SYSTEM_DEPS" = "1" ]; then
  log "安装系统依赖（node${NODE_MAJOR}、nginx、pm2）..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl ca-certificates gnupg nginx
  if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
  if ! command -v pm2 >/dev/null 2>&1; then
    npm i -g pm2
  fi
  ok "系统依赖就绪：node $(node -v)，npm $(npm -v)"
else
  warn "跳过系统依赖安装（INSTALL_SYSTEM_DEPS=0）"
fi

# ---------- 2. 拉取 / 更新代码 ----------
if [ -d "$DEPLOY_DIR/.git" ]; then
  log "目录已存在，git pull 更新..."
  git -C "$DEPLOY_DIR" pull --ff-only
else
  log "克隆仓库到 $DEPLOY_DIR ..."
  rm -rf "$DEPLOY_DIR"
  git clone "$REPO_URL" "$DEPLOY_DIR"
fi
ok "代码就绪：$DEPLOY_DIR"

# ---------- 3. 构建前端 ----------
log "安装前端依赖并构建 dist/ ..."
cd "$DEPLOY_DIR"
npm install
npm run build
ok "前端构建完成"

# ---------- 4. 后端依赖 ----------
log "安装后端依赖（better-sqlite3 需本地编译）..."
cd "$DEPLOY_DIR/server"
npm install --omit=dev
ok "后端依赖就绪"

# ---------- 5. 配置 .masterkey（存在则保留，绝不覆盖）----------
if [ ! -f "$DEPLOY_DIR/server/.masterkey" ]; then
  log "生成 .masterkey（API Key 加密密钥）..."
  node -e "require('fs').writeFileSync('$DEPLOY_DIR/server/.masterkey', require('crypto').randomBytes(32).toString('hex')+'\n')"
  ok ".masterkey 已生成"
else
  warn ".masterkey 已存在，保留原值（覆盖会导致历史已加密 API Key 无法解密）"
fi

# ---------- 6. 配置 .env（存在则保留）----------
# 注意：仅写入运维项；API 方案请在部署后于浏览器「⚙ API」中添加并启用。
if [ ! -f "$DEPLOY_DIR/server/.env" ]; then
  log "创建 .env（仅 PORT / MOCK_LLM，不包含任何 API Key）..."
  cat > "$DEPLOY_DIR/server/.env" <<EOF
PORT=3001
MOCK_LLM=$MOCK_LLM
EOF
  ok ".env 已创建（API 方案请在 Web 界面「⚙ API」中配置）"
else
  warn ".env 已存在，保留原值（如需更新请手动编辑 $DEPLOY_DIR/server/.env）"
fi

# ---------- 7. 启动 / 重载后端（PM2）----------
log "PM2 启动 / 重载后端..."
cd "$DEPLOY_DIR/server"
if pm2 describe treechat-server >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs
else
  pm2 start ecosystem.config.cjs
fi
pm2 save
ok "后端运行中：$(pm2 jlist | tr ',' '\n' | grep -c '"name":"treechat-server"') 个进程"

# ---------- 8. 配置 Nginx ----------
NGINX_SRC="$DEPLOY_DIR/deploy/nginx/treechat.conf"
NGINX_DST="/etc/nginx/sites-available/treechat.conf"
if [ -f "$NGINX_SRC" ]; then
  log "写入 Nginx 配置（server_name=$DOMAIN, root=$DEPLOY_DIR/dist）..."
  sed -e "s#server_name your-domain.com;#server_name $DOMAIN;#" \
      -e "s#root /var/www/treechat/dist;#root $DEPLOY_DIR/dist;#" \
      "$NGINX_SRC" > "$NGINX_DST"
  ln -sf "$NGINX_DST" /etc/nginx/sites-enabled/treechat.conf
  # 关闭默认站点，避免冲突
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  ok "Nginx 已配置并 reload"
else
  warn "未找到 $NGINX_SRC，跳过 Nginx 配置（请手动配置并反代 /api 到 3001）"
fi

echo
ok "部署完成！"
echo "  - 前端：http://$DOMAIN/  （或服务器 IP）"
echo "  - 后端 API：http://127.0.0.1:3001/api/health"
echo "  - 查看状态：pm2 status / pm2 logs treechat-server"
echo "  - 数据库文件：$DEPLOY_DIR/server/data/treechat.db（请做好备份）"
echo

# ---------- 9. 账号体系（手动初始化）----------
echo "  【账号体系 / 多用户】"
echo "  项目支持多用户、数据隔离、邀请制注册。请按需执行以下命令："
echo "    # 创建管理员（首个用户也可直接在网页注册自动成为管理员）"
echo "    cd $DEPLOY_DIR/server && node scripts/setup.js <用户名> <密码>"
echo "    # 生成邀请码（可选天数），私下发给朋友，每个码仅能注册一次"
echo "    node scripts/gen-invite.js [数量] [有效期天数]"
echo

echo "  ★ 首次使用：打开网页后先在「⚙ API」添加并启用你的 API 方案，才能发起真实对话。"
echo "  ★ 离线调试：将 $DEPLOY_DIR/server/.env 中 MOCK_LLM 改为 1 可走本地假回答。"
echo
warn "如需 HTTPS，请运行：sudo certbot --nginx -d $DOMAIN"
