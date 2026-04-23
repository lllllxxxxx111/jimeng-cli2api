# Jimeng CLI API Wrapper

[🌍 English Version](./README_EN.md) | [🇨🇳 中文版](./README.md)

This project aims to transform the underlying CLI commands of Bytedance's Jimeng (Dreamina) into an API interface compliant with the OpenAI standard. This allows for seamless integration into any existing workflow (including support for seedance2.0 and VIP capabilities).

## ⚠️ Disclaimer & Copyright (Must Read)

1. **License**: The core wrapper code of this project (including routes and the dashboard) is open-sourced under the **MIT License**.
2. **Official Component Isolation**: This project **DOES NOT** include any closed-source CLI executables or commercial assets belonging to Jimeng or ByteDance.
3. **Self-Deployment of CLI**: After pulling this codebase, you must obtain the `jimeng-cli` binary from the official channels yourself. **We are not responsible for any account bans, data issues, or legal disputes arising from your use of the official CLI.**

## 🚀 Quick Start Guide (Beginner Friendly)

To get this API running, it fundamentally relies on the **"Official Jimeng CLI"**.

> ⚠️ **CLI Version Requirement: Use `dreamina.exe` / `dreamina` **v1.4.2 or above**.**  
> Starting from v1.4.2, the CLI upgraded submit_id from the old 16-char hex format to standard UUID. This project (v2.0.0+) is fully adapted to the new format.  
> Using an older CLI will cause task polling to **permanently fail** — tasks will never move from PROCESSING.  
> Download: 👉 [Official Jimeng CLI Docs](https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg)

### 💻 Windows One-Click Deployment

**Batch Scripts**:
*   **`start.bat`**: **One-click run script**. It automatically detects and installs Node.js, **pulls the latest Jimeng CLI (`dreamina.exe`) from the official server**, places it in the `bin` directory, initializes the database, and starts the API service. Just double-click!
*   **`pack.bat`**: **One-click build & package**. Double-click this to compile and compress a `jimeng-deploy.zip` that filters out source code, making it easy to share a ready-to-run package with others.

**Steps**:
1. **Get Code**: Download/unzip this project or use `git clone`.
2. **Run**: Double-click **`start.bat`**.
3. **Access Dashboard**: Open `http://localhost:3000` in your browser.
4. **Admin Login**: **Default password is `admin`**. Please change it immediately!

---

### 🐧 Linux Server Deployment (For Geeks & Production)
If deploying on Ubuntu/CentOS:
1. **Environment**: Ensure Node.js (v18+) and npm are installed.
2. **Download CLI**: Run official script:
   ```bash
   curl -fsSL https://jimeng.jianying.com/cli | bash
   ```
3. **Start Project**:
   ```bash
   npm install
   npx prisma db push
   npm run build
   npm run start
   ```

## ⚠️ Important Limitations & Personal Statement

**[Official Jimeng Restrictions]**
1. **VIP Account Required**: Due to official policies, you must bind a Jimeng account that has **VIP membership** to utilize advanced models like seedance2.0.

**[Developer Statement]**
1. This repository was created **solely to solve the pain point of integrating Jimeng API into personal workflows, intended for personal learning, research, and workflow automation.**
2. **Do not use illegally**. Any serious consequences or financial losses caused by illegal abuse, commercial profiteering, or violation of official Jimeng terms of service are **entirely unrelated to the author of this repository**. If you do not agree, delete this code immediately.

## �️ Admin Dashboard Guide

After starting the service, log in to the admin dashboard to bind your Jimeng VIP account and issue API tokens.

Key features of the dashboard:
- **Account Pool**: Bind and manage Jimeng VIP accounts via OAuth Device Flow. Check credit balance and status in one click.
- **API Token Management**: Generate, disable, or delete API keys. Optionally bind a key to a specific account or use the shared pool.
- **Task Management**: View all generation tasks in real time (PENDING / PROCESSING / SUCCESS / FAILED). Filter by status, inspect submit_id / logid for debugging, and force-fail or retry any stuck task.
- **Admin Security**: Change the dashboard login password.

**Detailed documentation:**
1. **👉 [Admin Manual EN](./docs/后台管理使用手册_EN.md)**
2. **👉 [API Integration Docs EN](./docs/API集成文档_EN.md)**

---

## 📁 Directory Structure

* `src/`: Backend API core.
* `frontend/`: Vue 3 Dashboard source code.
* `data/`: (**DO NOT COMMIT**) Local SQLite database and user credentials.
* `bin/`: (**DO NOT COMMIT**) Official Jimeng CLI binaries.
* `docs/`: Guides and manuals.

## 🔄 Changelog

**v2.0.0 (2026-04-24)**
- 🔧 **[Core] Adapted to Jimeng CLI v1.4.2**: The new CLI upgraded submit_id from 16-char hex to UUID format. This release fully supports the new format with fallback for legacy IDs.
- 🔧 **logid persistence**: logid returned by CLI is now extracted and saved to the database on task submission for better traceability.
- 🗄️ **New `jimengLogId` DB field** with auto-migration included in upgrade package.
- 🆕 **Admin "Task Management" tab**: view/filter all tasks, force-fail stuck tasks, retry failed tasks, copy submit_id / logid from detail modal.
- 🆕 **24h auto-fail**: PROCESSING tasks older than 24h are automatically marked FAILED on the next polling cycle.

**v1.0.1 (2026-04-20)**
- 🐛 **Bug Fix**: Fixed a multimodal routing bug in the OpenAI standard video generation API. When only images (without audio/video files) were uploaded and a multimodal model like `seedance2.0` was specified, the router incorrectly fell back to the standard multiframe/single-image mode (resulting in `3.0 fast`). The logic now strictly adheres to the requested model, enforcing the multimodal generation channel regardless of the attachment types, greatly improving API compatibility and scheduling accuracy.

## 🤝 Community & Support

Welcome to join our QQ Group for technical discussions, API integrations, and workflow automation setups:
* **QQ Group**: `691588657` (Chinese language group)

## 📄 License
Released under the [MIT License](LICENSE).
*Author: XiaoYue <43854695@qq.com>*
