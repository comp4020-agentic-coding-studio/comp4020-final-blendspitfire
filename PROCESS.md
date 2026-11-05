# Process

<!-- 中文稿，英文定稿待做（目标 900–1100 词）。 -->

## 我最终想提供什么体验

Asset Nexus Unlimited 现在是一个俯视角多人合作游戏。玩家作为资产回收小组进入地下设施，启动并守住反应堆，恢复货运电梯供电，再带着物资撤离。反应堆是完成回收任务的手段，货物才是公司派玩家下来的目的。这一设定也影响了撤离场景：货物要成为视觉重点，电梯的布局要像真正用于运输的空间（撤离在 [`7cbb188`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/7cbb188) 实现，货物在 [`67fabdf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/67fabdf) 按这个思路重做，另见 [ADR-069](docs/adr.md#adr-069-freight-lift--panel-by-the-door-the-cargo-one-heap-the-shaft-built-around-the-platform)）。

我的出发点受到《游戏设计艺术》的影响：游戏应当传达某种体验，让玩家解决问题，并让目标在游戏内部具有价值。开发过程中，这个体验逐渐明确为合作与沉浸感。越到后期，我越意识到课程项目需要的是一段短而完整、即时有趣的体验。我逐渐放下通过长期养成或反复游玩建立反馈的方向，转向一种游乐园式的体验：玩家来玩一次，就应该能感受到它想表达的东西。这也体现在具体取舍上：目标从十波缩短为六波，失败后保留建造的跨局积累不再是重点，而多人并行时则用分房间（每个站点最多四人）保证每一局都是一支小队的完整体验（[ADR-060](docs/adr.md#adr-060-seventh-round--what-watching-the-group-play-showed-about-the-ui)、[`e120767`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/e120767)）。

## 技术选择：我不感兴趣的部分，交给 agent

说得直接一点：我对技术实现本身并不感兴趣。我在意的是玩家在浏览器里实际看到、听到、操作到的东西，也就是前端的"体验"和效果。所以技术栈我完全交给了 Claude，只提了一个要求：沿用项目已有的工具链，保持一致，不要为了某个功能中途引入第二套构建系统或运行时。它选择了 Node、TypeScript、WebSocket、SQLite，以及 Three.js 和 esbuild；实时规则由服务端判定，客户端负责呈现与部分预测。具体取舍记录在 [ADR-005](docs/adr.md#adr-005-tech-stack-native-typescript-on-node-ws-nodesqlite-threejs) 和[服务端权威架构说明](docs/adr/0001-server-authoritative-shared-world.md)中，初始实现见 [`8d98917`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/8d98917)。

我对技术的要求只看结果：多人看到的是不是同一个世界，操作是否跟手，画面是否流畅。第一次真正的多人测试出现明显延迟时，我关心的是"开枪感觉不对"，而怎么解决（客户端预测、插值、断线重连）由 agent 提出和实现（[`881e4fd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/881e4fd)）。这种分工的代价是我对底层代码了解有限，判断它是否正确主要依靠自动检查和试玩，而不是读代码。

我把精力放在玩法方向和审美判断上。玩法通常容易描述，也容易让 agent 修改；美术则需要反复看实际效果，才能知道它是否接近我的想法。

## 让 agent 维护项目的记忆

这次对我最方便、也最重要的选择，是让 agent 持续维护一套文档系统：ADR 记录决策及理由，handoff 保存当前状态与下一步工作，harness 和美术交互规则保存需要延续的约束。设定之后，它会在工作过程中自行更新这些文件，我不用每次重新解释项目背景。规则在 [`4e64818`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/4e64818) 写入 `CLAUDE.md`，[`cd7a57f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/cd7a57f) 要求 handoff 必须能让新会话独立接手，[`2e194f4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/2e194f4) 把它们移进 `docs/` 并纳入 git。

我想特别强调 ADR 的作用。这可能只是我的错觉，但我觉得有了 ADR，agent 不仅知道我做了什么，还知道我为什么这样做。这样它以后就不容易因为某些原因曲解我的意思，也不容易为了遵守某条规则，反而选择一个更差的解决方法。

尤其最后两三个星期，我已经很少感到明显的沟通不畅。我的工作方式逐渐变成：先花十几分钟讨论计划，再让它独立实现一两个小时，最后回来检查和试玩。这是我自己的主观感受，并没有做过有无这套系统的对照实验。它也会带来问题：有些随口说的话会被固化成硬规则，之后需要纠正。这些感受也记录在 [crit 10 reflection](reflections/crit-10.md) 中。

## 检查守护的是什么

`spec/` 里的测试针对的是"体验一旦坏掉就很难被立刻看出来"的那部分：两个浏览器能否互相区分、同一个人回来还是同一个人、一个玩家拿着的东西别人抢不走（`multiuser.test.ts`）；不同站点的玩家互不可见、第五个人进不去（`rooms.test.ts`）；畸形消息和刷屏打不垮服务器（`robustness.test.ts`）；电梯、波次、商店和教程的规则（`lift`、`defence`、`economy`、`tutorial`）。这些都是程序能执行的规则。合作是否有趣、画面是否让人投入，测试回答不了，只能靠试玩判断。

## 美术探索怎样变成规则

俯视角的直接灵感来自《逃离鸭科夫》：这种形式适合轻量、同时带有叙事的游戏，而且固定观看距离可以降低模型细节的要求。《恶魔轮盘赌》和《致命公司》启发了像素化处理，它既能掩盖模型精细度不足，让玩家想象缺失的部分，也能帮助营造紧张气氛。《致命公司》还启发了黑心公司的设定；玩法上，我主要参考《泰坦陨落》的边境防御。

实际美术并没有因为给出参考就直接达到预期。我尝试过包括《Arc Raiders》在内的不同方向，后来逐渐明确：需要控制的是材质、灯光、颜色之间的关系。地下设施最终形成了统一的低饱和色域，鲜艳颜色主要留给发光物体，整体调色与模型分开；gallery 和自动检查让模型能被统一审阅，并检查面数与颜色范围。美术系统建立于 [`d9a96d5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/d9a96d5)，设施与色域在 [`fdc8482`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/fdc8482)，后期红灰调整在 [`f69f2f4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/f69f2f4)。

## 纠正怎样落进规则和检查

纠正 agent 的结果也会进入规则。例如，它曾为了让俯视轮廓更清楚，把手里的枪也横着拿。我要求地上的枪可以侧放，拿在手里的枪仍要正常握持。这条反馈被写进美术规则。类似地，头灯产生不合理的自身阴影时，我拒绝通过取消阴影来解决，而是要求调整光源的位置。这些例子说明，规则需要保存视觉目标和判断理由，避免修复一个问题时丢掉原本想要的效果。见 [ADR-014](docs/adr.md#adr-014-corrections-after-first-model-review)、[ADR-033](docs/adr.md#adr-033-flashlight-shadows-headlamp-on-the-cap-brim) 及头灯规则提交 [`ebd6978`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/ebd6978)。

玩法上的纠正则落进测试。agent 曾让敌人在后面的波次里悄悄变得更耐打、更快。我的规则是：如果数值变了，外观就必须跟着变，玩家看到什么就应该知道自己面对什么。这条规则写进了 [ADR-053](docs/adr.md#adr-053-an-enemy-kinds-stats-never-scale-with-the-wave)，并在 [`572769f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/572769f) 成为一条测试（"an enemy kind has the same stats on every wave"）。同样，试玩时发现炮塔可以把通道完全封死，这不是我想要的防守方式；改成炮塔不阻挡敌人后，[`60785ea`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/60785ea) 加了一条"敌人能绕过一圈炮塔"的测试，防止之后的改动把它改回去（[ADR-066](docs/adr.md#adr-066-ninth-round--scope-for-the-last-week-and-the-backlog-settled)）。

## 试玩揭示了实现之外的问题

小组试玩改变了我对引导的判断。有人把地表当成 PVP 场地，没有发现电梯；没人提醒就不知道要启动反应堆，也有人一直没找到商店。后来我据此反馈加入分房间的教程、目标标记和屏幕边缘箭头。再往后，信息虽然都有了，却埋得太深，或在波次结束时同时出现，于是 ready 提示有了独立位置，各种信息也改为分批呈现。见 [ADR-050](docs/adr.md#adr-050-what-the-group-playtest-showed--tutorial-and-visual-guidance-come-next)，引导标记在 [`0e52073`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/0e52073)，教程在 [`12a8297`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/12a8297)，信息层级调整在 [`544c774`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/544c774)（[ADR-060](docs/adr.md#adr-060-seventh-round--what-watching-the-group-play-showed-about-the-ui)）。

这些问题并不只是 AI 没有发现。即使是我，也要看其他人实际游玩才意识到。Agent 可以验证程序是否执行了规则，检查页面和画面，但它不能真正获得玩家的体验。我认为这在一定程度上是一个硬伤，无法单靠增加 harness 或调整工作流解决。美术是否成立、合作是否有趣、玩家是否理解下一步，仍需要人的判断，尤其是其他玩家的反馈。

## 目前的取舍

我在美术上投入了很多调整，音效则因为时间限制没有打磨到同样程度。它已经加入，制作时采用先在试听页面听、再决定保留合成音还是换成录音的方式，但沉浸感和压力曲线仍有继续调整的空间。见 [ADR-071](docs/adr.md#adr-071-sound-first-batches) 及战斗音效接入 [`80ba129`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-blendspitfire/commit/80ba129)。

这次协作让我能把更多精力放在选择和审阅上。文档与检查减少了重复沟通，也帮助 agent 自主推进；与此同时，游戏最终传达了什么体验，仍然需要我和实际玩家来判断。

## 参考文献

- 《游戏设计艺术》（Jesse Schell, *The Art of Game Design: A Book of Lenses*）
