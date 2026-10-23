# 发布扩展

## 密钥用途

`manifest.json` 中的 `key` 只用于本地加载未打包扩展时固定开发版 ID，不会进入
Chrome Web Store 的 ZIP。

发布流程使用两套独立内容：

- Web Store ZIP：打包时删除 `manifest.json` 的 `key`，由商店签名并分配商店扩展 ID。
- CRX：使用单独的 CRX 公钥/私钥对。打包时把 `CRX_PUBLIC_KEY_BASE64` 注入
  `manifest.json` 的 `key`，并使用 `CRX_PRIVATE_KEY_BASE64` 签名。

两个 CRX Secret 必须来自同一对密钥。不要把私钥提交到仓库、上传商店或附加到普通
Release。

## 配置 GitHub Secret

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中新增：

```text
CRX_PRIVATE_KEY_BASE64
CRX_PUBLIC_KEY_BASE64
```

`CRX_PRIVATE_KEY_BASE64` 是 CRX 私钥 PEM 的 Base64；`CRX_PUBLIC_KEY_BASE64`
是对应公钥的 manifest `key` 值（base64 SPKI DER），也可以直接填 PEM 公钥，
打包脚本会归一化。

建议为 CRX 单独生成一对新密钥，不要复用本地开发密钥：

```bash
node -e "const {generateKeyPairSync}=require('node:crypto');const fs=require('node:fs');const p=generateKeyPairSync('rsa',{modulusLength:4096});fs.writeFileSync('crx-private.pem',p.privateKey.export({type:'pkcs8',format:'pem'}));console.log(p.publicKey.export({type:'spki',format:'der'}).toString('base64'))"
```

把命令输出的公钥写入 `CRX_PUBLIC_KEY_BASE64`，私钥则转成 Base64 后写入
`CRX_PRIVATE_KEY_BASE64`：

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("crx-private.pem")
) | Set-Clipboard
```

请把原始私钥备份到安全的密码管理器或离线介质。`.keys/` 和 `*.pem` 已被
`.gitignore` 排除。

## 自动发布

1. 更新 `package.json` 和 `manifest.json` 的版本号。
2. 提交变更。
3. 创建与版本号一致的标签并推送：

```bash
git tag v2.0.0
git push origin main
git push origin v2.0.0
```

GitHub Actions 会：

1. 安装依赖。
2. 运行全部测试和语法检查。
3. 校验标签与 manifest 版本一致。
4. 删除 manifest `key`，生成默认压缩的 Web Store 用 ZIP。
5. 注入 CRX 公钥，并使用 GitHub Secret 中的 CRX 私钥生成签名 CRX。
6. 生成 SHA256 校验文件。
7. 按 Conventional Commits 类型分组生成提交清单，列出提交者和 Full Changelog
   链接，并创建 GitHub Release 上传这三个文件。

如果仓库中存在 `.github/release-notes/<tag>.md`，该文件会优先作为 Release
notes 正文，适合人工撰写中英双语发布说明；没有时使用自动生成的提交清单。

默认构建会使用 esbuild 对运行时代码做标准 JavaScript 压缩，不改变入口路径、
ES module 依赖或 Chrome API 名称。压缩只减小体积，不提供源码保密能力；
GitHub 仓库中的可读源码仍是审查与维护依据。

GitHub Release 与 Chrome Web Store 使用同一份默认压缩 ZIP；该 ZIP 不包含
`manifest.json` 的 `key`。`.crx` 使用另一套 CRX 密钥签名，仅用于企业分发、
受管环境和开发测试。

本地验证打包：

```bash
CRX_KEY_PATH=/path/to/crx-private.pem \
CRX_PUBLIC_KEY_BASE64="<base64 SPKI 公钥>" \
npm run package:extension
```

Windows PowerShell：

```powershell
$env:CRX_KEY_PATH = "C:\path\to\crx-private.pem"
$env:CRX_PUBLIC_KEY_BASE64 = "<base64 SPKI 公钥>"
npm.cmd run package:extension
```

不设置 `CRX_PUBLIC_KEY_BASE64` 时，脚本会从私钥推导公钥，便于本地调试；
GitHub Actions 中必须显式配置，且必须与私钥匹配。

生成未压缩调试包：

```bash
CRX_KEY_PATH=/path/to/crx-private.pem \
CRX_PUBLIC_KEY_BASE64="<base64 SPKI 公钥>" \
npm run package:extension:source
```

## 上传 Chrome Web Store

商店提审文案、权限用途和数据披露说明不纳入公开仓库。公开隐私政策见
[PRIVACY.md](PRIVACY.md)。

1. 注册并验证 Chrome Web Store Developer Dashboard 账号。
2. 首次发布选择“新增项目”，上传 Release 中的 `.zip`。
3. 填写名称、简介、分类、语言、商店图标和截图。
4. 在隐私规范中说明各权限用途。
5. 提交审核。
6. 已有商店项目升级时，在同一项目中使用“上传新版本包”，扩展 ID 由商店保持稳定。

Chrome Web Store 不接受签名 CRX 作为上传包。上传 Release 中的 ZIP，不要上传
`.crx` 或私钥。

## 关于 CRX

签名 CRX 适合企业策略、受管环境和开发测试。普通用户从网页直接安装 CRX 通常会
受到 Chrome 限制，并可能显示 `CRX_REQUIRED_PROOF_MISSING`。公开发行应通过
Chrome Web Store。

## 更换 CRX 签名密钥

更换 CRX 密钥会改变 CRX 扩展 ID，并可能导致：

- 旧 CRX 安装的扩展 storage 无法自动迁移；
- 用户需要重新填写服务地址和 API Key；
- 如果服务端校验的是 CRX 扩展 ID，`ABM_EXTENSION_ID` 需要同步更新。

Web Store 的项目 ID 由商店保持，不受 CRX 密钥影响。已有商店项目应优先使用商店
分配的扩展 ID，不应为了统一 ID 而随意更换商店项目。

