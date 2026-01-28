# 🌍 Macro Scouter (宏观信号监测哨兵)

> **"Data is the new oil, but signal is the new gold."**
> 一个基于 Polymarket 预测市场的自动化宏观经济监测系统。零代码配置，高信噪比，GitHub 原生体验。

## 🚀 项目简介

**Macro Scouter** 是一个去中心化的宏观数据抓取与分析 Agent。它利用 Puppeteer 模拟真人行为，从全球最大的预测市场 Polymarket 抓取最真实的真金白银交易数据（非单纯的民意调查），并清洗出高价值的宏观信号。

### ✨ 核心特性

* **无代码控制台 (IssueOps)**: 不需要修改一行代码，直接通过 **GitHub Issues** 进行管理。
    * 新增监控 👉 发个 Issue
    * 修改关键词 👉 改 Issue 标题
    * 停止监控 👉 关闭 Issue
* **高信噪比 (Signal-Only)**: 内置智能过滤器。
    * 自动剔除 `Volume < 100` 的死盘。
    * 自动剔除 `Spread > 5%` 的无效博弈。
    * 自动识别并修正 `live/news` 等无效链接。
* **永久免费架构**: 
    * **大脑**: GitHub Issues (配置)
    * **手脚**: Hugging Face Docker (执行，16GB RAM)
    * **仓库**: GitHub Repo (存储 JSON 数据)
    * **扳机**: GitHub Actions (定时触发)

---

## 🛠️ 架构图

```mermaid
graph LR
    A[GitHub Issues] -- 1. 读取指令 --> B(Hugging Face Space)
    D[GitHub Actions] -- 2. 定时唤醒 --> B
    B -- 3. 模拟搜索 & 抓取 --> E[Polymarket]
    B -- 4. 清洗 & 存入 --> C[GitHub Data Folder]
