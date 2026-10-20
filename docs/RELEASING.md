# 发布扩展

## 密钥用途

Manifest 中的 `key` 是公开的 RSA 公钥，用于固定开发版和自托管版的扩展 ID。

`.keys/abm-extension-private.pem` 是对应的私钥，用于：

- 生成带签名的 `.crx`；
- 保证自托管 CRX 使用同一个扩展 ID；
- 在企业策略或开发模式下验证扩展来源。

Chrome Web Store 上传的是 ZIP，商店会自行签名。不要把私钥上传到商店、GitHub
仓库或普通 Release。

## 配置 GitHub Secret

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中新增：

```text
CRX_PRIVATE_KEY_BASE64
```

值为私钥文件的 Base64。请在本地生成并直接写入 GitHub Secret，不要粘贴到聊天、
Issue 或提交记录：

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes(
    "browser-mcp-extension\.keys\abm-extension-private.pem"
  )
) | Set-Clipboard
```

请把原始 `.keys/abm-extension-private.pem` 备份到安全的密码管理器或离线介质。
`.keys/` 已被 `.gitignore` 排除。

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
4. 生成默认压缩的 Web Store 用 ZIP。
5. 使用 GitHub Secret 中的私钥生成签名 CRX。
6. 生成 SHA256 校验文件。
7. 创建 GitHub Release 并上传这三个文件。

默认构建会使用 esbuild 对运行时代码做标准 JavaScript 压缩，不改变入口路径、
ES module 依赖或 Chrome API 名称。压缩只减小体积，不提供源码保密能力；
GitHub 仓库中的可读源码仍是审查与维护依据。

GitHub Release 与 Chrome Web Store 使用同一份默认压缩 ZIP；`.crx` 仅用于
企业分发、受管环境和开发测试。

本地验证打包：

```bash
CRX_KEY_PATH=.keys/abm-extension-private.pem npm run package:extension
```

Windows PowerShell：

```powershell
$env:CRX_KEY_PATH = ".keys\abm-extension-private.pem"
npm.cmd run package:extension
```

生成未压缩调试包：

```bash
CRX_KEY_PATH=.keys/abm-extension-private.pem npm run package:extension:source
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

## 更换签名密钥

更换私钥或 manifest `key` 会改变扩展 ID，并导致：

- 旧扩展的 storage 无法自动迁移；
- 用户需要重新填写服务器地址和 API Key；
- 服务端 `ABM_EXTENSION_ID` 需要同步更新；
- Web Store 若已有项目，应优先使用该项目的扩展 ID，不应随意更换密钥。

