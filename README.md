# minipet-overlay

AI 编程搭子 — 陪你写代码的亲密伙伴

桌面悬浮窗形式的 AI 编程搭子，用动画和语音为你加油打气。支持自定义形象，默认内置莎莎。

## 架构

```
Claude Code 写代码
    |  hooks 事件
    v
claude-minipet（检测编码行为，发送结构化数据）
    |  HTTP POST /event
    v
minipet-overlay（桌面动画 + 语音）
```

- **claude-minipet** — Claude Code 终端宠物插件，监听编码事件（开始/完成/报错/升级），发送结构化数据
- **minipet-overlay** — 桌面悬浮窗，接收事件后播放动画和语音

## 快速开始

**首次安装：**

```bash
npm install -g claude-minipet minipet-overlay
claude-minipet init
minipet-overlay start
```

首次启动会引导你选择默认形象或上传照片生成自定义形象。

**之后每天启动：**

```bash
minipet-overlay start
```

**前置要求：**
- [Node.js](https://nodejs.org/) >= 18
- [Claude Code](https://claude.com/claude-code)（编码联动需要）

## 功能

### 点击互动
点击编程搭子，它会随机用语音跟你互动：
- "代码也像人生一样，坚持就会有收获~"
- "今天也要加油鸭，我陪着你！"
- "相信自己，你也可以成为自己的冠军！"

### 饭点提醒
- 08:00 — "早上好呀~该吃早饭啦！"
- 12:00 — "中午啦！放下键盘去吃饭吧~"
- 18:00 — "晚饭时间到~今天辛苦了！"

### 休息提醒
每隔约 1 小时自动提醒你休息、活动一下。

### Claude Code 编码联动
使用 Claude Code 写代码时，编程搭子会实时响应：

| 事件 | 动作 | 示例语音 |
|------|---------|---------|
| 任务完成 | 开心 (happy) | "任务完成啦！你真棒~" |
| 代码跑通 | 开心 (happy) | "代码跑通啦~" |
| 连续报错 | 开心 (happy) | "别灰心~在最痛苦的时候，也能够再多坚持一下！" |
| 升级 | 开心 (happy) | "真正的伟大，永远知道如何重新出发！" |
| 新会话 | 开心 (happy) | "嗨~又见面啦，今天也一起加油吧！" |

### 自定义形象

上传一张照片，自动生成 5 个动画状态：

```bash
# 生成自定义形象（需要 python3 + ffmpeg）
minipet-overlay generate photo.jpg --name 柯基

# 切换形象
minipet-overlay use 柯基

# 切回默认
minipet-overlay use default
```

Pipeline 流程：Vision LLM 识别 -> Seedream 生图 -> Seedance 生成动画 -> SAM3 抠图 -> WebM 透明视频

## 命令

```bash
minipet-overlay start                          # 启动编程搭子
minipet-overlay stop                           # 停止
minipet-overlay status                         # 查看运行状态
minipet-overlay generate <照片> --name <名称>   # 生成自定义形象
minipet-overlay use <名称|default>              # 切换形象
minipet-overlay list                           # 查看可用形象
```

## 系统要求

- Node.js >= 18
- Mac / Windows / Linux
- Mac/Windows: 桌面悬浮窗（Electron）
- Linux: 自动降级到浏览器模式（http://127.0.0.1:3210）
- 自定义形象额外需要：python3, ffmpeg

## 与 Claude Code 联动

`minipet-overlay start` 会自动：
1. 安装 `claude-minipet`（如果未安装）
2. 执行 `claude-minipet init`（注册 Claude Code hooks）
3. 配置事件推送地址

之后正常使用 Claude Code 写代码即可，编程搭子会自动响应编码事件。

## 技术栈

- **后端**: Express + WebSocket (端口 3210)
- **前端**: 5 个 WebM 透明动画（sitting/sleeping/eating/happy/talking）
- **语音**: 豆包 seed-tts-2.0 TTS
- **桌面**: Electron 透明无框悬浮窗
- **形象生成**: Vision LLM + Seedream + Seedance + SAM3
- **事件源**: claude-minipet Claude Code hooks
