# AI 编程搭子 — 陪你写代码的桌面伙伴

## 一句话介绍

一个桌面悬浮窗小宠物，能感知你的编码状态，用动画和语音陪你写代码。支持上传照片生成专属形象。

## 它能做什么？

### 编码联动

编程搭子会通过 Claude Code hooks 实时感知你的编码状态：

- 任务完成时，开心地蹦跶，跟你说"任务完成啦！你真棒~"
- 连续报错时，温柔安慰"别灰心~在最痛苦的时候，也能够再多坚持一下！"
- 升级时，为你欢呼"真正的伟大，永远知道如何重新出发！"
- 开始新会话时，热情打招呼"嗨~又见面啦，今天也一起加油吧！"

### 点击互动

点击小宠物，它会随机跟你聊天：

- "代码也像人生一样，坚持就会有收获~"
- "今天也要加油鸭，我陪着你！"
- "累了就休息一下，我等你~"

每句话都有语音播报。

### 贴心提醒

- **饭点提醒**：08:00 / 12:00 / 18:00 自动提醒吃饭
- **休息提醒**：连续写码约 1 小时后提醒你站起来活动

### 自定义形象

不想用默认形象？上传一张照片就能生成专属编程搭子：

```
minipet-overlay generate photo.jpg --name 柯基
```

系统会自动走完整个生成流程：

1. Vision LLM 识别照片主体
2. Seedream 生成标准化底图
3. Seedance 生成 5 组动画（待机/睡觉/吃饭/开心/说话）
4. SAM3 自动抠图，生成透明背景视频

生成完成后一键切换：

```
minipet-overlay use 柯基
minipet-overlay use default   # 切回默认
```

## 安装使用

### 一行安装

```bash
npm install -g claude-minipet minipet-overlay
claude-minipet init
minipet-overlay start
```

首次启动会引导你选择默认形象或上传照片生成自定义形象。

### 日常启动

```bash
minipet-overlay start
```

### 全部命令

| 命令 | 说明 |
|------|------|
| `minipet-overlay start` | 启动编程搭子 |
| `minipet-overlay stop` | 停止 |
| `minipet-overlay status` | 查看运行状态 |
| `minipet-overlay generate <照片> --name <名称>` | 生成自定义形象 |
| `minipet-overlay use <名称\|default>` | 切换形象 |
| `minipet-overlay list` | 查看可用形象 |

### 环境要求

- Node.js >= 18
- Mac / Windows / Linux

## 技术架构

```
Claude Code
    |  hooks 事件
    v
claude-minipet（终端宠物插件，检测编码行为）
    |  HTTP POST /event
    v
minipet-overlay 后端（Express + WebSocket，端口 3210）
    |  WebSocket 推送
    v
桌面悬浮窗（Electron 透明窗口 / 浏览器降级）
```

- **5 种动画状态**：sitting / sleeping / eating / happy / talking，WebM 透明视频
- **语音合成**：豆包 seed-tts-2.0 TTS
- **形象生成 Pipeline**：Vision LLM + Seedream + Seedance + SAM3
- **用户绑定**：每个用户通过 claude-minipet DNA 自动关联形象

## FAQ

**Q：不装 claude-minipet 能用吗？**
可以。点击互动、饭点提醒、休息提醒都能正常使用，只是没有编码联动。

**Q：没有 Electron 怎么办？**
会自动降级为浏览器模式，在 http://127.0.0.1:3210 打开即可。

**Q：自定义形象生成需要多久？**
大约 10-20 分钟，取决于网络和 API 响应速度。

**Q：可以有多个自定义形象吗？**
可以。每次 generate 用不同的 --name 即可，通过 use 命令随时切换。
