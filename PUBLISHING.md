# 发布到 VS Code 插件市场

## 0. 为什么要在两个网站之间跳

VS Code 市场是历史遗留的双系统：

| 网站 | 干什么 |
| --- | --- |
| <https://marketplace.visualstudio.com/manage> | 创建 publisher（发布者 ID），看已发布插件的状态 |
| <https://dev.azure.com> | 生成 PAT（个人访问令牌）。市场的身份认证后台是 Azure DevOps，所以令牌只能在这里拿 |
| 本地终端 | `vsce login` 存令牌，`vsce publish` 打包并上传 |

一次性配好后，日常发布只在本地敲命令。

## 1. 一次性准备（只做一次）

### 1.1 创建 publisher

1. 打开 <https://marketplace.visualstudio.com/manage>，用微软账号登录
2. Create Publisher
3. ID 填 `etng`（**创建后不可改名**，被别人占用就得换）
4. Name 随意，填显示用的名字

### 1.2 生成 PAT

1. 打开 <https://dev.azure.com>，用**同一个**微软账号登录
2. 右上角用户设置 → Personal Access Tokens → New Token
3. 关键两处，填错会在 `vsce publish` 时报 401：
   - **Organization 必须选 All accessible organizations**
   - **Scopes 勾选 Marketplace → Manage**（不是 Acquire）
4. 生成后立刻复制（关掉页面就看不到）

### 1.3 本地登录

```bash
npx vsce login etng
# 粘贴上一步的 PAT
```

令牌存在 `~/.vsce`，之后不用重复登录。**PAT 过期后重跑这条命令即可**（默认最长一年）。

## 2. 本地试用（发布前先验证）

打包成 vsix 装进本机 VS Code：

```bash
npm run validate              # tsc + eslint
npx vsce package              # 产出 godoc-peek-<version>.vsix
code --install-extension godoc-peek-0.1.0.vsix --force
```

**装完必须重载窗口**才生效：`Cmd+Shift+P` → Developer: Reload Window。

开发期不想反复打包，用 `code . && F5` 起 Extension Host 更快。

卸载：`code --uninstall-extension etng.godoc-peek`

## 3. 发布

```bash
npm run validate
npx vsce publish patch        # 自动 bump 版本号、打 git tag、上传
```

`patch` / `minor` / `major` 三选一，vsce 会自己改 `package.json` 的版本号。
想手动控制版本就先改 `package.json` 再跑 `npx vsce publish`（不带参数）。

发布后：<https://marketplace.visualstudio.com/manage> 能看到状态，首次发布通常几分钟内上线。

## 4. 版本规则

沿用本仓库约定：

| 改动 | 命令 |
| --- | --- |
| bug 修复、小调整（默认） | `npx vsce publish patch` |
| 新增功能 | `npx vsce publish minor` |
| 破坏性变更 / 重构 | `npx vsce publish major` |

版本号必须递增，重复版本会发布失败。

## 5. 排障

| 报错 | 原因 / 处理 |
| --- | --- |
| `Failed to get publisher` | publisher 没建，或 ID 拼错 |
| 401 / 403 | PAT 的 Organization 没选 All accessible，或 scope 选成 Acquire 了 |
| `version already exists` | 版本号没递增 |
| `A 'repository' field is missing` | 补 `package.json` 的 repository，或加 `--allow-missing-repository` |
| icon 相关报错 | `media/logo.png` 至少 128×128，当前是 256×256 |
| 市场页面图片不显示 | README 里必须用绝对 `https://` 链接，相对路径不生效 |
| 想看打包进去了什么 | `npx vsce ls` |

插件自身的运行日志：`Cmd+Shift+P` → **GoDoc Peek: Show Log**。
hover 命中会记 `[hover] … 定位到 …`，查不到会记 `未找到 … 的文档：<原因>`。

## 6. 可选：GitHub Actions 自动发布

不想在本地跑 `vsce publish` 的话，把 PAT 存成仓库 secret `VSCE_PAT`
（Settings → Secrets and variables → Actions），然后加一个 workflow：

```yaml
name: Publish
on:
  push:
    tags: ["v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx vsce publish -p ${{ secrets.VSCE_PAT }}
```

之后 `git tag v0.1.1 && git push --tags` 即触发发布。
