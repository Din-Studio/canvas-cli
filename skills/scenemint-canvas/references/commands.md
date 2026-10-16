# 场景 → 命令（先看这里）

本节把用户的一句话翻成 `canvas_cli` 的 argv。argv 用 JSON 数组写，原样复制即可。
下文所有大写字母的 `NODE-ID` / `SHA` / `MODEL-ID` 都是占位符，必须换成**上一条命令回复里**的真实值。

## 小节索引（先定位，再只读那一节）

本文件很长。**不要整读**：宿主的文件读取工具会在中途截断，而且不会告诉你缺的是哪半份 —— 拿半份手册当全份用，正是「这条命令不存在吧」这类错误判断的来源。先按用户那句话在下面的场景表里找到场景号（`## 1.` 一直到 `## 18.`，文档库是 `## 17d.`，三维导演台是 `## 6f.`，动画调度是 `## 6g.`，出参考视频是 `## 6h.`），照抄 argv；要查参数细节再按**标题原文**搜下半部分对应的一节。标题会改、行号更会改，所以这里只给标题，不给行号。

| 读哪一节（照这个标题原文搜）                              | 里面是什么                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `## 铁律（每条命令之前都过一遍）`                         | 发任何命令之前都成立的十条                                                                                              |
| `## Main and delegated worker sessions`                   | 一个连接对一张画布；worker 能做什么、不能做什么                                                                         |
| `## Hard limits every call is checked against`            | 每条命令都会被检查的边界：一批多少条、一次读几条路径、上传多大                                                          |
| `` ## 命令卡住 / 页面刚升级：`page_away` ``               | 页面不在时谁排队、谁根本没发出去、怎么用同一个 `--request-id` 取结果                                                    |
| `## Find and read`                                        | `list-canvases` `ls` `read` `grep` `snapshot` `health` `tasks` `changes` 的完整参数                                     |
| ``## The document index: `doc-index` and business paths`` | 业务路径那张表怎么读、怎么写，以及为什么它删不得                                                                        |
| `## Discover generation models`                           | `models` 与 `inputSchema`：参数只能用它列出来的值                                                                       |
| `## Wire references and write prompt mentions`            | 连线与 `@{}` 的固定顺序                                                                                                 |
| `## Plain text nodes (no generation)`                     | 文字便签（不用 `run`）                                                                                                  |
| `## Apply batches`                                        | 一批 `apply` 的整批语义、`--turn`、`--file`                                                                             |
| `## The thirty apply commands`                            | 30 条 apply 命令各自的字段；每条还有自己的三级小节，再往下找一层                                                        |
| `## Runs, undo, and timelines`                            | `run` `run-batch` `run-stills` `run-shot-refs` `run-tool` `cancel` `cancel-batch` `undo` `redo` `operations` `timeline` |
| `## Media and connections`                                | `upload` `download` `inspect-media` `frames` `export-jianying` `jianying-roots`                                         |
| `` ## Project documents: `docs` ``                        | 文档库：`docs ls` `read` `create` `update` `delete` 的参数与回包                                                        |
| `## Refresh and errors`                                   | 错误码逐条对应的处置                                                                                                    |
| `## 不经宿主、直接跑二进制时`                             | 人在 shell 里排查用；模型不需要读                                                                                       |

## 铁律（每条命令之前都过一遍）

- argv 里**永远不要写 `--session`**：宿主自动注入。自己写 → 命令被拒（`SESSION_NOT_ALLOWED`），什么都没执行。
- **先 `ls` / `grep` 再 `read`，永远不要猜节点 id**。猜的 id 只会得到 `missing` 或 `node_not_found`。
- 写任何文字前**先 `read` 拿 `promptSha` / `contentSha` / `titleSha`**，写的时候放进 `expect`。不带 → 会覆盖用户刚改的内容。
- `@{标签}` 只能逐字复制 `read` 回复里 `mentionCandidates[].syntax` 的值。自己拼 → `unresolved_mention`，整批失败。
- **连线一批、写提示词另一批**，中间要等参考节点有输出。例外：参考是三维出片卡（`run` 回包 `outputs[]` 里已经落下的那张）时，`connect` 和带 `@{}` 的提示词可以放**同一批**，`@` 标签逐字取那一行的 `outputs[].title`（场景 6h）。
- **`run` / `run-batch` 之前必须把节点清单念给用户、得到用户同意**。每个节点 = 一次付费生成。
- 文件路径只能写会话 workspace 里的相对路径（`--file edit.json`、`--out out/a.png`）。写别处 → `workspace_boundary` / `file_not_found`。唯一的例外是 `export-jianying --draft-root`：直写用户的剪映草稿目录（绝对路径，见场景 17c）。
- 回复 `ok:false` = 什么都没发生。读 `error.code`，按下面对应场景修，不要改个措辞重发。
- 用户看不懂 JSON。回报时说：做了什么、节点叫什么、还差什么；不要贴原始回复。
- 带 JSON 的命令：把 JSON **压成一行**放进 `--json`；太长就存成 workspace 里的 `edit.json` 用 `--file edit.json`。

## 1. 找节点：「白妍那张图在哪」「我打了终稿标签的」「ep01 第一镜」

按名字 / 提示词里的字（默认搜 prompt、content、title）：

```json
["grep", "白妍", "--fixed"]
```

回读 `shown[]`：每条有 `nodeId`、`path`、`field`、`text`。多条命中就把 `path` 和 `text` 念给用户选。

按标签（任一命中、不分大小写，`--tag` 可重复）：

```json
["ls", "/", "--tag", "终稿", "--long"]
```

回读 `rows[]`：`nodeId`、`title`、`tags`、`status`、`hasOutput`、`promptSha`、`titleSha`。

按业务路径（目录以 `/` 结尾，一层一层往下）：

```json
["ls", "/视频/ep01/"]
```

`rows[]` 里以 `/` 结尾的是目录，再 `ls` 一层；不以 `/` 结尾的是节点。找不到任何东西时告诉用户「画布上没有叫 X 的」，不要编。

- ✅ 正确：`["grep","白妍","--fixed"]` → 拿 `shown[0].nodeId` → 再 `read`。
- ❌ 错误：`["read","白妍"]` → 回复 `missing:["白妍"]`，什么也没读到。名字不是 id。
- ❌ 错误：`["read","node-1"]`（猜的 id）→ `missing`。id 只来自 `ls` / `grep` / `created[]`。
- ❌ 错误：`["grep","白妍(.*)婚纱"]` 之类复杂正则 → `invalid_request` `unsafe_pattern`。用 `--fixed` 搜字面。

## 1b. 定位：「定位到 X」「跳过去看看」「这个在哪」「给我看一眼刚失败的那个」

**你做得到。** 用户浏览器里那块画布的相机，`focus_node` 能动：它在用户的页面上以 320 ms 动画把镜头移过去并放大。不要回答「那是页面自己的行为，我碰不到」——那是错的，而且用户会当真。

动作永远是同一个：**先拿到 nodeId，再 `focus_node`**。区别只在「nodeId 从哪来」，而用户的说法只有两种。

**① 用户说的是画布上的东西**（「白妍的婚纱图」「ep03 第二个镜头」「人物设定那个组」）→ 按场景 1 用 `grep` / `ls` / `read` 拿 `nodeId`，再定位：

```json
["grep", "白妍", "--fixed"]
```

<!-- prettier-ignore -->
```json
["apply", "--json", "{\"commands\":[{\"type\":\"focus_node\",\"nodeId\":\"NODE-ID\",\"fill\":0.6}]}"]
```

**② 用户说的是一次任务**（「刚才那批跑的」「刚失败的那个」「最后生成的那张」）→ 走 `tasks`（场景 12）。它的每一行都带那次任务跑的是哪个节点：文本 `table` 里是 **`node`** 列，JSON 的 `rows[]` 里是 `nodeId` + `nodeTitle`。拿这个 id 去定位，不要回头按名字重新猜：

```json
["tasks", "--status", "failed", "--limit", "5"]
```

<!-- prettier-ignore -->
```json
["apply", "--json", "{\"commands\":[{\"type\":\"focus_node\",\"nodeId\":\"ROWS-0-NODEID\",\"fill\":0.6}]}"]
```

`fill` 是节点要占满视野的比例，`(0,1]`，默认 0.5。看细节用 0.8，想连周边一起看用 0.3。

**组也是节点。** 用户说「人物那个组」就直接 `focus_node` 那个组 id，整个框会框进视野——不用先展开、不用 `ungroup`、不用把成员列出来一个个看。组大，`fill` 给小一点（0.4～0.5）。

**做完要核对回包。** `focus_node` 和下面的 `select` 是 apply 里仅有的两条「效果不在文档里」的命令（动的是用户浏览器里的镜头 / 选区，不是画布文档），所以 `ok:true` 不代表用户的画面动了。读 `focused[0].framed`：`true` 才可以说「已经定位过去了」；`false` 时 `reason:"unmeasured"`（页面还没量到这个节点，多半在视野外）或 `"no_camera"`（这个宿主没有画布相机，永远定位不了）——两种都要改口，把节点名和 `path` 报给用户让他自己找，别谎称已经定位。

- ✅ 正确：`["grep","婚纱","--fixed"]` → 拿 `shown[0].nodeId` → `focus_node` → 读 `focused[0].framed` → 「已经帮你定位到『白妍·婚纱』了」。
- ✅ 正确：`["tasks","--submitter","me","--status","failed"]` → 拿 `rows[0].nodeId` → `focus_node` → 「刚失败的是 S02 特写，已经跳过去了」。
- ✅ 正确：用户说「看看第一幕那个组」→ `["ls","/","--long"]` 找到组 id → `{"type":"focus_node","nodeId":"GROUP-ID","fill":0.45}`。
- ❌ 错误：用 `set_viewport` 去「定位」。

  <!-- prettier-ignore -->
  ```json
  {"commands": [{"type": "set_viewport", "viewport": {"x": -400, "y": -200, "zoom": 0.75}}]}
  ```

  它写的是画布**保存的** viewport，也就是**下次打开**停在哪，**不动任何人当下的相机**；而且用户一平移缩放，页面约 400 ms 后就把它覆盖掉。用它回答「跳过去看看」= 用户什么也没看到，而你会以为成功了。它只在用户明说「以后打开就停在这」时才对。

- ❌ 错误：不 `ls` / `grep` / `tasks`，直接猜一个 `nodeId`（`node-1`、`S02`、用户说的标题）→ `node_not_found`，整批失败。id 只来自上一条命令的回复。
- ❌ 错误：用户说「定位到人物那个组」，先 `read` 组拿 `memberIds` 再逐个 `focus_node` → 镜头在成员之间乱跳，最后停在最后一个。直接定位组。
- ❌ 错误：拿 `ok:true` 就汇报「你现在看到它了」。要读 `focused[].framed`。
- ❌ 错误：用户没要求就 `focus_node`（比如每改一个节点都跳一下）→ 抢用户的镜头。只在用户要求「给我看看」时用。

**一次看几个 / 看全貌**（「把这三张一起给我看」「缩到能看到整张画布」）：`nodeIds` 取这些节点的**合并**包围盒，`all:true` 是整张画布。`nodeId` / `nodeIds` / `all` 三选一：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "focus_node", "nodeIds": ["ID-A", "ID-B", "ID-C"], "fill": 0.8}]}
```

<!-- prettier-ignore -->
```json
{"commands": [{"type": "focus_node", "all": true, "fill": 0.9}]}
```

**指给用户看是哪几个**（「你说的是哪几张」「把失败的标出来给我看」）：`select` 在用户的画布上把这些节点选中高亮（和人点选一样），不动镜头、不改文档；空数组 = 取消选中。要「跳过去 + 标出来」就一批里先 `focus_node` 再 `select`：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "focus_node", "nodeIds": ["ID-A", "ID-B"]}, {"type": "select", "nodeIds": ["ID-A", "ID-B"]}]}
```

读 `selected[0].shown`：`false` 且 `reason:"no_selection"` = 这个宿主没有编辑器选区，改口把节点名报给用户。

- ❌ 错误：想「选中它们」然后等用户按 Delete —— 删除由你自己发 `delete_node`（先问用户），`select` 只是给人看。

## 2. 看节点写了什么：「这张图的提示词是什么」

```json
["read", "NODE-ID"]
```

回读 `nodes[0]`：`prompt`、`promptSha`、`params`（模型、比例、分辨率）、`outputUrl`、`tags`、`edges.in`、`mentionCandidates`、`lastError`。只要一个字段：`["read","NODE-ID/prompt"]`。

- ❌ 错误：用 `snapshot` 看提示词 → 只有前 300 字，还拿不到 `promptSha`。
- ❌ 错误：把 `read` 回来的 `prompt` 里的 `@{白妍·基准}` 念成「艾特白妍」。它是「参考了『白妍·基准』这个节点」。

## 3. 改提示词：「把白色婚纱改成红色」「整段重写」

第一步 `["read","NODE-ID"]`，记下 `promptSha`。

局部替换（优先，其它文字和 `@{}` 原样保留）：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "edit_text", "nodeId": "NODE-ID", "field": "prompt", "oldString": "白色婚纱", "newString": "红色婚纱"}]}
```

整段重写（必须带 `expect`）：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "update_node", "nodeId": "NODE-ID", "draft": {"prompt": "新的整段提示词"}, "expect": {"promptSha": "SHA"}}]}
```

argv（JSON 压成一行；注意引号要转义）：

<!-- prettier-ignore -->
```json
["apply", "--json", "{\"commands\":[{\"type\":\"edit_text\",\"nodeId\":\"NODE-ID\",\"field\":\"prompt\",\"oldString\":\"白色婚纱\",\"newString\":\"红色婚纱\"}]}"]
```

回读 `written[]`（新的 `sha`），再 `read` 一次确认。改完提示词节点变 `dirty`，要出新图得再走场景 6。

- ❌ 错误：`update_node` 不带 `expect` → 用户刚手改的内容被覆盖，没有任何报错。
- ❌ 错误：回复 `stale` 后把 `expect` 去掉重发 → 同样覆盖用户。正确做法：重新 `read`，用新 sha。
- ❌ 错误：`edit_text` 的 `oldString` 出现两次 → `invalid_command` `matches: 2`。多带几个字让它唯一。
- ❌ 错误：把 `read` 回来带 `@{⚠missing:…}` 的整段原样 `update_node` 写回 → `unresolved_mention`。用 `edit_text` 改局部，或先把那个 token 删掉。
- ❌ 错误：`["apply","--file","/tmp/edit.json"]` 或 `["apply","--file",".canvas/edit.json"]` → `workspace_boundary` / `file_not_found`。文件放在 workspace 里，写相对 workspace 的路径。回包的 `error.path` 是解析后的绝对路径、`error.workspace` 是会话 workspace 根（0.17.0），照它挪文件或改路径。

## 4. 新建生成节点并连参考：「基于白妍的基准图再出一张婚纱照」

第一步 找参考节点（场景 1），确认它 `hasOutput:true`。没有输出就先按场景 6 生成它，**等它成功再继续**。

第二步 选模型：`["models","--model-type","image"]`，回读 `models[].id`，拿 `MODEL-ID`。

第三步 建节点（提示词先**不写 `@{}`**）：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "add_node", "id": "NEW-ID", "kind": "gen", "position": {"x": 0, "y": 0}, "title": "白妍·婚纱", "draft": {"mode": "image", "modelId": "MODEL-ID", "aspectRatio": "3:4"}}]}
```

第四步 连线（单独一批）：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "connect", "source": "BASE-ID", "target": "NEW-ID", "targetHandle": "reference"}]}
```

回读 `created[]` 里 `kind:"edge"` 的 `id`，记下来（断线要用）。

第五步 `["read","NEW-ID"]`：`prompt` 里已经被自动种了一个 `@{白妍·基准}`；`mentionCandidates[].syntax` 就是可用的写法；记下 `promptSha`。

第六步 写提示词，`@{}` 放在句子里、紧跟「基于参考图」：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "update_node", "nodeId": "NEW-ID", "draft": {"prompt": "基于参考图 @{白妍·基准} 生成，保持与参考图完全一致的人物五官与发型，改为白色蕾丝婚纱，教堂内景，柔和逆光"}, "expect": {"promptSha": "SHA"}}]}
```

视频节点写法：`人物参考 @{白妍·婚纱·基准}，场景参考 @{教堂·白天·基准}，白妍缓步走向圣坛，镜头从背后缓推。`

第七步 `read` 确认 `mentions[].key` 含 `BASE-ID`，然后走场景 6 生成。

- ❌ 错误：第四、六步合成一批（connect + 写 `@{}`）→ `unresolved_mention`，整批失败。
- ❌ 错误：参考节点还没有输出就写 `@{}` → `unresolved_mention`。先生成参考。
- ❌ 错误：`@{白妍·基准} 白色婚纱，教堂……`（token 堆在开头，或保留自动种下的 token 再在后面追一段）→ 能写进去，但出图效果差。把 token 挪进句子。
- ❌ 错误：自己写 `@白妍`、`@图片1`、贴 URL → 不绑定任何参考，等于没连。
- ❌ 错误：`"kind":"image"` / `"kind":"text"` → `invalid_request`。kind 只有 `gen`、`media-upload`、`scene-3d`。
- ❌ 错误：`"targetHandle":"prompt"` → `invalid_command` `CONNECT_REJECTED: unknown-port`。gen 节点只有 `reference` 一个入口。

## 5. 打标签 / 找标签：「把这几张标成人物设定」「看看我刚打了终稿的」

打标签（节点和组都行；`--tags ""` 清空；逗号分隔）：

```json
["apply", "--node", "NODE-ID", "--tags", "人物设定,终稿"]
```

找刚打了标签的：`["ls","/","--tag","终稿","--long"]`；按标签文字模糊搜：`["grep","终稿","--fields","tags","--fixed"]`。

预置标签（用户下拉里固定有的）：`人物设定`、`场景设定`、`道具设定`、`分镜图`、`A-copy`、`B-copy`、`暂定`、`终稿`；集数写 `ep01` 这样。自定义也允许。

- ❌ 错误：`["ls","/","--tags","终稿"]` → `invalid_argument` `--tags is not an option of ls`。筛选是 `--tag`，写入才是 `--tags`。
- ❌ 错误：给组写 `title` / `prompt` 之类 draft → `invalid_draft`。组只能写 `assetTags` / `assetTagColors`。
- ❌ 错误：一次写 21 个标签、或某个标签超 30 字、或空串 → `invalid_command` `INVALID_DRAFT`，整批不落。

## 6. 生成：「出一张」「这几个镜头重新生成」

第一步 列清单：`["ls","/","--tag","分镜图","--long"]` 或场景 1 的其它方式，拿到每个 `nodeId` 和 `title`。

第二步 **把清单念给用户**：「要生成这 3 个：S01 全景、S02 特写、S03 …，每个各算一次，确认吗？」等用户说好。

第三步 生成：

```json
["run", "NODE-ID", "--approved"]
```

```json
["run-batch", "--nodes", "ID-A,ID-B,ID-C", "--approved"]
```

按组生成（先 `["read","GROUP-ID"]` 拿 `memberIds`，全部列进授权）：

<!-- prettier-ignore -->
```json
["run-batch", "--json", "{\"groupId\":\"GROUP-ID\",\"approval\":{\"userApprovedNodeIds\":[\"ID-A\",\"ID-B\"]}}", "--approved"]
```

回读：`run` 回 `ok:true` 只表示**已提交**；`run-batch` 回 `submitted` / `pending` / `skipped` 和 `batchId`。之后按场景 7 看进度。

- ❌ 错误：漏 `--approved` → `approval_required`。
- ❌ 错误：用户没点头就加 `--approved` → 命令能过，但花了用户的钱。这是违规，不是技巧。
- ❌ 错误：`["run-batch","--group","G","--approved"]` 不带 `--json` 授权清单 → `approval_required`。
- ❌ 错误：回复没来就再发一次同样的 `run-batch` → 重复计费。等，或用场景 7 查。
- ❌ 错误：把 `run` 的 `ok:true` 报成「生成好了」。它只是「排上队了」。

### 6a. 再来一次：「这张图 / 这段视频再抽一次」「重新生成」「手不对，修一下」

**重跑不丢历史。** 同一个节点再 `run`（改没改提示词都一样，人点的、Agent 发的都一样），新结果
**追加**进这个节点的候选组（就是 ×2 / ×4 批量和「设为主图 / 主视频」用的那一组）：最新一跑自动
成为主图 / 主视频，之前每一次的结果都还在，可以选回去。两次单跑再加一次 ×2 → 候选组里 4 个。
图片和视频候选不自动淘汰。切换产出类型仍会替换另一类型的候选组。

```json
["run", "NODE-ID", "--approved"]
```

跑完后列出所有候选，让用户挑（或者按用户的描述替他挑）：

```json
["resources", "NODE-ID"]
```

回读 `resources[]` 里 `source:"candidate"` 的行：`outputId`、`runIndex`（第 N 次）、`runId`、
`createdAt`、`promptSha`、`promptChanged`（生成它时的提示词和现在的不一样）、`current`（当前
主图）。给用户念的时候说「第 2 次、10:31 生成的、提示词已改动」，不要念 id。

```json
[
  "apply",
  "--json",
  "{\"commands\":[{\"type\":\"select_output\",\"nodeId\":\"NODE-ID\",\"outputId\":\"OUTPUT-ID\",\"expectOutputId\":\"CURRENT-OUTPUT-ID\"}]}"
]
```

**先判断是哪一种「再来一次」**（弱模型照表执行，不要自己发挥）：

| 用户的话                                                                          | 类型              | 怎么做                                                                                                                           |
| --------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 「重新生成」「修一下」「手不对」「串脸了」「构图错了」「内容不符」「被审核拦了」  | (a) 修 bug 型重做 | **同一个节点**：需要就 `edit_text` / `update_node` 改提示词，然后 `run`。结果累积成候选，用户在「设为主图 / 主视频」里挑。       |
| 「换个方式」「再来一版不同的」「试试别的风格」「换个机位 / 镜头感」「要一版对比」 | (b) 换一种演绎    | `duplicate_node`（原节点旁边出一个版本 2、版本 3……，参考连线一起复制），在**新节点**上写另一种提示词再 `run`。两版并排留着比较。 |

(b) 的复制命令（`count` 1–20，`layout` 决定第二份往哪边排；不写 `position` 就落在源节点旁边的空地上）：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "duplicate_node", "nodeId": "NODE-ID", "count": 2, "layout": "row"}]}
```

- ✅ (a) 上一张有明确缺陷 → 同节点改提示词重跑，`resources` + `select_output` 在所有候选里挑。
- ✅ (b) 上一张能用、用户想看另一种诠释 → `duplicate_node` 出新版本，各自保留。
- ✅ 用户想回到旧的那次结果 → `resources` 找到那一行的 `outputId`，`select_output`；不用重新生成。
- ✅ 用户明确说「之前的都不要了、清掉重来」→ `["run","NODE-ID","--fresh","--approved"]`（`clearCandidates:true`）才会清空同类型旧候选。只在用户明说时用。
- ❌ 错误：为了修缺陷去 `duplicate_node` → 画布上堆满坏版本。
- ❌ 错误：用户说「试另一种」却在同一节点覆盖提示词重跑 → 两种诠释没法并排比较（虽然旧结果还在候选里，但提示词已经被改掉了）。
- ❌ 错误：`delete_node` 再 `add_node` 来「重来」→ 连线、标签、历史全丢。重跑就在原节点上 `run`。
- ❌ 错误：默认加 `--fresh` → 把用户还想比较的旧候选清掉了。默认永远不加。
- 候选太多、某一张不要了 / 想把某一张单独拿出来 → 场景 6d。
- 产品层有自己的「加版」命令时（例如 script-to-video 的 `canvas_plan stage=takes`），**用产品的**，
  它决定版本节点怎么建；这张表只管裸画布。

### 6b. 「这张图就是那个节点的结果」「用户拖进来的这张当基准图」

用户指着画布上已有的一张图说「这个就是 X 节点的结果」——不用重跑，`adopt_output` 把它登记成 X 的候选并设为主图，走的是和真生成一模一样的落地路径：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "adopt_output", "nodeId": "NODE-ID", "url": "https://HOST/PATH-FROM-SNAPSHOT.png"}]}
```

`url` 只能从 `snapshot` / `ls --long` 的 `outputUrl` 里**复制**（那些地址已经在可信媒体域名上）。本地文件先 `upload`（场景 14）再取它的 `outputUrl`。

- ✅ 正确：用户「这张脸才对，把它当白妍的基准」→ `["ls","/","--long"]` 找到那张图的 `outputUrl` → `adopt_output` 到基准节点 → `read` 确认。
- ❌ 错误：用它「补」一个从来没生成过的结果（贴一个外部网址、编一个地址）→ `invalid_request`，而且那是伪造节点历史。
- ❌ 错误：对已经有视频候选的节点采纳一张图 → `invalid_command`。换节点。
- ❌ 错误：想在同一个节点的几次生成之间挑一个 → 那是 `select_output`（场景 6a），不是这条。

## 6c. 节点工具条上的工具：「把这段的人声分离出来」「这张图抠个图」「这段去掉字幕」「把这张图裁成 16:9 / 切成四宫格 / 翻过来 / 圈出来」

节点工具条上的那些次级操作（人声分离 / 环境音分离 / 去字幕 / 视频超清 / 智能拆分 / 抠图 / 重绘 / 扩图 / 重打光 …）走 `run-tool`。**它和 `run` 一样花钱**，所以同一道流程：先列清单、念给用户、等他点头，再发 `--approved`。

```json
["run-tool", "NODE-ID", "--kind", "separate-vocal", "--approved"]
```

带提示词的编辑类工具（重绘 / 推演 / 编辑元素）：

```json
["run-tool", "NODE-ID", "--kind", "image-inpaint", "--prompt", "把背景换成夜景街道", "--approved"]
```

**`--kind` 不确定就先问节点**：`["read","NODE-ID"]` 的回包里有 `tools`，那是**这个节点当下适用**的工具清单（每条带 `kind` 与中文名；一个都没有时这个字段不出现）。它跨两套工具：节点工具条的（人声分离 / 去字幕 / 超清 / 拆分）和图片编辑的（重绘 / 推演 / 消除 / 编辑元素 / 扩图 / 抠图 / 重打光 / 转角度 / 三视图 / 图片超清）。kind 写错或用错节点（对着音频节点要「去字幕」），回包是 `tool_not_found` / `tool_not_applicable`，并把可用清单原样列出来——照着改 `kind` 再发，不要猜第二次。

产物**一律落在源节点旁边的新节点上，源节点一个字节不动**（分离出的音频、抠好的图、去过字幕的视频都是新节点）。图片编辑还会先建一个占位的派生节点、结果落到它上面——所以跑的时候源图上看不到 `running`，要看进度就看新出现的那个节点。所以跑错了删掉新节点即可，不会毁掉用户已有的东西。

**本地工具（`billable:false`，不是生成扣费项）**：`read` 的 `tools` 里带 `"billable":false` 的那几条（`trim-audio` 裁切音频、`trim-video` 裁切视频、`capture-frame` 截帧；图片节点上的 `crop-image` 裁剪、`grid-split` 多宫格、`flip-image` 翻转、`annotate-image` 标注（含文字 `kind:"text"`），以及资产参考图 `asset-sheet`、剧内比例总表 `scale-lineup` —— 这两件与标注文字见场景 6e）整件事在用户浏览器里做完，不经网关、**不是生成扣费项**，不需要向用户要钱的那次点头（CLI 仍要 `--approved`，那只是命令形状）。全集在契约 `CANVAS_CONTRACT.tiers["run-tool"].localKinds`。参数走 `--json` 的 `metadata`，回包不是 `taskId` 而是 `local:true` + 产物节点：

```json
["run-tool", "AUDIO-NODE", "--kind", "trim-audio", "--title", "音色 · 白妍", "--approved", "--json", "{\"metadata\":{\"mode\":\"speech\",\"targetMs\":5000}}"]
["run-tool", "AUDIO-NODE", "--kind", "trim-audio", "--approved", "--json", "{\"metadata\":{\"inMs\":1200,\"outMs\":6200}}"]
["run-tool", "VIDEO-NODE", "--kind", "trim-video", "--approved", "--json", "{\"metadata\":{\"inMs\":12000,\"outMs\":17000,\"frames\":true}}"]
["run-tool", "VIDEO-NODE", "--kind", "capture-frame", "--approved", "--json", "{\"metadata\":{\"atMs\":[0,2500,4950]}}"]
["run-tool", "VIDEO-NODE", "--kind", "capture-frame", "--approved", "--json", "{\"metadata\":{\"count\":3}}"]
["run-tool", "IMAGE-NODE", "--kind", "crop-image", "--approved", "--json", "{\"metadata\":{\"x\":0.1,\"y\":0.2,\"w\":0.6,\"h\":0.5}}"]
["run-tool", "IMAGE-NODE", "--kind", "crop-image", "--title", "海报 · 横版", "--approved", "--json", "{\"metadata\":{\"aspect\":\"16:9\",\"rotate\":90}}"]
["run-tool", "IMAGE-NODE", "--kind", "grid-split", "--approved", "--json", "{\"metadata\":{\"cols\":2,\"rows\":2}}"]
["run-tool", "IMAGE-NODE", "--kind", "flip-image", "--approved", "--json", "{\"metadata\":{\"axis\":\"horizontal\"}}"]
["run-tool", "IMAGE-NODE", "--kind", "annotate-image", "--approved", "--json", "{\"metadata\":{\"strokes\":[{\"kind\":\"rect\",\"color\":\"#FF3B30\",\"width\":0.008,\"points\":[[0.3,0.2],[0.7,0.6]]}]}}"]
```

- `mode:"speech"`（仅音频）= 自动选段：掐掉静音、装完整的句子、总长不超过 `targetMs`（默认 5000；`maxMs` 另设硬上限；`minMs` = 整句凑不到这个长度时把下一句截一截补足，音色参考要 4–5 秒就传 `minMs:4000`）。回包 `outputs[0].meta` 有实际落到的 `inMs / outMs`、装了几句（`speechSegments`）、是否截断（`truncated`）。
- `mode:"speech"` 再带 `turns:["Ann","Ben","Ann"]` + `speaker:"Ben"` = 多人同镜：按台词顺序把说话段对到人，只取 Ben 的那一句（`meta.alignment` = `exact` / `merged` 可信；`unreliable` = 段数对不上台词数，退回整体选窗，要让人在面板上确认）。浏览器里做不了说话人识别，靠的是台词顺序——`turns` 必须逐句照分镜正文的顺序写。
- `inMs / outMs`（毫秒）= 手动范围，音频视频都收；不足 100ms 拒。
- `frames:true`（仅视频）= 顺带抽出入点 / 出点两帧成两个图片节点（重抽一段时给新镜头当首尾帧）；默认不抽。
- `capture-frame`（仅视频，0.12.0 起）= 单独截帧成图片节点，不裁视频：`atMs` 一个毫秒数或数组（≤24 个，超出时长的钳到尾帧附近），或 `count:N` 等距抽 N 帧（N≥2 含首尾）。产物一帧一个图片节点，`meta.atMs` 是实际落到的时间、`meta.index / total` 是顺序。看片质检（首中尾三帧）、给重抽当参考帧都用它，别再用 `trim-video` + `frames:true` 绕。
- 图片四件（gen 图片节点、上传的图片节点都能用，要已经出图）——**源图不动，结果一律是源节点旁的新图片节点（带溯源边），和人在图片工具条上点出来的节点一模一样**。坐标全是 0..1 归一化（左上角是 0,0）：
  - `crop-image`：`x / y / w / h` 四个一起给（`x + w ≤ 1`、`y + h ≤ 1`；覆盖整图又不旋转也收，等于复制一份原图，同界面），或只给 `aspect`（`1:1` `3:2` `2:3` `4:3` `3:4` `16:9` `9:16`，取该画幅最大的居中框），二选一。`rotate` 可选 `0 / 90 / 180 / 270`（顺时针）：**先转图、框落在转过的图上**，和界面裁剪台一样。长边超过 4096 等比缩小。`meta` 回实际的 `rect / width / height`。
  - `grid-split`：`cols`、`rows` 各 1..4 的整数（1×1 也收，等于复制一份原图，同界面）；一格一个新节点，行优先（`meta.index / row / col`），排在源节点右侧成网格。某格上传失败会跳过它、其余照落，`meta.failedCells` 列出跳过的格。
  - `flip-image`：`axis` = `horizontal`（左右）/ `vertical`（上下）。
  - `annotate-image`：`strokes` 非空（≤200 笔）；每笔 `kind` = `pen`（自由线，1..2000 个点）/ `rect` / `circle` / `arrow`（恰好 2 个点：起点、终点）；`color` 可省（默认 `#FF3B30`，收 `#RGB` / `#RRGGBB` / `#RRGGBBAA`）；`width` 是图片长边的比例，可省（默认 0.008，界面细 / 中 / 粗 = 0.004 / 0.008 / 0.016，上限 0.1）。笔画直接烧进图里。
  - 这四件的参数错了（越界、空 `strokes`、多一个不认识的键、带了 `--prompt`）回 `invalid_request`，什么都没做——照原话改 `metadata` 再发；对着视频 / 音频 / 还没出图的节点发回 `tool_not_applicable`。
  - 上传完成才落节点（不经 `local-media://`），所以新节点的 `outputUrl` 已经是 http 地址。处理加上传超过 30 秒会先回 `unknown_outcome`，这时节点还没落下、稍后才出现——不要重发，过一会儿读源节点的下游核实。
- 产物：mp3（音频）/ mp4（视频）落在源节点旁的新节点上，先 `local-media://` 预览、上传完成后换成 CDN 地址（`read` 到 http 地址即可用）。超过等待窗口回 `unknown_outcome` 时产物节点已经在画布上，读源节点的下游即可，不要重发。

- ✅ 正确：用户「这段台词的人声给我分出来」→ 念清单「要对 ep01-P01-S02 跑一次人声分离，算一次生成，确认吗」→ 用户点头 → `["run-tool","v-ep01-p01-s02","--kind","separate-vocal","--approved"]` → 场景 7 看进度。
- ✅ 正确：用户「把这张图裁成横版，左右翻一下」→ `read` 看到 `crop-image` / `flip-image` 带 `billable:false` → 先 `crop-image` `{"aspect":"16:9"}`，再对**回包 `nodeIds[0]` 那个新节点**发 `flip-image`（不是对源图）。
- ❌ 错误：想「就地」改掉源图——这几件从不覆盖源图，结果永远是新节点；不要的话删掉新节点即可。
- ✅ 正确：分离出来的音频太长 → `read` 看到 `trim-audio` 带 `billable:false` → 直接 `--json '{"metadata":{"mode":"speech","targetMs":5000}}'`，不用再要点头（不是生成扣费项）。对用户也不要说「免费」「不花钱」（拍板 A81）。
- ❌ 错误：没 `--approved` 就发（`approval_required`，一次网络都不发就被挡）。
- ❌ 错误：把付费的 `run-tool` 当成不是扣费项的「看一眼」——除了 `billable:false` 那几条，每跑一次都是一次扣费，和 `run` 没区别。
- ❌ 错误：节点正在跑的时候再发一次（`already_running`）。等它到终态，或场景 16 先停。

## 6d. 管候选：「这张不要了」「把第二张单独拆出来」「这个节点清空，从头来」

先 `["resources","NODE-ID"]` 拿 `outputId`（生成节点是 `source:"candidate"` 的行；媒体节点的图片 / 视频历史是 `source:"image-history"` / `"video-history"` 的行，同样带 `outputId`）。

**删掉一张候选**（候选面板上的 ✕）。删的正好是主图，下一张顶上；删光了节点就没有输出了：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "delete_output", "nodeId": "NODE-ID", "outputId": "OUTPUT-ID", "expectOutputId": "CURRENT-OUTPUT-ID"}]}
```

**把一张候选拆成独立节点**（候选面板上的「拆分」）：新节点只带这一张、以它为主图，落在源节点右边；**源节点一点不动**（候选还在，主图不变）。源节点在组里时，新节点也是这个组的成员（跟着组拖、跟着组删），组框不够大会自己长到罩住它。要放到组外，只 `remove_from_group` 不够：节点原地不动、还压在框里（看着仍像组里的，`health` 报 `stray_over_frame`），要再 `move_node` 挪出框（移出后它是顶层节点，`position` 给绝对坐标）。框只长不缩：拆分时要是把框撑大了，需要的话用 `resize_group` 的 `fit:true` 收回去。组里原本只有源节点一个成员时，`remove_from_group` 会让整个组解散（看 `dissolved[]`），就没有框要收了。新节点 id 在 `created[0].id`：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "split_output", "nodeId": "NODE-ID", "outputId": "OUTPUT-ID"}]}
```

**清空一个节点的全部产出**（右键「清空媒体」）：主图、所有候选、历史、封面、尾帧一起清掉，节点留着、回到空态。**这是删东西**，先把「会清掉 N 张候选」说给用户听：

```json
{ "commands": [{ "type": "clear_output", "nodeId": "NODE-ID" }] }
```

- ✅ 正确：「第三次那张不要了」→ `resources` 找 `runIndex:3` 那行的 `outputId` → `delete_output`。
- ✅ 正确：「把这张单独拿出来，我要拿它去做别的」→ `split_output`，拿 `created[0].id` 继续连线。
- ❌ 错误：用 `delete_output` 删媒体节点**正在显示**的那条历史 → `invalid_command`；先 `select_output` 换一条再删。
- ❌ 错误：节点正在跑时 `delete_output` / `clear_output` → `node_running`；等它跑完或先 `cancel`。
- ❌ 错误：「重新生成」却先 `clear_output` → 旧结果全没了。重跑本来就保留旧候选（场景 6a）。
- ❌ 错误：worker 身份发 `delete_output` / `clear_output` → `worker_forbidden`，删除类归主会话。

## 6e. 资产参考图与剧内比例总表：「给白妍拼一张参考图」「这个道具要看得出多大」「全剧的人站一排比比身高」「图上加个字」

三件都是本地工具（`billable:false`：浏览器里画完、不经网关、**不是生成扣费项**；CLI 仍要 `--approved`，只有主会话能发）。产物一律是源节点旁的新图片节点，源图不动。

**资产参考图 `asset-sheet`**（拍板 A57，0.15.1）：每个资产美术只出**一张**图，它就是 run-tool 的 NODE-ID；合成图不重排它，只在旁边 / 底下加东西 —— 这张合成图就是喂给视频模型的参考图。数值来自资产清单，由你放进 `metadata`：

<!-- prettier-ignore -->
```json
["run-tool", "BAIYAN-SHEET-NODE", "--kind", "asset-sheet", "--approved", "--json", "{\"metadata\":{\"kind\":\"character\",\"panels\":{\"baselineSheet\":\"BAIYAN-SHEET-NODE\"},\"heightCm\":168,\"scaleRefs\":[{\"nodeId\":\"GUYAN-SHEET-NODE\",\"heightCm\":183,\"label\":\"顾言\"}],\"fields\":{\"name\":\"白妍\",\"gender\":\"女\",\"age\":\"24\",\"weight\":\"48 kg\"}}}"]
["run-tool", "TEAPOT-SHEET-NODE", "--kind", "asset-sheet", "--approved", "--json", "{\"metadata\":{\"kind\":\"prop\",\"sizeCm\":{\"l\":24,\"w\":15,\"h\":16},\"fields\":{\"name\":\"青瓷茶壶\",\"material\":\"青瓷\"}}}"]
["run-tool", "LIVINGROOM-SHEET-NODE", "--kind", "asset-sheet", "--approved", "--json", "{\"metadata\":{\"kind\":\"scene\",\"sceneSize\":{\"lengthM\":8,\"widthM\":6},\"fields\":{\"name\":\"白家客厅\",\"setting\":\"室内\",\"entrances\":\"南墙正门\"}}}"]
```

标尺人物的设定图不在这张画布上时按文件 id 给；资产清单点名了道具右格的样子就照写 `heldMode`：

<!-- prettier-ignore -->
```json
["run-tool", "LUKE-SHEET-NODE", "--kind", "asset-sheet", "--approved", "--json", "{\"metadata\":{\"kind\":\"character\",\"heightCm\":175,\"scaleRefs\":[{\"fileId\":\"GUYAN-SHEET-FILE-ID\",\"heightCm\":183,\"label\":\"顾言\"},{\"fileId\":\"BAIYAN-SHEET-FILE-ID\",\"heightCm\":168,\"label\":\"白妍\"}],\"fields\":{\"name\":\"Luke\"},\"estimated\":[\"heightCm\"]}}"]
["run-tool", "CAR-SHEET-NODE", "--kind", "asset-sheet", "--approved", "--json", "{\"metadata\":{\"kind\":\"prop\",\"heldMode\":\"beside\",\"sizeCm\":{\"l\":450,\"w\":180,\"h\":150},\"fields\":{\"name\":\"白家的轿车\",\"color\":\"黑\"}}}"]
```

标尺人物是用户自传的图（拍板 A60）时在那一项写 `userSheet:true`（本地抠他的站立全身人像，抠不出画剪影）：

<!-- prettier-ignore -->
```json
["run-tool", "PERSON-B-SHEET-NODE", "--kind", "asset-sheet", "--approved", "--json", "{\"metadata\":{\"kind\":\"character\",\"heightCm\":178,\"scaleRefs\":[{\"nodeId\":\"PERSON-D-UPLOAD-NODE\",\"heightCm\":170,\"label\":\"人物丁\",\"userSheet\":true}],\"fields\":{\"name\":\"人物乙\"}}}"]
```

- 版式（契约 `localTools.assetSheet.panels`：`primary` = NODE-ID 那张图、`cells` = 它从左到右装着什么，美术照这个出图）：
  - 人物：NODE-ID 是**基准设定图** —— 左脸部特写、右**带头**三视图（正 / 侧 / 背三个全身人像水平排开，脸部特写与三视图之间、三个人之间都留白底空隙）。合成图 = 整张设定图原样（等比缩到一排高，**不拆**）+ **比例格** + 底部信息块。`panels.baselineSheet` 可以不给；给就写 NODE-ID 自己。`heightCm` 必给。
  - 比例格：本人物的正面视图与 `scaleRefs` 里 1–2 个**标尺人物**（剧内人物，`{nodeId | fileId, heightCm, label}`：他们的基准设定图、身高、脚下写的名字 ≤ 20 字；`localTools.assetSheet.scaleRefs`）的正面视图按身高换算、同一个每厘米像素站在一条地线上，右边一根共用的竖尺；每人一条从头顶水平引到竖尺的浅灰虚线，线上靠尺那一端写身高（拍板 A57 补充 2；经过别人时断开，不压住人像），脚下写名字与身高。**不用外部参照物**（门、椅、A4 …）；最高 ÷ 最矮超过 `noteHeightRatio`（4）倍照同一比例画（矮的会很小），回包 `notes` 说明；标尺人物缺 `heightCm` → `invalid_request` 点名是第几个、叫什么。标尺选谁由你按资产清单定（拍板 A57：男主 + 女主；主角自己那张与另一位主角比；单主角剧与出场最多的配角比）；没给 `scaleRefs` 就只有本人物与竖尺，回包 `notes` 提醒。
  - 正面视图怎么取：按列找白底空隙，跳过左边的脸部特写，取三视图的**第一个人像**（空隙窄到图宽 0.1% 也认；人脚下的浅灰投影不算；白裙、浅灰裤子、银甲这类浅色低饱和的衣服，一列里浅灰竖向跨得够长（图高 10% 以上）就算人，不会被切成竖条；脸部特写真贴着第一个人时，按后面几个人的脚底线再分一次，头顶脚底对得上才用，回包 `notes` 说一声；特写自己中间一大片接近底色（白胸口、白衬衫）按列看像断开的，整块当特写再取一次，三视图正好 3 个才用，都不成时报错两种可能都说）；标尺人物同法。旧项目给的单张派生全身图（A57 起已不再出）取整张：先判是不是设定图 —— 横图、至少三块够高的内容、除特写外那几块站在同一条地线上（底边差不到图高 3%）而特写跟它们对不上；不是就整张量。量外框同比例总表（先切脚下投影，拿不准回 `warnings` 里的 `floor_shadow_kept`），裁出来的那一块把跟图边连着的底色换白（人身上跟底色相近、被人围着的地方，比如深色底上的黑眼睛，不动）。**取不出就 `run_failed`，点名是哪张**（`run-tool 的 NODE-ID（…）` 或 `metadata.scaleRefs[i]（名字，节点 / 文件 …）`）：整张连成一块、左右颠倒（三视图在左、脸部特写在右）、左边那块不在内容宽的 12%–65%、第一个人矮于图高 35% 或宽过自己身高的 1.2 倍、三视图不是正好 3 个人像、第一个人窄过自己身高的 0.15（只取到一条）、第一个人两侧齐腰处各有一小块分开的东西（白袖子接近底色、手跟身子连不上）、第一个人的外框顶到图上沿（0.15.0 以前从脖子画起的无头三视图，或头顶被裁掉：报「设定图不带头，需按新口径重出」）—— 这时换一张重出（浅色衣服要带比底色深的勾线；颠倒的设定图别用 `flip-image` 翻：人会跟着镜像）。左边那块比一般的脸部特写窄得多（像是颠倒了）时照常出图，回包 `notes` 提醒看一眼比例格。
  - 旧项目：`panels.baselineSheet` 是另一张图 → 左段放它、比例格从 NODE-ID 取正面（NODE-ID 是那时的派生全身图，A57 起已不再出）；`panels.face` + `panels.threeView`（分开的两张）→ 左段照 0.15.0 拼成两格。两种写法不能混。
  - 道具：NODE-ID 是**三格图** —— 左正面、中背面、右按长边三档：≤ 30 cm 手部特写捧着、≤ 60 cm 不露脸的人胸口以下双手持物、更长的不露脸普通人在旁或正在使用（右格的人不是剧中角色，只作尺寸参照）。合成图 = 这张图整宽 + 底部尺寸信息块。`sizeCm` 必给。`heldMode`（`handClose` / `hand` / `beside`，`localTools.assetSheet.heldModes`）省略时按 `sizeCm` 的长边判（`heldModeMaxCm`），只影响信息块里紧跟长 × 宽 × 高的那一条「右图：…，仅作尺寸参照，非剧中角色」（`locale:"en"` 时是 `Right panel`）。
  - 场景：NODE-ID 是**两格图** —— 左场景图、右顶视户型图（室外为俯瞰图）。合成图 = 这张图整宽 + 底部尺寸面积信息块（长 × 宽来自 `sceneSize`，面积没给 `fields.area` 就按长 × 宽算）。`sceneSize` 必给。画布不往户型图上画尺寸线。
  - 0.15.0 的写法撤销了（拍板 A57）：道具另给背面图 / 手持图的 `backRef` / `heldRef`、场景另给户型图的 `panels.plan` —— 给了回 `invalid_request`，报错里带新写法。道具、场景不收 `panels`；`scaleRefs` 只给人物。
  - **用户自传的图**（拍板 A60 定稿、A61；哪些是自传由产品判，你照清单写）：**自传资产不拼合成图** —— NODE-ID 是自传图就别跑 asset-sheet（给了 `metadata.userSheet:true` 回 `invalid_request`「自传资产不拼合成图」），那张原图整张就是视频参考。自传的人物当**标尺**时在 `scaleRefs[i]` 写 `userSheet:true`：不取三视图，本地抠图、不用任何模型（阈值在 `localTools.userSheet`）—— ① 图边一圈像素均匀（与中位色每个通道差不到 24 的占 60% 以上）就从图边抹掉相连的底色，不均匀（实景、渐变底、拼图框）→ 剪影 `complex_background`；② 按连通块找站立全身人像（高 ÷ 宽 2–5、至少占图高 40%、底边在下半张；正 / 侧 / 背都行，取最大的），没有 → `no_full_body`；脚下投影照产品图那套切（同 `floorShadow`：底色上比底色暗、不改色相的一片算投影色，比脚宽或扁就切，拿不准回 `floor_shadow_kept`）；③ 顶 / 底离图边至少 1%、头顶上方没被别的格子紧挨着压着、有头，不然 → `incomplete`。抠出来的人与别人同一比例站进比例格；取不出就画一个按身高缩放的中性灰人形剪影（照样写名字身高、画标高虚线，只表示身高），回包 `notes` 说原因，不报错。`metadata.userSheetBg: {tolerance?, uniformity?}` 可改底色的两个阈值。
  - 点名的节点（`panels`、`scaleRefs` 的 `nodeId`）都要是已出图的图片节点；标尺人物不能是本人物自己（否则 `invalid_request`，什么都没做）。按 `fileId` 给的跑的时候才找（先在这张画布上找当前图是这个文件的节点，找不到再翻项目素材库）：哪都找不到、找到的就是 NODE-ID、两个标尺是同一张 → `run_failed` 点名是哪个、哪个文件。
- 信息块（底部，高度不超过整图 15%）：字段键与顺序在 `localTools.assetSheet.fields`（A30：人物 14、场景 9、道具 7 项）。值是字符串或数字、≤120 字，原样上图（单位写进值里，如 `"48 kg"`）；没有的别给这个键。身高、道具的长 × 宽 × 高、场景的长 × 宽由上面的几何参数生成，`fields` 里不收（比例格里画的高矮和字里写的数字只能有一个来源）；道具在长 × 宽 × 高后面多一条说明右格（见上）。放不下的末尾「…」，回包 `meta.infoDroppedFields` 列出没放进去的字段。
- 估出来的数（拍板 A38③：剧本没写身高体重时盘点员自己估，不写「未知」）：`estimated` 列出哪些是估的 —— 几何参数键（人物 `heightCm`、道具 `sizeCm`、场景 `sceneSize`，见 `localTools.assetSheet.geometryKeys`）或这个 kind 的字段键（如 `weight`），每个都要真给了值；信息块里对应的值后缀「（估）」，如 `身高 168 cm（估）`。场景的 `sceneSize` 估了，按它算的面积也带「（估）」。例：`"heightCm":168,"fields":{"weight":"48 kg"},"estimated":["heightCm","weight"]`。
- 图上文字的语言：缺省中文；剧本台词占比最大的语言不是中文时（拍板 A55）给 `locale:"en"`（`localTools.assetSheet.locales`）—— 信息块字段名、「（估）」、道具那条「右图」、比例格里没给名字时的「本人物」跟着换，字段的值与名字原样上图（要英文就把值也写成英文）。
- `withInfo:false` 去掉信息块（真机发现文字被画进视频时用它退），比例格也一并只留人像：名字、身高、竖尺、刻度、标高虚线、地线都不画，人的位置与大小不变（回包 `scale.stripped: true`）。这由 `stripScaleText` 管，缺省跟着 `withInfo:false`；要留比例格的字就再给 `stripScaleText:false`，只去比例格的字、留信息块就给 `stripScaleText:true`（道具、场景没有比例格，给了不起作用）。
- `metadata` 只收 `kind`、`panels`（人物）、`heightCm` / `scaleRefs`（人物）、`sizeCm` / `heldMode`（道具）、`sceneSize`（场景）、`fields`、`estimated`、`locale`、`withInfo`、`stripScaleText`、`userSheetBg`（还认 `userSheet`，但只能是 `false`）；多一个键就 `invalid_request`。
- 回包 `outputs[0].meta`：`kind`、`width` / `height`（道具 / 场景整宽 2400；人物一排 1000 高、宽随设定图与比例格）、`panels`（人物 `baselineSheet`，旧项目 `face` / `threeView`；道具 `propSheet`；场景 `sceneSheet`）、`heldMode` / `heldModeSource`（道具：`metadata` = 你给的，`sizeCm` = 按长边判的）、`scale`（人物：`pxPerCm`、`ruler`（`topCm`、`unit`）、`figures`（每人 `label`、`heightCm`、`nodeId`（按 `fileId` 在素材库里找到的为 `null`）、`fileId`、`source`（`sheet` = 从基准设定图的三视图取的，`whole` = 整张图，`figure` = 自传图抠出来的人，`silhouette` = 自传图画的剪影）、`userSheet`（自传的才有）、`reason`（剪影才有）、`box`（正面视图 / 抠出来的人在它那张图里的外框，原图像素；剪影没有）、`rect`（画在哪）、`shadowCutPx`）、`stripped`）、`subjects`（有自传标尺时：每个 `label`、`kind`、`nodeId` / `fileId`、`userSheet: true`、`source`、`reason`，与比例总表同一个形状 —— 用剪影的要照实告诉用户）、`infoRows` / `infoHeightRatio` / `infoTruncated` / `infoDroppedFields`、`notes`（见上；照实告诉用户）、`warnings`（`[{code, message}]`，码的全集在 `localTools.warningCodes`，照 `message` 告诉用户或改参数重跑）、`url`、`fileId`、`font`（`embedded` = 用随画布发的中文字体画的；`fallback` = 字体没加载上，用了系统字体）。新节点有溯源边连回画布上用到的每一张图；标题缺省「<name> · 参考图」，`--title` 可改。

**剧内比例总表 `scale-lineup`**（拍板 A40）：全剧（或一集、一个镜头）的人物 / 生物 / 道具按大小从小到大站成一排，地线对齐、每排左边一根竖尺、刻度线横贯整排，每个下方写名字与身高（道具写长边那个数）—— 一张图看清谁比谁高多少，给导演和视频模型当比例的总参照。数值来自资产清单：

<!-- prettier-ignore -->
```json
["run-tool", "BAIYAN-SHEET-NODE", "--kind", "scale-lineup", "--title", "第一集比例总表", "--approved", "--json", "{\"metadata\":{\"items\":[{\"nodeId\":\"BAIYAN-SHEET-NODE\",\"heightCm\":168,\"label\":\"白妍\"},{\"nodeId\":\"GUYAN-SHEET-NODE\",\"heightCm\":183,\"label\":\"顾言\"},{\"nodeId\":\"XIAOBAO-SHEET-NODE\",\"heightCm\":120,\"label\":\"小宝\"},{\"fileId\":\"FOX-FILE-ID\",\"heightCm\":45,\"label\":\"小狐\",\"kind\":\"creature\"}]}}"]
["run-tool", "BAIYAN-SHEET-NODE", "--kind", "scale-lineup", "--approved", "--json", "{\"metadata\":{\"items\":[{\"nodeId\":\"A-NODE\",\"heightCm\":168,\"label\":\"白妍\"},{\"nodeId\":\"B-NODE\",\"heightCm\":183,\"label\":\"顾言\"},{\"nodeId\":\"C-NODE\",\"heightCm\":45,\"label\":\"小狐\",\"kind\":\"creature\"}],\"groups\":[[0,1],[2]]}}"]
["run-tool", "BAIYAN-SHEET-NODE", "--kind", "scale-lineup", "--approved", "--json", "{\"metadata\":{\"items\":[{\"nodeId\":\"BAIYAN-SHEET-NODE\",\"heightCm\":168,\"label\":\"白妍\"},{\"nodeId\":\"SWORD-SHEET-NODE\",\"sizeCm\":{\"l\":100,\"w\":4,\"h\":12},\"label\":\"长剑\",\"kind\":\"prop\"}]}}"]
```

- NODE-ID 只决定成图落在哪个节点旁边（任一张已出图的图片节点，通常主角的基准设定图）；要排的**全在 `items`**（1–48 个，`localTools.scaleLineup`）：`nodeId` 或 `fileId`（同上，画布上找不到再翻项目素材库）、`label`（≤20 字，写在它脚下）、`kind`（`character` 缺省 / `creature` / `prop`），再加它的大小：人物 / 生物给 `heightCm`（身高 / 体高，厘米）；**道具（`kind:"prop"`）给 `sizeCm {l, w, h}`**（与资产清单、asset-sheet 同一组数，拍板 A45①），不收 `heightCm` —— 图上主体外框的**像素长边**对应长宽高里最大的那个（`scaleAxis`：`"l"` / `"w"` / `"h"` 可指定对应哪一个，`localTools.scaleLineup.scaleAxes`），另一边按外框宽高比推，所以横放的 1 m 长剑画成 1 m 长、十来厘米高，不会被当成 1 m 高、把整排压扁。同一张图不能出现两次。
- 每个 item 取哪一块（拍板 A57，与 asset-sheet 的比例格同一份代码）：**人物给基准设定图**节点（左脸部特写、右带头三视图），取三视图的第一个人像（怎么取、哪些情况取不出，见上面 asset-sheet 的「正面视图怎么取」）；旧项目的单张派生全身图（A57 起已不再出；竖图、或整张只有一个人）照旧量整张。**道具给三格图**（左正面、中背面、右手持或在旁），取左格正面（按空隙取第一块；第一块占内容宽一半以上、又比其余最宽的一块宽出 1.6 倍以上，就是左格和中格连在了一起 —— 按它的长边定比例会把道具画小 —— 算取不出；左格本来就画得宽的横放长剑不拦）；单张的道具图量整张。**生物与人物同法**：生物设定图（特写 + 带头三视图）取三视图的第一个（正面；四足、带翅的正面宽，宽 ÷ 高到 2 都认，再宽多半是正面连着侧面，算取不出），单张的生物图（浅色的也算，比如一只侧面的白狐）先判不是设定图，照旧量整张。取出来的那一块按非白像素裁主体。**产品图取不出**（正面 / 左格取不出、裁不出主体）**不整表失败**（拍板 A60「不停下问人」）：那一项画成剪影（人物中性灰人形、生物按身高的方框、道具按 `sizeCm` 的方框，只表示大小），回包那一行 `source: "silhouette"`、`reason` 是取不出的原因码（如 `loose_parts`、`headless`、`merged`、`blank`），`notes` 里写原来的报错（是谁、为什么、怎么改）—— 照实告诉用户、换图重跑；asset-sheet（人物自己的合成图）取不出仍然 `run_failed`。回包每一项的 `source` 说取的是哪种（`sheet` / `panel` / `whole`）。
- 每个人物 / 生物还有一条从头顶水平引到左边竖尺的浅灰虚线，线上贴着尺身写身高（与比例格同一种画法；道具没有，它按长边定比例）；竖尺与资产之间留一栏放这些字。
- **用户自传的图**（拍板 A60）：那一项写 `userSheet:true`，不取三视图 / 三格图 —— 人物同上面 asset-sheet 的自传标尺（本地抠站立全身人像，取不出画按身高缩放的中性灰人形剪影）；生物同法但不看高宽比、不看有没有头，取不出画按身高的方框；**自传的道具一律画按 `sizeCm` 的中性灰圆角方框**（宽 = 长、宽里大的那个，高 = 高，按长边定比例；原图照旧当视频参考）；场景不进比例总表。例：

<!-- prettier-ignore -->
```json
["run-tool", "BAIYAN-SHEET-NODE", "--kind", "scale-lineup", "--approved", "--json", "{\"metadata\":{\"items\":[{\"nodeId\":\"BAIYAN-SHEET-NODE\",\"heightCm\":168,\"label\":\"白妍\"},{\"nodeId\":\"PERSON-D-UPLOAD-NODE\",\"heightCm\":170,\"label\":\"人物丁\",\"userSheet\":true},{\"nodeId\":\"LEDGER-UPLOAD-NODE\",\"sizeCm\":{\"l\":21,\"w\":0.2,\"h\":29.7},\"label\":\"旧账本\",\"kind\":\"prop\",\"userSheet\":true}]}}"]
```

- 分排分张：一排最多 `perRow` 个（缺省 6），多了均分（7 → 4 + 3，13 → 5 + 4 + 4，小的在前）；一张最多 `rowsPerImage` 排（缺省 2，上限 3），再多出多张（13 个缺省就是两张）。`groups`（下标数组的数组，一组一排、组内仍从小到大，与 `perRow` 二选一）手动指定谁和谁一排。排序与分比例都按「大小」：人物是身高，道具是长边那个数。
- 比例：同一张图里各排一个每厘米像素，最高的顶到可用高度；相邻几张合起来最大 ÷ 最小不超过 `maxHeightRatio`（25）倍的**共用同一个比例与刻度**，跨张也能直接比。超过 25 倍的（2 cm 的戒指和 32 m 的龙）不放进同一张图，按比例拆开、各自一套刻度，回包 `notes` 说明拆开的原因与每组有谁（手动 `groups` 里某一组自己就超了，也按比例拆成几排并说明）。
- 标题默认「剧内比例总表」，`locale:"en"` 时是「Height lineup」（名字原样上图）。
- 画幅 16:9（2400 × 1350）。一张时同其它图片本地工具落在 NODE-ID 旁；几张时全部上传完才一起落下（排在 NODE-ID 右侧成网格），中途失败或取消一张都不落。`--title` 给了，几张时各自加「（i/n）」；缺省标题「剧内比例总表」「剧内比例总表（i/n）」。每张新节点有溯源边连回 NODE-ID 与这张图里画布上的每个资产。
- 每个资产**尽量用无投影的白底图**：量主体外框前会先切掉脚下的浅灰投影（阈值在 `localTools.scaleLineup.floorShadow`：最小通道 ≥ 180、最大 − 最小 ≤ 24、带高不超过外框的 8%），切了多少在回包那一行的 `shadowCutPx`（原图像素）。那条浅灰带还得**长得像落在地上的投影**才切 —— 比紧挨着它上面的脚明显更宽（左右外沿 ≥ 1.25 倍）**或者**扁（带高 ≤ 带宽的 1/5），占一条就算（跟脚差不多宽的窄投影也切）；只占一条的照切，但回包 `warnings` 里一条 `floor_shadow_kept` 提醒（那也可能是浅色的鞋底 / 鞋子）。浅灰的鞋、浅色长靴、拖地的浅色裙摆跟上面的腿差不多宽、不扁，是人的一部分，不切也不报。深色投影切不掉；像投影、但高过 8% 的不切，回包 `warnings` 里一条 `floor_shadow_kept`。`metadata.floorShadow` 可以只改其中几项（`{minLevel?, maxChroma?, maxBandRatio?}`），或给 `false` 不切。
- 回包 `outputs[i].meta`：`sheet` / `of`（第几张 / 共几张）、`width` / `height`、`pxPerCm`、`ruler`（`topCm`、`unit`）、`rows`（每排从小到大：`label`、`kind`、人物 / 生物的 `heightCm` 或道具的 `sizeCm` 与实际用的 `scaleAxis`、`rect` 画在哪、`source`（`sheet` / `panel` / `whole`；自传的 `figure` = 抠出来的人、`silhouette` = 剪影或方框，另带 `userSheet: true` 与剪影的 `reason`）、`shadowCutPx`（切了投影时））、`subjects`（有自传 item 或产品图退了剪影时：每个 `label`、`kind`、`nodeId` / `fileId`、`userSheet: true`（自传的才有）、`source`、`reason` —— 自传的与产品图取不出的放在一起，统一照实告诉用户、决定要不要重出）、`notes`（拆开时，每张都带同一份；基准设定图像是颠倒、脸部特写贴着第一个人、自传图画了剪影时也在这里）、`warnings`（同上）、`url`、`fileId`、`font`。

**标注文字**：`annotate-image` 的 `kind:"text"`（与场景 6c 的笔画同一个工具，可混在一个 `strokes` 里）：

<!-- prettier-ignore -->
```json
["run-tool", "IMAGE-NODE", "--kind", "annotate-image", "--approved", "--json", "{\"metadata\":{\"strokes\":[{\"kind\":\"text\",\"text\":\"A 白妍\",\"points\":[[0.12,0.3]],\"size\":0.04,\"color\":\"#FFFFFF\",\"background\":\"#000000AA\"}]}}"]
```

- `points` 恰好一个锚点（0..1）；`align` = `left`（锚点是文字框左上角，默认）/ `center`（上边中点）/ `right`（右上角），框会被推回图内（比图还宽 / 高的推回去也装不下，超出的部分被裁掉：照样出图，回包 `meta.warnings` 里一条 `text_overflow` 点名是第几条）；`size` = 字号占图片长边的比例（默认 0.03，上限 0.3）；`text` ≤200 字，`\n` 分行、≤10 行；`color` 默认 `#FF3B30`；`background` 省略就不画底色、描一圈反差色的边。中文用随画布发的 Noto Sans SC 子集，任何机器上画出来一样。

- ✅ 正确：美术出完白妍的基准设定图（左脸部特写、右带头三视图）→ 从资产清单取身高 168、各字段，标尺取男主顾言（183）的基准设定图 → `asset-sheet`（NODE-ID = 白妍的设定图，`scaleRefs` = 顾言）→ 这张参考图连到镜头节点的 reference 口，再从 `read` 的 `mentionCandidates` 逐字抄它的 `@{…}` 写进提示词（场景 4）。
- ✅ 正确：道具让美术一次出一张三格图（左正面、中背面、右按长边：≤ 30 cm 手部特写捧着、≤ 60 cm 不露脸的人手持、更长的不露脸普通人在旁，图里不用剧中角色）→ `asset-sheet`（NODE-ID = 这张三格图，`sizeCm` 从资产清单取）。场景同理：一张两格图（左场景、右户型）→ `asset-sheet`（`sceneSize`）。
- ✅ 正确：全剧人物定稿后 → 从资产清单取每个人的身高 → 一次 `scale-lineup`（人物 item 给各自的基准设定图，items 给全，几张由工具分）→ 回包 `notes` 说拆开了就照实告诉用户为什么是两张。镜头里有关键道具时一起排进去，道具给它的三格图与 `sizeCm`。
- ❌ 错误：把身高 / 尺寸写进 `fields.height` / `fields.size`——不收：比例格里画的高矮和字里写的数字只能有一个来源（`heightCm` / `sizeCm` / `sceneSize`）。
- ❌ 错误：还按 0.15.0 给道具另传背面图 / 手持图（`backRef` / `heldRef`）或给场景另传户型图（`panels.plan`）—— A57 起撤销了，`invalid_request`；一张三格图 / 两格图就是 NODE-ID。
- ❌ 错误：人物的 NODE-ID 给单张的全身图、设定图放 `panels.baselineSheet` —— 那是旧项目的兼容写法（比例格从 NODE-ID 取整张）；A57 起 NODE-ID 就是基准设定图本身。
- ❌ 错误：想给比例格配门、椅、A4 这类外部参照物 —— 没有了（A57），比高矮就给 `scaleRefs` 里的剧内人物；身高差得多也照画，看 `notes`。
- ❌ 错误：标尺人物不给 `heightCm` —— `invalid_request` 点名是哪个；资产清单没写就估一个（A38③），同样列进这个人物资产的「估」。
- ❌ 错误：道具右格里用剧中角色（主角也不行）——视频模型会把那个人当角色带进镜头；只用手、胸口以下，或背影 / 侧影的普通人。
- ❌ 错误：比例总表里给道具写 `heightCm`（横放的剑会被当成那么高）——道具给 `sizeCm`。
- ❌ 错误：回包有 `floor_shadow_kept` 还当比例是准的——要么脚下那条像投影的带太高没切（这个资产被量矮了），要么它只有一条像投影也切了（若其实是浅色鞋底，被量高了）；比例总表照 `message` 调 `floorShadow`（或给 `false`）或换无投影的图，比例格就换一张脚下不带投影的设定图。
- ❌ 错误：以为 `scale-lineup` 的 NODE-ID 会被排进去——它只是落点；要排的每一个（包括 NODE-ID 那张）都要写进 `items`。
- ❌ 错误：`items` 用带背景的剧照——裁不出主体，比例不对；人物用白底的基准设定图，道具用白底的三格图或主体图。
- ❌ 错误：正面视图取不出（`run_failed` 说连成一块 / 比例不像 / 左右颠倒 / 贴着分不开）还一遍遍重发——换一张重出（脸部特写与三视图之间、三个人之间留白底空隙）；颠倒的设定图别用 `flip-image` 翻过来：人会跟着镜像。

## 6f. 三维导演台：「搭个茶馆的场，两个人隔着柜台」「第二镜改成环绕」「出一张过肩的静帧给生成用」「这一场每一镜的开始、结束站位图都出来」

三维节点（`scene-3d`）里是一个场景：人物、布景道具、机位和镜头表。你不交整份场景，只交**动作**（apply 命令 `scene3d_apply`，16 种 op，0.17.0 起含调度 `add_act` / `update_act` / `remove_act`（场景 6g）；字段见参考小节「`scene3d_apply`」）；每一批带上 `sceneDigest` 当 `baseDigest`，场景在那之后被人改过就整批拒绝。单位：米，y 朝上，人偶脚点在 `position`、面朝 +z；角度一律写度（方位约定见下面「方位」一条）；`fov` 是垂直视场角（度），也可以直接写焦距 `focal`（毫米，二选一）。

- **digest 接力**：下一批的 `baseDigest` 直接接上一批回包里的 `sceneDigest`（`scene3dSummary` 里写着「sceneDigest=…（下一批 baseDigest）」，`undo` / `redo` 回包的 `scene3d[]` 也有；`undo` 那一项带 `fallback:true` 时场景退回了更早的一份，先 `read` 再改），不必先 `read`。`undo` / `redo` 改了场景时那一项还带 `sceneSummary`（与 `read` 的场景摘要逐字相同：计数与自检行），`undoneOps[].label` 逐个说撤回了哪几个动作、改字段的那几个给了哪些字段（「scene3d_apply ep01-茶馆：update_shot shot-2（fov、framing）；transform boss（position）」），撤完不用再 `read` 确认；`set_figure` 的 `applied[k].fields` 列出这一条改了哪些字段（只改给出的字段）。会话里还没有这个节点的 digest 时才去读：**只要 digest 就 `["read","NODE-ID/output"]`**（回 `sceneDigest`、`sceneSummary`、静帧与 `stale`，不带整份场景）。
- **三维节点别用 `snapshot` 读**：`snapshot` 的三维行只有计数和 digest，看场景用 `read`。

第一步 看已有的场景（会话里刚建过、手上有上一批回包的 digest 就跳过）：

```json
["read", "NODE-ID"]
```

回读 `scene`（角度是度）、`sceneDigest`（下一批的 `baseDigest`）、`sceneSummary`（1–3 行人话：digest 与对象 / 机位 / 镜头计数——有调度表再加动作条数与时间线总长、静帧是哪一镜、过期没有、自检结论和拦下的原话——有调度表再加动作提醒条数）、`checks`（三项自检）、`objectCount` / `cameraCount` / `shotCount`、`stale`（静帧是不是旧场景出的）。只要场景：`["read","NODE-ID/scene"]`；只要 digest：`["read","NODE-ID/output"]`。

第二步 搭场景（「搭个茶馆的场，两个人隔着柜台」）：建节点和第一批动作放在**同一批**，`baseDigest` 写 `"new"`。把下面整段存成 workspace 里的 `desk.json`：

```json
{
  "commands": [
    {
      "type": "add_node",
      "id": "s3d-4a101807d6",
      "kind": "scene-3d",
      "title": "ep01-茶馆",
      "position": { "x": 0, "y": 0 }
    },
    {
      "type": "scene3d_apply",
      "nodeId": "s3d-4a101807d6",
      "baseDigest": "new",
      "actions": [
        { "op": "set_scene", "aspectRatio": "16:9" },
        { "op": "remove", "id": "human-default" },
        {
          "op": "add_object",
          "id": "counter",
          "role": "set",
          "kind": "box",
          "prefab": "counter",
          "transform": {
            "position": { "x": 0, "y": 0.55, "z": 0.4 },
            "scale": { "x": 3.2, "y": 1.1, "z": 0.8 }
          }
        },
        {
          "op": "add_object",
          "id": "boss",
          "role": "figure",
          "kind": "human",
          "transform": { "position": { "x": -0.4, "y": 0, "z": -0.3 } }
        },
        {
          "op": "add_object",
          "id": "off",
          "role": "figure",
          "kind": "human",
          "transform": { "position": { "x": 0.4, "y": 0, "z": 1.2 } }
        },
        {
          "op": "set_figure",
          "id": "boss",
          "pose": "stand",
          "arms": "down",
          "facing": "off",
          "gaze": "off"
        },
        {
          "op": "set_figure",
          "id": "off",
          "pose": "stand",
          "arms": "hold",
          "facing": "boss",
          "gaze": "boss"
        },
        { "op": "set_axis", "ends": ["boss", "off"] },
        {
          "op": "add_shot",
          "id": "shot-1",
          "n": 1,
          "framing": "过肩中景",
          "dur": 2.75,
          "focal": 85,
          "cam": { "x": -2.3, "y": 1.7, "z": -2.3 },
          "look": "off",
          "lens": "越柜内那人的右肩，微俯看向柜外那人",
          "intent": "试探"
        },
        {
          "op": "add_shot",
          "id": "shot-2",
          "n": 2,
          "framing": "中景",
          "dur": 5,
          "focal": 50,
          "moveEase": "out",
          "orbit": {
            "center": { "x": -0.4, "y": 1.4, "z": -0.3 },
            "r": 2.4,
            "from": -110,
            "to": -20,
            "y": 1.5
          },
          "look": "boss"
        }
      ]
    }
  ]
}
```

```json
["apply", "--file", "desk.json"]
```

- 手写时节点 `id` 只要求画布内唯一（建议 `s3d-` 前缀 + 任意短后缀）；`s3d-` + 场景键 sha256 前 10 位是 s2v `canvas_plan` 的约定，页面不校验 id 形状。换一个场景就换 `id` 和 `title`。`add_node` 必带 `position`。
- 这一批里的 `remove`（删默认人偶）**不算破坏性**：`baseDigest:"new"` 的建场批删的是刚建出来的东西，不用先问用户。
- 这一批：删掉新节点自带的默认人偶 `human-default`；放一个柜台（`prefab:"counter"`，台面前后 z 0 – 0.8）和两个人物，`boss` 在柜台里侧（z −0.3）、`off` 在外侧（z 1.2），互相朝向、对视；声明轴线 `boss` — `off`；第 1 镜是越过 `boss` 右肩的静止镜（机位在他身后偏右、略高于眼平，`focal:85`，16:9 上存 13.6°），第 2 镜是绕 `boss` 的环绕，从他背后转到右前方（`focal:50` ≈ 22.9°，`orbit` 的 `from` / `to` 是度，`y` 是机位的绝对高度）：机位在 x = 圆心.x + r·sinθ、z = 圆心.z + r·cosθ，`from:-110` 落在 x ≈ −2.66、z ≈ −1.12（`boss` 身后偏他的右手边 —— 他面朝 `off`，大致朝 +z，右手在 −x 一侧），`to:-20` 落在 x ≈ −1.22、z ≈ 1.96（他的右前方）。

回包（节选，数都是页面真算出来的；另有 `written`、`rev`、`undoDepth`，同其它 apply）：

```json
{
  "ok": true,
  "created": [{ "command": 0, "id": "s3d-4a101807d6", "kind": "scene-3d" }],
  "scene3d": [
    {
      "command": 1,
      "nodeId": "s3d-4a101807d6",
      "sceneDigest": "d840df3374f57afb",
      "applied": [
        { "op": "set_scene" },
        { "op": "remove", "id": "human-default" },
        { "op": "add_object", "id": "counter" },
        { "op": "add_object", "id": "boss" },
        { "op": "add_object", "id": "off" },
        { "op": "set_figure", "id": "boss", "fields": ["pose", "arms", "facing", "gaze"] },
        { "op": "set_figure", "id": "off", "fields": ["pose", "arms", "facing", "gaze"] },
        { "op": "set_axis" },
        { "op": "add_shot", "id": "shot-1" },
        { "op": "add_shot", "id": "shot-2" }
      ],
      "checks": {
        "health": [],
        "axis": {
          "applicable": true,
          "ok": true,
          "offside": [],
          "message": "2 镜的机位都在轴线同一侧，没有越轴"
        },
        "cuts": [
          {
            "fromId": "shot-1",
            "toId": "shot-2",
            "from": 1,
            "to": 2,
            "angle": 15.1,
            "jump": false,
            "exempt": "moving",
            "message": "低于 30°，但运动镜打破了跳切感"
          }
        ],
        "framing": []
      },
      "framing": [
        {
          "shotId": "shot-1",
          "n": 1,
          "k": 0,
          "t": 0,
          "subject": "off",
          "size": "中景",
          "coarse": "中景",
          "cut": 0.623,
          "cutAt": "胸～腰",
          "view": "正面",
          "elevationDeg": 1,
          "distance": 4.422
        },
        {
          "shotId": "shot-2",
          "n": 2,
          "k": 0,
          "t": 0,
          "subject": "boss",
          "size": "中景",
          "coarse": "中景",
          "cut": 0.65,
          "cutAt": "胸～腰",
          "view": "3/4 背侧",
          "elevationDeg": -2,
          "distance": 2.402
        },
        {
          "shotId": "shot-2",
          "n": 2,
          "k": 0.992,
          "t": 4.958,
          "subject": "boss",
          "size": "中景",
          "coarse": "中景",
          "cut": 0.649,
          "cutAt": "胸～腰",
          "view": "3/4 正侧",
          "elevationDeg": -2,
          "distance": 2.402
        }
      ]
    }
  ],
  "scene3dSummary": "s3d-4a101807d6：应用 10 个动作 → sceneDigest=d840df3374f57afb（下一批 baseDigest）；0 处拦下，0 处提醒\n取景 镜1：off 中景（切在胸～腰），正面，俯 1°，距 4.42 m\n取景 镜2：boss 中景（切在胸～腰），3/4 背侧，仰 2°，距 2.4 m；末帧 boss 中景，3/4 正侧，距 2.4 m"
}
```

把 `scene3dSummary` 用人话告诉用户；下一批的 `baseDigest` 就是 `scene3d[0].sceneDigest`。本批加了或改了镜头时，摘要下面每镜跟一行「取景 镜n：主体 景别（切在…；全身在画内时写身体部位），朝向，俯 / 仰，距离」（运动镜末帧的主体、景别、朝向或距离变了时加「；末帧 …」，环绕镜常见的是只换朝向），有取景提醒再跟「镜n ⚠ <原话>」；细节在 `scene3d[0].framing[]`（每镜首帧一行，运动镜另有末帧一行；上面从略了 `cam` / `look` / `fov` / `hfov` / `eyeAt`）。表头「取景 N 条提醒」只数本批动过的镜头；别的镜头还带着取景提醒时，下面另有一行「取景：上面只算了本批动过的 n 镜；其余 m 镜里 镜k 另有 j 条取景提醒，read NODE/checks 看」（其余镜头超过 12 镜时不替它们重算，只写「其余 m 镜没重算，read NODE/checks 看」）—— 没有这一行就是别的镜头没有取景提醒。`applied[k].id` 是每个动作实际落到的 id（撞了已有的 id 会改名成 `-2`，这时还带 `requestedId`，`scene3dSummary` 里写「改名 a→b」）。

- `add_object` 的 `kind` 可省：认识的 `prefab`（含别名）推出它的 kind，`role:"figure"` 推出 `human`；显式写了以你写的为准。推出来的回在 `applied[k].kind`，`scene3dSummary` 里写「chair 按 prefab 画（kind=box）」—— 画的是这件家具本身（椅子有座面、靠背、腿），kind 只是它的足迹类型，不是只画一个方块。
- 没写 `color` 的人物 / 道具：页面按名字给身份色（站位图与下游提示词「粉色人偶 = 某某」靠它认人），这个色已被同一场里另一个人物（道具对道具）占着就换调色板里第一个没用过的，存进 `color`。老场景里两个不同的人同色时自检报一条 `warn` 档的 `identity_color_clash`，message 末尾就是换色的动作（`{"op":"transform","id":"guest","color":"#36b89a"}`），照抄进下一批即可。只报至少有一个起了名字的对象用着的颜色（下游提示词的身份映射只列起了名字的对象）；几个都没起名字的道具同色不报。
- **按集身份色**（0.18.0，产品显式写 `color`）：一集里同一个人物、道具在每一场、每一张站位图、预演里都要同一个颜色，提示词才能写「站位参考图中：红色人偶为某某、白色方块为某物」。用 `@scenemint/canvas-cli/contract` 的 `allocateEpisodeIdentityColors([{id, role, main?, extra?, scenes?}…], previous?)` 给整集分色、`add_object` 里显式写 `color`：人物用 12 个可念的色（契约 `scene3d.identity.namedColors` / `namedLabels`：红、蓝、黄、绿、紫、橙、粉、青、棕、黄绿、墨绿、卡其；`main` 的主要人物先分、整集固定），出场人物超过 12 个时一次性群演（`extra`）共用「灰色群演」（`extrasColor`，色名「灰色」），道具统一白 / 浅灰方块（`propColors`，同一场里的道具尽量不同色）；`previous`（写在索引里的上一次结果）照旧，补场不换色。`checkEpisodeIdentityColors([{scene, objects}…])` 查同一个 id 跨场换了色（`color_drift`）、同一场两个人用着同一个可念色（`color_shared`）。色名一律从 `scene3dColorLabel(color)` 取。页面照存不改；没写 `color` 的对象仍按名字的八色算法上色。
- `position` / `rotation` / `scale` 可以只给几个分量（`{"rotation":{"y":60}}`），没给的分量不动；`add_object` 不给 `position.y` 就落地。镜头点（`cam`、`to`、`orbit.center`、`set_camera` 的 `position` / `target`）仍要 x / y / z 三个分量。
- 人物带着 `facing`（朝向某人 / 某点）时，`transform` 给的 `rotation.y` 和现在的不同（按 4 位小数比）就让 `rotation.y` 说了算：`facing` 被清掉，回包 `applied[k].cleared:["facing"]`，`scene3dSummary` 写「清掉 off.facing（rotation.y 覆盖）」。导演台里手转人物也是这一条。
- **方位**（俯视，y 朝上）：`rotation.y = θ` 把对象的正面从 +z 转到 (sinθ, 0, cosθ) —— 0° 朝 +z、90° 朝 +x、−90° 朝 −x、180° 朝 −z；`orbit` 用同一个约定：机位在 x = 圆心.x + r·sinθ、z = 圆心.z + r·cosθ，0° 在圆心的 +z 一侧、90° 在 +x、−90° 在 −x、180° 在 −z。人偶面朝 +z 时右手在 −x 一侧。家具不转（`rotation.y` 0）时：`chair` / `sofa` 靠背在 −z，`chair` / `sofa` / `bench` 坐上去面朝 +z（转成 `rotation.y:90` 就面朝 +x；6g 的 `chair` 没转，`boss` 坐下后面朝 +z）；`bed` 床头在 −z；`stairs` 往 +z 升高；`door` / `window` 的框立在 x–y 平面里，人沿 z 方向穿过；其余 prefab 画成块 / 柱，不分正反。要家具面朝某一点：`rotation.y` = atan2(点.x − 家具.x, 点.z − 家具.z) 换成度。
- `set_figure` 是补丁：只改这一条给出的字段（只写 `{"op":"set_figure","id":"boss","pose":"sit"}` 时 `arms` / `facing` / `gaze` 原样留着），给 `null` 的清掉；回包 `applied[k].fields` 列出这一条给了哪些字段（`transform` 也带，列出给了哪几组：`position` / `rotation` / `scale` / `color`）。
- `set_focus` 只打标（标出焦点物件），不改画法、不换几何。

**锚点与 scale**（`position` 指的是物体的哪一点；`scale` 是**倍数**，乘在 prefab 尺寸或 1 m 上）：

| kind               | `position` 是                   | 不起作用的 scale                 |
| ------------------ | ------------------------------- | -------------------------------- |
| `human`            | 脚点（两脚之间的地面点）        | 用 `bodyType`，别拿 scale 改身高 |
| `box` / `cylinder` | 几何中心（落地时 y = 高的一半） | —                                |
| `plane`            | 中心                            | `scale.y`（平面没有厚度）        |
| `backdrop`         | 底边中点                        | `scale.z`                        |

**登记到 `/三维/<场景>`**：建场那一批里顺手把节点写进文档索引，之后 `ls /三维/ --long` 能列出它（行上带 `sceneDigest` / `shotCount`）。索引写法见「The document index」一节：先 `["read","/文档/index/content"]` 拿 `contentSha`，同一批里

<!-- prettier-ignore -->
```json
{"type": "update_node", "nodeId": "doc-index", "draft": {"content": "#canvas-index v1\npath\tnodeId\n/三维/ep01-茶馆\ts3d-4a101807d6\n…原有的行原样保留…"}, "expect": {"contentSha": "SHA-FROM-READ"}}
```

（分隔符是真的 TAB；整张表连原有的行一起写回。s2v 的 `canvas_plan` 自己登记，不走这一条。）

第三步 改一镜：`baseDigest` 接上一批回包的 `sceneDigest`（会话里没有才 `["read","NODE-ID/output"]`）。上面的第二镜已经是环绕镜，用户说「第二镜的环绕再转远一点」，就给 `update_shot` 一个新的 `orbit`（`orbit` 整个替换，没变的项也要写上）：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "scene3d_apply", "nodeId": "NODE-ID", "baseDigest": "SCENE-DIGEST-FROM-READ", "actions": [{"op": "update_shot", "id": "shot-2", "orbit": {"center": {"x": -0.4, "y": 1.4, "z": -0.3}, "r": 2.4, "from": -110, "to": -10, "y": 1.5}}]}]}
```

环绕从 `from` 转到 `to`（度），圆心、半径是米。回包的 `sceneDigest` 变成 `785714eeed83d77d`，`applied` 是 `[{"op": "update_shot", "id": "shot-2"}]`，`scene3dSummary` 是「s3d-4a101807d6：应用 1 个动作 → sceneDigest=785714eeed83d77d（下一批 baseDigest）；0 处拦下，0 处提醒」，下面一行「取景 镜2：boss 中景（切在胸～腰），3/4 背侧，仰 2°，距 2.4 m；末帧 boss 中景，3/4 正侧，距 2.4 m」（这一批只动了第二镜，取景只重算它）。越轴、接缝 < 30° 不在 apply 摘要里说（0.18.0，A87 ③）：结构化的 `scene3d[0].checks.axis` / `checks.cuts` 照旧在回包里，出预演（6h）时回包 `notes[]` 提醒。

- 「第二镜改成环绕」而第二镜原来是 `cam` 静止镜：同一个 `update_shot` 里给 `orbit`，再给 `cam: null` 删掉原来的静止机位（可选字段给 `null` 就是删）。
- 环绕镜改回静止镜：给 `cam` 的同时给 `orbit: null`。一镜同时有 `cam` 和 `orbit` 时按环绕算，`cam` 不起作用 —— 只给 `cam` 的那一批回 `ok:true`，镜头其实没变；自检会报一条 `warn` 档的 `orbit_cam_ignored`。反过来，静止镜改环绕：给 `orbit` 的同时给 `cam: null`（有 `to` 也一并 `to: null`），否则同样报这一条，message 末尾写着这句改法。

**回 `scene3d_conflict`**：你拿到 digest 之后，人或别的 Agent 改了这个场景。回包带着：`error.currentDigest`（现在的 digest）、`error.sceneSummary`（现状人话：计数、静帧、自检）、`error.sceneWriter`（谁改的：`actor` 是 `agent` / `human` / `remote` / `page`，`at`，Agent 带 `agentId`——别的标签页里的 Agent 也认得出，前提是那一页在协作状态里发布了它写下的 digest；认不出（那页的人改的、或那页还是旧版）记 `remote`）、`error.checks`，以及整份 `error.scene`（宿主不一定贴出来）。摘要看不出**改了什么**，所以先 `["read","NODE-ID/scene"]`（`error.next[0]`），对照你的计划找出别人改动的地方，再在它的基础上**重新规划**，用 `currentDigest` 作 `baseDigest` 发一批**改过的**新动作（`error.next[1]`）。不要原样重发，也不要只把新值填进旧的那批 —— 那会把人刚改的东西改回去。

**静帧还是站位图**：这几条出图命令出的东西不一样，按用户要的东西选，别按卡片名 —— `run --frame end` 的卡和 `run-stills` 的图都带「结束站位」字样。

| 用户要                                                  | 发                                                                  | 出什么                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 「静帧」「每镜出一张图」「出一张过肩的给生成用」        | `run`（第四步；全部镜头 `--shots all`，镜尾那一刻加 `--frame end`） | 每镜**一张** `s3i-` 静帧卡，回包 `outputs[]`；连 gen 当参考图                |
| 「站位图」「开始 / 结束站位图」「给视频节点配站位参考」 | `run-stills`（第四步之二）                                          | 每镜**两张**独立图片节点（开始、结束），回包 `stills[]`；连那一镜的视频节点  |
| 「每镜三样参考」「站位图和预演一起出」                  | `run-shot-refs`（第四步之三）                                       | 每镜两张站位图节点 + 一张预演卡，回包 `shots[]` 每镜一行；连那一镜的视频节点 |

第四步 出静帧（「出一张过肩的静帧给生成用」）：

```json
["run", "NODE-ID", "--shot", "shot-1", "--approved"]
```

- 静帧在浏览器里渲染、不是生成扣费项、**不用问价**（契约 `tiers.run.localKinds` 含 `scene-3d`），但 `run` 仍要 `--approved`，只有主会话能发。宿主从 argv 看不出节点 kind：先看索引 / 最近一次 `read`，都没有就发一次 `["read","NODE-ID"]`，`nodes[0].kind` 是 `scene-3d` 才免问；`run-batch` 全是三维节点不问，混批只问非三维的那些。
- 渲完回 `{ok:true, local:true, submitted:true, turnId, shotId, outputs:[{nodeId, outputId, shotId, n, title, mediaType:"image", output:"still", url, result}], renderedDigest, pending:[], failed:[], timings}`：每镜一张**静帧卡**（`nodeId` 是 `s3i-…` 卡片，落在三维节点正下方、按镜号左→右，`title` 是「<场景标题> · 镜n · 静帧」，下游 `@{}` 标签就用它），`url` 是静帧，`renderedDigest` 是出片时的场景 digest。几镜一起出：`["run","NODE-ID","--json","{\"allShots\":true}","--approved"]`（或 `{"shotIds":["shot-1","shot-3"]}`）；没变的镜头回 `result:"reused"`，不重渲。
- **每镜一张卡**：同一镜再出落在同一张卡上——追加一张候选并切成主图（`result:"rerendered"`，卡片 id 不变，旧候选不删，满 5 张时 `notes[]` 提示清理）；不同镜各是各的卡。给 gen 当参考连的是**静帧卡**，不是三维节点（三维节点的输出口不随出片更新）。所以「先把三镜都出完、再建三个 gen 各连各的卡、一起 `run-batch`」是对的。
- 30 s 内没渲完的镜进 `pending[]`，`notes[]` 写「镜 n 仍在渲（预计 ≤ N s），等一会儿 read NODE-ID/renders 取，不要重发 run」—— 照做：`["read","NODE-ID/renders"]` 每张卡一行，`state` 是 `rendering` / `landed` / `failed`。三维的 `run`（带 `--shot` / `--shots` / `--render` / `--frame`）送到页面却没拿到答复（标签页关掉、被丢弃、刷新、超时）时，CLI 回可重试的 `render_interrupted`（不是 `unknown_outcome`）：请用户回到画布后照 `error.next[0]` 原样重发，已落地的镜头复用；不带这些参数的裸 `run` 认不出是三维，仍是 `unknown_outcome`，先 `read NODE-ID/renders` 看再定。取的是这一镜开头那一刻的机位；不带选镜字段取镜头表里排第一的那一镜（`reorder_shots` 之后的顺序，不一定是 `n` 为 1 的那镜），场景还没有镜头时用当前机位（`shotId:null`，卡片标题没有「镜n」）。镜头 id 不存在 → `invalid_request`（`path:"shotId"` / `"shotIds"`，消息列出现有的镜头）。
- 某一镜有「拦下」档的数据问题（比如 `look` 指向不存在的对象）时这一镜不出片：它进 `failed[]`（`run_failed`，消息以「数据健康拦下」开头、带 `checks`），别的镜照出；先按 `checks.health` 补数据再 `run` 那一镜。全部镜头都失败时整条回 `ok:false`，`error` 是第一个失败，`outputs` / `pending` / `failed` 照样带齐。
- 镜级失败看 `failed[].error.code`：`render_interrupted`（可重试：每张静帧从拿到渲染槽起 20 s 渲、渲完 20 s 传，超时、WebGL 上下文丢失、网络错误都算）照 `error.next[0]` 原样重发（不是生成扣费项，没变的镜会复用）；`run_failed` 看 `error.message`：「unhandled node kind」= 画布页面比 CLI 旧、还不会出静帧，请用户刷新画布页面，不要重试；其它（没有可用的 WebGL、人偶模型有问题……）原样告诉用户。几镜都卡在 `dur` 上时只有第一条失败带 `apply`（一条改齐几镜），其余写「同上」；照第一条发一次。
- 要这一镜镜尾那一刻的静帧（卡片叫「结束站位」；走位、运镜都到位的那一刻：机位在 `to` / 环绕的 `to` 角、视场角在 `fovTo`，人物走到走位终点、朝向按终点算）：静帧加 `"--frame", "end"`，即 `["run", "NODE-ID", "--shot", "shot-2", "--frame", "end", "--approved"]`。缺省 `start`。它落在同一镜的**另一张静帧卡**上（仍是 `s3i-` 卡、回包 `outputs[]`，不是 `run-stills` 的图片节点；`title` 是「<场景标题> · 镜n · 结束站位」，卡片 `scene3d.frame:"end"`，`read NODE-ID/renders` 里那一行带 `frame:"end"`），镜头开头那张卡不动；没有走位也没有运镜的镜两张同画面，照样出。`--frame` 不是 `start` / `end` → `invalid_request`（`frame must be start or end`）；配 `--render video` / `sheet` → `invalid_request`（`path:"frame"`）。
- 出完 `["read","NODE-ID/renders"]`：每张卡一行（`stale:true` = 卡是旧场景出的）。之后再改场景，`apply` 回包的 `scene3dSummary` 有「产物过期」行，行尾就是更新它的 `run` argv。开始 / 结束两张在画布上叫「开始站位 / 结束站位」（0.16.4 起，原「开始帧 / 结束帧」）：它们只是站位参考，不是视频的首帧、尾帧，跟用户说时也用这两个词。

第四步之二 出这一场的全部站位图（「这一场每一镜的开始、结束站位图都出来」「给视频节点配站位参考」）：一条命令，每一镜出**开始**（镜头开头那一刻）与**结束**（走位、运镜都到位那一刻）两张，**每张落成一个独立的图片节点**，能单独连到各自的视频节点、被 `@{}` 引用：

```json
["run-stills", "NODE-ID", "--approved"]
```

回包（`run-stills`，接在上面第三步之后出；`nodeId` 是页面起的 id，`url` 这里是示例地址，其余都是真代码算的）：

```json
{
  "ok": true,
  "nodeId": "s3d-4a101807d6",
  "sceneDigest": "785714eeed83d77d",
  "stills": [
    {
      "shotId": "shot-1",
      "frame": "start",
      "nodeId": "media-5c1d3f0e-8a4b-4c62-9d1e-2f7a6b3c9e41",
      "url": "https://cdn.example/stills/scene3d-s3d-4a101807d6-shot-1-start.png",
      "created": true,
      "sceneDigest": "785714eeed83d77d"
    },
    {
      "shotId": "shot-1",
      "frame": "end",
      "nodeId": "media-b7e2a9c4-1f3d-4e8a-a6b5-0c9d8e7f6a52",
      "url": "https://cdn.example/stills/scene3d-s3d-4a101807d6-shot-1-end.png",
      "created": true,
      "sceneDigest": "785714eeed83d77d"
    },
    {
      "shotId": "shot-2",
      "frame": "start",
      "nodeId": "media-3e9f1a2b-7c6d-4b5e-8f4a-1d2c3b4a5e63",
      "url": "https://cdn.example/stills/scene3d-s3d-4a101807d6-shot-2-start.png",
      "created": true,
      "sceneDigest": "785714eeed83d77d"
    },
    {
      "shotId": "shot-2",
      "frame": "end",
      "nodeId": "media-d4c3b2a1-9e8f-4a7b-b6c5-2e1f0a9b8c74",
      "url": "https://cdn.example/stills/scene3d-s3d-4a101807d6-shot-2-end.png",
      "created": true,
      "sceneDigest": "785714eeed83d77d"
    }
  ],
  "failed": [],
  "skipped": [],
  "orphans": [],
  "stillsSummary": "s3d-4a101807d6：出了 4 张站位图（新建 4 张，原地刷新 0 张）"
}
```

- 同 `run`：浏览器里渲染、不是生成扣费项，但要 `--approved`，只有主会话能发。缺省全部镜头 × 两帧，按镜头表顺序、每镜先开始后结束；只要几镜用 `"--shots", "shot-1,shot-3"`（`all` = 全部），只要一种帧用 `"--frames", "end"`（`start` / `end` / `both`，缺省 `both`）。
- **剧本转视频的产品场景**：`kind` 是 `scene-3d`、id 合契约 `CANVAS_CONTRACT.scene3d.embedded`（`idPattern` `^s3d-ep[0-9]{2,4}-p[0-9]{2,4}$`，`idFlags` `i`，即 `s3d-epXX-PYY`）的三维节点是这一场的建模数据（只看 id 与 kind，不看标题、标签）；你照常 `ls` / `read` / `snapshot` 得到它。**0.18.1 起它的卡片照常画在人的画布上、照常占位置**（进框选、小地图、大纲；0.16.3–0.18.0 不画），到它出的每张站位图 / 预演卡各有一条**不存储的归属虚线**（按卡上的 `stillOf` / `previzOf` 推出：不是连线、不在 `edges` 里、不进 `mentionCandidates`，你不用也不能 `connect` / 删它），那些卡角上写「出自 <三维卡标题> · S01 开始」（结束 / 预演）。**三维卡的摆位**（约定）：放在这一场第一镜三联的左侧同一行（右缘离开始站位图 48 px、顶边对齐），或正上方（左缘对齐、底边离三联 48 px）；像素按卡的外框算（数据尺寸 + 2 px 边框），48 px 是外框之间的空白、正好 48 不算挡；三联左缘常落在半像素（视频中线 − 三联宽 / 2），画布把缝四舍五入到整像素再判（47.5 按 48 算），照它四舍五入或向下取整都不挡；页面量到的视频宽偶尔少 1–2 px，放左侧时缝留 49–50 px 更稳。落三联时它算占位，放在约定位置不挡三联，放在别处挡到了，三联照下面的规矩往上找空地 / 叠放并点名被它挡住。每镜展示三样参考：两张站位图（标题 `epXX-PYY-SZZ开始站位` / `epXX-PYY-SZZ结束站位`）与一张运镜预演卡（`epXX-PYY-SZZ运镜预演`），从左到右开始 / 结束 / 预演三联居中放在对应视频正上方（摆法见下）。**站位图是俯视图**（0.18.0 起，契约 `CANVAS_CONTRACT.scene3d.overview`；0.18.1 按镜拉近、固定 16:9）：不按镜头机位。**方向整场一个**——场景正面（默认机位从看点往机位的水平方向，默认机位就是 +z）往右偏 30°、俯 45°；**取景按镜**——只框这一镜出场的人物与道具（这一镜开始 / 结束两刻、加子镜头各自的开始 / 结束；「出场」= 在这一镜自己的镜头机位里露进画框的，加 look / lookTo / follow 点名的；家具、布景照画、不算进取景）加边距，**先保证这一镜的人全员完整入画**（脚、手里拿的东西都在，每人离画框四边至少画面高的 5%，`overview.figureMarginRatio`），再在这个前提下沿同一方向尽量推近、必要时上下左右居中，目标是最高的人偶占画面高 1/3（`minFigureFraction`，目标不是硬下限）；人站得太散够不着 1/3 时以全员入画为准，`run-stills` / `run-shot-refs` 的回包 `notes[]` 提一句「镜 n：本镜人物分布宽，人偶约占画面高 X%」——照原文告诉用户即可，不用为它改站位；**室内场被墙挡住时**（0.18.2，契约 `overview.direction`；挡的是墙、门、窗、柱与高过 1.2 m 的布景，电视 / 显示器 `screen` 不算）先换方向（默认起每 45° 一档、离默认最近的、门窗或敞开那一侧先）、都挡就把机位移进室内并把俯角抬到最多 60°、仍不行才在站位图里剖掉挡在机位前的墙（`overview.cutaway`，镜头静帧与预演不剖），整场同一个方向，回包 `notes[]` 里一句「本场俯视方向：…」（按这个前缀认，不一定是第一条）说换成了什么、为什么——照原文告诉用户，不用为它改场景；同一镜开始与结束是同一个机位，可以直接比位置；每镜两张按开始 / 结束那一刻摆人物；画地面网格、**不画名字标签**（人偶与方块只用各自的身份色，谁是谁写在视频提示词的颜色对照里）。**站位图与产品场景的预演固定 16:9**（1920×1080，`overview.aspectRatio` / `stillSize` / `previzSize`），不跟场景画幅（竖屏项目也是横图）。它只表达位置与远近，不是首帧 / 尾帧、不决定构图。视频列距要放得下三联：三联宽约 1599 px（16:9 卡外框 501×283、卡间距 48），视频中心之间 ≥ 1647 px 三联才都落在原位；人从站位图工具条「3D导演台」打开这一场、停在这一镜这一帧（预演卡的工具条也有，停在这一镜开头），渲染会更新这一镜的站位图。这一场还没有镜头、或有镜头缺站位图（没出、被删、图被清空）时，大纲顶部「缺站位图的导演台」列出它的入口。它的产物是每镜三样参考：两张站位图（`run-stills`）与一段预演（0.18.0 起 `["run","NODE-ID","--shots","all","--render","video","--await","180","--approved"]`；三样一条命令出齐用 `run-shot-refs`，见第四步之三）。产品场景的预演每镜一张 `s3v-` 卡，标题 `epXX-PYY-SZZ运镜预演`（与站位图同一个分镜号，下游 `@{epXX-PYY-SZZ运镜预演}` 引用它），与那一镜的两张站位图**三联居中放在视频正上方**（从左到右：开始站位 / 结束站位 / 运镜预演，先出哪样都排进同一个三联）；`read` 卡片带 `previzOf`（`{sceneNodeId, shotId, sceneDigest}`，与 `stillOf` 同形、没有 frame；卡上显示的不是落地的那一条时不带 `sceneDigest`，人换过视频的带 `replaced:true`），`read NODE-ID/renders` 的预演行也带它；产品场景的预演按 `sceneDigest` + 画法版本判新旧（与站位图同一口径：场景里与这一镜无关的东西改了也算过期，重出时原地刷新同一张卡）。预演时长 = 本镜 `dur`；短于 2 s 的镜照本镜时长出，回包 `notes[]` 提醒「挂参考时由产品延长到下限」，画布不改它。视频列宽不够并排放三张（三联宽约 1599 px）时三联往上找空地、最多挪两行，再放不下就叠放在视频正上方 —— 两种回包 `notes[]`（`run-stills` 另接在 `stillsSummary` 末尾）都点名是哪一镜、被谁挡住。另两种也提醒（0.18.0）：找不到这一镜的视频节点（gen 视频节点 id 是 `v-<分镜号>`、标题以分镜号开头、或已连着这一镜的站位图 / 预演卡，三种都对不上）时三联退回三维卡右边的网格，回包合成一句「镜 a、b 找不到对应的视频节点……」—— 先建视频节点再出；这一镜已有的站位图 / 预演卡不在三联该在的位置（0.17.0 落的两张居中摆法升级后原地刷新、不挪位，或人挪过）时新落的那张跟着它排、不替人挪，回包点明没居中、偏了多少、压到了谁 —— 要居中就在画布上整组挪到视频正上方。0.18.1 起还有一种：这一场的三维卡、或它的站位图 / 预演卡压着别的节点（老画布里三维卡从不画变成画出来、9:16 场景的竖卡原地刷新成横卡都会这样），`run-stills` / `run-shot-refs` 的回包 `notes[]` 点名谁压到了谁，请产品跑一次画布重排（剧本转视频的 `canvas_rebase`）、把三维卡放回约定位置 —— 画布不替人挪，你也别为它挪别的节点。导演台对这一场点「出预演」落的是同一张卡、同一个命名与摆位。`run` 不带 `--render video`（静帧 / 联系表）打在它上面照旧 `invalid_request`（`error.path` `nodeId`：那两种卡会单独露在人的画布上），`run-batch` 把它记成 `not_runnable` 跳过。
- 别的三维节点（人或你自建的，不合上面那条）：站位图按镜头机位、按场景画幅出，按下一条摆放。
- 每张一个 media-upload 节点。产品场景的标题与摆放见上上条；别的三维节点：标题 `<三维节点标题>·镜<n>·开始站位` / `…·结束站位`，摆在三维节点右边、一镜一行（开始一列、结束一列；格子被别的节点占了往下找空行，不叠放；上下相邻的两场，第二场排在自己右边的空地）；`read` 它带 `stillOf`（出自哪个三维节点的哪一镜哪一帧、`sceneDigest`；换过图的没有 `sceneDigest`、带 `replaced:true`，见下）。**认它靠 `stillOf` 和回包的 `nodeId`，不靠标题**。三维节点自己一个字段都不写（0.17.0 起：它的 `outputUrl` / `renderedShotId` / `renderedFrame` 是老页面留下的，不看它们）；三维节点还没有镜头卡时，卡片缩略图显示第一镜的开始站位图（产品场景的三维卡也是这样，它不出镜头卡）。
- **重发不重复建**：同一个三维节点的同一镜同一帧再出，原地刷新那个节点的图 —— id、标题、位置、标签、连线都不变（回包 `created:false`）。改了场景要新图，就把同一条命令再发一次。
- 人（或你用 `duplicate_node` / `duplicate_nodes`）复制出来的站位图是一张**普通图片**：复制件不带 `stillOf`，重出不会去刷它；原件删了再出是新建一个，也不会认领复制件。同一镜同一帧撞出不止一个站位图节点（老数据、两个页面同时出）时，只认 id 排在最前的那个（场景改了就刷新它，已是最新就不动它），`stillsSummary` 按张点名认的是哪一个（连视频节点就用它）；回包 `duplicates` 列出其余的节点 id —— 它们是多余的、原样没动，报给用户、提醒用户删，你不要自己删。
- 一次最多 120 张（60 镜 × 两帧），页面 90 s 内答复。**续跑**：已经有站位图节点、而且出自当前场景（按当前画法画的 —— 页面升级了人偶画法，旧站位图照常重出）的那一张不再出，进 `skipped`（`reason:"up_to_date"`，带那个节点的 `nodeId`，照样拿它去连视频节点）；场景改过的照常重出、原地刷新。没做完的也进 `skipped`：`budget` 总预算用完、`page_away` 页面离开 —— 这两种回包另带 `remaining:[{shotId, frame}…]`，**把同一条命令原样再发一次**，已出的按 `up_to_date` 跳过、只补 `remaining` 里那几张，发到回包不再带 `remaining` 为止（一场几十镜常要发两三次）；`cancelled` 是被取消或三维节点被删了，不要重发。渲染或上传失败的进 `failed`（消息同 `run`），别的照出、已出的不回滚；这一镜有「拦下」档的数据问题时两张都进 `failed`（「数据健康拦下」开头），回包带 `checks`。一张都没出成、又有没做完的才回 `ok:false`（`run_failed`），`failed` / `skipped` 照样逐张列出；全部 `up_to_date` 是 `ok:true`（什么都不用做）。回包先念 `stillsSummary`。
- 用户要你重出这一批（哪怕场景没改，比如人偶模型换了）：加 `"--force"`，已是最新的也全部重出（原地刷新），换过图的也一起盖掉、标记清掉（见下一条）；不是用户要的就别加。❌ 续跑时加 `--force` —— 每次都从头出，永远出不完。
- **站位图被人或你换过图**（人在节点上「替换文件」—— 拖一个文件到卡片上、或从空卡片选文件；你 `upload --into`；`update_node` 写 `outputUrl`；在历史里选了另一张）：节点照旧是这一镜这一帧的承接节点，id、标题、位置、连线、`@{}` 引用都不变，`read` / `ls --long` 带 `stillOf.replaced`（没有 `sceneDigest`），卡片角上标「已换图」。之后 `run-stills` 缺省跳过它：进 `skipped`（`reason:"replaced"`，带 `nodeId`，照样拿它去连视频节点），`stillsSummary` 逐张点名哪一镜哪一帧；场景改了也**不**动它，也不算没做完（不进 `remaining`，全是 `replaced` / `up_to_date` 照样 `ok:true`）。用户要你重出这几张（盖掉换上去的图）才加 `"--force"`：换过图的也原地重出、标记清掉，已是最新的也一起重出；只盖计划时就已换过图的，出图途中才被人换掉的照样不盖（以最后一次动作为准）。清空媒体不算换图：清空的站位图下次 `run-stills` 会补回来；换过图的被清空也一样 —— 清空即去掉 `replaced`（`stillOf` 只剩 `sceneNodeId` / `shotId` / `frame`），照常补回同一个节点。`update_node` 写 `outputUrl: null` 同样算清空。
- **页面在出图时离开**（用户刷新、关标签、离开画布、浏览器被关或崩了）：在渲的那张停下，已出的留在画布上、不回滚。页面会先把部分回包送回来（已出的逐张列出，没出的 `skipped` 记 `page_away`、列在 `remaining`），再告诉守护进程页面走了；来不及送（页面先没了、浏览器进程没了、网络断了）你收到的就是 `unknown_outcome`。两种都先发 `["status"]` 再定：
  - 刷新、或在同一个标签页里回到画布：页面自动续上原会话，几秒内 `status` 回到 `connected` —— 把同一条命令原样再发一次。
  - 关了标签页、浏览器被关或崩了：**续不上原会话**（配对凭据只存在那个标签页里，新开的标签页接不上）。`status` 迟迟不回 `connected`（`reconnecting`、`pageAway:true`），或用户说关过，就请用户重新打开画布、你重新 `connect` 配对，在新会话里把同一条命令原样再发一次。关标签后约 45 s 内（守护进程的租约）`status` 可能仍显示 `connected`：这时重发只会排队、租约到期后回 `page_away`（`queued:true`，没执行），同样按这一条处理。
  - 重发都只补没出的（已出的按 `up_to_date` 跳过）。这是「`unknown_outcome` 不要重发」的例外：`run-stills` 重发不会重复建。
- `run-stills` 在跑时发 `["cancel","NODE-ID"]` **停得下它**（0.17.0 起守护进程不把 `cancel` 排在在跑的写操作后面）：在渲的那张当场停下，它与没出的进 `skipped`（`cancelled`，不带 `remaining`、不续跑），已出的留在画布上。`cancel` 回 `not_owned`（「多半已经出完了」）= 送到时它已经出完了，不用重试；回 `not_owned`「人在导演台点的出预演（镜…）正在渲」= 那是人点的那一批，Agent 停不了，照 `next[0]` `read NODE-ID/renders` 等它落地（`run-stills` 照样能和它同时跑）。（0.16.2 的守护进程会把同一会话的 `cancel` 排在 `run-stills` 后面，那时停不下。）
- 删掉的镜头（或删掉的三维节点）留下的站位图节点不会被删：回包 `orphans[]`（`orphan:true`）与 `read` 那个节点的 `stillOf.orphan` 会标出来，要不要删问用户。
- 回 `method_not_allowed`「Unknown canvas method」= 画布页面比 CLI 旧、还不认 `run-stills`（什么都没出）：请用户刷新画布页面再发，不要改写命令、不要改成一镜一镜地 `run`。
- ❌ 错误：一镜一镜地 `run --shot … --frame …` 再自己 `upload` 成新节点 —— 那样没有 `stillOf`，重出会越积越多。出站位图就用 `run-stills`。

续跑是什么样子（同一场景从头出，页面渲得慢：每张 24 s，90 s 里只出得了 3 张）。续跑（第一次回包的尾巴；`stills` 是前 3 张，形状同上）：

```json
{
  "skipped": [
    {
      "shotId": "shot-2",
      "frame": "end",
      "reason": "budget"
    }
  ],
  "remaining": [
    {
      "shotId": "shot-2",
      "frame": "end"
    }
  ],
  "stillsSummary": "s3d-4a101807d6：出了 3 张站位图（新建 3 张，原地刷新 0 张）；没开始 1 张（总预算用完）：同一条命令再发一次接着出，已出的跳过（up_to_date）、只补没出的"
}
```

回包带 `remaining` → 把 `["run-stills", "NODE-ID", "--approved"]` 原样再发一次。续跑（原样再发一次的回包；已出的 3 张进 `skipped`、带各自的 `nodeId`，只出了剩下那张，不再带 `remaining` —— 这一场出完了）：

```json
{
  "ok": true,
  "nodeId": "s3d-4a101807d6",
  "sceneDigest": "785714eeed83d77d",
  "stills": [
    {
      "shotId": "shot-2",
      "frame": "end",
      "nodeId": "media-d4c3b2a1-9e8f-4a7b-b6c5-2e1f0a9b8c74",
      "url": "https://cdn.example/stills/scene3d-s3d-4a101807d6-shot-2-end.png",
      "created": true,
      "sceneDigest": "785714eeed83d77d"
    }
  ],
  "failed": [],
  "skipped": [
    {
      "shotId": "shot-1",
      "frame": "start",
      "reason": "up_to_date",
      "nodeId": "media-5c1d3f0e-8a4b-4c62-9d1e-2f7a6b3c9e41"
    },
    {
      "shotId": "shot-1",
      "frame": "end",
      "reason": "up_to_date",
      "nodeId": "media-b7e2a9c4-1f3d-4e8a-a6b5-0c9d8e7f6a52"
    },
    {
      "shotId": "shot-2",
      "frame": "start",
      "reason": "up_to_date",
      "nodeId": "media-3e9f1a2b-7c6d-4b5e-8f4a-1d2c3b4a5e63"
    }
  ],
  "orphans": [],
  "stillsSummary": "s3d-4a101807d6：出了 1 张站位图（新建 1 张，原地刷新 0 张）；3 张已是最新（场景没改、站位图都在），没重出；确实要重出才加 --force"
}
```

第四步之三 每镜三样参考一条命令出齐（「这一场每镜的站位图和预演都出来」「给每个视频配齐三样参考」，0.18.0）：每一镜按序出**开始站位图 → 结束站位图 → 预演**，一条命令出完一场：

```json
["run-shot-refs", "NODE-ID", "--approved"]
```

- 同 `run-stills`：浏览器里渲染、不是生成扣费项、不用问价（契约 `tiers["run-shot-refs"].billable:false`），仍要 `--approved`、只有主会话能发。缺省全部镜头、按镜头表顺序；只要几镜用 `"--shots", "shot-1,shot-3"`（`all` = 全部）。没有 `--frames`：每镜三样都出。两张站位图就是 `run-stills` 出的那两个图片节点（同一个 `stillOf`；产品场景同样是俯视图、按镜取景、16:9），预演就是 `run --render video` 出的那张 `s3v-` 卡（产品场景 `epXX-PYY-SZZ运镜预演`、三联、`previzOf`）—— 之前用 `run-stills` / `run` 出过的，这条原地刷新同一个节点、同一张卡，不重复建。
- 回包 `{ok, nodeId, sceneDigest, shots, remaining?, orphans, duplicates?, checks?, notes?, shotRefsSummary}`，先念 `shotRefsSummary`。`shots[]` 每镜一行（契约 `SCENE3D.shotRefParts`）：`{shotId, n, start:{nodeId, url}, end:{nodeId, url}, previz:{nodeId, url, durationS}, created, skipped, failed}` —— `start` / `end` / `previz` 是承接那一样的节点（这次出的，或之前出的、已是最新 / 换过的；没出、也没有承接节点的是 `null`），拿它们的 `nodeId` 连那一镜的视频节点（见下面「站位图进视频节点」与 6h 第三步）；`created` 是这一次新建的那几样（原地刷新的不算）；`skipped[]` 是没出的那几样 `{part, reason, nodeId?}`（`part` 是 `start` / `end` / `previz`，`reason` 同 `run-stills`）；`failed[]` 是出了没成的 `{part, message}`。
- 页面一次只渲一样：一镜三样出完再出下一镜。总预算按镜数算：每镜两张各 25 s + 预演 15 s + 每帧 250 ms（4 s 的镜 96 帧，这一镜 89 s），封顶 240 s（`SCENE3D.limits.shotRefsBudgetMs`；守护进程与 CLI 为这一条等到 255 s，`shotRefsCallMs`）—— 镜多、页面渲得慢时一次出不完是正常的。到点时在渲的那一样停下，它与没开始的进 `skipped`（`budget`）、列进 `remaining:[{shotId, part}]`；页面离开同理（`page_away`）。**回包带 `remaining` → 把同一条命令原样再发一次**：已是最新的跳过（站位图与产品场景的预演按 `sceneDigest` + 画法版本判，别的三维节点的预演按镜头摘要判）、只补没出的，发到回包不再带 `remaining` 为止；续跑**不要**加 `--force`。
- 一样出错不停：进那一镜的 `failed`，接着出下一样，已出的不回滚。这一镜有「拦下」档的数据问题时三样都进 `failed`（「数据健康拦下」开头），回包带 `checks`（预演口径：没有时长 / 不足一帧的镜也拦）；这一镜 `dur` 超过 30 s 只拦预演，两张站位图照出。一样都没出成、又有没做完的才回 `ok:false`（`run_failed`），`shots` 照样逐镜列出；全部已是最新 / 换过是 `ok:true`（什么都不用做）。
- 换过的（站位图 `stillOf.replaced`、预演卡里人换上的视频）缺省不动：进 `skipped`（`replaced`，带 `nodeId`，照样拿它连视频节点）。用户要你重出才加 `"--force"`：全部原地重出，换上去的图、视频也一起盖掉。短于 2 s 的镜照本镜时长出预演，`notes[]` 提醒（挂参考时由产品延长）；一镜里谁都没动时开始、结束两张一模一样，是正常结果，照样出、照样落。
- `notes[]`（也接在 `shotRefsSummary` 末尾）还有：三联摆位提醒（往上挪过、叠放、找不到视频退回网格、跟着没居中的老站位图排，0.18.1 起还有三维卡 / 站位图 / 预演卡压着别的节点、请产品重排，见上面产品场景那条），以及这一批有预演的镜（这次出的与已是最新的）里的**越轴提醒（不拦）**「镜 n 的机位在轴线另一侧……」与**接缝提醒（不拦）**「镜a→镜b 转角 x°（< 30°），会读成跳切……」—— 同 `run --render video`；是导演有意的就在导演意图里写明，不用为它改机位、不用返修。
- 在跑时同一个三维节点上的 `run` / `run-stills` 回 `already_running`；`["cancel","NODE-ID"]` 停得下它（在渲的与没出的进 `skipped`（`cancelled`），不续跑）。页面离开、`unknown_outcome` 的处置同 `run-stills`（先 `status`，再把同一条命令原样再发一次；重发不会重复建）。回 `method_not_allowed` / `invalid_request` 且 `hint` 写「这是 0.18.0 起才有的写法」= 画布页面或守护进程比这条命令旧：照 `hint` 刷新画布页面或重新 `connect`；都做过仍拒收说明站点还是 0.17.0：只用 `run-stills` 出站位图 —— 那种站点拒收剧本转视频建的场景的 `run --render video`，别再试；自己建的三维节点可以再 `run --shots all --render video` 出预演。

第五步 静帧进生成（顺序同场景 4）：先把那一镜的静帧卡（`run` 回包 `outputs[].nodeId`）连到 gen 节点的参考口，

```json
{
  "commands": [
    {
      "type": "connect",
      "source": "STILL-CARD-ID",
      "target": "GEN-NODE-ID",
      "targetHandle": "reference"
    }
  ]
}
```

再 `["read","GEN-NODE-ID"]` 拿 `mentionCandidates`，提示词里逐字写静帧那一项的 `syntax`（`@{…}`；标签就是 `run` 回包 `outputs[].title` 的实际值，页面给重名加过后缀的也以回包为准），并写明：「第一张参考是构图、站位、机位与透视的参考；后面的参考是人物身份参考。不要把网格、标记、线框画进画面。」最后把节点念给用户，同意后 `["run","GEN-NODE-ID","--approved"]`（这一步花钱）。

站位图（第四步之二）进视频节点：按回包把每一镜的两张分别连到**那一镜**的视频节点（`stills[i].nodeId`，开始、结束各一条边），再 `read` 视频节点拿 `mentionCandidates`，提示词里逐张点名：「开始站位参考 `@{…·开始站位}`（本段开始时人物的位置与远近），结束站位参考 `@{…·结束站位}`（本段结束时的位置）」——这两张只是站位参考：开始站位图不是首帧画面、结束站位图不是最后一帧，都不决定构图、机位和画面内容。

```json
{
  "commands": [
    {
      "type": "connect",
      "source": "START-STILL-NODE-ID",
      "target": "VIDEO-NODE-ID",
      "targetHandle": "reference"
    },
    {
      "type": "connect",
      "source": "END-STILL-NODE-ID",
      "target": "VIDEO-NODE-ID",
      "targetHandle": "reference"
    }
  ]
}
```

**自检**（`checks`，回包和 `read` 里是同一份）：`health` 是数据写漏写错（`level:"block"` 拦下这一镜的静帧，`"warn"` 提醒）—— 直接补数据；`axis` 是越轴（`ok:false` 时 `offside` 列出轴线另一侧的镜头）；`cuts` 是相邻两镜的接缝（`jump:true` = 低于 30°、会读成跳切，`exempt` 是豁免原因）。越轴、接缝的结论原样告诉用户；要改就作为镜头设计的改动提出、说清意图，**不许只为消警告**去挪机位、改视场角，或给不是轴上镜的镜头标 `onAxis:true`（SKILL.md「自检立场」）。

**取景**（`checks.framing`，0.17.0；只提醒、永不拦）：按场景数据预判这一镜实际拍到了什么，每 0.25 s 采样加首帧与末帧。`apply` 只重算本批 `add_shot` / `update_shot` 碰到的镜头（回包 `checks.framing[]` + `framing[]`）；`read NODE-ID`、`read NODE-ID/checks` 带全部镜头的提醒；`read NODE-ID/framing` 是网格版（对象实际占画面的比例、41 点扫描），`cam_too_close` / `foreground_fill` 只在那里出现。码：`cam_inside`（机位在物体或人物体内）、`cam_below_ground`、`cam_too_close`（< 0.3 m，贴脸）、`subject_out`（主体出画，持续 ≥ 2 个采样点或落在首 / 末帧）、`head_out`（头不在画内）、`subject_blocked`（主体被挡，「可能被 X 挡住（近似判断，t1–t2 s）」）、`foreground_fill`（更近的东西占画面 ≥ 40%）、`framing_mismatch`（`framing` 文字与实测景别不是一个粗档；所有采样点都不是这一档才报 —— 运动镜只要有一个采样点同档就不报，例如推镜首帧远景、末帧全景，写「全景」不报；报的时候 message 写首帧的实测），message 末尾附「要 X：机位离 … ≈… m 或 fov≈…°」（机位沿视线挪、看点不动；或机位不动只改 fov）——照它改机位 / 焦距，不改 framing 文字。景别只对人物算：主体是 `look` 指的那个对象（`look` 是点时取眼睛离画面中心最近、在画内的人物）；主体是道具或布景时「取景 镜n」行只写「主体 <id>」、没有景别，`framing` 写什么都不报 `framing_mismatch` —— 例：6g 那一场加一镜 `look:"cup"`、`framing:"特写"`，回包那一行就是「取景 镜4：主体 cup」；要量景别就让 `look` 指人物。景别按画框切在人物哪里定（切点 = 站姿等效身高的分数，头顶 ≈ 1、脚 = 0；全身在画内按投影身高占画高），阶梯是契约 `SCENE3D.framing.sizes`：

| 景别   | 粗档 | 判据                         | 身体部位                         |
| ------ | ---- | ---------------------------- | -------------------------------- |
| 大特写 | 特写 | 切点 ≥ 0.87                  | 只有眼 / 嘴 / 手等局部           |
| 特写   | 特写 | 切点 ≥ 0.83                  | 脸充满画框                       |
| 中近景 | 近景 | 切点 ≥ 0.70                  | 头与肩                           |
| 中景   | 中景 | 切点 ≥ 0.52                  | 腰部以上                         |
| 七分身 | 中景 | 切点 ≥ 0.36                  | 大腿中部以上                     |
| 中全景 | 全景 | 切在腿上                     | 接近全身                         |
| 全景   | 全景 | 全身在画内，身高 ≥ 0.45 画高 | 全身在画内                       |
| 远景   | 远景 | 全身在画内，身高 ≥ 0.15 画高 | 全身在画内，人物偏小             |
| 大远景 | 远景 | 全身在画内，更小             | 全身在画内，人物很小、以环境为主 |

取景提醒原样告诉用户；与意图不符就改机位、焦距，或如实改写 `framing`，**不许为消提醒改 `framing` 文字**（SKILL.md「取景立场」）。上面 6f 两镜实测都是中景、没有提醒：第 1 镜写的「过肩中景」与实测同档，不报 `framing_mismatch`。

- ✅ 正确：把整批动作一次想好再发；回包的 `sceneDigest` 接着当下一批的 `baseDigest`（会话里还没有才 `read NODE-ID/output`）。
- ✅ 正确：两人对手戏用 `set_axis` 声明轴线；人物朝向对方用 `set_figure {facing:"对方的 id"}`，不自己算 `rotation`。
- ❌ 错误：点写成数组 `"position": [1, 0, 2]` → `invalid_request`（`commands[0].actions[k].position`）。点一律 `{x, y, z}`。
- ❌ 错误：回 `scene3d_conflict` 后原样重发 → 同样的 `scene3d_conflict`；只换 `baseDigest` 重发 → 能过，但会把人刚改的站位改回去。先 `read NODE-ID/scene` 看现状，再重新规划。
- ❌ 错误：把三维节点（而不是静帧卡）连到 gen 的参考口 → 三维节点的输出口不随出片更新，gen 拿不到这次的静帧。连 `run` 回包里那一镜的 `outputs[].nodeId`。
- ❌ 错误：每批之前都 `read` 一次整份场景 → 白花一轮；digest 在上一批回包里。
- ❌ 错误：拿 `snapshot` 看三维场景 → 只有计数；用 `read`。
- ❌ 错误：同一批里对同一个节点发两条 `scene3d_apply` → `invalid_request`。合成一条的 `actions`。
- ❌ 错误：`focal` 和 `fov` 同时给 → `invalid_request`。二选一。
- ❌ 错误：`remove` / `remove_shot` 删人在导演台改过的对象 / 镜头（`editedBy:"human"`，场景文本标「人改过」）却没先问用户 → 不带 `--approved` 整批回 `approval_required`、什么都没改；**不要**自己补 `--approved` 重发：先把要删的念给用户，同意了再带 `--approved`（0.18.0）。没打这个标记的（Agent 建的、照方案重建的）直接删，不用问。
- ❌ 错误：改了标着 `终稿` 的三维节点，没在同一批用 `update_node` 的 `draft.assetTags` 把 `终稿` 换成 `待审`。

## 6g. 动画（调度）：「伙计走到柜台前拿起杯子」「老板走过去坐下」「第二镜跟着他走」

0.17.0 起三维场景里可以排**调度**（谁在故事第几秒做什么）：动作还是随 `scene3d_apply` 发，同样带 `baseDigest`，多了三个 op —— `add_act`（加一条）、`update_act`（改一条：给 `null` 删字段）、`remove_act`（删一条，破坏性：先告诉用户）。镜头多了四个字段：`start`（这一镜拍的是故事第几秒开始的那一段）、`via`（途经机位）、`follow`（跟拍）、`shake`（手持晃动）。字段表见参考小节「`scene3d_apply`」。故事时间用秒（`at` / `start` 在 0–600），一个场景最多 200 条动作。

一条 act（`add_act`）：

- `who`（必填）是人物或道具的 id；`at`（必填）是故事第几秒开始；`dur` 可省，省了按缺省算：走位 = 路程 ÷ 步速（`gait:"walk"` 1.4 m/s、`"run"` 3.5 m/s），转身 0.5 s，换姿态按过渡表（站↔坐 1.0、站↔蹲 0.6、坐↔蹲 0.6、→跪 1.2、→躺 / 趴 2.0），手臂 0.4，视线 0.3，拿 / 放 0.5，手势 1.5 s。
- `to` 是走到哪：点 `{x,z}`（省 `y` 就落地）或对象 id。走到对象：同一条带 `pose:"sit"` 且对象是椅子 / 沙发 → 坐上去（回包 `applied[k].to` 是座椅正面前的停步点、`applied[k].seat` 是那张座椅：人站到它前面再坐上座面，不是往回走）；否则停在离它足迹 0.5 m 的地方、面向它。`via` 是途经点（最多 8 个）。一条里既有走位又有转身 / 换姿态：先走、到点再转身（0.5 s）、再换姿态；算出来的 `dur` 只在回包 `applied[k].dur` 回显，不落进场景。
- `pose` / `arms`（或单手 `armL` / `armR`）/ `facing` / `gaze` 的取值与 `set_figure` 相同；`hold` 是拿起哪个道具（`hand` 选 `right` / `left`）；`gesture` 是手势：`wave` 挥手、`nod` 点头、`shake_head` 摇头、`bow` 鞠躬、`beckon` 招手、`point_at` 指向（`point_at` 同一条要给 `gaze`，指的就是视线的目标）。`note` 是给人看的备注。
- 保留词：`hold:"@drop"` = 放下（道具落到正下方第一个台面，没有台面就落到地上）；`facing:"@keep"` = 冻结当前朝向；`gaze:"@none"` = 视线回正。
- **进场 / 离场**（0.18.2，契约 `scene3d.presence`）：同一场前后几段的人物不一样时，开场不在的人先 `set_figure {id, offstage:true}`，到他上场的那一段写 `add_act {who, at, do:"@enter", to?, facing?}`——在第 `at` 秒出现在 `to`（点，省 `y` 落地；不给就在他此刻的位置），立刻面朝 `facing`；下场写 `add_act {who, at, do:"@offstage"}`。只给人物；进场那一条只收 `to` / `facing`（另加 `note`），离场那一条只收 `note`——走进来、坐下、拿东西另写一条（`at` 不早于进场）。**`at` 写在他上场 / 下场的那一镜的入点**：一镜的结束站位图与下一镜的开始站位图是同一个故事时刻，正好在这一刻进场 / 离场的人算下一镜的。不在场的那几刻：不画（静帧、站位图、预演、导演台放映）、不做穿模 / 接触自检（他身上的问题不拦他不在的镜；进场那一刻就穿模的，原话点名这条进场调度——写了 `to` 的说落点，没写的说他出现在存储的站位上：补 `to` 或挪存储的站位）、不进站位图取景框、不参与越轴 / 接缝 / 动作提醒。`run-stills` / `run-shot-refs` 回包 `notes[]` 每镜一句「镜 n：未出场：丙（bing，S02 进场）」，`run-shot-refs` 的那一镜另带 `offstage:{start, end}`（两张站位图各自不在场的人物 id）：给站位图写颜色对照时只列在场的人。`read NODE/scene` 原样给 `figure.offstage` 与 `do`，照抄回写即可。回 `invalid_request` 且 `hint` 写「这是 0.18.2 起才有的写法」= 画布页面或守护进程比这条命令旧：照 `hint` 刷新画布页面或重新 `connect`；都做过仍拒收说明站点还是 0.18.1 或更早：去掉 `do` / `offstage` 再发（那种站点没有在场模型）。
- 道具当 `who` 只能用 `to` / `via` / `facing`；别的通道 → `invalid_request`。
- 同一人后一条在前一条还没做完时开始 → 以后一条为准，从当时的样子接着做。走位打断走位是正常写法；别的通道（姿态、手臂、头部）叠在一起，自检报一条 `act_conflict`（提醒）。坐着 / 蹲着发起走位，页面自动先起身。

镜头的新字段（`add_shot` / `update_shot`）：

- `start`：这一镜从故事第几秒拍起。不给 = **跟随剪辑**：接上一镜的 `start + dur`（回包 `applied[k].start` 回显定格的值）。同一段戏要从两个机位各拍一遍，就给两镜同一个 `start`。有调度时 `reorder_shots` 会先给跟随剪辑的镜头钉上当前的 `start` 再重排（回包 `applied[k].pinned`），每镜拍的故事时刻不变。
- `via:[{t, cam, look?, fov? | focal?}]`：起幅 `cam` → 途经点 → 落幅 `to` 的多点运镜，`t` 是这一镜的进度（0 < t < 1，严格递增，最多 8 个）；必须同时有 `to`，不能与 `orbit` 同给（都回 `invalid_request`，`path` 指 `via`）。
- `follow:"<人物 id>"`：机位跟着这个人平移（跟拍）。`shake:"light" | "medium" | "heavy"`：手持晃动，叠在最后。

建场 + 调度 + 三镜一批发完（**理想剧本的第 1 次调用**；在已有场景上加调度就只发那几条 `add_act`，`baseDigest` 接上一批回包）。把下面整段存成 workspace 里的 `anim.json`，发 `["apply","--file","anim.json"]`：

```json
{
  "commands": [
    {
      "type": "add_node",
      "id": "s3d-4a101807d6",
      "kind": "scene-3d",
      "title": "ep01-茶馆",
      "position": {
        "x": 0,
        "y": 0
      }
    },
    {
      "type": "scene3d_apply",
      "nodeId": "s3d-4a101807d6",
      "baseDigest": "new",
      "actions": [
        {
          "op": "set_scene",
          "aspectRatio": "16:9"
        },
        {
          "op": "remove",
          "id": "human-default"
        },
        {
          "op": "add_object",
          "id": "counter",
          "role": "set",
          "kind": "box",
          "prefab": "counter",
          "transform": {
            "position": {
              "x": 0,
              "y": 0.55,
              "z": 0.4
            },
            "scale": {
              "x": 3.2,
              "y": 1.1,
              "z": 0.8
            }
          }
        },
        {
          "op": "add_object",
          "id": "chair",
          "role": "set",
          "prefab": "chair",
          "transform": {
            "position": {
              "x": -1.1,
              "z": -0.5
            }
          }
        },
        {
          "op": "add_object",
          "id": "boss",
          "role": "figure",
          "kind": "human",
          "transform": {
            "position": {
              "x": -0.4,
              "y": 0,
              "z": -0.3
            }
          }
        },
        {
          "op": "add_object",
          "id": "off",
          "role": "figure",
          "kind": "human",
          "transform": {
            "position": {
              "x": 0.4,
              "y": 0,
              "z": 1.2
            }
          }
        },
        {
          "op": "add_object",
          "id": "cup",
          "role": "prop",
          "kind": "box",
          "transform": {
            "position": {
              "x": -0.3,
              "y": 1.15,
              "z": 0.7
            },
            "scale": {
              "x": 0.1,
              "y": 0.1,
              "z": 0.1
            }
          }
        },
        {
          "op": "set_figure",
          "id": "boss",
          "pose": "stand",
          "arms": "down",
          "facing": "off",
          "gaze": "off"
        },
        {
          "op": "set_figure",
          "id": "off",
          "pose": "stand",
          "arms": "down",
          "facing": "boss",
          "gaze": "boss"
        },
        {
          "op": "set_axis",
          "ends": ["boss", "off"]
        },
        {
          "op": "add_act",
          "id": "a1",
          "who": "off",
          "at": 0,
          "to": {
            "x": -0.2,
            "z": 1.1
          },
          "gait": "walk"
        },
        {
          "op": "add_act",
          "id": "a2",
          "who": "off",
          "at": 3,
          "hold": "cup",
          "hand": "right"
        },
        {
          "op": "add_act",
          "id": "a3",
          "who": "boss",
          "at": 4,
          "to": "chair",
          "pose": "sit"
        },
        {
          "op": "add_shot",
          "id": "shot-1",
          "n": 1,
          "framing": "过肩近景",
          "dur": 4,
          "focal": 85,
          "cam": {
            "x": -2.3,
            "y": 1.7,
            "z": -2.3
          },
          "look": "off",
          "intent": "试探"
        },
        {
          "op": "add_shot",
          "id": "shot-2",
          "n": 2,
          "framing": "中景",
          "dur": 2,
          "focal": 50,
          "moveEase": "out",
          "orbit": {
            "center": {
              "x": -0.4,
              "y": 1.4,
              "z": -0.3
            },
            "r": 2.4,
            "from": -110,
            "to": -20,
            "y": 1.5
          },
          "look": "boss"
        },
        {
          "op": "add_shot",
          "id": "shot-3",
          "n": 3,
          "dur": 2.5,
          "fov": 40,
          "orbit": {
            "center": {
              "x": 0,
              "y": 1.4,
              "z": 0.5
            },
            "r": 2.6,
            "from": 200,
            "to": 250,
            "y": 1.6
          },
          "look": {
            "x": 0,
            "y": 1,
            "z": 0
          }
        }
      ]
    }
  ]
}
```

回包（节选；数由真代码算出）：

```json
{
  "ok": true,
  "created": [
    {
      "command": 0,
      "id": "s3d-4a101807d6",
      "kind": "scene-3d"
    }
  ],
  "scene3d": [
    {
      "command": 1,
      "nodeId": "s3d-4a101807d6",
      "sceneDigest": "1bf17b9b28aec2fa",
      "applied": [
        {
          "op": "set_scene"
        },
        {
          "op": "remove",
          "id": "human-default"
        },
        {
          "op": "add_object",
          "id": "counter"
        },
        {
          "op": "add_object",
          "id": "chair",
          "kind": "box"
        },
        {
          "op": "add_object",
          "id": "boss"
        },
        {
          "op": "add_object",
          "id": "off"
        },
        {
          "op": "add_object",
          "id": "cup"
        },
        {
          "op": "set_figure",
          "id": "boss",
          "fields": ["pose", "arms", "facing", "gaze"]
        },
        {
          "op": "set_figure",
          "id": "off",
          "fields": ["pose", "arms", "facing", "gaze"]
        },
        {
          "op": "set_axis"
        },
        {
          "op": "add_act",
          "id": "a1",
          "dur": 0.4345,
          "to": {
            "x": -0.2,
            "y": 0,
            "z": 1.1
          }
        },
        {
          "op": "add_act",
          "id": "a2",
          "dur": 0.5
        },
        {
          "op": "add_act",
          "id": "a3",
          "dur": 2.0118,
          "to": {
            "x": -1.1,
            "y": 0,
            "z": -0.147
          },
          "seat": "chair"
        },
        {
          "op": "add_shot",
          "id": "shot-1",
          "start": 0
        },
        {
          "op": "add_shot",
          "id": "shot-2",
          "start": 4
        },
        {
          "op": "add_shot",
          "id": "shot-3",
          "start": 6
        }
      ],
      "checks": {
        "health": [],
        "axis": {
          "applicable": true,
          "ok": true,
          "offside": [],
          "message": "3 镜的机位都在轴线同一侧，没有越轴；这是按摆位判的，调度后另有 1 处切点越轴，见 checks.motion 的 axis_motion"
        },
        "cuts": [
          {
            "fromId": "shot-1",
            "toId": "shot-2",
            "from": 1,
            "to": 2,
            "angle": 15.1,
            "jump": false,
            "exempt": "moving",
            "message": "低于 30°，但运动镜打破了跳切感"
          },
          {
            "fromId": "shot-2",
            "toId": "shot-3",
            "from": 2,
            "to": 3,
            "angle": 143.4,
            "jump": false,
            "message": "超过 30°，不会读成跳切"
          }
        ],
        "motion": [
          {
            "level": "warn",
            "code": "figure_collision",
            "message": "boss 在镜 2 里穿进 counter（人物胶囊半径 0.25 m，持续 > 0.25 s）",
            "path": "shots[1]"
          },
          {
            "level": "info",
            "code": "axis_motion",
            "message": "镜 3 镜内机位相对轴线（boss–off，按调度后的位置）换了边：机位过轴或两人换边，下一镜要从新的一侧接",
            "path": "shots[2]"
          },
          {
            "level": "warn",
            "code": "axis_motion",
            "message": "镜 2 出点与镜 3 入点的机位在轴线（boss–off，按调度后的位置）两侧，切过去会读成越轴",
            "path": "shots[2]"
          }
        ],
        "framing": [
          {
            "level": "warn",
            "code": "subject_blocked",
            "shotId": "shot-3",
            "objectId": "off",
            "t": [0, 0.5],
            "message": "off 可能被 counter 挡住（近似判断，0–0.5 s）"
          }
        ]
      },
      "framing": [
        {
          "shotId": "shot-1",
          "n": 1,
          "k": 0,
          "t": 0,
          "subject": "off",
          "size": "中景",
          "coarse": "中景",
          "cut": 0.623,
          "cutAt": "胸～腰",
          "view": "正面",
          "elevationDeg": 1,
          "distance": 4.422
        },
        {
          "shotId": "shot-1",
          "n": 1,
          "k": 0.99,
          "t": 3.958,
          "subject": "off",
          "size": "中景",
          "coarse": "中景",
          "cut": 0.652,
          "cutAt": "胸～腰",
          "view": "正面",
          "elevationDeg": 1,
          "distance": 3.998
        },
        {
          "shotId": "shot-2",
          "n": 2,
          "k": 0,
          "t": 0,
          "subject": "boss",
          "size": "中景",
          "coarse": "中景",
          "cut": 0.65,
          "cutAt": "胸～腰",
          "view": "侧面",
          "elevationDeg": -2,
          "distance": 2.402
        },
        {
          "shotId": "shot-2",
          "n": 2,
          "k": 0.979,
          "t": 1.958,
          "subject": "boss",
          "size": "中景",
          "coarse": "中景",
          "cut": 0.594,
          "cutAt": "胸～腰",
          "view": "正面",
          "elevationDeg": 8,
          "distance": 2.443
        },
        {
          "shotId": "shot-3",
          "n": 3,
          "k": 0,
          "t": 0,
          "subject": "off",
          "size": "全景",
          "coarse": "全景",
          "view": "正面",
          "elevationDeg": 0,
          "distance": 3.12
        },
        {
          "shotId": "shot-3",
          "n": 3,
          "k": 0.983,
          "t": 2.458,
          "subject": "boss",
          "size": "中景",
          "coarse": "中景",
          "cut": 0.64,
          "cutAt": "胸～腰",
          "view": "侧面",
          "elevationDeg": 18,
          "distance": 1.412
        }
      ],
      "timeline": {
        "total": 8.5,
        "shots": [
          {
            "id": "shot-1",
            "start": 0,
            "end": 4,
            "editStart": 0
          },
          {
            "id": "shot-2",
            "start": 4,
            "end": 6,
            "editStart": 4
          },
          {
            "id": "shot-3",
            "start": 6,
            "end": 8.5,
            "editStart": 6
          }
        ],
        "acts": [
          {
            "id": "a1",
            "who": "off",
            "start": 0,
            "end": 0.4345
          },
          {
            "id": "a2",
            "who": "off",
            "start": 3,
            "end": 3.5
          },
          {
            "id": "a3",
            "who": "boss",
            "start": 4,
            "end": 6.0118
          }
        ]
      }
    }
  ],
  "scene3dSummary": "s3d-4a101807d6：应用 16 个动作 → sceneDigest=1bf17b9b28aec2fa（下一批 baseDigest）；0 处拦下，0 处提醒，取景 1 条提醒（不拦，见下）；chair 按 prefab 画（kind=box）\n时间线：总长 8.5 s（timeline.total=8.5），3 镜，3 条动作\n动作 off：0–0.43 s 走到 (-0.2, 0, 1.1)；3–3.5 s 拿起 cup\n动作 boss：4–6.01 s 走到 chair 坐下\n取景 镜1：off 中景（切在胸～腰），正面，俯 1°，距 4.42 m；末帧 off 中景，正面，距 4 m\n取景 镜2：boss 中景（切在胸～腰），侧面，仰 2°，距 2.4 m；末帧 boss 中景，正面，距 2.44 m\n取景 镜3：off 全景（全身在画内），正面，平视，距 3.12 m；末帧 boss 中景，侧面，距 1.41 m\n镜3 ⚠ off 可能被 counter 挡住（近似判断，0–0.5 s）"
}
```

- 有调度时回包多一段 `timeline`：`total` 是成片总长（各镜 `dur` 之和），`shots[]` 是每镜拍的故事时间窗（`start`–`end`）和在成片里的入点 `editStart`，`acts[]` 是每条动作的起止。`scene3dSummary` 跟着「时间线：…」「动作 <人物>：…」几行，念给用户核对「谁在第几秒做什么」。
- **动作提醒**在 `scene3d[0].checks.motion[]`（`level` 是 `warn` / `info`），`scene3dSummary` 的「0 处提醒」只数数据健康，不数它们 —— 要单独看。码：`figure_collision`（人物穿进布景 / 道具 / 别人；两个人时主语是走过去的那个，带动作 id 和故事时间）、`axis_motion`（按调度后的位置，镜内机位换了边，或切点两侧的机位在轴线两边）、`speed`（走得 / 跑得太快——步频过高像小碎步急赶，拉长 dur 或改跑；机位平移太快、甩镜、单帧瞬移）、`move_while_posed`（非站姿起步自动插起身 = `info`；走着换姿态 = `warn`）、`prop_unsupported`（放下的道具掉到地上）、`cut_jump`（故事时间连续的切点上人物位置 / 朝向跳了）、`screen_direction`（同一段走位跨切后画面方向反了）、`act_unseen`（这条动作不在任何镜头的故事时间里，拍不到）。动作提醒只提醒、不拦出片。上面这一批就有三条：老板坐下时身体碰到柜台（镜 2）；第三镜的机位过了轴（镜内换边，和镜 2 的切点也在轴线两侧）。和越轴、接缝一样**原样告诉用户**；要改就作为镜头 / 调度设计的改动提出、说清意图（比如把椅子往后挪、换第三镜的环绕角度），不许只为消提醒去挪东西。
- 这一批加了三镜，取景也三镜都重算（`checks.framing[]` + `framing[]`，摘要里「取景 镜n：…」三行）：第 3 镜开头 off 可能被柜台挡住，摘要表头因此写「0 处提醒，取景 1 条提醒（不拦，见下）」，下面跟「镜3 ⚠ <原话>」。读法同 6f「取景」：原样告诉用户，不许为消提醒改 `framing` 文字。
- 只看时间线：`["read","NODE-ID/timeline"]`（和回包的 `timeline` 同形）。
- ✅ 正确：先把整场戏想好（谁、第几秒、走到哪、做什么），一批发完；镜头不写 `start`，让它跟随剪辑。
- ❌ 错误：拿 `add_shot` 的 `dur` 去凑动作时长 —— 镜头 `dur` 是这一镜在成片里多长；动作的快慢由 `at` / `dur` / `gait` 决定。
- ❌ 错误：`remove_act` 没先告诉用户（它是破坏性的；`remove` / `remove_shot` 只在删人改过的对象 / 镜头时要同意，见 6f）。

## 6h. 出参考视频：「把这场出成预演视频」「拿预演当运镜参考去生成」「出一张联系表」

三维节点能把每一镜渲成一段**预演视频**（白模、按调度动起来），落在三维节点下方的视频卡（`s3v-…`）上；拿它当视频生成的运镜 / 景别 / 站位参考。和静帧一样在浏览器里渲染、不是生成扣费项、不用问价，`run` 仍要 `--approved`。

**理想剧本**（一场三镜，共 3 次调用 + 1 次付费确认）：① 一批 `apply` 建场 + 调度 + 三镜（场景 6g）→ ② 一条 `run` 出全部镜头的预演视频 → ③ 一批 `apply` 建 gen、连视频卡、写 `@`（能同批）→ 把 gen 清单念给用户，同意后 `run-batch`。

第二步 出预演视频：

```json
["run", "s3d-4a101807d6", "--shots", "all", "--render", "video", "--await", "180", "--approved"]
```

- `--shots all` = 全部镜头（`--shots shot-1,shot-3` 只出这几镜；和 `--shot` 二选一）；`--render` 是 `still`（缺省）/ `video` / `sheet`（联系表，配 `--frames 3|5|9`，缺省 3）。
- `--await 180`：**整条命令**（含之后的下载）最多等 180 秒墙钟时间，不是每镜 180 秒。页面 30 s 内没渲完的镜先进 `pending[]`，CLI 每 3 s 读一次 `NODE-ID/renders`，落下的并进 `outputs[]`；到点还没渲完的留在 `pending[]`，`notes[]` 写「N 镜仍在渲，等一会儿 read NODE/renders 取，不要重发 run」—— 照做，**不要重发 `run`**。视频建议 180；只出静帧不用带。`--await` 只收 0–240 的整数秒（写成毫秒 → `invalid_argument`）；`--wait` 是「页面不在时排队等」的开关，不是等出片。
- `--out-dir 产出/预演`：把 `outputs[]` 每张卡的当前产物经页面下载（同 `download`，CLI 不直连 url）到 workspace 里这个目录，每项加 `path`（文件名 = 卡片标题-outputId 前 8 位）；单项下载失败只在那一项加 `pathError`，`run` 照样 `ok:true`。
- 事后补文件（带 `pathError` 的项、到点还在 `pending[]` 后来才落下的镜）：**不要重发 `run`**。等镜头落下（`read NODE-ID/renders` 里那一镜是 `landed`），用它那行 / `outputs[]` 里的卡片 id 下载：`["download", "s3v-…", "--out", "产出/预演/镜2.mp4"]`。
- 一镜 `dur` 超过 30 s 渲不了（这一镜进 `failed[]`，不可重试，先拆镜）；页面没有视频编码能力（浏览器不支持 H.264 编码）回 `run_failed`，原样告诉用户。
- **越轴、接缝只在这里提醒**（0.18.0，A87 ③；不拦）：出预演的回包 `notes[]` 带「越轴提醒（不拦）：镜 n 的机位在轴线另一侧——是有意越轴就在导演意图里写明…」与「接缝提醒（不拦）：镜1→镜2 转角 x°（< 30°），会读成跳切…」（只点名这一批出的镜；切到的那一镜在这一批里才算它的接缝）。原样告诉用户；要改就作为镜头设计的改动提出并说清意图（自检立场），不为消提醒挪机位。apply 的摘要不再写这两样。

回包（节选，隔离测试栈实录；`url` 是测试栈的文件服务，三镜只列前两镜）：

```json
{
  "ok": true,
  "local": true,
  "submitted": true,
  "turnId": "3d2b2ab7-3e5c-4437-bd2f-fa77dff4102f",
  "renderedDigest": "d989e043e4ee0565",
  "outputs": [
    {
      "nodeId": "s3v-7a9aebfe19",
      "title": "ep01-茶馆 · 镜1 · 预演",
      "mediaType": "video",
      "shotId": "shot-1",
      "n": 1,
      "output": "video",
      "outputId": "f6acebc0-2514-476f-9a97-673e68c153e2",
      "url": "http://127.0.0.1:7734/files/2026-10-09/24f6efd9-5ec4-4ea9-a3e6-03c9c1648300.mp4",
      "posterUrl": "http://127.0.0.1:7734/files/2026-10-09/4777d366-34e1-49b1-9e2e-bf1fa4d67c3d.png",
      "lastFrameUrl": "http://127.0.0.1:7734/files/2026-10-09/f82644f8-39e4-4737-b220-056ef09d75b3.png",
      "durationMs": 4000,
      "result": "created",
      "created": true,
      "reused": false
    },
    {
      "nodeId": "s3v-753ae51779",
      "title": "ep01-茶馆 · 镜2 · 预演",
      "mediaType": "video",
      "shotId": "shot-2",
      "n": 2,
      "output": "video",
      "outputId": "34a596c5-378a-421b-b9bf-ff39a9dc6ae3",
      "url": "http://127.0.0.1:7734/files/2026-10-09/36c6042f-3a28-4faa-9b2d-4454a6d450c6.mp4",
      "posterUrl": "http://127.0.0.1:7734/files/2026-10-09/2c44da8c-382a-4576-9eb3-125100e67447.png",
      "lastFrameUrl": "http://127.0.0.1:7734/files/2026-10-09/23664a1e-1a06-4067-a653-16a7b6542910.png",
      "durationMs": 2000,
      "result": "created",
      "created": true,
      "reused": false
    }
  ],
  "pending": [],
  "failed": []
}
```

这份实录录于合流（D-91）之前：之后没写 `color` 的人物、道具按名字取身份色、存进场景，同一批 6g 动作现在得到的 `sceneDigest` 是 `1bf17b9b28aec2fa`（上面 6g 回包里那个），实录里的 `renderedDigest` 仍是录的时候那份场景的；其余字段与颜色无关。

- 每镜一张**视频卡**：`nodeId` 是 `s3v-…` 卡片，`title`（「<场景标题> · 镜n · 预演」）就是下游 `@{}` 的标签，`durationMs` = 这一镜的 `dur`，`posterUrl` / `lastFrameUrl` 是首帧 / 末帧。同一镜再出落在同一张卡上（`result:"rerendered"`），没变的镜回 `result:"reused"`、不重渲。
- 人动过的镜头卡：卡里被换成同类型的文件（替换文件 / `upload --into`），下次 `run` 先把那个文件记成一条「原始上传」候选再追加新渲的一条（`resources` 里还能选回它，选回后这张卡算过期）。卡被 `clear_output` 清空后，`NODE/renders` 那一行 `url:null`、`stale:true`，下次 `run` 把它重新填上（同一个 `nodeId`，`result:"rerendered"`）。卡里被换成了别的类型的文件（静帧卡里放了视频）：`run` 在出片前就回 `run_failed`，`error.next[0]` 是删这张卡的 `delete_node`，先征得用户同意。卡的标题保留建卡时的镜号，插镜头改了 `n` 之后以 `NODE/renders` 的 `n` 为准。
- 选回旧的预演候选（`select_output`）后，`NODE/renders` 的 `durationMs`、`timeline append` 的长度检查和参考视频时长提示都按选中的那条算。
- 之后改了场景：`apply` 回包的 `scene3dSummary` 有「产物过期」行，行尾就是更新它的 `run` argv。`undo` / `redo` 改了场景时回包也带 `scene3d[].renders` 与同样的「产物过期」行（`scene3dSummary`）。这一批或之前几批加了镜头、还没出卡的，那一行会点名「镜n 还没出…卡」并把它并进 argv；全部镜头都要出就是 `allShots`。镜尾静帧卡的 argv 带 `"frame":"end"`。行里「其中 … 卡上已有与现场景一致的候选」给的是一条 `select_output` 的 `apply`（undo 回到渲过的场景时常见）：照它选回去，不要再 `run`；「其中 … 里是人换上的文件」/「换成了别的类型的文件」的卡不在 argv 里——先问用户（别的类型要先征得同意 `delete_node`）。动作打完场景一字不差时 `scene3d[].unchanged:true`、基础行写「N 个动作打完场景没有变化」：没写、不进撤销栈，digest 不变。`["read","NODE-ID/renders"]` 每张卡一行（`state` 是 `rendering` / `landed` / `failed`，`stale:true` = 卡是旧场景出的）。
- 联系表（`--render sheet --frames 5`）：每镜一张 `s3c-…` 图片卡，一镜里等距取 5 格，给用户一眼看全一镜的走位。

第三步 视频卡接生成：**同一批**里建 gen、连卡、写 `@`（参考是已经落下的视频卡，`@` 标签逐字取上一步回包的 `outputs[].title`，不用先 `read`）。视频卡只能连 `mode:"video"` 的 gen（连图片 gen → `invalid_command`「CONNECT_REJECTED」）；`modelId` 先 `["models","--model-type","video"]` 拿：

```json
{
  "commands": [
    {
      "type": "add_node",
      "id": "gen-v1",
      "kind": "gen",
      "title": "镜1 生成",
      "position": {
        "x": 0,
        "y": 1500
      },
      "draft": {
        "mode": "video",
        "modelId": "MODEL-ID",
        "prompt": "以 @{ep01-茶馆 · 镜1 · 预演} 作为唯一的运镜 / 景别 / 站位参考，只作运动参考，不参考画面内容。"
      }
    },
    {
      "type": "connect",
      "source": "s3v-7a9aebfe19",
      "target": "gen-v1",
      "targetHandle": "reference"
    }
  ]
}
```

每镜一个 gen、各连各的视频卡。提示词照下面写（这一段规范来自对视频生成模型的实测）：

1. 用「以 @{<视频卡标题>} 作为唯一的运镜 / 景别 / 站位参考，只作运动参考，不参考画面内容」开头；每张人物参考图写「@{<人物基准图标题>} 对应视频中的 <哪一个> 人偶」（`@{}` 送到模型时变成 `@[视频1]` / `@[图1]`）。
2. 不写这些词：替换、改成、修改、增加、加上、去掉、删除、延续、延长、续写 —— 它们会让模型把任务当成「改这段视频 / 接着这段往下拍」。
3. 不声明任务类型（不写「参考生视频」「视频编辑」之类）。
4. 挂了参考视频就**不设首帧 / 尾帧**：seedance 的首帧 / 首尾帧与参考图 / 视频 / 音频是互斥的两类任务，一起发提交时直接被拒（400，没有生成）。seedance 2.5 用首帧 / 尾帧时比例只能是 `adaptive`。
5. 生成时长取 `max(4, ceil(这一镜的 dur))` 秒（按 `models` 回的 `inputSchema` 写进参数）；参考视频单条 2 s 起（2.5 声明了视频编辑任务时 4 s 起），单条与合计上限：seedance 2.0 是 15 s，2.5 是 30 s。视频卡的时长超了，**单节点** `run` 的回包 `notes` 会提示（只提示、照常提交；条数超 `inputSchema` 的上限才会被拒）；下面那步用的 `run-batch` 回包**不带**这条提示，提交前自己按各镜 `dur` 把每个 gen 接的参考视频合计核一遍。
6. 预演视频当运镜参考为主；只要构图站位的，用三维静帧卡当参考图（场景 6f）为辅。模型优先 seedance 2.5，其次 2.0（以 `models` 列出的为准）。

**一个 gen 接几张预演卡**（用户要几镜合成一条生成）：规范仍是上面的一镜一个 gen —— 剧本转视频也只这样接，时长按一镜算。一定要合成一条时：生成时长取 `max(4, ceil(各卡 dur 之和))` 秒，例：6g 那一场三镜 4 + 2 + 2.5 = 8.5 s → 9 秒；各卡 dur 之和不能超过参考视频合计上限（seedance 2.0 15 s、2.5 30 s，与它们的单段输出上限同数），张数不能超过 `models` 的 `inputSchema` 里 `videos.maxItems`（2.0 是 3、2.5 是 10）；超了就拆成几个 gen。提示词按镜号依次点名每张卡（`@{}` 逐字取各卡 `title`），其余照上面 1–5 条。几张卡合成一条的生成效果没有实测过，先跟用户说明。

然后把 gen 清单念给用户，同意后 `["run-batch","--nodes","GEN-1,GEN-2,GEN-3","--approved"]`（这一步花钱）。

预演视频卡也能直接进时间线当粗剪占位（场景 17）：`["timeline","--json","{\"op\":\"append\",\"dedupeBySource\":true,\"sort\":\"shot\",\"clips\":[{\"nodeId\":\"s3v-…\"}]}"]`，再 `export-jianying` 导剪映（场景 17c）。剪辑器里的「一键导入该集 / 全部导入」不带预演卡，要进时间线就这样显式 append（或请用户手动拖入）。

- ✅ 正确：一条 `run --shots all --render video --await 180` 出完全部镜头；回包有 `pending[]` 就过一会儿 `read NODE-ID/renders`。
- ✅ 正确：gen、`connect`、带 `@{视频卡标题}` 的提示词放同一批。
- ❌ 错误：回包有 `pending[]` 又发一遍 `run` → 白排一次队；还在渲的镜不会更快。
- ❌ 错误：提示词里写「把视频里的白模替换成白妍」→ 模型当成视频编辑；照上面第 1 条写。
- ❌ 错误：挂了参考视频又设首帧 → 两种参考混用，seedance 提交直接被拒。

## 7. 进度 / 失败原因：「好了没」「怎么失败了」

```json
["ls", "/", "--status", "running"]
```

```json
["ls", "/", "--status", "failed"]
```

失败行有 `error: "<kind>[CODE]: 说明"`。按 kind 处理：

- `quota` → **停下**，告诉用户「账户余额不足，剩下的没有提交」。不要重跑。
- `rate_limit` → 等 30 秒，只重跑这个节点。
- `moderation` → 按合规要求改提示词（场景 3），再问用户是否重跑。
- `invalid_params` → 改 `draft`（模型、比例、时长），不是改措辞。
- `provider` → 重跑一次；再失败就报给用户。

用户改了画布想同步：`["changes","--since-seq","N","--since-epoch","E"]`（`N` 和 `E` 一起取自上一次 `changes` / `snapshot` 的回复）。**先看 `truncated`**：`truncated:true` 时这份增量不能用（`entries` 可能是空的，也可能看起来很连续），`truncatedReason:"feed_restarted"` = 这个游标不属于这条 feed（页面刷新过），`"buffer_dropped"` = 500 条缓冲挤掉了；两种都重新 `snapshot`，用新回复的 `seq` + `epoch` 接着走。只有「`entries` 为空**且**没有 `truncated`」才是「什么都没发生」。

- ❌ 错误：对 `quota` 的节点反复 `run` → 每次都尝试计费，还是失败。
- ❌ 错误：`ls` 不带 `--status` 翻全画布找失败 → 大画布只回目录计数，看不到。

## 7b. 复位失败状态：「那个红的先别管了」「失败的那个复位一下」

节点失败条上的「重置状态」：`failed`（或提示词改过的 `dirty`）回到 `idle`，错误清掉，**产出一个都不动**。已经是 `idle` 的节点是空操作。

```json
{ "commands": [{ "type": "reset_status", "nodeId": "NODE-ID" }] }
```

- ✅ 正确：用户看过失败原因、决定先不重跑 → `reset_status`，节点不再挂着红条。
- ❌ 错误：对正在跑的节点 `reset_status` → `node_running`。要停下它用 `cancel`（场景 16）。
- ❌ 错误：用 `reset_status` 代替「重跑」→ 它不提交任何东西，节点仍然没有新结果。

## 8. 撤销：「刚才那步不要了」

```json
["undo", "--turns", "1"]
```

回读 `undone`：`0` = 什么都没撤，如实告诉用户。撤完 `read` 受影响的节点确认。

撤错了要还原（「算了还是刚才那样」「恢复一下」）：

```json
["redo", "--turns", "1"]
```

`redo` 只能还原**紧接着刚被 `undo` 撤掉**的那几组；中间只要又写了一笔，重做栈就空了，回 `redone:0`——那时只能重新做一遍，不要反复发。

「你到底改了些什么」「刚才那几步是哪几步」：

```json
["operations"]
```

回的是本 Agent 这条会话的步骤栈（每组一条，带 `turnId` / `label` / 命令条数），也是决定 `--turns` 要写几的依据。它只读，不产生撤销步。

- ❌ 错误：想用 `undo` 撤用户自己的操作 → `undone:0`。`undo` 只撤本 Agent 的步骤。
- ❌ 错误：想用 `undo` 退掉一次生成 → 钱已经花了，撤不回。只能撤画布上的改动。
- ❌ 错误：凭记忆报「我刚才做了三步」→ 先 `operations`，页面刷新和别的会话都不在你记忆里。
- ❌ 错误：`undone:0` / `redone:0` 之后换个 `--turns` 数字反复重试 → 没有可撤 / 可重做的东西，换几次都一样。

## 8b. 删除与恢复：「把这一组删了」「刚才误删了，恢复一下」

**删除**是 `delete_node`（删一个组 = 连框带成员一起删）。**一批删掉超过 5 个节点、或含带成员的组**，页面和界面的删除确认用同一道门槛：先把要删的清单（节点名、组里有几个成员）念给用户，**用户同意后**加 `--approved` 重发 —— 它替这一批里每条 `delete_node` 的目标声明「用户同意删」：

<!-- prettier-ignore -->
```json
["apply", "--approved", "--json", "{\"commands\":[{\"type\":\"delete_node\",\"nodeId\":\"GROUP-ID\"}]}"]
```

不加 `--approved` 的大批删除回 `approval_required`，什么都没删。5 个以内、不含组的删除不用它。

**恢复**：你和用户删掉的节点都进页面的「最近删除」（画布控制条上的「恢复最近删除」，本标签页内有效，最多 500 个节点）。`undo` 救不回的（页面刷新过、撤销栈被新操作冲掉）用它：

```json
{ "commands": [{ "type": "recover_deleted", "nodeIds": ["NODE-A", "NODE-B"] }] }
```

不写 `nodeIds` = 全部恢复（和那个按钮一样）。节点按原 id、原位置回来，两端都在的连线一起回来。读 `recovered[0]`：`nodeIds` / `edgeIds` 是回来了的，`notFound` 是缓冲里没有的（不是在这个标签页删的、已经回来了、或被挤出缓冲）。

- ✅ 正确：「刚才那步删错了」→ 先 `["undo","--turns","1"]`（场景 8）；`undone:0` 再 `recover_deleted`。
- ❌ 错误：没问用户就给大批删除加 `--approved` → `--approved` 是「用户已经同意」的声明，不是开关。
- ❌ 错误：`recover_deleted` 之后说「全都回来了」→ 读 `recovered[].nodeIds` 与 `notFound` 如实报。
- ❌ 错误：worker 身份发 `recover_deleted` 或带 `--approved` 删除 → `worker_forbidden`，归主会话。

## 9. 下载成品：「把终稿都下载下来」

第一步 列目标：`["ls","/","--tag","终稿","--has-output","--long"]`，拿 `nodeId`、`title`、`outputUrl`。

第二步 逐个下载（路径相对 workspace，目录自动建）：

```json
["download", "NODE-ID", "--out", "out/白妍-终稿.png"]
```

要历史版本 / 候选：`["resources","NODE-ID"]` 拿 `resourceId`，再 `["download","NODE-ID","--resource","RESOURCE-ID","--out","out/白妍-v2.png"]`。

回读 `path` 与 `bytes`。全部完成后把文件清单报给用户。

- ❌ 错误：`--out /Users/me/Desktop/a.png` → `workspace_boundary`。只能写 workspace 里。
- ❌ 错误：同名文件已存在 → `file_exists`。换名字，或用户同意后加 `--overwrite`。
- ❌ 错误：拿 `outputUrl` 自己 curl → 拿不到（受保护的地址）。用 `download`。
- ❌ 错误：对 `hasOutput:false` 的节点 `download` → `resource_not_found`。先生成。
- ❌ 错误：用 `export_output` 存文件。

  <!-- prettier-ignore -->
  ```json
  {"commands": [{"type": "export_output", "nodeId": "NODE-ID", "path": "shot-01.png"}]}
  ```

  它只**描述**一次导出（结果落在 `exports[]`：`url` 或 `content` + `mimeType` + `fileName`），**磁盘上什么都不会出现**——`path` 是宿主的事。要真的拿到文件只有 `download`。它存在是给宿主用的：宿主自己接了写盘，或者想在只读画布上拿导出清单（不写画布，所以只读也能发）。

## 10. 连线 / 断线：「让这张参考那张」「把参考去掉」

连线：见场景 4 第四步；记下 `created[]` 里的 edge id。

断线（需要 edge id；没记下就 `["snapshot"]` 在顶层 `edges[]` 里按 `source` / `target` 找）：

```json
{ "commands": [{ "type": "disconnect", "edgeId": "EDGE-ID" }] }
```

断线会同时把目标提示词里对应的 `@{}` 删掉；断完 `read` 目标确认。

- ❌ 错误：`{"type":"disconnect","source":"A","target":"B"}` → `invalid_request` `Unexpected disconnect field: source`。
- ❌ 错误：argv 第一个词写 `connect`（`["connect",…]`）→ 那是配对页面，不是连线。连线是 `apply` 里的 `connect` 命令。
- ❌ 错误：把 `read` 里 `edges.in[].from` 当 edge id → `EDGE_NOT_FOUND`。`read` 不给 edge id。

## 11. 分组 / 重命名组：「把这三张归成第一幕」「组名改成教堂」

分组（**一个**未分组的节点就够——只有一段的场次也该有框）：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "group_nodes", "id": "GROUP-ID", "nodeIds": ["ID-A", "ID-B", "ID-C"], "title": "第一幕"}]}
```

重命名：先 `["read","GROUP-ID"]` 拿 `titleSha`，再：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "update_node", "nodeId": "GROUP-ID", "title": "教堂", "expect": {"titleSha": "SHA"}}]}
```

解散：`{"type":"ungroup","groupId":"GROUP-ID"}`。给组打标签见场景 5。

**把节点放进已有的组**（「这张也归到第一幕」）：位置不动，组框只长不缩地罩住它。已经在**别的**组里的节点不会被抢（进 `skipped[]`，`reason:"already_grouped"`，先移出再放进来）：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "add_to_group", "groupId": "GROUP-ID", "nodeIds": ["ID-D", "ID-E"]}]}
```

**移出组**（「这张不属于第一幕」，节点菜单的「移出组」）：节点留在原处、变成散节点。组里剩不到 2 个成员时整个组框解散，回包 `dissolved[]` 会说：

```json
{ "commands": [{ "type": "remove_from_group", "nodeId": "ID-D" }] }
```

**组框大小**：`resize_group`。`fit:true` 按成员**渲染后**的包围盒 + 56 px 重贴合，既涨也缩：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "resize_group", "nodeId": "GROUP-ID", "fit": true}]}
```

- ✅ 正确：想只去掉框、留下内容 → `{"type":"ungroup","groupId":"GROUP-ID"}`。
- ❌ 错误：`{"type":"delete_node","nodeId":"GROUP-ID"}` 想「只删框」→ **框里每个节点一起删**，`ok:true` 不给任何提示。有用户因此丢了 7 段成片。
- ❌ 错误：`add_node` 写 `"kind":"group"` → `invalid_request`。组只能由 `group_nodes` 产生。
- ❌ 错误：以为一批里有已分组的 id 就整批失败 → 不会：它们进 `skipped[]`，其余照常成组；一个都不剩才 `invalid_command`。别按老规矩把 40 条拆成 40 次。
- ❌ 错误：`{"type":"move_node","nodeId":"GROUP-ID","size":{…}}` 想改框大小 → `invalid_request`（守护进程在页面看到之前就拒）。改框只有 `resize_group`。
- ❌ 错误：标题超过 60 字 → 会被截断，`titleSha` 对不上。
- ❌ 错误：想把节点从 A 组挪到 B 组，直接 `add_to_group` B → 进 `skipped[]`（`already_grouped`），什么都没变。先 `remove_from_group`，再 `add_to_group`。

## 11b. 整理画布：「画布乱了」「组框大得离谱」「节点叠在一起 / 跑到框外面了」

先看体检结论 —— **一条命令，别自己去 snapshot 里做几何运算**：

```json
["health"]
```

回复的 `report` 是排好的文本（分类计数 + 每类前三条明细 + 每条的修复命令），`issues[]` 是同一份东西的结构化版。详见下面的 11c。

要看原始几何数据（体检用的就是它们）：

```json
["snapshot", "--limit", "2000"]
```

（CLI 的 `--limit` 就是 `maxNodes`。）组行带 `membersBounds`（成员渲染后的包围盒）和 `frameOversize:true`（框面积 > 成员包围盒的 3 倍）。回复里有 `truncated:true` 就说明这次**没看全**，`omittedNodes` 是漏掉的条数——把 `--limit` 调大（硬上限 2000，再大也只回 2000 条）再看一遍，别拿半张画布下结论。

整张画布一次修好（组框贴合成员、组内不叠、成员不出框、组与组不压、散节点不压框）：

```json
["tidy", "--scope", "all", "--fit-frames"]
```

只想修一个组的框：`{"type":"resize_group","nodeId":"GROUP-ID","fit":true}`。

- ✅ 正确：`tidy --scope all --fit-frames`。只动坏掉的部分，幂等，不给用户弹「Agent 重排了你的画布」。
- ❌ 错误：`tidy --all`。那是**整理布局**，会把用户手工摆的东西整个重排，还落成你的撤销步（用户 Ctrl+Z 撤不回）。
- ❌ 错误：用一串 `move_node` 手算坐标去「整理」。组成员坐标是相对父框的，框原点一动就全错；`tidy --scope` 是一个批次、一个撤销步。
- ❌ 错误：看到 `strays[]` 就把它们 `group_nodes` 进去。那是「落在框里但不属于该组」的节点，整理**故意不动**它们——先问用户。

## 11c. `health`：一条命令回答「现在画布哪里坏了」

**什么时候跑它**：用户说「画布乱了」「对不上」「看着不对」「这是怎么回事」「帮我检查一下」，或者你自己刚做完一批 `arrange` / `group_nodes` / `resize_group` 想确认没留下错位。只读、幂等，不产生撤销步，随便跑。

```json
["health"]
```

```json
["health", "--limit", "1000"]
```

（`--limit` 就是 `maxIssues`：明细表最多列几条。）

**为什么要有这条命令**：这些结论所需的数据 `snapshot` 早就给了（每个节点的 `position` / `size` / `parentId`，组行的 `bounds` / `memberIds` / `membersBounds` / `frameOversize`），但把它们算成「哪里坏了」需要对上百个节点做矩形相交、包含和面积比 —— 而且组成员的存储坐标是**相对父框**的，算错一步结论就是反的。`health` 在页面侧算完再回结论，所以它也**不受 `snapshot` 那个 2000 节点的硬上限**：一张 2400 节点的画布 `snapshot` 只能看一半，`health` 扫全部。

### 回包

| 字段                          | 含义                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scanned`                     | `{nodes, groups, edges}` —— 这次**真的扫了**多少。永远是整张画布，没有 clamp                                                                                                                                          |
| `counts`                      | 每一类的条数，**全量**（即使 `issues` 被截也是全量）                                                                                                                                                                  |
| `totalIssues` / `healthy`     | 总条数；`healthy:true` = 一条都没有                                                                                                                                                                                   |
| `issues[]`                    | 明细，按严重度排序。每条带 `kind`、`nodeId` / `groupId` / `otherId`、一句人话 `message`、数字 `metrics`，多数还带 `fix`（可直接执行的 argv）                                                                          |
| `truncated` / `omittedIssues` | **只代表明细表没列全**，绝不代表画布没看全。`--limit 1000` 可以看到更多                                                                                                                                               |
| `report`                      | 上面这一切排成的文本：分类计数 + 每类前三条 + 修复命令。念给用户用这个。修复行给的是 **argv 原样** —— 宿主（`canvas_cli`）自己补会话，直接在 shell 里跑要在末尾加 `--session`，报告开头那一句会把本次会话的 id 写出来 |

### 八类违例

| `kind`                 | 判据                                                                                                                                                                                                                                                                                                                                  | 建议的修                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `dangling_mention`     | 提示词里 `@` 的 key 既不是画布上的节点，也不是这个节点自己的手动引用                                                                                                                                                                                                                                                                  | 没有 `fix`：用 `edit_text` 把那段 `@` 删掉，或把引用重新接上。**这一类排第一**，因为节点照样跑得动、照样计费，只是少带了那个参考 |
| `member_escaped`       | 成员矩形没有被它自己组的框完全包住（`metrics` 给上下左右各超出多少像素）                                                                                                                                                                                                                                                              | `tidy --scope selection --groups GROUP-ID --fit-frames`                                                                          |
| `group_frame_oversize` | 框面积 / 成员包围盒面积 > 契约的 `group.oversizeRatio`（3）                                                                                                                                                                                                                                                                           | `resize-group GROUP-ID --fit`                                                                                                    |
| `stray_over_frame`     | 顶层散节点（没有 `parentId`）的**中心**落在某个组的框里 —— 人眼会以为它在组里，但 `run-batch --group`、删组都不带上它。全产品只有这一份 stray 判据：`tidy` 的 `strays[]`、`frame_strays`、`--absorb-strays` 收的那批，都是它。只把边角压进框、中心还在框外的节点**不算**这一类，那种错位归 `tidy --scope all`（它会把节点从框上推开） | `resize-group GROUP-ID --fit --absorb-strays`，**但这会改成员归属，先问用户**；用户也可能只是想把它挪开（`tidy --scope all`）    |
| `group_overlap`        | 两个组的框相交                                                                                                                                                                                                                                                                                                                        | `tidy --scope groups`                                                                                                            |
| `node_overlap`         | 两个非组节点相交，且相交面积超过较小那个节点面积的 2%（纯贴边不算）                                                                                                                                                                                                                                                                   | `tidy --scope all`                                                                                                               |
| `group_empty`          | 成员数 0（`groupMinMembers: 0` 时这一类整个关掉：先建框再填内容的工作流里空框是正常的）                                                                                                                                                                                                                                               | 没有 `fix`：删掉这个空框还是往里放东西，是用户的决定                                                                             |
| `group_undersized`     | 成员数低于契约的 `group_nodes.minMembers`（当前是 1，所以默认不会触发）                                                                                                                                                                                                                                                               | 没有 `fix`                                                                                                                       |

- ✅ 正确：`["health"]` → 把 `report` 念给用户 → 用户点头 → 按 `fix` 执行 → 再 `["health"]` 确认清零。
- ❌ 错误：拉一个 `snapshot` 回来自己遍历节点算相交。弱模型在这件事上算错的典型形态是把组成员的父相对坐标当成绝对坐标，于是报出一堆并不存在的「成员出框」。
- ❌ 错误：看到 `stray_over_frame` 就直接 `--absorb-strays`。组是**删除单位**：收编错了，下次 `delete_node` 这个组会把用户的散图一起删掉。
- ❌ 错误：`truncated:true` 时把 `issues[]` 当成全部问题报给用户。`counts` 才是全量；要明细就把 `--limit` 调大。

## 11d. 复制一批：「把这一组复制一份」「这几张复制到右边」

`duplicate_nodes` = 在画布上框选这些再复制粘贴：组展开成它的成员（组框本身不复制），**这几个节点之间的连线跟着复制到副本上**，别的入边照样继承。`offset` 是整份副本相对原位置的平移；不写就落在原来那批旁边的空地上（原来的组框也算占用 —— 副本不是组员，不会落进框里）。新 id 在 `created[]`，一个副本一条：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "duplicate_nodes", "nodeIds": ["GROUP-ID", "ID-X"], "offset": {"x": 0, "y": 900}}]}
```

- ✅ 正确：复制的是一组 → 副本是散节点；要副本也有框，拿 `created[]` 的 id 再 `group_nodes`。
- ✅ 正确：只复制一个节点、要好几份 → 那是 `duplicate_node` 的 `count`（场景 6a）。
- ❌ 错误：对一组逐个 `duplicate_node` 成员 → 成员之间的连线不会连到副本上，副本全连回原件。

## 12. 谁跑的 / 我提交的完成了没：「刚才是谁跑的这批」「我昨晚提交的那批完成了吗」「这个节点在跑的是不是我提交的」

`tasks` 列出这张画布的生成任务（最新在前）：每行有 `taskId`（`run` / `run-batch` 回的那个）、`nodeId` / `nodeTitle`、`kind`、`status`（`queued` / `running` / `succeeded` / `failed` / `cancelled`）、`submittedAt` / `finishedAt`、`submitter`（`kind` 是 `human` / `agent` / `unknown`，**`isMe:true` = 本会话提交的**），失败的还有 `error`。回复里另有一张 `table` 文本表，直接念给用户。

刚才是谁跑的这批（看最近的几条）：

```json
["tasks", "--limit", "20"]
```

我提交的那批完成了没（`--since` 用提交时的时间；不加就是全部）：

```json
["tasks", "--submitter", "me", "--since", "2026-09-09T20:00:00Z"]
```

这个节点在跑的是不是我提交的：

```json
["tasks", "--node", "NODE-ID", "--status", "running"]
```

回读 `rows[0].submitter.isMe`：`true` 是你的；`false` 看 `submitter.kind`——`human` 是用户自己点的，`agent` 是别的 Agent 会话（`name` 是它的名字）；`unknown` 是记录提交者之前的老任务。`ls --long` 的行和 `read` 的节点也带一份精简的 `run: {taskId, submitter:{kind,isMe}, submittedAt}`，够回答「这个节点现在跑的是谁的」。

看别的画布 / 项目的任务（「帮我看看另一个项目的任务跑完没」）：

```json
["tasks", "--scope", "all", "--status", "running"]
```

`--scope project` 是本画布所在项目的全部画布，`--scope all` 是用户能看到的全部项目。这些行多了 `canvasName` / `projectName`（和 id），回复带固定的 `scopeNote`：**只读——那些节点不在配对画布上，你不能去那里 `read` / `run` / `cancel`**，只能把状态和所在画布 / 项目名报给用户。

- ✅ 正确：`["tasks","--submitter","me","--status","running"]` → 「你让我跑的 3 个里还有 1 个在跑：S02 特写」。
- ✅ 正确：用户问「这个是不是你在跑」→ `["tasks","--node","NODE-ID"]` 看 `isMe`，再回答。
- ✅ 正确：`["tasks","--scope","all"]` → 「项目二 / 另一张画布 有 2 个在跑、1 个失败」，只报状态。
- ❌ 错误：凭记忆回答「那批是我跑的」→ 页面刷新、别的会话、用户自己点的运行都不在你记忆里。先 `tasks`。
- ❌ 错误：`cancel` 回 `not_owned` 后换个说法重试 → 那是别人的运行（`tasks` 里 `isMe:false`），取消不了；告诉用户。三维节点上的 `not_owned` 是静帧 / 站位图已经出完了，也不用重试。
- ❌ 错误：对 `--scope all` 列出来的别的画布的节点 `read` / `run` / `cancel` → `missing` / `node_not_found` / `not_owned`。那是只读信息。
- ❌ 错误：`["tasks","--status","done"]` → `invalid_request`。状态只有 `queued` / `running` / `succeeded` / `failed` / `cancelled`。
- ❌ 错误：`["tasks","--nodes","A,B"]` → `invalid_argument`。是可重复的 `--node A --node B`（或 `--node A,B`）。

## 13. 排版：「把这几张排成一行 / 两列」「对齐一下」「间距弄匀」

**摆位置永远用这两条命令，不要自己算坐标**：它们用节点**渲染后的真实尺寸**，组成员还会自动换算成相对父框的坐标——手写 `move_node` 在这两件事上必错。

新建了一批节点、想让它们成行成列（顺序就是你列 `nodeIds` 的顺序，这是唯一一条你能决定顺序的排版命令）：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "arrange", "nodeIds": ["ID-A", "ID-B", "ID-C", "ID-D"], "layout": "grid", "columns": 2, "gap": 64}]}
```

`layout` 是 `row` / `column` / `grid`；省略 `gap` 时横向间距 160、纵向间距 96；显式 `gap` 同时覆盖两轴；`grid` 的 `columns` 默认 `ceil(√n)`；`anchor` 不写就用这批节点当前包围盒的左上角。

已经摆好了、只是没对齐 / 间距不匀：

<!-- prettier-ignore -->
```json
{"commands": [{"type": "align", "nodeIds": ["ID-A", "ID-B", "ID-C"], "mode": "distribute_x", "gap": 48}]}
```

`mode` 八个：`left` / `right` / `top` / `bottom` / `center_x` / `center_y` 要 **≥2** 个节点，`distribute_x` / `distribute_y` 要 **≥3** 个。

- ✅ 正确：「这四张排成两行两列」→ `arrange` `grid` `columns:2`。
- ✅ 正确：「左边对齐一下」→ `align` `mode:"left"`。
- ✅ 正确：「横向间距弄成一样」→ `align` `distribute_x`。
- ❌ 错误：用 `align` 去「排成一行」。对齐只动一个轴，不会把堆在一起的节点摊开；要成行是 `arrange` `row`。
- ❌ 错误：`{"type":"align","mode":"left","gap":40}` 指望它「左对齐并留 40 间距」→ `gap` 在六个对齐模式上被**接受然后忽略**，没有任何报错。要间距就 `distribute_*` 或 `arrange`。
- ❌ 错误：以为 `distribute_x` 按你写的 `nodeIds` 顺序排 → 它按节点**当前位置**排。顺序不对先用 `arrange`。
- ❌ 错误：整张画布乱了就 `arrange` 全部节点 → 那是场景 11b 的 `tidy --scope all`，`arrange` 只管你点名的这几个。
- ❌ 错误：`nodeIds` 里有重复 id → `invalid_command`；空数组 → `invalid_request`（它绝不会放宽成「全部」）。

## 14. 上传素材：「把这张图放到画布上」「这是参考图，传上去」

文件必须已经在会话 workspace 里（用户给的是本地路径就先让他放进来），≤ 25 MiB：

```json
["upload", "参考图.png", "--title", "白妍·基准"]
```

回读 `created[]` 里那个新节点的 id：它是一个 `media-upload` 节点，直接就是 `succeeded` 状态、带输出，可以马上被别的节点 `connect` 成参考（场景 4）。位置默认落在画布最右边的空地上。

- ✅ 正确：`["upload","白妍.png","--title","白妍·基准"]` → 拿 `created[0].id` → `connect` 给生成节点当 `reference`。
- ❌ 错误：`["upload","/Users/me/Desktop/a.png"]` → `workspace_boundary`。只能写 workspace 里的相对路径。
- ❌ 错误：自己拼 `{"type":"upload_asset", …}` 手写 `bytesBase64` → 你读不到文件字节。**只能**用 `upload`，它替你读文件、算 base64、组装这条命令。
- ❌ 错误：worker 身份发 `upload` → 整批 `worker_forbidden`。让主 Agent 传。
- ❌ 错误：文件超 25 MiB → `too_large`；换个小的，或让用户在页面上传。

**换掉已有媒体节点的文件**（「用这张替换那个参考图」）：`--into` 把文件传进**已有的** `media-upload` 节点，节点 id、标题、位置、标签、连线都不变，下游直接用上新文件；旧历史清掉。回包 `created[]` 是空的（没建新节点）：

```json
["upload", "新参考图.png", "--into", "MEDIA-NODE-ID"]
```

- ❌ 错误：`--into` 指向生成节点 → `invalid_command`；生成节点的结果换法是 `adopt_output`（场景 6b）。`--into` 再加 `--title` / `--x` / `--y` → `invalid_argument`。

## 15. 看媒体：「你看看这张图对不对」「这段视频里人物有没有走位」

**你不能凭 `outputUrl` 说自己看过图。** 要真看，先把它取到 workspace，再用宿主自己的看图工具打开：

```json
["inspect-media", "NODE-ID", "--out", "out/看.png"]
```

视频抽帧（默认均匀抽若干张，回一个文件清单）：

```json
["frames", "NODE-ID", "--out-dir", "out/帧"]
```

- ✅ 正确：`inspect-media` 取下来 → 用宿主的看图工具打开 → 按看到的内容回答用户。
- ✅ 正确：用户问「这段视频里她走到圣坛了吗」→ `frames` 抽帧、逐张看，并**明说这是抽帧**：中间的动作和全部声音你都没看到。
- ❌ 错误：拿 `ls --long` 里的 `outputUrl` 当「我看过了」→ 你只拿到一个地址。
- ❌ 错误：用 `download` 代替 `inspect-media` 去「看」→ `download` 是交付给用户的成品（场景 9），`inspect-media` 是给你自己看的工作副本。
- ❌ 错误：抽了帧就断言「声音没问题」→ 抽帧里没有声音。

## 16. 停下来：「别跑了」「把剩下的停了」

单个节点：

```json
["cancel", "NODE-ID"]
```

整批还没提交的（`batchId` 来自 `run-batch` 的回复；不带 `--batch` = 本会话的**每一个**批次）：

```json
["cancel-batch", "--batch", "BATCH-ID"]
```

`cancel-batch` 丢掉的是**还没提交**的节点；已经提交出去的还在跑，要逐个 `cancel`。回读 `cancelled[]` 念给用户，别说「全停了」。

- ✅ 正确：用户「别跑了」→ `cancel-batch --batch BATCH-ID` → 再 `["tasks","--status","running"]` 看还有几个在跑 → 逐个 `cancel` → 如实汇报哪些停了、哪些已经在跑（钱已经花了）。
- ❌ 错误：`cancel` 回 `not_owned` 后换个说法重试 → 那不是本会话提交的运行（`tasks` 里 `isMe:false`），取消不了，告诉用户。
- ❌ 错误：不带 `--batch` 就 `cancel-batch`，只想停一个批次 → 本会话所有批次的待提交节点全被丢掉。
- ❌ 错误：`--batch` 写一个已经跑完的批次 id → `batch_not_found`。它可能只是结束了。
- ❌ 错误：以为取消能退钱 → 已提交的那些照样计费。

## 17. 时间线：「把这几段拼成一条视频」「第二段往前挪」

时间线是画布 meta 里的一条剪辑轨，不是节点。**先列再改**，每次写都要带上一次读到的 `baseRevision`：

```json
["timeline", "list"]
```

回读 `revision`、`layoutDigest` 与 `clips[]`（每条带 clip id、来源节点、起止）。`revision` 只认成员和顺序、不含裁剪；`layoutDigest` 连每段的入出点一起算，`cut` 必须用它，`split` / `trim` / `restore` 可以用（§17a）。`op` 十个：`list` / `set` / `append` / `remove` / `reorder` / `clear` / `trim` / `split` / `cut` / `restore`；只有 `list` 是只读，其余都是写命令、会排队。写的时候把 `baseRevision` 填成刚读到的那个数：

<!-- prettier-ignore -->
```json
["timeline", "--json", "{\"op\":\"append\",\"clips\":[{\"nodeId\":\"NODE-ID\"}],\"baseRevision\":REVISION}"]
```

`timeline_conflict` = 有人在你之前改了，重新 `list` 再决定；`timeline_busy` = 有人正在页面上拖，等一轮再来。想能还原就先把 `list` 回来的 `clips[]` 记下来（`previousClips`）。

### 17a. 剪辑：「这段只要 2 到 5 秒」「从这里切开」「把 10 秒到 15 秒剪掉」「刚才那刀不要了」

四个编辑 op 和剪辑器里的手势是同一套计算（拖边 / S 键 / I-O-X / 撤销），剪辑器里拖过头会被夹住，这里**不夹，直接报错**。两套时间别混：

- **素材时间**（`trim` 的 `inMs/outMs`、`split` 的 `atMs`）：这段视频自己的第几毫秒，和 `clips[]` 里的 `inMs/outMs` 同一坐标。
- **时间轴时间**（`cut` 的 `inMs/outMs`）：拼好之后的第几毫秒，= 前面各段 `trimmedMs` 之和；带 `episode` 时是那一集自己的时间轴。

**revision 不含裁剪；cut/split 请先 list 并带 baseLayout。** `cut` 的区间是你按 `list` 看到的那份布局算出来的时间轴位置：人在剪辑器里把前面一段裁短 1 秒，同一个「第 N 秒」就落到了别处（常常是下一段），而 `revision` 纹丝不动、拦不住。所以 `cut` **必须**带 `baseLayout` = 上一次回包里的 `layoutDigest`（每个回包都带最新的，连着剪就用上一次回包里的）；`split` / `trim` / `restore` 可以带，带了就比对；别的 op 不收。对不上 = `timeline_conflict`（`error.path` 是 `baseLayout`），回包里有当前的 `clips[]` 与 `layoutDigest`：按它们重新决定再发——`cut` 要**重算区间**，别拿旧区间配新指纹硬发。

**人刚改过裁剪时，先 list 再带 baseLayout。** `trim` / `restore` 按片段 id 直接写入出点，`revision` 拦不住人刚在剪辑器里裁的那一刀，不带 `baseLayout` 就会用旧值把它盖掉，而且不报错（`restore` 会把 `previousClips` 里每一段都写回去，包括人后来又裁过的段）。看到人动过时间线（`changes` 里有 `fields:["timeline"]` 且没有 `nodeId`），或者用户说他刚在剪辑器里裁过：先 `list`，把人的改动并进你要写的值（`restore` 就是把 `previousClips` 里人改过的那几段换成回包里的当前值），再带这次回包的 `layoutDigest` 作 `baseLayout` 发。连着写的时候带上一次回包里的 `layoutDigest` 就行，撞了 `timeline_conflict` 再照这样做。不带 `baseLayout` 就不比对，和原来一样。

| op        | 参数                        | 行为                                                                                                               | `baseRevision`                          | `baseLayout` |
| --------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------ |
| `trim`    | `clipId` + `inMs?` `outMs?` | 改入出点，**clip id 不变**；出点给到素材终点及以后 = 放到片尾（`outMs:null`）。裁完不足 100ms、入点超出素材 → 报错 | 可选（revision 不含裁剪，给了照样比对） | 可选         |
| `trim`    | `clipId` + `reset:true`     | 这一段恢复全长                                                                                                     | 可选                                    | 可选         |
| `trim`    | `reset:true` + `episode?`   | 剪辑器工具条的「重置裁剪」：整条（或那一集）全部恢复全长                                                           | 可选                                    | 可选         |
| `split`   | `clipId` + `atMs`           | 在素材时间 `atMs` 处一分为二，两半各 ≥ 100ms；原 id 消失，回 `createdClipIds`                                      | **必填**                                | 可选         |
| `cut`     | `inMs` `outMs` + `episode?` | 剪掉时间轴区间 `[inMs,outMs)`：跨到的段切成头尾两段（新 id，`createdClipIds`），整段落在里面的删掉                 | **必填**                                | **必填**     |
| `restore` | `previousClips`             | 把上一次写操作回包里的 `previousClips` 原样写回（同 id、同顺序、同裁剪）——你的撤销                                 | **必填**                                | 可选         |

<!-- prettier-ignore -->
```json
["timeline", "--json", "{\"op\":\"trim\",\"clipId\":\"CLIP-ID\",\"inMs\":2000,\"outMs\":5000}"]
["timeline", "--json", "{\"op\":\"split\",\"clipId\":\"CLIP-ID\",\"atMs\":3000,\"baseRevision\":\"REVISION\"}"]
["timeline", "--json", "{\"op\":\"cut\",\"episode\":\"EP01\",\"inMs\":10000,\"outMs\":15000,\"baseRevision\":\"REVISION\",\"baseLayout\":\"LAYOUT-DIGEST\"}"]
```

- 页面量不到视频真实长度，只认节点的计划时长（`fallbackDurationMs`）。**后果**：出点为 null（放到片尾）的段按计划时长算长度；真实视频和计划时长不一样时，`trimmedMs` / `knownMs`、`trim` 的片尾判定（出点 ≥ 计划时长就记成 null）和 `cut` 的时间轴位置，都会和剪辑器里显示的差「真实长度 − 计划时长」，而且 `cut` 区间之前每一段的差会累加。对位置精度敏感时，先跟用户说明这是按计划时长算的，请他在剪辑器里核对。
- 长度未知（`outMs` 和 `fallbackDurationMs` 都是 null）的段：`split` 它会报错；`cut` 时只要它在区间之前、或者和区间相交（在区间终点之前开始），也会报错。别去猜它的长度：`cut` 带 `episode` 把范围缩到不含它的那一集，或者改用 `split`（按素材时间切，不需要时间轴位置）再 `remove`；要切的就是它本身，先用 `["inspect-media","源节点ID","--out","out/量长度.mp4","--probe"]` 量出素材真实长度（`probe.format.duration`，单位秒），按量到的值 `trim` 出点再 `split`，或者请用户在剪辑器里分割（剪辑器量得到真实长度）。
- `restore`：`previousClips` 只有**写操作真的改了轨道**才回，拿到就存着。它只还原片段 id、顺序和入出点，**不还原画面**：还在轨上的段（同 id）用它**此刻**在轨上的画面，已经不在的（删了 / 被 split、cut 换了 id）按源节点**当前**输出重建；源节点也没了就整批拒，不做半截还原。每段的入出点只做结构校验：给了 `outMs` 就必须比 `inMs` 晚至少 100ms（`outMs:null` = 到片尾，不查），不合规整批拒，不会替你改成「到片尾」；和轨上同 id 那段入出点完全相同的不查。想只撤一刀而不是整批，自己从 `previousClips` 里挑。
- `restore` **不按计划时长拒入点**（`trim` 会）：入点超没超出素材，要真实长度已知才判得了，而页面只有计划时长，它还可能过期（节点改长时长重跑后，片段上的计划时长不跟着变；模型给的视频也可能比计划长）。剪辑器按真实长度裁过的段，入点可以在「计划时长 − 100ms」之后，这样的段照样还原；你给的 `outMs` 也不会被当成素材长度。代价是 `restore` 能写回 `trim` 会拒的入出点（比如计划 4 秒的段写回 `[9000, 9500]`），剪辑器打开后会按真实长度规整掉——所以 `previousClips` 只填回包里原样的那份，别拿 `restore` 当 `trim` 用。
- **`restore` 的已知限制**：源节点在这期间重跑过，轨上那段就已经换成新输出（重跑还会把它的裁剪清零），`restore` 会把旧的入出点套到**新视频**上，长度和内容都可能对不上。`restore` 之后 `list` 看一眼，不对就 `trim` 重裁或 `reset:true`，并告诉用户。
- 时间线的写**不进** `undo` 栈，撤销只能靠 `restore`。

### 17b. 分集：「只看第一集」「把第二集清掉」「本集一键导入」

分集规则和剪辑器一样：看片段标题里的 `epNN`（`ep01-P01-S01 …` 属于 `EP01`），认不出的归 `unknown`。`episode` 写 `EP01` / `ep1` / `1` / `unknown` / `all` 都行；不带 = 整条轨道（原来的行为）。

- `list --episode EP01`：`clips[]` 只含这一集，另回 `episode`（规整后的名字）与 `episodes[]`（轨道上现有的全部集）。**`revision` 和 `layoutDigest` 永远是整条轨道的**，拿去写哪一集都一样用。
- `clear` 带 `episode`：只撤这一集，别的集原位不动（剪辑器「清空本集时间轨」）。
- `append` 带 `dedupeBySource:true`：已在轨上（或同一批里重复）的节点跳过，`skipped[].reason = "duplicate_source"`。
- `append` 带 `dedupeBySource:true` + `sort:"shot"` = **剪辑器的「一键导入」**：新片段并入各自那一集、整集按镜号（集-场-镜）重排，已在轨上的保留裁剪；此时不收 `index`。加 `episode` = 「一键导入本集」，不属于这一集的节点整批拒；不加 = 「全部导入」，每集各补各的，`unknown` 集保持原序。和剪辑器的按钮一样，`clips` 里**不放三维镜头卡**（`s3i-` / `s3v-` / `s3c-` 开头、带 `data.scene3d` 的节点），用户点名要哪张卡才放（场景 6h）。

<!-- prettier-ignore -->
```json
["timeline", "list", "--episode", "EP02"]
["timeline", "clear", "--episode", "EP02", "--json", "{\"baseRevision\":\"REVISION\"}"]
["timeline", "--json", "{\"op\":\"append\",\"dedupeBySource\":true,\"sort\":\"shot\",\"episode\":\"EP01\",\"clips\":[{\"nodeId\":\"NODE-A\"},{\"nodeId\":\"NODE-B\"}]}"]
```

- ✅ 正确：`["timeline","list"]` → 拿 `revision`（`cut` 还要 `layoutDigest`；人刚改过裁剪时 `trim` / `restore` 也带上）→ 带着它写 → 写完再 `list` 确认。
- ❌ 错误：不带 `baseRevision` 直接写 → 覆盖用户刚剪的那一刀。
- ❌ 错误：`changes` 里看到 `fields:["timeline"]` 且没有 `nodeId`（人重剪了时间线）还拿着旧的 `baseRevision` 写 → `timeline_conflict`。先 `list`。
- ❌ 错误：worker 身份发 `timeline` → 主 Agent 才能发。
- ❌ 错误：想「删掉某一段视频节点」就去改时间线 → 那是节点的事（场景 11），时间线只管成片怎么拼。
- ❌ 错误：把时间轴上的秒数（「第 10 秒」）当 `split` 的 `atMs` → `atMs` 是那一段素材自己的时间；按时间轴剪用 `cut`。
- ❌ 错误：`cut` 撞了 `timeline_conflict`（`baseLayout`）之后，拿回包里的新 `layoutDigest` 配上**原来的区间**重发 → 区间要按回包里的 `clips[]` 重算，人裁短了前面一段，原来的秒数已经落在别的画面上了。
- ❌ 错误：`trim` 完看 `revision` 没变，以为没写进去 → revision 只认成员和顺序，看回包里那段的 `inMs/outMs`。
- ❌ 错误：人刚在剪辑器里改过裁剪，还拿着老的 `previousClips` 不带 `baseLayout` 直接 `restore` → 人裁好的那一刀被旧值盖掉，而且不报错。先 `list`，把人的改动并进去，再带 `baseLayout`。

## 17c. 剪映工程：「导出剪映工程」「按集导到剪映」「粗剪交给剪映精剪」「直接导进我的剪映」

粗剪的交付物是**剪映工程**（剪映的草稿目录）。**首选直接写进用户的剪映草稿目录**（剪映首页直接看得到）—— 两步：

第一步，看用户登记过的剪映草稿目录（最多 5 条，最近用过的在前；只读，但只有主会话能发）：

```json
["jianying-roots"]
```

回读 `roots[]`：每条 `label`（备注，例如「公司 Windows」）、`path`、`lastUsedAt`、`exists`（这台电脑上有没有）、`looksLikeDraftRoot`（像不像剪映草稿根：根下有 `root_meta_info.json` 或已经有草稿）、`usable`（`--draft-root` 收不收，`false` 时 `reason` 说为什么）。回包的 `table` 直接念给用户，请他选一条；表是空的、或者他要用别的目录，就请他给剪映「全局设置 → 草稿位置」里显示的**完整路径**。

第二步，直写（每集一个工程直接建在那个目录下：`<剧名>_EP01_<时间戳>/`）：

<!-- prettier-ignore -->
```json
["export-jianying", "--draft-root", "D:\\JianyingPro\\User Data\\Projects\\com.lveditor.draft"]
```

- **表里有的**（`jianying-roots` 列出来的那几条）直接导。**表外的新路径**：先把完整路径念给用户（「我要把工程写进 D:\…\com.lveditor.draft，对吗？」），他同意了才加 `--approved`：

  <!-- prettier-ignore -->
  ```json
  ["export-jianying", "--draft-root", "E:\\剪映草稿", "--approved"]
  ```

  不加 `--approved` 回 `approval_required`（退出码 2），一个字节都没下、什么都没写。导出成功后这条目录**自动记进登记表**（已在表里的刷新最近使用时间；表满 5 条时挤掉最久没用的那条，回包 `warnings` 点名挤掉了谁 —— 告诉用户）。

- 目录必须**已经存在**（剪映自己建的），这里从不替用户新建；只新建自己的工程目录（和做到一半时的 `.<工程名>.partial` 暂存目录），不覆盖、不删目录里别的任何东西（没有 `--overwrite`）。它不能是符号链接 / 联接点、盘符根、用户主目录或系统目录。
- 回包 `draftRoot` 就是这个目录，`outDir` 是 `null`，`projects[].dir` 是工程目录名；workspace 里**不另留一份**。`remembered` 说登记成功没有（没成功只是下次还得问用户、不影响这次的工程）。
- 已经导在 workspace 里（`产出/剪映工程/`）的，要送进剪映：同样的 `--episode` / `--name` 加 `--draft-root` 再导一次 —— 素材从 workspace 里的旧工程硬链接（跨盘就复制），不重下。

用户暂时不给目录、或者只要一份放在项目里的：不带 `--draft-root`，写进会话 workspace 的文件树 —— 不打 zip、不走浏览器下载：

```json
["export-jianying"]
```

默认写到 `产出/剪映工程/`。时间线上有片段标题带 `epNN` 就**每集一个工程**（`<剧名>_EP01_<时间戳>/`；没有集号的片段进 `<剧名>_其他_<时间戳>/`，不丢），一段都没有（广告片、MV）就**一个工程**（`<剧名>_<时间戳>/`）。每个工程目录里是一份完整的剪映草稿（`draft_content.json` 等 10 个文件）加 `assets/video/` 里的**整段**素材：片段只记入出点，用户在剪映里能把裁过的片段拉回完整长度。转场、字幕轨、音量**照时间线上片段的数据写**（没写就是硬切、没有字幕轨、原声），导出这一步不加任何默认；要转场 / 字幕 / 音量，先把它们写到时间线的片段上。

大导出先看计划（只问素材大小，不下载、不建目录；带 `--draft-root` 也一样，表外目录还会提醒要先问用户）：

```json
["export-jianying", "--dry-run"]
```

回 `projectCount`、每个工程的 `clips`（段数）/ `bytes` / `dir`，以及 `totalBytes`（要下的素材总字节，`reusableBytes` 是本地已经有、不用再下的）。几个 GB 的导出**按集分批**发，让每一条都在宿主的超时里做完：

```json
["export-jianying", "--episode", "EP01", "--episode", "EP02"]
```

- 只导一集 / 「其他」那一组：`--episode EP03` / `--episode 其他`（写法与 timeline 相同：`EP01` / `ep1` / `1` / `unknown`；逗号分隔也行）。
- 改组织方式：`--layout single`（全部放进一个工程）/ `--layout episodes`（按集）。不写就按整条时间线的片段标题推（有集号就按集），带不带 `--episode` 都一样 —— 与导出按钮的分集页相同。
- 剧名缺省是画布标题，要换：`--name 剧名`。写到 workspace 里别处：`--out-dir 交付/剪映`（workspace 里的相对路径；与 `--draft-root` 二选一）。

回包逐个工程给 `status`：`ok` = 这个工程写好了；`partial` = 有素材最终下载失败（或下到的不是视频），它还在 `.<工程名>.partial/` 暂存目录里（workspace 的 `产出/剪映工程/` 或剪映草稿目录下）、剪映不当它是草稿，`failedNodeIds` 是出问题的片段的来源节点。整条回包此时是 `ok:false`、`error.code:"export_partial"`，`error.retry` 是**只重导没做完的工程**的 argv（带着原来的 `--draft-root` / `--approved`）：修好片段（或等网络恢复）后原样发它 —— 已经下好的素材不重下，暂存目录接着用。

**回包 `ok` 只说明文件都写好了，不代表剪映一定能打开。** 直写的：请用户重启剪映（草稿列表不会自动刷新），在首页找到这几个工程逐个打开核对。写进 workspace 的：剪映还看不到它，按上面两步用 `--draft-root` 再导一次送进剪映。两种都**不要让用户移动工程目录**：草稿里的素材按 `draftRoot` 下的**绝对路径**引用，工程目录或素材一旦移走、改名或删掉，剪映里对应片段就会素材离线。

回包 `warnings` 里点名「视频编码是 …」的片段：那段素材的视频编码不在浏览器导出支持的范围里（H.264 / H.265 / VP8 / VP9 / AV1 / ProRes 以外，例如 MPEG-4 Part 2 的 mov —— 页面上的导出按钮导不了它）。CLI 不拦、照常写进了工程，但**剪映能否播放以真机为准**：把这几段念给用户，请他在剪映里重点看；播不了就换一个 H.264 编码的版本替换这段再导。

回包 `warnings` 里说「同一时刻叠在一起的字幕超过 4 条」：一个工程最多写 4 条字幕轨（重叠的字幕一条轨上移一行，再多会被推出画面），同一时刻叠了 5 条以上时多出的那几条没有写进草稿，句子里点名丢了几条、最早一条在时间轨第几秒。工程照常可用；把这句念给用户，让他在剪映里手动补，或者先把那一段的字幕错开时间再导。这条提醒只有正式导出的回包里才有：`--dry-run` 不下载素材、量不出每段的真实长度，不检查字幕叠了几条，它没提醒不代表不会丢。

- ✅ 正确：`["jianying-roots"]` → 把 `table` 念给用户 →（他选了第 1 条）`["export-jianying","--draft-root","<那条的 path>"]` → 告诉用户工程名，请他重启剪映在首页打开核对。
- ✅ 正确：用户说「导到 E:\剪映草稿」（表里没有）→ 念给他「我要把工程直接写进 E:\剪映草稿，对吗？」→ 他同意 → `["export-jianying","--draft-root","E:\\剪映草稿","--approved"]`。
- ✅ 正确：大导出先 `["export-jianying","--draft-root","<路径>","--dry-run"]` → 把工程数、每个工程几段、总共多大念给用户 → 正式导（大就按集分批）。
- ✅ 正确：回 `export_partial` → 按 `failedNodeIds` 找到是哪几段（`read` 那几个节点）→ 修好后原样发 `error.retry`。
- ✅ 正确：要转场 / 字幕 / 音量 → 先写进时间线上的片段，再导出。
- ❌ 错误：用户没点头就给表外的路径加 `--approved`；回 `approval_required` 就自己补上 `--approved` 重发 → `--approved` 是「用户已经同意写进这个目录」的声明，不是开关。先念路径、等用户同意。
- ❌ 错误：回 `invalid_path` 就换成上一级目录、盘符根或者自己建一个目录重导 → 看 `error.reason`：`not_found`（路径不对 / 目录还不在）、`symlink`（中间一级是符号链接或联接点）、`realpath_changed`（经过了挂载点 / 映射盘）、`drive_root` / `home_dir` / `system_dir`（不许直写的地方）、`not_absolute`。把 `error.message` 念给用户，请他照剪映「全局设置 → 草稿位置」里显示的原样给。
- ❌ 错误：`--draft-root` 配 `--out-dir` 或 `--overwrite` → `invalid_argument`。直写从不覆盖：同名工程已在（同一秒重导）就换一个 `--name`。
- ❌ 错误：子代理发 `jianying-roots` 或 `export-jianying --draft-root` → `worker_forbidden`。直写用户的剪映目录只由主 Agent 做：把要导的集写进汇报。
- ❌ 错误：让用户把剪映「草稿位置」改成 workspace 里的目录，或者让他把 workspace 里的工程**移动**（剪切）到剪映草稿目录 → 前者改的是剪映的全局设置（他原来那些草稿可能就不在首页了），后者素材一移走就离线。要送进剪映就 `--draft-root` 重导。
- ❌ 错误：**自己拼 `draft_content.json`、往工程目录里手写或改草稿文件、往剪映草稿目录里手工拷东西** → 字段对不上剪映 5.9 就打不开，而且和素材路径、`draft_meta_info.json` 对不上。剪映草稿只由这条命令生成。
- ❌ 错误：用 `download` 把素材一段段下下来、自己搭目录 → 那不是剪映工程；更不要把素材剪短（剪映里就拉不回完整片段了）。
- ❌ 错误：把工程 `assets/video/` 里的素材 `upload` 回画布 → 几个工程共用的素材是**硬链接**（同一份磁盘，链接数大于 1）；只被一个工程用的素材，重跑时复用了 out-dir 里上一次导出的同一份之后也可能是硬链接。`upload` 按安全规则拒收（`workspace_boundary`「Expected an independent regular file」：链接数大于 1 的文件可能链着 workspace 外的文件，一律不上传）。这些素材本来就是画布上的视频节点，要用就用原节点；真要上传，先复制成一个独立的新文件再传。
- ❌ 错误：写进 workspace 时回 `file_exists` 就加 `--overwrite` 重发 → 会覆盖同名工程里的草稿文件（用户可能已经在剪映里改过）。先换 `--name`；只有用户同意覆盖才加 `--overwrite`。
- ❌ 错误：`export_partial` 之后不带 `--episode` 整条重发 → 已经写好的工程会再多出一份（新时间戳）。发 `error.retry`。
- ❌ 错误：回 `jianying_refused` 还原样重发 → 那是时间线本身的问题（`error.reason`：`unsupported-container` 容器不对、`separate-audio` 挂了独立配音、`invalid-transition` 转场放不下、`too-many-clips` 一个工程超过 200 段、`untrusted-host` 素材地址不在白名单、`empty-timeline` 时间线是空的），照 `error.message` 改时间线。
- ❌ 错误：回 `bridge_missing` 就放弃 → 那是页面太旧（没有 `timeline_export` / `jianying_roots_list`）：请用户刷新画布页面，再发一次。
- ❌ 错误：回 `workspace_boundary` / `draft_root_boundary` 就换个目录或加 `--overwrite` 硬导 → 那是要写进去的目录（`--out-dir` 的某一级、工程目录、`.partial` 暂存目录或它们的 `assets/`）里有符号链接，`error.path` 指出是哪一级；导出已经停下，没有顺着它往外写。把这个路径告诉用户，请他删掉那个链接后再导。

## 17d. 文档库：「把第 3 集剧本给我看看」「第 3 集第 2 场那句台词改一下」「把镜头表存进文档库」「用户上传的小说在哪」

画布左栏的「文档库」归**项目**（同项目下所有画布共享）：剧本、剧情大纲、全局骨架、人物档案、剧本圣经、镜头表、拉片台账 / 报告、用户上传的小说都在这里，而且**只在这里** —— 它是这些文字的唯一源数据，没有本地副本、没有同步。读就是读库，改就是带版本号**原地改**。面板分两栏：`script`（剧本栏：要拿去生产的剧本，反推剧本也在这里）和 `reference`（参考资料：其余一切；上传的小说一部一个文件夹，每章一篇）。

| 要做什么              | 命令（argv 见下）                                                              | 档                       |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------ |
| 列、搜                | `docs ls --section script --episode 3`                                         | L0，worker 也能发        |
| 读全文                | `docs read DOC-ID`（手上有第 N 版就加 `--if-version N`：没变不传正文）         | L0，worker 也能发        |
| 列文件夹 / 整夹存下来 | `docs ls --folders`、`docs read --folder 名或ID --out-dir 目录`                | L0，worker 也能发        |
| 新建一篇              | `docs create --type TYPE --file 正文.md`                                       | L1，只有主会话           |
| 原地改（一处 / 整篇） | `docs update DOC-ID --expect-version N --patch DIFF`（或 `--file` / `--text`） | L1，只有主会话           |
| 删除                  | `docs delete DOC-ID --approved`                                                | L3，只有主会话，先问用户 |

先列（`--section script` / `reference`、`--type`、`--episode`、`--folder`、`--q` 都能筛）：

```json
["docs", "ls", "--section", "script", "--episode", "3"]
```

回读 `items[]`：每篇的 `id`、`docType`、`episode`、`version`、`title`、`folder`、`summary`，以及排好的 `table`（直接念）。翻页看 `nextOffset`（`--offset`）。

读全文：

```json
["docs", "read", "script:ep:03"]
```

回读 `document.content`（正文，没有任何头信息）和 `document.version`（改的时候要带）、`document.contentSha`。`document.contentUrl` 是这一版正文文件在 CDN 上的链接（每个版本存成一个 `.md` 文件）：只给人在预览窗里看，**读正文就用 `docs read`，别自己去取链接，也别把链接发给任何人**（拿到链接就能打开）；还没搬到 CDN 的旧文档是 `null`。已经读过、只想知道变没变（比如隔一会儿再看剧本有没有被改）：`["docs", "read", "script:ep:03", "--if-version", "4"]` —— 还是 v4 就回 `notModified:true`、不传正文（接着用手上那一版），变了照常回全文。只想存到 workspace 里慢慢看：`["docs", "read", "script:ep:03", "--out", "看/第3集.md"]`（`看/` 不在会自动建）—— **那只是临时阅读副本**，改它不会回到文档库。

只改一处（改一句台词、一场戏）：做一段 unified diff（`diff -u` 的格式，`---` / `+++` 头可有可无），`--expect-version` 写**刚读到的** `version`：

<!-- prettier-ignore -->
```json
["docs", "update", "script:ep:03", "--expect-version", "4", "--patch", "@@ -12,1 +12,1 @@\n-她推门进来。\n+她猛地推门进来。\n"]
```

整篇换掉：`["docs", "update", "script:ep:03", "--expect-version", "4", "--file", "剧本/第3集.md"]`（`--file` 是会话 workspace 里的 UTF-8 正文文件；短的用 `--text`）。只改标题 / 摘要 / 来源：`--title`、`--meta '{"summary":"…"}'`。回包 `summary` 一句话说清新版本号；`unchanged:true` = 内容和字段都没变，没写新版本。

新建一篇（智能体产出：第 5 集剧本、第 5 集镜头表、一份拉片报告）：

```json
["docs", "create", "--type", "script", "--episode", "5", "--file", "剧本/第5集.md"]
```

不给 `--id` 就由文档库按规则起：有集号 → `script:ep:05` / `shotlist:ep:05`；一个项目一份的类型 → 类型名本身（`outline`、`skeleton`、`characters`…）；其它 → 类型 + 标题。要固定 id 就 `--id lap-report:狂飙01`（id 最多 20 字）。`--title` 不给就取正文第一个 `#` 标题（再没有就取文件名）。反推剧本也是 `--type script`，来源写进 `--meta '{"source":"拉片反推：狂飙第1集"}'`；全局骨架是 `--type skeleton`（参考资料，不算剧本）。`--type` 的全部取值与各自的中文名见下半部分的 `` ## Project documents: `docs` `` 一节。

删除（先把要删的那一篇念给用户，同意了才发）：

```json
["docs", "delete", "note:旧大纲", "--approved"]
```

- ✅ 正确：`docs read` 拿到 `version` → 在这一版的正文上改 → `docs update … --expect-version <这个 version>`。
- ✅ 正确：回 `upload_failed`（正文文件没存上，什么都没写）或 `content_unavailable`（正文文件取不回来，或取回来的不是这一版的正文 —— 服务端按 `contentSha` 校验过，不会把错内容当正文回给你）→ 文件服务一时不可用（`retryable: true`）：过一会儿**原样**再发同一条命令；连着几次都这样就告诉用户，别换成别的写法。
- ✅ 正确：回 `quota_exceeded`（项目里没删的文档正文合计会超过 50 MB，什么都没写；`error.usedBytes` 是现在的合计、`error.limitBytes` 是上限）→ 原样重发没用：告诉用户项目文档满了，请他删掉不用的文档（或把这一篇改短）再写；只改标题 / 摘要、把正文改短照常写得进。
- ✅ 正确：回 `invalid_argument`（CLI 本地就挡下了，什么都没发）或 `invalid_request`（页面 / 服务端挡下，什么都没写）→ 看 `error.path` 是哪个字段（`content` —— `--file` / `--text` / `--patch` 的正文、`title`、`sourceAgent`、`id`、`expectVersion`、`meta.<键>` —— `--meta` 里不许设的键……）；正文或字段里有 `\u0000` / 半个 emoji 时另带 `error.position`（第几个字，换行统一 LF 之后数）→ 只改那一处再发。原样重发还是同一个错。
- ✅ 正确：回 `doc_conflict` → 别人（或别的智能体）刚改过：`["docs","read","DOC-ID"]` 重读（错误里的 `currentVersion` 就是现在的版本）→ 在新正文上重做这一处 → 带新版本号再 `docs update`。
- ✅ 正确：同一篇再 `docs create` 回 `doc_conflict`（「already exists」）→ 它已经在库里了，改它就 `docs update`。
- ✅ 正确：不带 `--id` 的 `docs create` 回 `doc_conflict` 且带 `suggestedId`（「already used by another document」）→ 标题长、截断后的 id 撞上了**另一篇**（错误里的 `id`）：那一篇不是你的，照原样再发一次、加上 `--id <suggestedId>`（或自己起一个）。
- ✅ 正确：带 `--id` 的 `docs create` 回 `doc_conflict`（「already used by "…"」）→ 这个 id 已经有一篇了：先 `docs read` 看它，确实是你要的那一篇才 `docs update`；不是就换个 `--id`。
- ✅ 正确：回 `doc_conflict` 带 `deleted:true`（「was deleted」/「was used before by "…", which has been deleted」）→ 那一篇已经被删了：改不了，它的 id 也不拿来新建（历史归那一篇）。先告诉用户；要写回来就不带 `--id` 新建（集号 / 一个项目一份的类型会复活原来那一篇、历史接上），或换一个 `--id`。
- ✅ 正确：小说在参考资料栏的文件夹里，一章一篇。先看有哪些文件夹（名字、id、章数、更新时间）：`["docs", "ls", "--folders"]`；整部读就一次存下来，每章一个文件（带序号与标题，章节顺序）：`["docs", "read", "--folder", "novel:k3x9", "--out-dir", "读/海巫"]`（`--folder` 写名字也行，两栏重名时只能用 id）—— 回包 `files[]` 列出每个文件和它那一篇的 `id` / `version`。只看某几章：`["docs", "ls", "--section", "reference", "--folder", "海巫"]` 再按 `id` 逐章 `docs read`。
- ❌ 错误：`docs read --folder` 存下来的那些文件改完就当改了文档库 → 那些都是临时阅读副本；要改哪一章就对那一章的 `id` 用 `docs update`（带它的 `version`）。回 `file_exists` 就换一个 `--out-dir`，确认可以覆盖才加 `--overwrite`（有一个已存在的文件就一个都不写）。
- ❌ 错误：把文档 `docs read --out` 到 workspace、改完再 `docs create` 成一篇新文档 → 文档库里多出一份，下游还在读旧的那份。**改就 `docs update`，原地改。**
- ❌ 错误：回 `doc_conflict` 就把 `--expect-version` 改成新版本号、拿自己手上的旧正文硬写 → 把别人刚写的那一版整篇覆盖掉。必须先重读、在新版本上重做。
- ❌ 错误：回 `doc_conflict` 带 `suggestedId` 时去 `docs update` 错误里的那个 `id` → 那是另一篇文档，会被你的正文整篇覆盖。
- ❌ 错误：以为 `docs read --out` 存下来的文件和文档库是同步的 → 改它什么都不会发生。
- ❌ 错误：去操作画布上的文档预览窗 / 编辑框改文档 → 那是给人用的；智能体改文档只走 `docs update`（带 `--expect-version`）。
- ❌ 错误：回 `too_large`（一篇正文最多 50,000 字：`error.chars` 是这次的长度、`error.limitChars` 是上限；CLI 发出去之前、页面、服务端回的都是这个码、这两个数）就原样再发一次 → 拆成几篇（比如一集一篇）分别 `docs create`。
- ❌ 错误：以为 `undo` 能撤掉 `docs update` / `docs create` → 撤不了：文档库不在画布的撤销栈里。服务端保留每一版的历史，回滚接口后续提供；今天要退回，只能拿改之前读到的旧文字再 `docs update` 一次（所以改之前先 `docs read`）。
- ❌ 错误：worker 发 `docs create` / `docs update` / `docs delete` → `worker_forbidden`：worker 只读文档库，请主 Agent 写。
- ❌ 错误：没问用户就 `docs delete … --approved` → `--approved` 是声明「用户已经同意删」，不是给自己开的票。
- ❌ 错误：把小说原文、每一镜的视频提示词、剪映工程往文档库里塞 → 小说由用户在面板上传（成文件夹），提示词在画布节点上，剪映工程走 `export-jianying`。

## 18. 连接、权限、收尾：「连上了吗」「怎么写不进去」「就这些了」

宿主一般已经连好。先问状态——它也是命令卡住、回 `page_away` 时的第一步：

```json
["status"]
```

`state` 是 `connected` 就直接干活；`reconnecting` 看 `pageAway` / `queuedCommands`，让用户把画布页面切到前台。没连上才配对（工作目录必须已存在，`connectionCode` 整串交给用户去画布右上角「连接 Agent」粘贴）：

<!-- prettier-ignore -->
```json
["connect", "--origin", "https://SCENEMINT-地址", "--name", "任务名", "--workspace", "/绝对路径/工作目录"]
```

**写之前先看能不能写**（用户角色是 viewer 时每条写命令都会 `read_only`）：

```json
["list-canvases"]
```

回读 `role` 与 `readOnly`——现问现读，别缓存：用户的角色在会话开着的时候就能被改。

任务做完了：

```json
["turn-end"]
```

- ✅ 正确：命令卡住 / 回 `page_away` → `["status"]` → 告诉用户「请把画布页面切到前台（刷新也行）」→ **不要重发写命令**，它会自动执行一次。
- ✅ 正确：准备一大批编辑之前先 `["list-canvases"]` 看 `readOnly`，是 `true` 就直接告诉用户，别一条条撞 `read_only`。
- ❌ 错误：任务还没做完就 `["disconnect"]` / `["stop"]` → 连接没了，用户得重新配对。做完发 `turn-end`，连接留着。
- ❌ 错误：换一张画布还用老连接 → 一个连接只对一张画布。重新 `connect` 配对，再 `["status"]` 核对 `canvasId`。
- ❌ 错误：任何命令的 argv 里自己写 `--session` → `SESSION_NOT_ALLOWED`，什么都没执行。宿主自动注入。
- ❌ 错误：worker 自己发 `connect` 建新的主连接 → worker 只用宿主给的身份。

## Main and delegated worker sessions

One connection = one canvas. To work on another canvas, `connect` and pair again, then check `status.canvasId` before reading or writing. Disconnecting one connection leaves the others alone.

A host that keeps a session across its own restarts must not trust its file: `connect --session ID` (with the usual `--origin/--name/--workspace`) reuses the session only when the daemon process is alive and the page is `connected` or has been away less than 60 s (`reused:true`, no new code), and otherwise retires it and mints a fresh one in the same call (`reused:false`, `replaced:{sessionId,reason}`, a new `connectionCode` to paste). `status` on a dead daemon answers `connection_failed` with `daemonPid` and `daemonAlive:false`.

A worker session is created by the host (`delegate`, see the last section for the raw form) and shares the paired canvas, main identity and undo history; its file boundary is its own workspace. Workers may read / search / inspect / download node media, run `export-jianying` into their own workspace (its read-only `timeline_export` is the one timeline read a worker may make) and make ordinary `apply` edits. They may also read the project document library (`docs ls` / `docs read`). They cannot `upload_asset` / `export_output`, `delete_output` / `clear_output` / `recover_deleted`, approve a bulk delete (`apply --approved`), run / cancel, undo / redo, inspect operations or use `timeline` (any op), write or delete documents (`docs create` / `docs update` / `docs delete`), list or write the user's Jianying draft folders (`jianying-roots`, `export-jianying --draft-root` — `jianying_roots_list` / `jianying_roots_touch` are main-only), delegate, or revoke. A delivered operation may still finish after revocation (`unknown_outcome`); revocation is not rollback.

---

# CLI command reference

Every canvas command runs under a session the host injects (see the last section for direct binary use). Output is JSON; success may be a business object without an `ok` field. An `ok:false` result has an `error.code` and `error.message`. Exit codes are 0 success, 1 business failure, 2 arguments or file boundary, 3 connection/authentication, and 4 unknown outcome. `scenemint-canvas help` lists every command; `scenemint-canvas COMMAND --help` lists that one command's own flags and its wire method.

Switches are checked against the command. An option this command does not read is `invalid_argument`, not a silently dropped argument, and the message names the nearest legal flag. Two consequences worth knowing before you guess a switch: `ls` pages with `--after CURSOR` (only `grep` and `read` take `--offset`), and `cancel-batch` scopes with `--batch BATCH-ID` — a bare `cancel-batch` drops the unsubmitted nodes of **every** batch this session started. `snapshot --limit N` is the CLI spelling of `maxNodes`. Because help and this checking are generated from one table, a switch shown by `--help` is always one the command actually reads.

`--json OBJECT` or `--file workspace.json` supplies the complete parameter object. `--file -` reads JSON from stdin. Do not include `role`, `actor`, `scope`, `canvasId`, `projectId`, `agentId`, `turnId`, `sessionId`, or `parentSessionId` inside it; the authenticated session controls scope and identity. `--turn NAME` groups commands and `--request-id UUID-v4` identifies one logical request owned by this caller session. The default turn ID is the generated request ID. Always keep a supplied request ID and its payload together; another worker or the parent cannot retrieve its cached result.

## Hard limits every call is checked against

The first eleven rows are enforced by the daemon **before** the request reaches the page (`src/policy.mjs`), so a batch that breaks one of them fails whole having never been delivered; from `read.paths` down they are the page's own gates and fail the same way, whole and with nothing written. Either way there is no partial effect, and none of them is negotiable by retrying.

| Where                                                   | Limit                                                                                                                                                                                                   | What a breach returns                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apply.commands`                                        | **1..1000** commands per batch                                                                                                                                                                          | `invalid_request` "apply requires 1..1000 commands"                                                                                                                                                                                              |
| `apply.commands[].type`                                 | one of the thirty names below                                                                                                                                                                           | `invalid_request` "Unknown or nested apply command"                                                                                                                                                                                              |
| `apply.commands[].<key>`                                | only the fields that command declares                                                                                                                                                                   | `invalid_request` "Unexpected `<type>` field: `<key>`"                                                                                                                                                                                           |
| any command payload                                     | plain JSON, ≤ 40 levels deep, no `commands` / `__proto__` key inside                                                                                                                                    | `invalid_request` "Nested or unsafe command field"                                                                                                                                                                                               |
| `run_nodes.nodeIds`                                     | **1..1000** non-empty strings, each ≤ 1024 chars                                                                                                                                                        | `invalid_request` "nodeIds must be 1..1000 non-empty strings"                                                                                                                                                                                    |
| `run_nodes` / `run_node` `approval.userApprovedNodeIds` | **1..1000** non-empty strings, each ≤ 1024 chars; no other key in `approval`                                                                                                                            | `approval_required`                                                                                                                                                                                                                              |
| `run_nodes.concurrency`                                 | integer 1..200 (default 24)                                                                                                                                                                             | `invalid_request`                                                                                                                                                                                                                                |
| `scene3d_apply.actions`                                 | **1..200** actions, each with a known `op` and only that op's fields                                                                                                                                    | `invalid_request` "scene3d_apply requires 1..200 actions" / "Unknown scene3d action op" / "Unexpected scene3d `<op>` field: `<key>`"                                                                                                             |
| `run_node` params                                       | only `nodeId` `approval` `clearCandidates` `shotId` `frame` (`RUN_NODE_FIELDS`); `shotId` a non-empty string ≤ 128 chars; `frame` `start` or `end`                                                      | `invalid_request` "Unexpected run_node field: `<key>`" / "frame must be start or end" (checked after `approval`: a missing / wrong approval is still `approval_required`)                                                                        |
| `run_stills` params                                     | only `nodeId` `shotIds` `frames` `force` `approval` (`RUN_STILLS_FIELDS`); `shotIds` 1..60 distinct non-empty strings ≤ 128 chars; `frames` 1..2 distinct of `start` / `end`; `force` a boolean         | `invalid_request` "Unexpected run_stills field: `<key>`" / "shotIds must be 1..60 …" / "shotIds must not repeat a shot" / "frames must be 1..2 of start, end, without repeats" / "force must be a boolean" (after `approval`, as for `run_node`) |
| `run_shot_refs` params                                  | only `nodeId` `shotIds` `force` `approval` (`RUN_SHOT_REFS_FIELDS`, 0.18.0); `shotIds` 1..60 distinct non-empty strings ≤ 128 chars; `force` a boolean                                                  | `invalid_request` "Unexpected run_shot_refs field: `<key>`" / "shotIds must be 1..60 …" / "shotIds must not repeat a shot" / "force must be a boolean" (checked after `approval`)                                                                |
| `read.paths`                                            | 1..20 paths                                                                                                                                                                                             | `invalid_request` "paths 一次最多 20 个"                                                                                                                                                                                                         |
| `scene3d_apply` scene size                              | objects ≤ 100, cameras ≤ 12, shots ≤ 60 per scene                                                                                                                                                       | `invalid_command` "a scene holds at most 100 objects" (cameras / shots alike)                                                                                                                                                                    |
| `run_stills` stills per call                            | ≤ 120 (shots × frames, `CANVAS_CONTRACT.scene3d.limits.stillsPerRun`); the page answers within 90 s (`stillsBudgetMs`)                                                                                  | `invalid_request` "一次最多出 120 张…：用 shotIds 分批"; past the budget the rest come back in `skipped` (reason `budget`) and `remaining`, not as an error — send the same command again                                                        |
| `run_shot_refs` time per call                           | per shot 25 s for each still + 15 s and 250 ms a frame for the previz, capped at 240 s (`CANVAS_CONTRACT.scene3d.limits.shotRefsBudgetMs`); the daemon and the CLI wait 255 s for it (`shotRefsCallMs`) | past the budget the rest come back in `skipped` (reason `budget`) and `remaining`, not as an error                                                                                                                                               |
| `ls.limit` / `grep.limit`                               | 1..500 (defaults 200 / 100)                                                                                                                                                                             | clamped, not an error                                                                                                                                                                                                                            |
| `resources.limit` / `resources.offset`                  | limit 1..200 (default 100); offset a nonnegative integer (default 0)                                                                                                                                    | `invalid_request` "resources requires limit 1..200 and a nonnegative integer offset"                                                                                                                                                             |
| `upload_asset.bytesBase64`                              | 25 MiB decoded (26,214,400 bytes)                                                                                                                                                                       | `too_large`                                                                                                                                                                                                                                      |
| `docs` document id                                      | ≤ 20 chars, `CANVAS_CONTRACT.documents.idPattern`                                                                                                                                                       | `invalid_argument` locally; `invalid_request` from the daemon / page                                                                                                                                                                             |
| `docs create` / `docs update` text                      | ≤ 50,000 characters per document, counted after line endings are normalized to LF (`CANVAS_CONTRACT.documents.contentMaxChars`)                                                                         | `too_large` with `chars` / `limitChars` — the CLI before sending, the daemon, the page and the server alike                                                                                                                                      |
| `docs ls --limit`                                       | 1..200 (default 50)                                                                                                                                                                                     | `invalid_argument` / `invalid_request`                                                                                                                                                                                                           |
| HTTP body                                               | 36 MiB                                                                                                                                                                                                  | transport-level rejection                                                                                                                                                                                                                        |

Clamping is the exception, not the rule: **only `ls.limit` and `grep.limit` are clamped into range.** Every other row above is a refusal, and `resources` in particular refuses rather than clamps — neither the CLI nor the daemon touches the number, so `--limit 500` on `resources` reaches the page and comes back `invalid_request`, not a page of 200.

## 命令卡住 / 页面刚升级：`page_away`

页面不在（用户刷新、升级、切走、浏览器重启）时守护进程进入 `reconnecting`，最多等它十分钟回来。命令不会在这段时间里静默挂着：

| 命令类型                                                                                                                                                                                                                                                    | 页面不在时                                                                                      | 你该做什么                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 只读（`ls` `read` `grep` `snapshot` `health` `tasks` `resources` `models` `inspect-media` `download` `docs ls` `docs read` `jianying-roots`）                                                                                                               | ≤ 5 秒回 `page_away`，`queued:false`、`outcome:"not_sent"`，**没排队**                          | 等页面回来再发（先 `status` 看 `pageAway`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 写（完整清单：`apply` `tidy` `resize-group` `upload` `run` `run-batch` `run-stills` `run-shot-refs` `run-tool` `cancel` `cancel-batch` `undo` `redo` `turn-end` `docs create` `docs update` `docs delete` `timeline`；timeline 只有 op 不是 list 时才排队） | 排队；`--wait-ms`（默认 30000）后回 `page_away`，`queued:true`、`outcome:"queued"`、`requestId` | **不要重发**。页面回来它会自动执行一次；用同一个 `--request-id` 再发一遍 = 取结果。`--wait` 一直等到恢复窗口结束（清单里的每一条都接 `--wait` / `--wait-ms`）。**宿主可能禁用 `--wait`**：这些命令本身收它，但把 CLI 包成工具的宿主有权拒（它自己的工具调用有超时，一个能阻塞十分钟的参数会把整轮对话挂死）。被宿主拒了就按宿主的话走，不要换着写法重试——发 `--wait-ms`（或什么都不加，默认 30000）拿到 `requestId`，然后轮 `["status"]` 看 `pageAway` / `queuedCommands`，页面回来后用**同一个** `--request-id` 再发一遍取结果 |

```json
["status"]
```

回读 `pageAway`（true = 页面不在）、`queuedCommands`（排队中的写命令数）、`pageLastSeenAt`（最后一次听到页面）、`resumeExpiresAt`（过了这个时间会话就结束）。

- ✅ 正确：`apply` 回 `page_away` + `queued:true` → 「画布页面暂时离线，这条修改已排队，请把画布切到前台，回来后会自动应用」→ 页面回来后 `["apply","--json","…同样的内容…","--request-id","同一个 id"]` 取结果。
- ❌ 错误：回 `page_away` 就换个 id 重发 `run` → 页面回来后同一个节点跑两次、付两次费。
- ❌ 错误：`resumeExpiresAt` 已过还在等 → 会话已结束（`not_connected`），让用户重新连接。
- ✅ 正确：用户说画布标签页关了、在新标签页里重开了（或过了 `resumeExpiresAt` 页面还没回来）→ 新标签页接不回这个会话（配对凭据只在原标签页里）→ 重新发 `connect` 配对（宿主里 argv 不写 `--session`，宿主带着本会话去探活；没有宿主、直接跑 CLI 时写成 `connect --session <本会话 id>`）：回 `reused:false` 时它停掉旧会话、连同排队的命令一起丢掉，再给新的连接码；回 `reused:true` 只说明页面不到一分钟前还在（关标签后守护进程要约 1–2 分钟才认），用户确认关了就过一分钟再发同一条 `connect`，直到回 `reused:false` 带新的连接码（connectionCode）。新会话里写命令先 `ls` / `read` 看生效没有再决定重发（三维出片可以原样重发，已出的镜头复用）。`status` 与 `page_away` 回包的顶层 `hint` 都写着这一支。
- ❌ 错误：光凭 `status` 一直 `reconnecting`、`pageAway:true` 就当标签页关了 → 被浏览器丢弃、刷新的标签页也是这样，回来会自己续上、把排队的写命令执行一次。
- ❌ 错误：在宿主里给 `connect` 自己加 `--session` → `SESSION_NOT_ALLOWED`；直接跑 CLI 时用不带 `--session` 的 `connect` 重新配对、再把写命令原样重发 → 旧会话和它排队的命令还活着，原标签页回来又执行一次（节点建两个、付两次费）。

## Find and read

| Command         | JSON parameters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list-canvases` | `{}`; only the paired canvas, with its live `role` and `readOnly`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ls`            | `path`, `glob`, `kind[]`, `status[]`, `hasOutput`, `tag[]`, `long`, `limit` (1–500), `after`; a `long` scene-3d row adds `sceneDigest` and `shotCount`; a `long` row of a `run-stills` still adds its `stillOf` (`replaced:true` once its picture was swapped)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `read`          | `paths` (1–20 node IDs or paths), optional `offset`, `limit` for one text field; a group returns `memberIds`; a scene-3d node returns `scene` (degrees), `sceneDigest`, `checks`, `objectCount` / `cameraCount` / `shotCount` and, with a still, `outputUrl` / `renderedDigest` / `renderedShotId` / `renderedFrame` / `stale`; `NODE/scene` reads only the scene part (so a business path whose last segment is literally `scene` must be read by node id, like `params` / `output` / `tags`; `/scene` on any other kind is `invalid_request`). 0.17.0 suffixes on a scene-3d node: `NODE/renders` (one row per shot card: `{shotId, n, output, nodeId, title, mediaType, outputId, url, posterUrl?, durationMs?, stale, state}`, `state` = `rendering` / `landed` / `failed`; an empty array = nothing rendered yet), `NODE/timeline` (`{total, shots[], acts[]}`, the same block an `apply` reply carries), `NODE/checks` (every shot's self-checks incl. `framing` / `motion`) and `NODE/framing` (the framing grid mode); a whole-node `read` adds `renders` / `timeline` only when there are cards / acts. A page older than the CLI lists an unknown suffix in `missing[]` — ask the user to refresh the canvas tab |
| `resources`     | `nodeId`, optional `limit` (1–200), `offset` from `nextOffset`; all candidate/history/reference/current media                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `grep`          | `pattern`, `fixed`, `ignoreCase`, `fields[]` (+ `tags`), `path`, `glob`, `kind[]`, `status[]`, `tag[]`, `filesOnly`, `count`, `limit`, `offset`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `snapshot`      | `maxNodes` (default 200, hard ceiling **2000**), `timeline`, `nodeIds[]`, `kinds[]`, `around:{nodeId,depth:1}`, `edges` (`all` default / `touching` = only edges with an end among the returned nodes / `none`; CLI `--edges`, echoed as `edgeScope` — send `touching` whenever you read a group of nodes by `nodeIds`). A clamped reply carries `truncated:true` **and** `omittedNodes:N` — a health check over a partial list is a wrong answer, so raise `maxNodes` or narrow the selection. A group row adds `bounds`, `memberIds`, `membersBounds` (the members' rendered box) and `frameOversize:true` when the frame is more than 3× the area its members need. A scene-3d row's `summary` is `{objectCount, cameraCount, shotCount, outputMode, url?, sceneDigest, stale}`. The reply carries **both** counters, `rev` and `seq` — see 「`rev` 和 `seq` 是两个计数器」 below                                                                                                                                                                                                                                                                                                                                       |
| `health`        | `maxIssues` (default 100, at most 1000 rows of detail), `groupMinMembers` (defaults to the contract's `group_nodes.minMembers`). Read-only and idempotent. The scan is **the whole canvas** — `scanned:{nodes,groups,edges}` says how much it looked at, and it is NOT bounded by snapshot's node ceiling. `truncated:true` / `omittedIssues:N` are only ever about the `issues[]` **detail list**; `counts` stays complete. See 「11c. `health`」 below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `changes`       | `sinceSeq` **and `sinceEpoch`** (both come from the previous reply; a `sinceSeq` sent without its `sinceEpoch` always answers `truncated`). Reply is `{seq, epoch, entries[], truncated?, truncatedReason?}`. **`truncated:true` invalidates the whole delta, `entries:[]` included** — see 「What `changes` can and cannot tell you」 below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `tasks`         | `nodeIds[]`, `status[]` (queued/running/succeeded/failed/cancelled), `submitter` (me/agent/human), `since` (ISO), `scope` (canvas/project/all), `limit` (1–500), `after`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `operations`    | `{}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### `rev` 和 `seq` 是两个计数器

回包里有两个数字，**不可互相比较**，各管各的问题：

| 计数器 | 谁让它涨                                                                 | 回它的命令                            | 用来回答                                                                                                                        |
| ------ | ------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `rev`  | **每一次**节点 / 连线 / doc-index 事务，**包括你自己写的**               | `snapshot` `ls` `read` `grep` `apply` | 「我手上这份读到的东西还是当前文档吗」                                                                                          |
| `seq`  | 只有**不是你干的**改动：用户在页面上改、别的协作者改、页面自己的自动整理 | `snapshot` `changes`                  | 「我不在的时候别人动了什么」——`changes --since-seq N --since-epoch E` 从这个数接着走；`seq` 必须和同一次回复里的 `epoch` 一起记 |

`snapshot` 同时给出两个，所以「先 `snapshot` → 干活 → 再 `snapshot`」能自证新鲜：
两次的 `rev` 一样 = 这期间画布一个字都没变；`rev` 涨了而 `seq` 没涨 = 变化全是你自己写的。
**永远不要用 `seq` 没动来判断「画布没变」**：你自己的 `apply` 按设计根本不碰 `seq`。
反过来也一样，`rev` 不能拿去当 `--since-seq`。

### What `changes` can and cannot tell you

`changes --since-seq N --since-epoch E` answers "what happened to this canvas that I did not do", as `{seq, epoch, entries[], truncated?, truncatedReason?}`.

**The cursor is two values, not one.** `seq` counts within one feed instance, and the feed lives in the page: a reload rebuilds it at 0. `epoch` says which instance a `seq` belongs to, so carry BOTH from the last reply (`changes` or `snapshot` — both return both) into the next call. Sending `--since-seq` without `--since-epoch` always answers `truncated` / `feed_restarted`: the page cannot prove your number still means anything, and "nothing much happened" is the one answer it must never guess.

**Read `truncated` before you read `entries`.** `truncated:true` means this reply is not a gap-free continuation of `sinceSeq`, and it can arrive with an EMPTY `entries` array. `truncatedReason` says which case:

| `truncatedReason` | What happened                                                                                                                                                        | What to do                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `feed_restarted`  | Your cursor does not belong to this feed: the `epoch` differs (a refresh or reopen rebuilt the feed at 0), or you sent no `epoch` at all so it could not be checked. | Take a fresh `snapshot` (or `ls`), re-read whatever you were tracking, and continue from THAT reply's `seq` **and** `epoch`. |
| `buffer_dropped`  | The feed keeps the last 500 entries and `sinceSeq` is older than the oldest one it still holds.                                                                      | Same: re-snapshot, then continue from the new `seq`.                                                                         |

The reply that means "nothing happened" is `entries:[]` **with no `truncated`**. Before `truncatedReason` existed, a page refresh produced `{seq:0, entries:[]}` — byte-identical to "nothing happened" — so an agent that reconnected to a canvas the user had been editing for an hour reported it as untouched. Never conclude "no changes" from an empty `entries` alone.

`epoch` closes the other half of that hole, which comparing numbers cannot. You remember `sinceSeq:57`; the user reloads (feed rebuilt at 0) and then edits 80 more times, so the new feed's entries `1..80` are all post-reload work. Ask with the bare number and `57 > 80` is false and `57` is not behind the buffer either, so the reply is `{seq:80, entries:[58..80]}` with no `truncated` — a plausible-looking "23 things happened" that silently swallows the 57 real edits entries `1..57` describe. With the `epoch` carried along, that same call is `feed_restarted`.

Each entry is `{seq, at, actor, kind, fields[], nodeId?, edgeId?, note?, nodeIds?}`.

`actor` is who did it, and it is **not** always the user:

- `human` — a human editing on the paired page.
- `remote` — another peer's transaction: their human, their page, or an agent driving their page. The origin does not cross the wire, so this is as precise as the page can be.
- `page` — the page itself, with no user involved: a batch note it wrote (`kind:"batch"`, see `note`), and the automatic frame refit that follows a landed output. **Never report a `page` row to the user as something they changed.**

What is and is not an entry:

- Node and edge adds / updates / deletes / moves, one entry per node or edge.
- A human re-cutting the video track: one entry with `fields:["timeline"]` and **no** `nodeId` — it is the track, not a node. Any `baseRevision` you hold is stale; re-read it with `timeline list` before writing.
- A human panning or zooming is deliberately **not** an entry. The page rewrites the saved viewport ~400 ms after every gesture, so entries would flood the 500-entry buffer and evict the real edits. Read the camera from `snapshot.viewport` when you need it.
- `nodeId:"doc-index"` with `kind:"delete"` is the index wipe — somebody unhooked every business path on the canvas (see 「Deleting it destroys every business path at once」). The index's creation and edits stay silent, and so does the one-time migration that moves a legacy `doc-index` node's text into the document field, which loses nothing. If you see this entry, stop and tell the user; every path you wrote down has stopped resolving.
- Your own writes are never entries. `changes` reports what you did NOT do.

`list-canvases` is also how you learn whether you may write at all: it returns the paired canvas's `role` and `readOnly` as the page sees them right now. A `viewer` role fails every mutating call with `error.code:"read_only"` — pairing succeeds regardless, so check before preparing a batch of edits you cannot land. Read it from `list-canvases` rather than caching it: the human's role can change while the session is open, and `status` deliberately does not carry it because a pair-time copy would go stale.

### Generation tasks: `tasks` (0.8.1)

`tasks` is the durable answer to "which generation tasks exist here, who submitted each, and where are they now". It is read-only (workers may call it) and is served by the page from the same server feed the task centre reads, so it lists the signed-in user's own tasks and nothing else — the CLI never holds a cookie or a URL. Rows are newest first:

| Field                             | Meaning                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskId`                          | The gateway task id `run` / `run-batch` returned; `null` while the submit is still queued                                                                        |
| `mediaTaskId`                     | The durable row id, stable from the moment the submit was accepted                                                                                               |
| `nodeId`, `nodeTitle`             | The node the run belongs to; `nodeTitle` only for nodes on the paired canvas                                                                                     |
| `kind`, `status`                  | `image` / `video` / `audio` / `text`; `queued` / `running` / `succeeded` / `failed` / `cancelled`                                                                |
| `submittedAt`, `finishedAt`       | ISO timestamps (`finishedAt` absent until terminal)                                                                                                              |
| `submitter`                       | `{kind, sessionId?, name?, isMe}` — `kind` is `human`, `agent` or `unknown` (recorded before 0.8.1); **`isMe:true` = this session (or its parent) submitted it** |
| `error`                           | The failure text, for `failed` rows                                                                                                                              |
| `canvasId/Name`, `projectId/Name` | Only on rows outside the paired canvas (`scope` ≠ `canvas`)                                                                                                      |

Filters: `--node ID` (repeatable; page-side, so `nextAfter` still walks the whole feed), `--status S` (repeatable), `--submitter me|agent|human` (`me` = this connection's identity, shared by its workers), `--since ISO`, `--limit N` (1–500, default 100), `--after CURSOR` (from `nextAfter`). `--scope project` lists every canvas in the paired canvas's project, `--scope all` every project the user can see; both add a fixed `scopeNote` — those rows are status information only, and their node ids are inert for every other command (`read` → `missing`, `run` → `node_not_found`, `cancel` → `not_owned`). The CLI adds a fixed-width `table` string to a successful reply.

`ls --long` rows and `read` nodes carry a reduced `run: {taskId?, submitter?: {kind, isMe}, submittedAt?}` for a node that is running or last ran: `taskId` / `submittedAt` come straight off the node's binding, `submitter` from the tasks feed (refreshed at most once per call, cached ~5 s) or from the bridge's own attribution of runs it started — and is omitted when neither knows, never guessed. `cancel NODE` answering `not_owned` means exactly that the node's run has `submitter.isMe:false` in `tasks`.

A failed node's `ls` row (short and long) carries `error: "<kind>[CODE]: message"` and its `read` carries `lastError {kind, code?, message}`; `kind` is `moderation` (rewrite the prompt under the compliance rules, then rerun with authorization), `quota` (the account is out of balance: stop and tell the user), `rate_limit` (a 429 / rate limit: wait and retry; a batch is not abandoned for it), `invalid_params` (fix the draft, not the wording), `provider` (retry), `cancelled` or `unknown` (report the message verbatim). `ls status=["failed"]` is the first stop after any batch.

### 标签（tags）

- 每条读路径都带 `tags: string[]`（没有就是 `[]`）：`ls` 行、`read` 节点、`snapshot` 节点，组也一样。`read NODE/tags` 只取这一个字段。
- 筛选：`ls` / `grep` 的 `tag[]`（CLI：可重复的 `--tag T`），任一命中、不分大小写，与大纲面板同口径。
- 搜索：`grep --fields tags`，一行一个标签，`line` = 标签序号。`fields` 只接受 `prompt` / `content` / `title` / `negativePrompt` / `tags`。
- 写入：`draft.assetTags`（≤ 20 条、每条 ≤ 30 字、trim、按小写去重，违反即 `INVALID_DRAFT` 整批拒）、`draft.assetTagColors`（`{标签:"#rrggbb"}`）。`gen` / `media-upload` / `scene-3d` / `group` 四种都能写；组只开放这两个键。只改标签不会让节点变 `dirty`。
- 用法与错误示例见「场景 5」。

`ls /` can show directory counts rather than all nodes. Follow discovered paths, use a suitable `glob`, or read known node IDs. Unindexed nodes are addressable as `/其它/NODE-ID` or bare IDs. `read NODE/prompt` selects a field. Text hashes describe stored text; preserve them exactly. `snapshot.truncated` means there are more nodes.

`ls --after CURSOR` resumes after the row whose cursor you pass; a cursor whose row has since been renamed, deleted or filtered out is `invalid_request`, not a silent restart, so re-page from the beginning when that happens rather than looping on a `nextAfter` you already hold.

Prefer `grep PATTERN --fixed` for literal searches in long scripts: fixed search scans large fields in chunks and accepts patterns up to 4,096 characters. `nextOffset` pages the hits already collected at the same document revision; it does not resume text left unsearched. `truncated` means the cooperative time budget ended or a regex line was too long. Counts then cover only searched text. Inspect each `incomplete` location using `read NODE/FIELD --offset LINE-MINUS-ONE`; `incompleteDetailsTruncated` means further locations were omitted. Never conclude that missing hits prove absence after an incomplete scan.

Regex searches accept patterns up to 256 characters with at most one group, eight alternatives and one nongroup quantifier; backreferences and lookarounds are refused. A regex line over 4,096 characters is skipped while the remaining lines are searched. An unsafe pattern returns `invalid_request` with `details.reason=unsafe_pattern`; use `--fixed` or download/read the relevant text and search locally when a more complex expression is necessary.

## The document index: `doc-index` and business paths

Everything in the previous section that talks about a _path_ — `/视频/ep01/P01/S01`, `/脚本一/镜头3`, `/段落A/画面2` — rests on one thing: a table this canvas carries called the **document index**. Read this section before you write to it, and before you delete anything named `doc-index`.

The page understands exactly two addressing facts: a node id, and a `path<TAB>nodeId` table mapping a virtual path to a node. **What a path means is entirely yours.** The canvas is deliberately taxonomy-free — an ad film writing `/脚本一/镜头3`, a music video writing `/段落A/画面2` and an episodic show writing `/视频/ep01/P01/S01` all use the identical mechanism, and the page never validates, orders or interprets a segment. Do not expect it to know that `S01` precedes `S02`, that a `/角色/` directory holds characters, or that renaming a directory should move anything. Nothing about your naming scheme is enforced or repaired here.

`doc-index` is a **reserved virtual address**. It used to be a text node with that literal id — visible, draggable, deletable — and it is not one any more. The id `doc-index`, and the path the table gives it (`/文档/index` when the table does not name itself), resolve to a document field that lives outside the node list.

- **`ls` never lists it.** Not at `/`, not at `/文档/`, not under any `glob`, not with `kind:["gen"]`. `grep` never searches it either.
- **The index's own row is never a dangling path.** An `ls` directory listing surfaces indexed paths whose node is gone as `status:"missing"`, `flag:"missing"` — the index's own row is skipped, because it points at an address that legitimately has no node.
- **`snapshot` returns it only when you name it.** `snapshot --json '{"nodeIds":["doc-index"]}'` is the only way, and only if you did not pass `around`, and only if `kinds` (when given) includes `gen`. The row carries **no `position` and no `size`** (it is not on the canvas — a layout diff must never compute a `move_node doc-index`), and its `summary` is `{"document":"index","length":N}`. This is the one channel that answers "does this canvas have an index at all" affirmatively.
- **It has exactly one field: `content`.** No prompt, no params, no output, no run status. `read` synthesises a row with `kind:"gen"`, `status:"idle"`, `title:""` so a caller that formats rows does not crash — those are shape, not data.
- **It is inside the Agent's undo scope but outside the human's.** An index write is one stack item for you (and rides in the same undo step as the node writes batched with it); the human's Ctrl+Z cannot touch it, in either direction.

### The table format

```
#canvas-index v1
path	nodeId	businessId	adopted	paid
/视频/ep01/P01/S01	NODE-ID-PLACEHOLDER	SHOT-ID-PLACEHOLDER	2	1
/角色/主角	NODE-ID-PLACEHOLDER-2
```

- The separator is a real **TAB**, never spaces. A line whose cells do not split on tabs simply does not parse.
- Any line starting with `#` is a comment and is skipped; the first line above is one.
- A row whose first cell is literally `path` is treated as a header **once**.
- Only the first two cells are required, and `path` must start with `/`. A row missing either, or with a path that does not start with `/`, is **silently skipped** — parsing is tolerant, so a malformed row does not fail your read, it just never resolves. If a path you wrote does not resolve, suspect the row before you suspect the API.
- Columns 3–5 are parsed but mostly yours: only `adopted` surfaces anywhere (as `adopted` on an `ls --long` row). `businessId` and `paid` ride along untouched — the page stores them, returns them nowhere, and never acts on them.
- Two rows with the same `path` are a **conflict**: `ls` marks those rows `flag:"conflict"`, `ls PATH` on it fails with `invalid_request` naming how many nodes it hit, and `read PATH` quietly reports the path in `missing[]` rather than picking one. Address such a node by its id instead.

### Reading and writing it

`["read","/文档/index/content"]` returns `content` and `contentSha`. Write it back with that digest as the precondition:

<!-- prettier-ignore -->
```json
{"label": "Register two new shots", "commands": [{"type": "update_node", "nodeId": "doc-index", "draft": {"content": "THE-WHOLE-TABLE-INCLUDING-THE-HEADER"}, "expect": {"contentSha": "SHA-FROM-READ"}}]}
```

For a single row, `edit_text` is cheaper and safer than rewriting the table:

<!-- prettier-ignore -->
```json
{"type": "edit_text", "nodeId": "doc-index", "field": "content", "oldString": "/视频/ep01/P01/S01\tOLD-NODE-ID", "newString": "/视频/ep01/P01/S01\tNEW-NODE-ID"}
```

`add_node {id:"doc-index"}` is **ENSURE, not ADD**. On a canvas that already has an index it keeps the existing text and changes nothing; `draft.content` is only the seed used when there is none. A second `add_node` is a no-op, never `DUPLICATE_NODE_ID` — which is exactly what makes a first batch safe to re-send after a reconnect. `kind`, `position` and `title` on that command describe a node that no longer exists and are ignored. The reply still reports `created[]` `{id:"doc-index", kind:<whatever kind you passed>}` and a `written[]` entry for `content`.

**Wrong** — every other field is refused rather than silently dropped: `{ "type": "update_node", "nodeId": "doc-index", "title": "Index", "draft": { "prompt": "…" } }` → `invalid_command` at `commands[0].title`, message `doc-index 是索引文档，只有 content 一个字段`. The same refusal covers `expect.promptSha` and `edit_text` on any field other than `content`. `expect.contentSha` and `expect.titleSha` are accepted: `titleSha` is verified against the digest of the empty title that `read` emits, so an echoed read row round-trips, and a mismatch is `stale`, not `invalid_command`.

On a canvas that has **no** index: `read /文档/index` puts the path in `missing[]`; `edit_text` returns `node_not_found`; `update_node` and `delete_node` return `invalid_command` carrying `NODE_NOT_FOUND: node not found: doc-index`.

### `INDEX_MISSING`

`ls` and `grep` return `warning:"INDEX_MISSING"` when the canvas has no index. It is a warning, not an error, and it blocks nothing: every node is still addressable as `/其它/<nodeId>` or as a bare node id, and every write command takes node ids anyway. Note that an **empty string is an index** — an empty one. Writing `""` makes the warning stop while nothing resolves, which is strictly worse than the warning.

### Deleting it destroys every business path at once

`{ "type": "delete_node", "nodeId": "doc-index" }` succeeds with `ok:true` and **no warning of any kind**. It does not delete a single node — it deletes the whole mapping. Afterwards every node on the canvas is reachable only as `/其它/<nodeId>`, `ls` starts warning `INDEX_MISSING`, and every path any earlier plan, note or hand-off wrote down stops resolving. There is no confirmation step and the page shows the human nothing.

Only two things soften it: your own `undo` can restore it (the field is in the Agent undo scope), and it does not touch the nodes themselves. It is also the one index event the change feed reports: a peer that wipes the index shows up in `changes` as `{nodeId:"doc-index", kind:"delete"}`, so if you see that row, stop — every path you or anyone else wrote down has stopped resolving. The human's Ctrl+Z **cannot** undo it. Never send this command as housekeeping, as "the index is stale", or as a step before rebuilding — rebuild by writing new `content` with `expect.contentSha`, which is atomic and reversible in the same way. Send it only when the user has asked for exactly this, in those words.

## Discover generation models

`models [query] --model-type video --limit 20 --offset 0` reads the signed-in user's catalog through the same `/api/gateway/models` route as the human model picker. JSON parameters are `modelType`, `modelId` (exact ID), `query` (case-insensitive ID/display-name substring), `offset`, and `limit` (1–100; default 20). Model types are `text`, `image`, `video`, `image_edit`, `video_edit`, `audio_edit`, and `audio`. A catalog entry does not imply the canvas has a generic generation node for every model type: ordinary generation node modes are text/image/video/audio; edit types belong to the existing specialized tools.

Results contain `models`, filtered `total`, `offset`, and `nextOffset` (null at the end). Each model has `id`, `displayName`, `modelType`, actual `inputSchema`, `schemaStatus`, and any published `protocol`/`featureTypes`. The schema is preserved verbatim, including `required`, `enum`, each enum's `default`, numeric constraints and `maxItems`; it is not a hand-written list of defaults. Read every constraint from it — models that look related do not share one (`MiniMax H3` takes `768p`/`2K` and up to 9 images, `MiniMax H3 Max` takes `480p`/`768p`/`1080p` and up to 12). A page is capped at 512 KiB and may contain fewer than `limit` entries; continue from `nextOffset`. Do not interpret a missing schema as an unconstrained model. `unauthorized` means the page needs a permitted account; `model_catalog_unavailable` means the catalog must be retried, not that no models exist.

A `video` model whose schema cannot express all of its limits also carries `localConstraints`, and the result then carries `constraintNotice`. It holds only what the published schema leaves out and `POST /api/tools/submit` enforces before billing: `durationMin` / `durationMax` / `durationAuto` (the auto-length sentinel, `null` when the model has none), `omniTaskTypes` (the 全模态 task types it understands), `omniTaskTypeRules` per declared `metadata.omni_reference_task_type` (`forcedAspect`, `requiresAutoDuration`, `requiresVideo`, `requiresAnyReference`), and `promptKeywords` (`edit` / `extend`: the prompt of a declared edit / extend must contain one of these words — nothing checks that before billing, so a miss may be rejected upstream after the charge). Aspect ratios, resolutions and reference-array caps stay in `inputSchema`. Its absence means the published schema is authoritative, never that the model is unconstrained.

The Gateway schema and the canvas draft use different field names. For `add_node`/`update_node` with `kind: "gen"`, use the observed `id` as `draft.modelId` and the appropriate `draft.mode`. Existing field mappings are:

| Gateway input field                          | Canvas draft field        |
| -------------------------------------------- | ------------------------- |
| `prompt`                                     | `prompt`                  |
| `aspect_ratio`                               | `aspectRatio`             |
| `resolution`, `duration`                     | `resolution`, `duration`  |
| `metadata.quality`, `metadata.output_format` | `quality`, `outputFormat` |
| `metadata.background`                        | `background`              |
| `metadata.generate_audio`                    | `generateAudio`           |
| `metadata.return_last_frame`                 | `returnLastFrame`         |
| `metadata.omni_reference_task_type`          | `omniReferenceTaskType`   |
| `metadata.prompt_expansion_mode`             | `promptExpansionMode`     |

Reference inputs use existing node connections/manual references and prompt mentions; read the target's `mentionCandidates` and `references` before wiring them. Do not paste the entire Gateway `inputSchema` or a generic `input_data` object into the draft. Supported fields remain enforced by the canvas command engine. Preparing a node does not submit a generation; `run --approved` is a separate command.

### Every draft key each node kind accepts

A key outside its kind's list is `invalid_draft`, never a silent drop, and the error carries `field` plus the whole `allowed` array — so the reply itself is the authoritative list at runtime. This is that list as the engine reads it:

| `kind`         | Accepted `draft` keys                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gen`          | `mode`, `source`, `outputType`, `prompt`, `modelId`, `audioSpeaker`, `aspectRatio`, `resolution`, `quality`, `outputFormat`, `background`, `promptExpansionMode`, `imageCount`, `negativePrompt`, `stylePresetId`, `userReferenceUrls`, `duration`, `generateAudio`, `returnLastFrame`, `omniReferenceTaskType`, `inputs`, `conversionSlots`, `fileName`, `mimeType`, `outputUrl`, `content`, `assetTags`, `assetTagColors` |
| `media-upload` | `mediaType`, `fileName`, `mimeType`, `outputUrl`, `assetTags`, `assetTagColors`                                                                                                                                                                                                                                                                                                                                             |
| `scene-3d`     | `outputMode`, `assetTags`, `assetTagColors`                                                                                                                                                                                                                                                                                                                                                                                 |
| `group`        | `assetTags`, `assetTagColors` _(only these — any other draft key on a group is `invalid_draft` with `allowed: ["assetTags","assetTagColors"]`)_                                                                                                                                                                                                                                                                             |

The keys the mapping table above does not cover, and what they are:

- `mode` — `text` / `image` / `video` / `audio`. Decides what the node will produce and which reference types its input port accepts. An `audio` node takes a model from `["models","--model-type","audio"]`: `语音合成` (text-to-speech: the prompt is the line spoken, `audioSpeaker` is the voice id and is required, no media references) or `音频生成（seed-audio）` (the prompt describes the sound; at most one reference image or up to three reference audios, not mixed).
- `audioSpeaker` — the TTS voice id for `mode:"audio"` with `语音合成` (the page's default is `zh_male_sophie_uranus_bigtts`); ignored by other models.
- `audioInputData` — model-specific audio parameters matching `models --model-type audio` → `inputSchema`, e.g. `audio_config`, `references`, `speaker`, `audio_params`, or recognition `audio` / `request`. Text is read from the node's `prompt`. Use `add_node` / `update_node` with `mode:"audio"`, then the regular `run` path; do not call Gateway separately. Seed-audio reserves an estimate, then settles `ceil(unitCredits × server-measured output seconds)` with the frozen rate. Parameters persist and are returned by `read`.
- `outputType` — `text` / `image` / `video` / `audio`, or `null`. The _resolved_ product; normally written by a run, not by you.
- `source` — `generate` (anything other than the literal `"upload"`) or `upload`.
- `imageCount` — number, **clamped to 1..4**, rounded. Out-of-range values are clamped silently, not refused.
- `negativePrompt` — string; `undefined` clears it. It is also an `edit_text` field.
- `stylePresetId`, `userReferenceUrls`, `inputs` (`{frameFirst,frameLast,images,videos,audios}`), `conversionSlots` — legacy/manual reference plumbing. Prefer real `connect` edges and prompt mentions; write these only from values you read back off the same node.
- `fileName`, `mimeType`, `outputUrl`, `content` — the node's stored result. **Writing `outputUrl` (or `content` in text mode) flips the node to `succeeded` and propagates downstream**, which is how a text note is stored without a run. Every other draft key flips it to `dirty`. To register an image the node did not generate, prefer `adopt_output`: it lands a real candidate with an `outputId`, where a bare `outputUrl` write does not.
- `assetTags` / `assetTagColors` — the user-visible tags on a node or group (see the 标签 section under Find and read): `string[]` (≤ 20, each ≤ 30 chars, deduped case-insensitively) and `{tag: "#rrggbb"}`. Tag-only writes never flip status or propagate.
- `media-upload.mediaType` — `image` / `video` / `audio`, or `null`.
- `scene-3d.outputMode` — `beauty` / `depth` / `mask` / `openpose`.

## Wire references and write prompt mentions

`scenemint-canvas connect` pairs the page; it does not connect nodes. Node wiring is an `apply` command:

<!-- prettier-ignore -->
```json
{"commands": [{"type": "connect", "source": "BASE-ID", "target": "VARIANT-ID", "targetHandle": "reference"}]}
```

**On the node kinds you can create, `reference` is the only input port that exists.** A `gen` node exposes exactly one input (`reference`, many-to-one) whose accepted types follow its `mode`: `text` mode accepts `text`; `image` mode accepts `text` and `image`; `video` mode accepts `text`, `image`, `video` and `audio`. A `scene-3d` node and a plain `media-upload` node have **no input port at all**. A `group` has no ports of any kind. `frameFirst`, `frameLast` and `prompt` are real handle names — the command union and the CLI both accept them — but they exist only on the legacy `image-gen` / `video-gen` nodes an older canvas may still carry, which no agent can create. Sending one to a `gen` node is `invalid_command` `CONNECT_REJECTED: unknown-port` at `commands[i].targetHandle`. Read the target's `edges.in` handles from `read`, or the graph's `edges[].targetHandle` from `snapshot`, before assuming a port exists.

`connect` is refused for seven distinct reasons, all reported as `invalid_command` with `CONNECT_REJECTED: <reason>`: `self` (source equals target), `unknown-node`, `unknown-port` (as above), `type` (the source's output type is not in the target port's `accepts` — a `media-upload` with no file picked yet emits nothing and always lands here), `cycle`, `duplicate` (this exact source→target→handle edge already exists), and `cardinality` (the port takes one edge and already has it).

Two side effects of `connect` and `disconnect` that surprise callers:

- Connecting to `reference` on a gen node whose prompt is **empty** (or is nothing but the existing reference tokens) appends the new source's mention token to the prompt for you. Re-read the prompt instead of assuming it is still empty.
- `disconnect` of a `reference` edge **strips that source's mention out of the target's prompt**. That is deliberate — a mention whose wire is gone sends nothing while still rendering as an attached chip — but it means a disconnect rewrites text you may be holding a `promptSha` for.

1. Create the base and target drafts with explicit model/parameters from the user's configuration and account catalog. Use `arrange` for new nodes, then check their measured bounds with a small snapshot.
2. Generate the required base under existing task authorization and wait for a usable output. Do not generate its variant or a video depending on it yet.
3. Apply the reference edge. `read VARIANT-ID` returns `mentionCandidates:[{key,label,syntax}]` for ready references. Copy the exact `syntax`, for example `@{Evelyn · 基础版}`, into the prompt, using the observed `promptSha` as a write precondition. Disambiguation suffixes are significant.
4. Reread the target. Confirm `mentions[].key` contains each intended source ID and `edges.in` has the proper wiring. Only then run the dependent node. A plain `@BASE-ID`, legacy `@图片1`, a URL, or prose about a reference is not the canvas's binding syntax. Translate legacy numbered image references through an explicit source-to-node mapping.

### 带 @ 引用的提示词标准写法

所有产品线（灵映客户端、剧本转视频等）共用这一套写法，`@{标签}` 一律放在**讲到那个主体的句子里**，不要堆在提示词开头。

- **图片生成节点（基于参考图）**：`基于参考图 @{基准标题} 生成，保持与参考图完全一致的<人物/服装/场景/风格……>，<本张要变化的内容>。` —— `@{}` 紧跟在「基于参考图」之后，先说明要保持什么，再写这一张的变化。
- **视频生成节点**：每个被引用的素材写成 `<主体>参考 @{标签}`，各自放进描述该主体的那句话里，例如：`人物参考 @{白妍·婚纱·基准}，场景参考 @{教堂·白天·基准}，白妍缓步走向圣坛，镜头从背后缓推。` 多个引用就多写几个 `<主体>参考 @{…}`，不要把所有 `@{}` 挤成一行放在最前面。
- 标签必须逐字复制 `read` 返回的 `mentionCandidates[].syntax`（含 `·前六位id` 这类消歧后缀）；`@节点id`、`@图片1`、URL 或「用参考图」这类文字都不绑定引用。

画布对这套写法有两条硬约束，写提示词前先记住：

1. **连线会自动种下裸 token。** 往 `gen` 节点的 `reference` 端口 `connect` 时，如果目标的 prompt **恰好为空**（或者只有已连引用的 token），画布会自动把新来源的 mention token 追加进 prompt（`commands.ts` 的 `applyConnect`）。所以连完线要先 `read` 一次：prompt 很可能已经不是空的了。
2. **写入时每个 `@{标签}` 都必须立刻能解析。** `update_node` / `add_node` 写 `prompt` 时，画布把每个 `@{标签}` 对照该节点当前的 `mentionCandidates` 还原；一个标签解析不了，**整个 apply 失败**，错误码 `unresolved_mention`（`resolveWrittenPrompts`）。能解析的条件是两条同时成立：该来源**已经连到本节点的 `reference` 端口**，并且**已经有输出**。没连线、没跑过、标题打错，三种情况报的是同一个错。

因此操作顺序固定为：

- **连线单独一个批次。** 先 `apply` 只含 `connect` 的批次，等来源节点有输出，再 `read` 目标拿 `mentionCandidates` 和 `promptSha`，然后另起一个批次写 prompt。不要在同一批里「连线 + 写带 `@{}` 的提示词」去赌解析顺序。
- **已有种下的 token 时，把它挪到语义位置，而不是在后面接着写正文。** 例如 `read` 回来的 prompt 是 `@{白妍·基准}`，正确的写法是整段改成 `基于参考图 @{白妍·基准} 生成，保持与参考图完全一致的人物与服装，改为夜景`；错误的写法是保留开头的 `@{白妍·基准}` 再在后面追一段正文。用 `edit_text` 做这种局部改写时同样要把 token 搬进句子里。
- 写完必须重读，确认 `mentions[].key` 含每一个预期来源；`mentionCandidates` 为空说明上游还没就绪，去修图（连线 / 跑基准），不要改措辞。

**A mention the canvas cannot bind fails the WHOLE apply.** Which code you get depends on which command wrote the text, and both carry `error.labels` with every offending label:

- `update_node` / `add_node` writing a `prompt`: **`unresolved_mention`**, at `commands[i].draft.prompt`. One message covers every cause — "被引用的节点必须已连接到本节点的 reference 端口，并且已经生成过输出（没有输出的节点不能被 @）" — so a typo'd label, a node you have not created, a node that is wired but has never produced output, and a node that is not wired to this node's `reference` port all look identical here. Diagnose by reading the target's `mentionCandidates`: a label absent from that list is not writable, whatever the reason.
- `edit_text` (either `oldString` or `newString`): the label table is consulted before the replacement, so a label it cannot resolve is **`invalid_command`** at `commands[i].oldString` / `.newString`, and it tells you which of two problems you have — "没有叫 @{X} 的节点或参考" (no node or manual reference carries that label at all) or "有多个同名节点" (two nodes share the title; use the disambiguated `标题·前六位id` form that `read` hands you in `mentions` / `mentionCandidates[].syntax`). A label that resolves fine but names an unwired or output-less source still fails afterwards as `unresolved_mention`.

None of these is fixed by rewriting the prompt. Fix the graph — create the node, wire the edge, run the base, or copy the disambiguated label — and send the same text again.

`@{⚠missing:KEY}` is the one token that prescription does **not** cover, and it round-trips through `edit_text` **only**. `edit_text` restores it verbatim to the same dangling key on purpose, so a prompt that already carried one stays editable. `update_node` / `add_node` write a whole `prompt` through a different restorer that has never heard of `⚠missing:`: the token matches no candidate, survives as a literal `@{…}`, and fails the whole batch as `unresolved_mention` with `⚠missing:KEY` sitting in `error.labels`. Copying a `read`'s prompt straight into an `update_node` is therefore a real way to lose a batch. And do not reach for the prescription above when you see it — `⚠missing:` means the key resolves to nothing anywhere in the graph (a deleted node, or a reference that lost its name), so creating a node and running it buys a paid generation that restores nothing. Either edit around the token with `edit_text`, or strip the token out of the text before writing it with `update_node`.

`read` and `snapshot` have different shapes: read uses `nodes[].nodeId`, `nodes[].params`, `nodes[].edges.in/out`, and full `prompt`; snapshot uses `nodes[].id`, `nodes[].summary.params`, geometry `position/size`, `parentId` (a snapshot-only field — `read` has no such key), and a top-level `edges` list. Snapshot prompt text is abbreviated. Do not infer missing links from looking for read-only fields in a snapshot. `mentions` lists actual stored bindings; `mentionCandidates` lists available choices, so a candidate's existence alone does not prove it is used.

File inputs and output paths are resolved relative to the session's `workspace`, not shell cwd. If workspace is `/project/.canvas`, save `/project/.canvas/edit.json` and use `--file edit.json` (or its absolute path), not `--file .canvas/edit.json`. For loopback HTTP diagnostics use `curl --noproxy '*' -4` so a shell proxy does not create a false server failure.

## Plain text nodes (no generation)

<!-- prettier-ignore -->
```json
{"commands": [{"type": "add_node", "id": "NOTE-ID", "kind": "gen", "title": "Note", "position": {"x": 0, "y": 0}, "draft": {"mode": "text", "outputType": "text", "content": "Stored note text"}}]}
```

`kind:"text"` and `kind:"note"` are invalid. This command stores text directly,
without `run`, a model lookup, or a paid generation. Reread `NOTE-ID/content`.

## Apply batches

Save a JSON object such as the following to a workspace file and pass `apply --file changes.json`. Replace the sample IDs and hashes with actual returned values — **every uppercase token in this document is a placeholder, never a literal to copy.** A digest is only ever obtained from a `read`, an `ls --long`, or a previous apply's `written[]`; a "known" sha typed from memory fails the precondition it was supposed to protect.

<!-- prettier-ignore -->
```json
{"label": "Refine the prompt and move its reference", "commands": [{"type": "update_node", "nodeId": "NODE-A", "draft": {"prompt": "The revised prompt"}, "expect": {"promptSha": "SHA-FROM-READ"}}, {"type": "move_node", "nodeId": "NODE-B", "position": {"x": 100, "y": 200}}]}
```

An apply is **all-or-nothing**: the batch is computed against the current graph and lands as one Yjs transaction, so the first rejected command throws before anything is written. It is also **one undo step** and one entry in `operations`.

### What the reply carries

| Field            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`             | false ⇒ nothing was written; read `error` and stop                                                                                                                                                                                                                                                                                                                                                                |
| `persisted`      | only `false`, only when the page wrote the batch but the collab server had not acknowledged it within 2 s. Do **not** resend. Confirm with `read NODE` a few seconds later: the content is new on the page either way, so the only proof is that the read reply no longer carries top-level `persisted:false`; if it keeps carrying it, tell the user the change is not saved yet and to keep the canvas tab open |
| `created[]`      | `{command, id, kind}` for every id this batch minted, in command order                                                                                                                                                                                                                                                                                                                                            |
| `written[]`      | `{command, nodeId, field, sha, length, status}` for every text field written, one per (node, field)                                                                                                                                                                                                                                                                                                               |
| `exports[]`      | one entry per `export_output`, in command order                                                                                                                                                                                                                                                                                                                                                                   |
| `skipped[]`      | `{command, nodeId, reason}` for every `group_nodes` / `add_to_group` id left out (`already_grouped` / `already_member` / `is_group` / `not_found`); absent when nothing was skipped                                                                                                                                                                                                                               |
| `focused[]`      | one per `focus_node`: `{command, nodeId \| nodeIds \| all, framed, reason?}` — see `focus_node`                                                                                                                                                                                                                                                                                                                   |
| `selected[]`     | one per `select`: `{command, nodeIds, shown, reason?}`                                                                                                                                                                                                                                                                                                                                                            |
| `recovered[]`    | one per `recover_deleted`: `{command, nodeIds, edgeIds, notFound?}`                                                                                                                                                                                                                                                                                                                                               |
| `dissolved[]`    | `{command, groupId}` for every `remove_from_group` that left the frame with fewer than 2 members, so the frame is gone                                                                                                                                                                                                                                                                                            |
| `tidied[]`       | `{command, moved, resized, strays[]}` for **every** `tidy` in the batch — the `scope` pass and the whole-canvas re-layout alike, and on **both** call paths (a plain `apply` batch containing a `tidy`, and the CLI's `tidy`). `strays[]` is only ever non-empty for the `scope` pass                                                                                                                             |
| `tidySummary`    | the same entries rendered as one text line each, strays named — produced by the page, so it accompanies `tidied[]` on both paths. Quote it; it is the only form that survives a host compressing the reply into prose                                                                                                                                                                                             |
| `scene3d[]`      | one per `scene3d_apply`: `{command, nodeId, sceneDigest, applied[], checks}` — `sceneDigest` is the next `baseDigest`; see `scene3d_apply`                                                                                                                                                                                                                                                                        |
| `scene3dSummary` | the same entries as one text line each (plus a `拦下：` line when something blocks a still) — produced by the page. Quote it                                                                                                                                                                                                                                                                                      |
| `rev`            | the document revision after the apply                                                                                                                                                                                                                                                                                                                                                                             |
| `undoDepth`      | this Agent's undo depth afterwards                                                                                                                                                                                                                                                                                                                                                                                |

`created[]` is the general contract for **"the id you could not have known in advance"**, and `kind` names what the id _is_, not always a node kind:

| Command                   | `created[]` entries                                | `kind`                       |
| ------------------------- | -------------------------------------------------- | ---------------------------- |
| `add_node`                | one, whether you supplied `id` or not              | the kind you asked for       |
| `add_node` on `doc-index` | one, id `doc-index`                                | the kind you passed (echoed) |
| `upload_asset`            | one, the new media node (none with `targetNodeId`) | `media-upload`               |
| `group_nodes`             | one, the new group                                 | `group`                      |
| `duplicate_node`          | one per copy, in creation order                    | the source's kind            |
| `duplicate_nodes`         | one per copied node, in graph order                | each copy's kind             |
| `split_output`            | one, the new node                                  | `gen`                        |
| `connect`                 | one, **the new edge's id**                         | `edge`                       |
| `adopt_output`            | one, **the new candidate's `outputId`**            | `output`                     |
| everything else           | none                                               | —                            |

**`connect`'s entry is the only place an `edgeId` is ever handed to you at creation time, and `disconnect` needs an `edgeId`.** `read` returns edges as `edges.in:[{from,handle}]` / `edges.out:[{to,handle}]` — no ids at all. The only other source is `snapshot`, whose top-level `edges:[{id,source,target,targetHandle}]` is always the whole graph's edge list, never filtered or truncated even when the node list is. So: capture `created[].id` when you connect, or take a `snapshot` and match on `source`/`target`/`targetHandle`. Never construct an edge id.

Note what `created[]` does _not_ report: `duplicate_node` also clones the source's **incoming edges** with fresh ids, and those ids are not returned. Snapshot the duplicate if you need to disconnect one of them.

`apply.written[]` returns the text hashes actually written. A stale hash or failed string match requires reading the current node and revising the change. Do not remove the precondition simply to force a write. Use draft fields supported by the node/model; `invalid_draft` provides allowed fields.

`expect` is compared against the text this page currently holds, and it is checked and written inside one synchronous update, so nothing on this page can slip between them. It is not a distributed lock: a collaborator's edit that has not reached this page yet is invisible to the check, and a node is written as a whole value, so the later of two concurrent writes wins the whole node. Treat `expect` as "the text I read is still the text here", not as a guarantee that no one else is editing.

`title` is one authoritative field on every node kind, groups included. `group_nodes{title}` and `add_node{title}` write it, `update_node{title}` and `edit_text{field:"title"}` change it, and `ls`, `read` and `snapshot` return exactly that stored string — never a per-kind placeholder. A stored title is **trimmed and clipped to 60 characters**, so a longer one reads back shortened and its `titleSha` is the digest of the shortened form. A group nobody named reads back as `""`: the caption the canvas shows for an unnamed group ("Group name", localized) is UI placeholder text that is not stored, so do not treat it as text to match. An `add_node` that omits `title` is different — the engine stores a real numbered default ("图片生成 1", "文本生成 2", by kind and mode), and that string is what you will read back. `titleSha` always hashes the string the same row displays, so a title copied out of `read` matches `edit_text.oldString` and `expect.titleSha`. A `group_nodes` reply lists the written title in `apply.written[]`.

## The thirty apply commands

Exactly thirty `type` values exist. Anything else is `invalid_request` before the page sees it.

`add_node` · `update_node` · `edit_text` · `move_node` · `connect` · `disconnect` · `delete_node` · `group_nodes` · `ungroup` · `add_to_group` · `remove_from_group` · `resize_group` · `set_viewport` · `arrange` · `align` · `tidy` · `duplicate_node` · `duplicate_nodes` · `select_output` · `delete_output` · `split_output` · `clear_output` · `reset_status` · `adopt_output` · `recover_deleted` · `focus_node` · `select` · `upload_asset` · `export_output` · `scene3d_apply`

Each entry below lists required fields, optional fields, one batch you can copy, and one mistake with the code it produces.

### `add_node`

**Required** `kind` (`gen` | `media-upload` | `scene-3d`), `position:{x,y}`. **Optional** `id`, `title`, `draft`.

Use it to create anything: a generation node, a stored text note (see the section above), a placeholder for media you are about to upload. Supply your own `id` when a later command in the same batch must refer to the node — you cannot read `created[]` mid-batch.

<!-- prettier-ignore -->
```json
{"type": "add_node", "id": "SHOT-NODE-ID", "kind": "gen", "position": {"x": 0, "y": 0}, "title": "S01 wide", "draft": {"mode": "image", "modelId": "MODEL-ID-FROM-CATALOG", "prompt": "…"}}
```

**Wrong:** `{"type":"add_node","kind":"group","position":{"x":0,"y":0}}` → `invalid_request` `expected one of: gen, media-upload, scene-3d` at `commands[0].kind`. Groups are born from `group_nodes`, never from `add_node`; so are `text` and `note`, which are not kinds at all. Reusing an existing id is `invalid_command` `DUPLICATE_NODE_ID: node already exists: <id>` — the one exception being `id:"doc-index"`, which is an ensure.

### `update_node`

**Required** `nodeId`. **Optional** `title`, `draft` (partial — only the keys you name are touched), `expect:{promptSha?, contentSha?, titleSha?}`.

Use it for whole-field writes and for parameter changes. Always carry `expect` for a text field you read earlier; that is the entire mechanism protecting you from clobbering a human edit.

<!-- prettier-ignore -->
```json
{"type": "update_node", "nodeId": "NODE-ID", "draft": {"aspectRatio": "16:9", "resolution": "1080p"}}
```

**Wrong:** `{"type":"update_node","nodeId":"NODE-ID","draft":{"maxDuration":15}}` → `invalid_draft` at `commands[0].draft.maxDuration`, with `field:"maxDuration"` and `allowed:[…]`. Rebuild the draft from `allowed`; never assume an unknown key was harmlessly ignored. A `promptSha` that no longer matches is `stale` carrying `currentSha` — re-read and build a **new** payload; replaying the old one fails identically. A text write on a gen node whose run is in flight is `node_running` (retryable: wait for the terminal status).

### `edit_text`

**Required** `nodeId`, `field` (`prompt` | `content` | `title` | `negativePrompt`), `oldString`, `newString`. **Optional** `replaceAll`.

Prefer this over `update_node` for local edits: it is an exact string replacement on the stored text, so every mention token you did not touch survives byte for byte, where a whole-prompt rewrite re-resolves all of them. `@{label}` inside either string is resolved before matching, so you can copy labels straight out of `read`.

<!-- prettier-ignore -->
```json
{"type": "edit_text", "nodeId": "NODE-ID", "field": "prompt", "oldString": "golden hour", "newString": "blue hour"}
```

**Wrong:** an `oldString` that occurs twice without `replaceAll` → `invalid_command` carrying `matches: 2`, message "出现 2 处：加更多上下文让它唯一，或 replaceAll=true". Zero matches is the same code with `matches: 0` and means the text already changed (or your `@{标签}` spelling is wrong) — re-read the full field. The match count _is_ the compare-and-set here: there is no `expect` on `edit_text` because a missing `oldString` already fails the write. A `@{label}` in either string that the canvas cannot resolve is a different `invalid_command`, carrying `labels` — see the mention section above for the two shapes it takes.

### `move_node`

**Required** `nodeId`, `position:{x,y}`.

Coordinates are **parent-relative for a grouped member** and absolute otherwise. Moving a `group` moves its frame and carries every member along unchanged.

```json
{ "type": "move_node", "nodeId": "NODE-ID", "position": { "x": 1200, "y": 400 } }
```

**Wrong:** feeding a grouped member the absolute coordinates you read from `snapshot` (which are always absolute) sends it flying by the frame's origin. Check `parentId` first — it appears **only on `snapshot`'s rows**; `read` and `ls --long` never return the field at all, so looking for it there gets you `undefined` on a node that is in fact grouped — or use `arrange` / `align`, which do this conversion for you.

### `connect`

**Required** `source`, `target`, `targetHandle` (`reference` | `frameFirst` | `frameLast` | `prompt`).

See the wiring section above for what actually exists: on creatable node kinds, `reference` is the answer. The reply's `created[]` carries the new edge id — keep it.

```json
{ "type": "connect", "source": "BASE-ID", "target": "VARIANT-ID", "targetHandle": "reference" }
```

**Wrong:** `{"targetHandle":"frameFirst"}` against a `gen` node → `invalid_command` `CONNECT_REJECTED: unknown-port`. Guessing handle names is never productive; the seven rejection reasons are listed above.

### `disconnect`

**Required** `edgeId` — and nothing else.

```json
{ "type": "disconnect", "edgeId": "EDGE-ID-FROM-SNAPSHOT-OR-CREATED" }
```

**Wrong:** passing `source`/`target` instead → `invalid_request` "Unexpected disconnect field: source" (the daemon rejects the batch before the page sees it). Inventing an id, or reusing one from another canvas, is `invalid_command` `EDGE_NOT_FOUND: edge not found: <id>`. Remember that disconnecting a `reference` edge also strips that mention from the target's prompt.

### `delete_node`

**Required** `nodeId`.

**Deleting a group cascades**: the frame _and every member_, plus every edge touching any of them, go together in one command. `created[]` says nothing about what left. To dissolve a frame while keeping its contents, use `ungroup`.

**Bulk deletes need the user's go-ahead**, on the editor's own line (`needsBulkDeleteConfirm`): when the batch's `delete_node`s remove **more than 5** nodes in total, or any group that has members, every `delete_node` target must be listed in `approval.userApprovedNodeIds` — `apply --approved` fills it with the batch's targets (and, 0.18.0, the node of every `scene3d_apply` with a `remove` / `remove_shot`: removing what a human changed in the desk needs it too, see `scene3d_apply`). Without it the batch is `approval_required` and nothing is deleted. Like `run --approved` it declares an authorization you already hold; never add it before the user said yes.

Everything a `delete_node` removes is snapshotted into the page's 最近删除 buffer (the same one the human's Delete key fills) once the batch commits, so `recover_deleted` can put it back after the undo stack is gone.

```json
{ "type": "delete_node", "nodeId": "NODE-ID" }
```

**Wrong:** `{"type":"delete_node","nodeId":"GROUP-ID"}` intending to remove only the frame — you just deleted every node inside it. And `nodeId:"doc-index"` deletes the whole business path map; see the index section before you type it.

### `group_nodes`

**Required** `nodeIds[]`. **Optional** `title`, `id`.

Needs **at least one node that exists, is not already in a group, and is not a group itself**. One survivor is enough — a frame around a single node is a legitimate thing to build (a scene with one shot, a product with one still). The frame is fitted around the members with 56 px padding and members become parent-relative.

Ids that fail those tests are **skipped, not fatal**, and every one of them comes back in `apply.skipped[]` as `{command, nodeId, reason}` with `reason` one of `already_grouped` (it is in another frame; a node is never stolen), `is_group`, `not_found`. Only when **nothing** survives is it `invalid_command` "group_nodes needs at least 1 existing, ungrouped, non-group node". Framing 40 scenes in one batch therefore lands 39 of them and tells you about the 40th, instead of rejecting the batch and leaving the canvas half-built.

<!-- prettier-ignore -->
```json
{"type": "group_nodes", "id": "GROUP-ID", "nodeIds": ["NODE-A", "NODE-B", "NODE-C"], "title": "Act 1"}
```

**Wrong:** trusting the count you sent. `ok:true` with four ids can still be a group of three — read `skipped[]`, or verify `memberIds` on the new group. `parentId` is a snapshot-only field; for a group you already know about, `read GROUP-ID` hands you `memberIds` more cheaply than a snapshot.

### `ungroup`

**Required** `groupId`.

Dissolves the frame and promotes every member back to absolute coordinates. The members survive; only the group node disappears. This is the **only** safe way to get rid of a frame.

✅ **Right — remove a frame, keep the work:**

```json
{ "commands": [{ "type": "ungroup", "groupId": "GROUP-ID" }] }
```

❌ **Wrong — `delete_node` on a group deletes the members too:**

```json
{ "commands": [{ "type": "delete_node", "nodeId": "GROUP-ID" }] }
```

`ok:true`, no warning, `created[]` empty — and the frame's seven finished videos are gone with it, along with every edge that touched them. A user lost exactly that. If a frame is in the way, `ungroup` it; if you really mean to delete the contents, delete the members by id first so the batch says what it is doing.

**Wrong:** passing a member's id, or a node that is not a group → `invalid_command` `group not found: <id>`.

### `add_to_group`

**Required** `groupId`, `nodeIds[]` (at least one).

Puts existing nodes into an existing group: their on-screen position does not change (they become parent-relative), the group's `childIds` gains them, and the frame then **grows** (never shrinks) to cover its members — a member whose centre sits outside its frame would be evicted by the next pointer gesture. Ids that cannot join come back in `skipped[]`: `already_grouped` (in **another** group — never stolen; `remove_from_group` first), `already_member`, `is_group` (groups do not nest), `not_found`. If nothing joined and something other than `already_member` was skipped, it is `invalid_command`.

<!-- prettier-ignore -->
```json
{"type": "add_to_group", "groupId": "GROUP-ID", "nodeIds": ["NODE-D", "NODE-E"]}
```

**Wrong:** `groupId` naming a plain node → `invalid_command` "node is not a group". Expecting a node from group A to move to group B → it is skipped as `already_grouped`.

### `remove_from_group`

**Required** `nodeId`.

The node menu's 移出组 (`removeNodeFromGroup`): the member keeps its absolute position and becomes a top-level node. **If fewer than 2 members would remain, the whole frame dissolves** (its last member is freed too) and the reply carries `dissolved:[{command, groupId}]` — tell the user the group is gone.

```json
{ "type": "remove_from_group", "nodeId": "NODE-ID" }
```

**Wrong:** a node that is in no group → `invalid_command`. Using it to "delete the frame" → that is `ungroup`.

### `resize_group`

**Required** `nodeId` (a group). **Optional** `size` (`{width,height}`, both positive) and `fit` (`true`) — exactly one of the two — plus `absorbStrays` (`true`).

Resizes ONE frame. **Members never move**: their stored positions are parent-relative, so when the frame's origin shifts they are rebased and stay visually still. **Membership does not change by default; only an explicit `absorbStrays:true` takes in ownerless loose nodes** — growing a frame over a loose node does NOT make it a member unless you asked for that in this very command, and a frame pulled in past a member never evicts it (no switch does that). That is the canvas's own rule for every frame gesture (a human dragging a grip gets the same "this node is only lined up with the frame" notice), and it matches what `tidy --scope` reports as a `strays[]` entry — one and the same test everywhere: **a node is a stray of a frame when its centre lies inside that frame** (`health`'s `stray_over_frame`, `tidy`'s `strays[]`, the `frame_strays` change entry and `absorbStrays` all ask that one question). A node that merely clips a frame's edge with its centre outside is not a stray and cannot be absorbed; `tidy --scope all` pushes that one off the frame instead. Joining is the drop of a NODE inside the frame, which only a human does; if the user wants that node in the group, ask, then `group_nodes` it. `fit:true` computes the size for you — the members' **rendered** bounding box plus 56 px padding — which both grows a frame a landed output outgrew and **shrinks** one that a rebuild fitted from stale placeholder sizes. Prefer `fit:true`: the model has no reliable way to guess a node's rendered height.

✅ **Right — a frame that reads back `frameOversize:true` in `snapshot`:**

```json
{ "commands": [{ "type": "resize_group", "nodeId": "GROUP-ID", "fit": true }] }
```

⚠️ **Only when the user named the pixels** — and never smaller than the members:

<!-- prettier-ignore -->
```json
{"commands": [{"type": "resize_group", "nodeId": "GROUP-ID", "size": {"width": 1800, "height": 1200}}]}
```

A `size` that would cut into the members is **held at the members' bounding box + 8 px** and the reply carries `clamped:[{command, nodeId, requested, applied, reason:"members_floor"}]`. Quote `applied`, never `requested` — telling the user "改成 1800×1200 了" when the frame is 3112×2512 is a lie they will catch. Read `membersBounds` from `snapshot` first if you want to know the floor before you ask. When you do not have a pixel figure from the user, use `fit:true`.

- ❌ **Wrong:** `{"type":"resize_group","nodeId":"G","size":{"width":400,"height":300}}` on a group whose members span 3000 px, then reporting "已改好". The frame comes back at the floor, not at 400×300, and `clamped[]` says so.

❌ **Wrong — `move_node` has no size, and a group's `data.width` is not a draft field:**

<!-- prettier-ignore -->
```json
{"commands": [{"type": "move_node", "nodeId": "GROUP-ID", "size": {"width": 1800, "height": 1200}}]}
```

→ `invalid_request` "Unexpected move_node field: size" (the daemon rejects the batch before the page sees it). The same goes for `update_node{draft:{width}}`. `resize_group` is the one write path for a frame's size.

#### `absorbStrays` — the one switch that changes membership

Default **false**. With `absorbStrays: true`, every node whose centre falls inside the frame **as this command found it** — the frame the user was looking at when `health` reported the stray — **and that belongs to no group at all** joins this group: it gains `parentId`, its stored position becomes parent-relative (it does not move on screen), and it appears in `memberIds`. The reply names them — `absorbed:[{command, nodeId, nodeIds}]`, where `nodeId` is the frame and `nodeIds` are the nodes it took in. No `absorbed` entry means no ownerless node's centre was inside that frame; it never means the flag was ignored.

**Order matters, and it is: absorb first, resize second.** The new members are already members when the size is computed, so `fit:true` fits around them too (the frame ends up covering what it just took in) and a `size` too small for them is held at the members' floor. Judging the strays _after_ the resize would make the switch a no-op: `fit` pulls the frame in to the members' bounding box + 56, and a stray is by definition not inside that box, so nothing would ever be absorbed while the reply still said `ok`.

**A node owned by another group is never stolen**, no matter how much the two frames overlap. Overlapping frames are ordinary layout, and moving somebody's finished shots into a different group is not a resize.

Use it to _repair_ what the canvas reported, not as a habit:

- `tidy --scope …` answers with `strays[]`;
- a human dragging a frame (or one of its grips) over a loose node writes a `changes` entry `{kind:"batch", note:"frame_strays", actor:"human", nodeId:<the frame>, nodeIds:[…]}`, and the mirror case — a member whose centre ended up outside the frame — writes `note:"frame_escaped"`. Both are **records, not actions**: the canvas deliberately changed nothing.

When either tells you a node is sitting inside a frame it does not belong to, ask the user first; the frame is a deletion unit (`delete_node <group>` takes the members with it), so absorbing a node silently is how work gets deleted later.

<!-- prettier-ignore -->
```json
{"commands": [{"type": "resize_group", "nodeId": "GROUP-ID", "fit": true, "absorbStrays": true}]}
```

❌ **Wrong:** reaching for `absorbStrays` to "fix" a `frame_escaped` note. It only ever adds members; a member that drifted outside its frame is still a member, and the fix is `fit:true` (grow the frame back around it) or `move_node` (bring the node home).

**Wrong:** `fit:true` **and** `size` together, or neither → `invalid_request` at `commands[i].size`. A non-boolean `absorbStrays` → `invalid_request` at `commands[i].absorbStrays`. A `nodeId` that is not a group → `invalid_command` `node is not a group: <id>`. A frame with no members cannot be fitted — `fit:true` leaves it as it is.

### `set_viewport`

**Required** `viewport:{x,y,zoom}` with a finite, positive `zoom`.

This writes the canvas's **saved** viewport — where the canvas opens _next_ time — and it is **not** an undo step (viewport lives in the document's meta map, outside every undo scope). It does **not** move anybody's camera right now, and the page overwrites it roughly 400 ms after any human pan or zoom. If your goal is "show the user this node", the command you want is `focus_node`.

```json
{ "type": "set_viewport", "viewport": { "x": -400, "y": -200, "zoom": 0.75 } }
```

**Wrong:** `"zoom": 0` → `invalid_request` "expected positive number" at `commands[0].viewport.zoom`. Expecting the human's screen to jump — it will not.

### `arrange`

**Required** `nodeIds[]` (non-empty, **unique**), `layout` (`row` | `column` | `grid`). **Optional** `gap` (non-negative; default **160 horizontally / 96 vertically**), `columns` (grid only, ≥ 1; default `ceil(sqrt(n))`), `anchor:{x,y}` (default the nodes' current bounding-box top-left).

Nodes are placed **in the order you list them** — this is the one layout command whose order you control — using each node's real measured size. Grid cells are sized to the largest box. A grouped member is re-expressed against its frame automatically.

<!-- prettier-ignore -->
```json
{"type": "arrange", "nodeIds": ["NODE-A", "NODE-B", "NODE-C", "NODE-D"], "layout": "grid", "columns": 2, "gap": 64}
```

**Wrong:** repeating an id → `invalid_command` "nodeIds must be unique". An id that is not on the canvas → `node_not_found` at `commands[0].nodeIds`. An empty `nodeIds` → `invalid_request` "expected at least one node" (it never widens to "everything").

### `align`

**Required** `nodeIds[]`, `mode`. **Optional** `gap`.

`left` / `right` / `top` / `bottom` / `center_x` / `center_y` need **≥ 2** nodes and line the boxes up on that edge or centre line of the selection's bounding box. `distribute_x` / `distribute_y` need **≥ 3**.

Two behaviours to internalise before you use distribute:

- **`gap` only affects `distribute_x` / `distribute_y`.** On the six alignment modes it is accepted and then ignored; a batch that "aligns left with gap 40" produces plain left alignment and no error tells you so.
- **Distribute sorts by current position on that axis, not by your `nodeIds` order.** The leftmost (or topmost) box is "first" whatever you listed first. Without `gap` the first and last boxes stay put and the ones between are evenly spaced; with `gap` everything packs from the first box at exactly that gap, and the last box moves too.

```json
{ "type": "align", "nodeIds": ["NODE-A", "NODE-B", "NODE-C"], "mode": "distribute_x", "gap": 48 }
```

**Wrong:** `{"mode":"distribute_x","nodeIds":["NODE-A","NODE-B"]}` → `invalid_request` "expected at least 3 nodes for mode distribute_x". And listing nodes in your intended visual order for a distribute achieves nothing — reorder them with `arrange` first if the current positions are wrong.

### `tidy`

**Optional** `nodeIds[]`, `groupIds[]` — each must be **non-empty when given**. Omitting **both** tidies the whole canvas. **Optional** `scope` (`all` | `groups` | `selection`) and `fitFrames` select the _other_, conservative pass — see "整理画布" below.

`tidy` runs the same layout the canvas's own "Tidy layout" button runs: members are packed inside their group frame, the frame is refitted around them and only ever grows, connected nodes keep their left-to-right flow (seeded with the arrangement already on screen), unconnected nodes are packed into order-preserving rows below that flow, and the whole result is anchored on the bounding box it started from, so the viewport does not jump. Passing `nodeIds` and/or `groupIds` restricts it to those units — a member ID counts as its group — and everything else stays put.

**When to use it:** you created or moved a cluster and want it readable, and you can name the units you are responsible for.

**When it is risky:** the whole-canvas form. It moves work the user placed by hand; it lands as **your** undo step, which the human's Ctrl+Z cannot reverse; it syncs to every collaborator immediately; and the page shows the user a notice that an agent re-laid their canvas. Ask for it explicitly. Only the shape that names NO list is whole-canvas: a list you pass must have at least one ID, so a filter that came back empty fails with `invalid_request` instead of quietly re-laying everything.

```json
{ "type": "tidy", "groupIds": ["GROUP-ID"] }
```

The CLI adds one gate on top of that: `tidy --all` is the only way to reach the whole canvas from a command line, and `tidy --nodes a,b,c` / `tidy --groups g1,g2` scope it (both may be given together; `--groups` is plural because the bridge takes a list, unlike `run-batch --group`, which expands exactly one). A bare `scenemint-canvas tidy` is `invalid_argument`, and a comma list that resolves to zero IDs is an error rather than a widening — the same rule the page applies. This is a guard on the default, not a permission boundary: `apply` with a raw `{"type":"tidy"}` still reaches the whole canvas, which is what a programmatic caller uses. Prefer `--nodes`/`--groups` and keep `--all` for a tidy the user actually asked for.

One frame at a time has its own verb: `resize-group GROUP-ID --fit` (or `--size 1800x1200`), with `--absorb-strays` as the explicit, off-by-default switch that takes ownerless loose nodes into the frame. It synthesises the same `resize_group` command described above, so everything that section says — the members' floor, `clamped[]`, `absorbed[]`, never stealing another group's member — applies unchanged.

**Wrong:** `{"type":"tidy","nodeIds":[]}` → `invalid_request` "expected at least one node" — deliberately, so a scope that filtered down to nothing can never become a whole-canvas run. A `groupIds` entry that is not a group is `invalid_command` `node is not a group: <id>`.

#### `tidy --scope` — 整理画布, the conservative pass

Adding `scope` switches to a different algorithm: it **fixes what is broken and touches nothing else**. A frame whose members outgrew it is refitted; members stacked on each other are re-packed into a `min(6, ceil(sqrt(n)))`-column grid; a member that escaped its frame is brought back under the ones that stayed; frames overlapping each other are pushed apart along the dominant axis, in reading order, so their relative order survives; a pile of loose nodes is spread onto a grid anchored at the pile itself; a loose node overlapping a frame's edge is pushed off it. **Membership is never rewritten** — `parentId` is read, never written — so a loose node whose centre sits _inside_ a frame it does not belong to is **reported, not moved**: it comes back in `apply.tidied[].strays`, and you hand those ids to the user rather than guessing whether they were meant to join.

It is **idempotent**: run it on an already-tidy canvas and it plans zero commands, `ok:true`, nothing written. That makes it safe to run twice; it also means "it changed nothing" is a real answer, not a failure.

| Field       | Meaning                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope`     | `all` (the canvas) · `groups` (frames and members only, loose nodes untouched) · `selection` (needs `nodeIds` and/or `groupIds`; a member id counts as its group) |
| `fitFrames` | also **shrink** frames to their members. Default grows only, so a frame the user deliberately enlarged stays enlarged. Needs `scope`.                             |

Because it never re-lays hand-placed work, `--scope all` does **not** need the `--all` guard and raises no "an agent re-laid your canvas" notice.

✅ **Right — the canvas came back from a rebuild with giant frames and overlapping groups:**

```json
["tidy", "--scope", "all", "--fit-frames"]
```

✅ **Right — just the frames, leave the loose nodes alone:**

```json
["tidy", "--scope", "groups", "--fit-frames"]
```

✅ **Right — only what the user selected:**

```json
["tidy", "--scope", "selection", "--groups", "GROUP-A,GROUP-B"]
```

❌ **Wrong — the whole-canvas re-layout when the user said "整理一下":**

```json
["tidy", "--all"]
```

That is 整理布局, not 整理画布: it re-flows everything the user placed by hand, lands as your undo step (their Ctrl+Z cannot reverse it) and shows them a notice. Use `--scope all` unless they asked for a full re-layout.

**Wrong:** `--fit-frames` without `--scope` → `invalid_argument` "--fit-frames needs --scope all|groups|selection". `--scope selection` with no id list → `invalid_argument`. `--scope` together with `--all` → `invalid_argument` "tidy takes either --scope or --all, never both". A bogus scope → `invalid_argument` "--scope must be one of: all, groups, selection".

The reply carries `apply.tidied[]`: `{command, moved, resized, strays[]}` — how many nodes changed place on screen, how many frames were resized, and the stray ids. Quote those numbers back; do not claim more. Alongside it the reply carries `apply.tidySummary`, the same entries as one text line each, e.g. `tidy (commands[0]): moved 2, resized 1, 2 strays left untouched (a human must place them): n4, n5`. Both fields are present **whichever path the tidy came in on** — a bare `apply` batch with a `tidy` command in it, or the CLI's `tidy`. Paste `tidySummary`: "applied 1 command" with no numbers in it is exactly what this field exists to replace.

**Always report the strays by id.** They are the nodes 整理 deliberately refused to move, and this list is the only signal that something on the canvas needs a person: name the ids to the user and ask, do not group them yourself and do not summarize them as "a few".

Every `tidy` reports, the plain whole-canvas form (`tidy --all`, or `apply` with a bare `{"type":"tidy"}`) included — there its `moved` / `resized` tell you how much of the user's own layout you just rewrote, and `strays[]` is always `[]` because that pass refuses nothing.

### `duplicate_node`

**Required** `nodeId`. **Optional** `count` (1..20, default 1), `position` (the **first** copy's top-left), `layout` (`row` | `column`, how further copies step from the first).

Native duplicate semantics: incoming edges are inherited (with fresh ids that are _not_ reported), the parent is stripped so a copied member lands top-level at its absolute position, runtime state is cleared, and the title gets the locale copy suffix ("副本"). Without `position` the first copy lands in genuinely free space beside the source; further copies step by the previous copy's size plus 48.

```json
{ "type": "duplicate_node", "nodeId": "NODE-ID", "count": 4, "layout": "row" }
```

**Wrong:** `{"type":"duplicate_node","nodeId":"GROUP-ID"}` → `invalid_command` "duplicate_node cannot copy a group; duplicate its members". To copy a group's contents use `duplicate_nodes`. `count: 50` → `invalid_request` "expected 1..20".

### `duplicate_nodes`

**Required** `nodeIds[]` (at least one). **Optional** `offset` `{x, y}`.

The editor's copy + paste of a selection (`duplicateSelectionInGraph`): a group in `nodeIds` expands to its members (the frame itself is not copied — copies land top-level at their absolute positions), **edges between two copied nodes are remapped onto the copies**, and other incoming edges are inherited. Runtime state is cleared and titles take the copy suffix. `offset` shifts the whole copy relative to the original's top-left; without it the copy lands in free space beside the original — clear of the frames of the groups it was copied from as well, because a copy is not a member and must not sit inside one. `created[]` has one entry per copy.

<!-- prettier-ignore -->
```json
{"type": "duplicate_nodes", "nodeIds": ["GROUP-ID", "NODE-X"], "offset": {"x": 0, "y": 900}}
```

**Wrong:** naming only empty groups → `invalid_command` (nothing to copy). An id that does not exist → `node_not_found`.

### `select_output`

**Required** `nodeId`, `outputId`. **Optional** `expectOutputId` (the current candidate's id, or `null` for none).

`select_output` adopts an existing candidate and propagates its output to connected nodes through the human picker path. Candidate `resources` rows expose `outputId`; use that field, not a resource ID or URL. Carry the current adopted candidate in `expectOutputId` to detect a human's intervening selection. A mismatch fails atomically with `stale` and `currentOutputId`; a removed candidate returns `resource_not_found`. Which candidate is "current" has two writable representations — the adopted pointer and the output the node actually displays — and they can disagree, because picking an image out of a node's history rewrites the displayed one without moving the pointer. When they disagree there is no single current candidate, so a supplied `expectOutputId` fails `stale` naming both rather than letting the precondition pass against a pointer the user is not looking at. Omitting `expectOutputId` still adopts, which is how you repair such a node: **whenever `select_output` (or any verb that adopts) returns ok, the pointer and the displayed output agree again** — that postcondition, not "which one is the truth", is the thing to re-read and rely on. It is an ordinary Agent-owned undo step, but whole-node Yjs writes from later collaborators can supersede individual nodes within that step. Re-read the resulting choice and references after undo.

<!-- prettier-ignore -->
```json
{"type": "select_output", "nodeId": "NODE-ID", "outputId": "OUTPUT-ID-FROM-RESOURCES", "expectOutputId": "CURRENT-OUTPUT-ID-FROM-RESOURCES"}
```

**Media-upload nodes too:** on a `media-upload` node `outputId` is an image-history / video-history entry id (those `resources` rows carry `outputId` as well), and `expectOutputId` is the entry currently displayed.

**Wrong:** passing a `resourceId` (the `r1:candidate:…` form) where `outputId` belongs → `resource_not_found` at `commands[0].outputId`. Downloading a candidate does not adopt it; only this command does.

### `delete_output`

**Required** `nodeId`, `outputId`. **Optional** `expectOutputId` (same compare-and-set as `select_output`).

The candidate picker's ✕ (`deleteNodeOutput`). On a gen node, deleting the adopted candidate promotes the next one and propagates it; deleting the last one leaves the node with no output. On a media-upload node it removes one image / video history entry — **the entry currently displayed cannot be deleted** (`invalid_command`: `select_output` another first). Refused while the node is running (`node_running`). Workers cannot send it.

<!-- prettier-ignore -->
```json
{"type": "delete_output", "nodeId": "NODE-ID", "outputId": "OUTPUT-ID-FROM-RESOURCES", "expectOutputId": "CURRENT-OUTPUT-ID"}
```

**Wrong:** an `outputId` that is no longer on the node → `resource_not_found`; relist `resources`.

### `split_output`

**Required** `nodeId`, `outputId`. **Optional** `position` (absolute top-left).

The picker's 拆分 (`splitGenOutput`): a **new** gen node holding only that candidate as its primary output, with the source's settings; the source's content is not modified (the candidate stays, its adopted output is unchanged). Default position: right of the source (source width + 88, staggered 36 px per earlier split of the same image). The new id is in `created[]` (`kind:"gen"`). Gen nodes only.

**Source inside a group:** the new node joins that same group — it is in the group's `childIds` and has `parentId`, so it moves with the frame and is deleted with it. It lands at the same on-screen spot, and the frame grows (never shrinks) until it covers the new node; if the frame's origin has to move, every member keeps its place on screen and only its frame-relative coordinates change. This holds for an explicit `position` too — a far-away `position` stretches the frame out to it. To keep the copy outside the group, `remove_from_group` alone is not enough: the node stays exactly where it is, still sitting on the frame (it looks grouped, and `health` reports `stray_over_frame`), so `move_node` it off the frame as well — it is top-level by then, so `position` is absolute. The frame only ever grows, so if the split stretched it, `resize_group {fit:true}` pulls it back in when needed. If the source was the group's only member, `remove_from_group` dissolves the group instead (`dissolved[]`) and there is no frame left to clear.

```json
{ "type": "split_output", "nodeId": "NODE-ID", "outputId": "OUTPUT-ID-FROM-RESOURCES" }
```

**Wrong:** a media-upload node → `invalid_command`; copy it with `duplicate_node` instead.

### `clear_output`

**Required** `nodeId`.

The node menu's 清空媒体 (`clearNodeMediaInGraph`): primary output, every candidate and history entry, poster, last frame, local path and (media-upload) the asset identity go; the node stays with status `idle` and downstream nodes lose the input. Refused while running (`node_running`); a scene-3d or group node has no media (`invalid_command`). Destructive — say what will be cleared first. Workers cannot send it.

```json
{ "type": "clear_output", "nodeId": "NODE-ID" }
```

**Wrong:** clearing to "rerun from scratch" — a rerun already keeps old candidates; `run --fresh` is the explicit discard.

### `reset_status`

**Required** `nodeId`.

The failure bar's 重置状态 (`resetNodeStatus`): `failed` or `dirty` → `idle`, error cleared, outputs untouched. `idle` is a no-op; `succeeded` is `invalid_command`; a running node (or one with a task in flight) is `node_running` — use `cancel`.

```json
{ "type": "reset_status", "nodeId": "NODE-ID" }
```

**Wrong:** expecting it to rerun anything — it submits nothing.

### `adopt_output`

**Required** `nodeId`, `url` (https, on one of the trusted media hosts: `cdn.echojoy.cn`, `file.echojoy.cn`, `*.myqcloud.com`, `*.tos-cn-beijing.volces.com`).

`adopt_output` registers an image that came from outside the node — a file the user dropped onto the canvas, another node's output — as one of that node's own candidates and makes it the primary, running the same code a finished generation runs. Like a rerun, it appends: the node's earlier image candidates stay in the group (the adopted row has `runId: null` and no `promptSha` in `resources`). Use it when the user names an existing picture as a node's result ("this one is the reference sheet for that character"), not to invent an output the node never had. The target must be a `gen` node in image mode, must hold no video candidate at all (adopting an image would discard the node's video candidates, so that is refused with `invalid_command` — judged on the candidate list, not on what the node currently displays), and must not be running. `url` must be https on a trusted media host, so copy it from `snapshot` or `ls --long` (those URLs already qualify), and `upload` a local file first rather than passing a local path. Only a node's current primary output has a URL in those replies; `resources` returns identities and metadata, never URLs, so to adopt another node's alternative take, first `select_output` it into that node's primary and read the URL back. The reply's `created[]` carries `{kind:"output", id}` with the new candidate's `outputId` — hold it for a later `select_output` or `expectOutputId`. The candidate's recorded prompt is deliberately left empty: the image was not generated from this node's prompt, and the node's own prompt text is not copied onto it. Adopting the same URL twice adds no second candidate, and re-adopting what is already the node's current output changes nothing at all (no undo step). To choose between takes the node produced itself, use `select_output`.

```json
{ "type": "adopt_output", "nodeId": "NODE-ID", "url": "https://HOST/PATH-FROM-SNAPSHOT.png" }
```

**Wrong:** a `blob:` / `data:` / `file:` / plain `http:` URL, or an https URL on any other host → `invalid_request` "expected an https URL on cdn.echojoy.cn, file.echojoy.cn, *.myqcloud.com, *.tos-cn-beijing.volces.com"; nothing could download such a candidate later. Adopting onto a node that holds a video candidate → `invalid_command`; delete the video takes on the canvas first or pick another node. Adopting onto a running node → `node_running` (retryable once it settles).

### `recover_deleted`

**Optional** `nodeIds[]` (at least one when present).

The canvas bar's 恢复最近删除 (`recoverRecentDeletes`): nodes from this page's recent-deletes buffer come back with their original ids, positions and group membership, plus every buffered edge whose two ends are both on the canvas again. Omit `nodeIds` to recover everything (the button's behaviour). The buffer holds the last 500 deleted nodes, human and Agent deletes alike, **in this browser tab's sessionStorage** — a different tab or a reloaded session has its own. The reply's `recovered:[{command, nodeIds, edgeIds, notFound?}]` lists what came back and which requested ids the buffer did not have. Workers cannot send it.

```json
{ "type": "recover_deleted", "nodeIds": ["NODE-A"] }
```

**Wrong:** `"nodeIds": []` → `invalid_request` (an empty filter never widens to "everything"). Reporting everything restored without reading `notFound`.

### `select`

**Required** `nodeIds[]` (may be empty — clears the selection).

Selects and highlights nodes in the human's editor, the same as clicking them, to show the user what you mean. Non-mutating, not undoable, not synced to collaborators. The reply's `selected:[{command, nodeIds, shown, reason?}]` says whether it happened; `reason:"no_selection"` = this host has no editor selection.

```json
{ "type": "select", "nodeIds": ["NODE-A", "NODE-B"] }
```

**Wrong:** an id that does not exist → `node_not_found`, whole batch refused.

### `focus_node`

**Exactly one of** `nodeId` (one node), `nodeIds[]` (their joint bounding box, at least one) or `all: true` (the whole canvas). **Optional** `fill` — a number in **(0, 1]**, default **0.5** — the fraction of the visible pane the target should cover.

This is the command that actually **moves the human's camera on the open page**, with a 320 ms animation, without asking. It is non-mutating and not undoable, and it does not sync to other collaborators. Use it sparingly and only when the user asked to be shown something.

It works on a **group** exactly as on a node — pass the group id and the whole frame is brought into view. Do not expand, ungroup or enumerate members first.

**Did it actually happen? Read `focused[]`, not `ok`.** `focus_node` and `select` are the only two commands whose effect is not in the document (`select` reports in `selected[]`, above): the batch they ride along with commits either way, so `ok:true` proves only that the write landed. The reply carries `focused:[{command,nodeId,framed,reason?}]` (`nodeIds` or `all:true` in place of `nodeId`, echoing how you named the target) — one entry per `focus_node` in the batch, **always present when the batch held one**, including when nothing moved.

| `focused[i]`                           | What to tell the user                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `framed: true`                         | 「已经帮你定位到 X 了」 — the camera animated there.                                                                                                                                                                                       |
| `framed: false`, `reason:"unmeasured"` | The page has no geometry for that node yet (off-screen in a big canvas, or you created it in this same batch). Say you could not move their view and name the node / its path so they can find it; a retry after it is on screen can work. |
| `framed: false`, `reason:"no_camera"`  | This host has no canvas camera at all — **no** `focus_node` will ever work here. Stop trying; report the node by name and path instead.                                                                                                    |

```json
{ "type": "focus_node", "nodeId": "NODE-ID", "fill": 0.6 }
```

**Wrong:** `"fill": 0` or `"fill": 1.5` → `invalid_request` "expected number in (0, 1]" at `commands[0].fill`. Two of `nodeId` / `nodeIds` / `all` together → `invalid_request`. Telling the user "你现在看到它了" on the strength of `ok:true` alone — that is the field above's whole reason for existing.

### `upload_asset`

**Required** `path`, `fileName`, `mimeType`, `bytesBase64`. **Optional** `position`, `title`, `id`, `targetNodeId`.

Do not build this command by hand: `scenemint-canvas upload FILE` constructs it from a workspace file, which is the only way the bytes get read. Uploads run **before** the transaction, so a failed upload rejects the whole batch with nothing written. Payload cap is 25 MiB decoded. The new node lands `succeeded` with the imported media, and `position` defaults to free space to the right of everything else.

`targetNodeId` (`upload FILE --into NODE-ID`) replaces the file of an **existing** `media-upload` node instead: id, title, position, tags and edges stay, the new file's `mediaAssetId` is recorded exactly like the node's own 替换文件, old history is cleared, and downstream nodes get the new file. Nothing is created (`created[]` is empty). It cannot be combined with `id` / `position` / `title` (`invalid_request`); a missing target is `node_not_found` and a non-media-upload target `invalid_command`, both before any byte is uploaded.

**Wrong:** `bytesBase64` over the cap → `too_large`. A mime type the canvas does not import, an image the preparer rejects, or a file service that returns no durable file identity → `upload_unsupported`, with `error.reason` one of `no_importer`, `unsupported_mime`, `unsupported_image`, `no_durable_file`, `upload_failed`. Only `upload_failed` is worth retrying; the others need a different file. **Workers cannot use this command at all** — the daemon refuses the whole batch with `worker_forbidden` before execution.

### `export_output`

**Required** `nodeId`, `path`. **Optional** `resourceId`.

Non-mutating: it only _describes_ an export. The result lands in `ApplyResult.exports[]` as `{command, nodeId, url|content, mimeType, fileName}` and **nothing is written to disk** — `path` is the host's concern. To actually get a file, use `download NODE --out FILE`. Because it writes nothing, a batch containing only `export_output` commands is permitted even on a read-only canvas.

```json
{ "type": "export_output", "nodeId": "NODE-ID", "path": "shot-01.png" }
```

**Wrong:** a node with no output → `invalid_command` "节点还没有输出"; an output that is not an http(s) URL → "输出不是可下载的 URL". A `resourceId` that is not the exact `r1:<source>:<16 hex>:<part>` form `resources` returned → `invalid_request` "Invalid resourceId; use resources first"; one that no longer belongs to the node → `resource_not_found`. **Workers cannot use this command at all.**

### `scene3d_apply`

**Required** `nodeId` (a `scene-3d` node), `baseDigest`, `actions` (1..200). Nothing else.

Changes the 3D scene inside one scene-3d node — the 3D director desk (convention `scene3d@1`) — through the same reducer the desk itself uses. You never send the scene whole: you send **actions**, planned against the scene you read, and the page applies them to the scene as it is now. A full copyable batch, its reply and the conflict / still / generation steps are scene 6f above.

- **`baseDigest`** is the previous reply's `sceneDigest` (`scene3d[].sceneDigest`, also in `scene3dSummary`; after `undo` / `redo`, their `scene3d[]`) — relay it, do not re-read. An `undo` entry with `fallback:true` is the exception: the undo fell back to an older scene, so re-read before applying. Only when the session has none yet, `read NODE-ID/output` (digest, `sceneSummary`, still state; not the whole scene). Never read a scene through `snapshot`: its scene-3d row carries counts and the digest only. Anything else is `scene3d_conflict` (see the error table). For a node that an `add_node` **earlier in this same batch** created, write `"new"`; `"new"` on any other node is `invalid_request`. The check is against the scene this page has; it is not a lock across collaborators.
- **One `scene3d_apply` per node per batch.** A second one is `invalid_request` at its `nodeId` (its base would be a digest you could not have known). Put all the actions in one list.
- **Units.** Metres, y up, ground y = 0; a figure's feet are at `transform.position` and it faces +z (its right hand on −x). Angles on the wire are **degrees** (`rotation`, `orbit.from` / `orbit.to`); the page stores radians, `read` gives degrees back. Yaw and orbit angles share one convention, seen from above: `rotation.y = θ` turns an object's front from +z to (sin θ, 0, cos θ) — 0° faces +z, 90° +x, −90° −x, 180° −z — and an `orbit` camera sits at x = center.x + r·sin θ, z = center.z + r·cos θ (0° on the centre's +z side, 90° on its +x side). Furniture at `rotation.y` 0: `chair` / `sofa` have their backrest on −z and `chair` / `sofa` / `bench` seat a figure facing +z, a `bed`'s headboard is on −z, `stairs` rise towards +z, `door` / `window` frames stand in the x–y plane (walked through along z); the other prefabs have no front. To turn a piece towards a point, `rotation.y` = atan2(point.x − x, point.z − z) in degrees. `fov` is the **vertical** field of view in degrees (2–140). `focal` (mm, 8–400) may stand in for it — converted on a 36 mm long edge at the scene's aspect ratio when the action lands — but never both (`fovTo` / `focalTo` alike). A point is always `{x, y, z}`.
- **Creating never overwrites.** An `add_object` / `duplicate` / `add_shot` id that is taken becomes `-2`, `-3`, …; later actions in the batch that name the requested id reach the new one, and `applied[k]` carries `{op, id, requestedId}`. Once a create is renamed, the older object / shot of that id cannot be named for the rest of the batch (a `reorder_shots` listing both fails) — touch it in the next batch.
- **References are not checked.** `look`, `lookTo`, `facing`, `gaze`, `ends` and `moves[].who` naming a missing id are written as they are (delete-then-create in one batch is normal) and come back in `checks.health` as `missing_ref`.
- **The page repairs data, never intent** (0.18.0, `scene3d[].repairs[]`, `SCENE3D.repairs`). After your actions land and before the self-checks, the page fixes only what leaves who sits / stands / holds what as you wrote it, only for what this batch touched, never anything a human changed in the desk: a box / cylinder whose bottom is below the ground is lifted onto it (`grounded`); since 0.18.1 a standing / crouching / kneeling figure whose soles are within 0.1 m of the surface under them (floor, platform / step top, furniture top; floating or sunk) is put on it (`figure_grounded`, `FIGURE_GROUND_MAX_M`; sitting / lying / prone figures are left alone; a farther gap stays a `support_gap` reminder whose message ends with `建议挪到 (x, y, z)（贴到…上）` and carries `fix`, a `transform` to send as is); a held object stored within 0.3 m of its hand is moved onto the hand (`held_to_hand`; farther ones stay a `held_offset` warning); a standing figure inside furniture / a wall that ≤ 0.1 m of horizontal movement frees is pushed out the shortest way (`pushed_out`; the reason gives the depth and the actual move, which adds 5 mm so it does not touch — at most about 0.105 m; a deeper one is not moved — its `body_penetration` still blocks, and that issue's message ends with `建议挪到 (x, y, z)` and carries `fix`, a `transform` action to send as is); a camera this batch created that equals an earlier one is merged into it (`camera_merged`; the earlier camera keeps its name — a name you gave the new one is not carried over, the reason says so, send `set_camera name` to that camera if you want it). Each entry is `{code, id, field, from, to, reason}`; `scene3dSummary` adds a `修数据 N 处…` line. Write the repairs back into your own plan. Since 0.18.2 (A102 ④, `SCENE3D.contact.floorSlab`) a box / cylinder whose centre stands over a **floor slab** — a level `box` with prefab `floor` (any thickness), or role `set`, no prefab or `platform`, at most 0.3 m high — and whose bottom sinks into it is set on the slab's top, not on y 0 (`grounded`, reason 「底面陷进 <地板>（地板顶面 y = …）：落到地板顶面」); walls, doors, windows, pillars, stairs, floors and platforms are not lifted, and a floor slab whose top is not below y 0 is left where it is (its top is the ground — lowering a 0.1 m floor box to top y 0 is a valid fix). The nearest free spot of a standing figure (`建议挪到 …` + `fix`) is computed from the stored scene after the repairs, by the same function `read` uses: `read NODE` / `NODE/checks` carry the same messages and the same `fix` as the `apply` reply (0.18.1 had them in `apply` only), and so does a stored-scene `support_gap`. A `seat` on something without a seat (`invalid_support`, 「X 没座面」) is never rebound and the pose never changed: replace it with a `chair` / `stool` / `sofa` / `bed` prefab, or give it a seat.
- **Problems come back all at once** (0.18.0). Every shape / vocabulary / range problem of the batch's actions — several fields of one action, several actions, acts judged as merged, the whole blocking table — is one `invalid_request`: `error.path` is the first, `error.issues[]` lists each `{path, message}`, and the message names them all (up to 12; `issues` has every one). Fix them all, then resend once. A single problem reads exactly as before (no `issues`). An unknown op / field is refused by the daemon at the first one, and the CLI `hint` names every other action of the batch with one.
- **`set_figure` is a patch**: only the fields it gives change (`{"op":"set_figure","id":"boss","pose":"sit"}` keeps `arms`, `facing`, `gaze`, …); `applied[k].fields` lists the fields it gave.
- **`null` clears**: `set_axis {ends:null}`, `set_focus {shape:null}`, `set_figure {facing:null}` / `{gaze:null}`, and every optional field of `update_shot` except `look`, `fov`, `n`, `focal`, `focalTo` (clear a zoom with `fovTo:null`).
- One batch is one undo step. It never changes the node's `status`: a still goes stale when `renderedDigest !== sceneDigest`, or when it was drawn by an older page whose drawing has since changed (`read` / `snapshot` say `stale`; `sceneSummary` says `已过期（画法更新过…）` for the second case) — either way, `run` it again.
- `remove` / `remove_shot` / `remove_act` delete things (`tiers.applyCommands.scene3d_apply.destructiveOps`). Since 0.18.0 the desk marks every object / shot a human changed there (`editedBy:"human"` in the scene — creating it, moving it, editing it, or giving a figure blocking all count — reordering shots does not, even when it pins the follow-edit shots' story `start`; `read NODE/scene` shows it, the scene text says `人改过`; you cannot write or clear it): `remove` / `remove_shot` on an **unmarked** one just run — rebuilding a scene from your plan needs no question — while on a **marked** one the whole batch is `approval_required` (nothing written, the message names them) until resent with the scene node in `approval.userApprovedNodeIds` (`apply --approved`, after the user agreed; `SCENE3D.humanEdit`). `remove_act`: tell the user first, as before. A `baseDigest:"new"` batch only removes what it just created (the default figure). Workers may send the command, but cannot approve.
- **Anchors and scale.** `position` is a human's feet, a box's / cylinder's centre (on the ground its y is half its height), a plane's centre, a backdrop's bottom-edge midpoint. `scale` is a **multiplier** on the prefab footprint (or 1 m); `scale.y` does nothing on a plane and `scale.z` nothing on a backdrop; a human's size is its `bodyType`.
- **Partial vectors.** An object's `position` / `rotation` / `scale` (in `add_object.transform` and `transform`) may give any subset of x / y / z; missing components keep their value, and `add_object` without `position.y` lands on the ground. Camera points — `set_camera` `position` / `target`, a shot's `cam` / `to` / `orbit.center` — need all three ("镜头点要 x / y / z 三个分量"). Wire angles are rounded to 4 decimals before conversion.
- **`facing` gives way to `rotation.y`.** On a figure that has `facing`, a `transform` whose `rotation.y` differs from the stored one (compared at 4 decimals) drops `facing`; the reply says `applied[k].cleared: ["facing"]` and the summary `清掉 <id>.facing（rotation.y 覆盖）`. `set_figure {facing:null}` keeps the heading you saw by writing it into `rotation.y`.
- Limits: objects ≤ 100, cameras ≤ 12, shots ≤ 60 per scene, acts ≤ 200 per scene, ≤ 20 `moves` per shot, ≤ 8 `via` points per shot or act, `at` / `start` 0–600 s; text fields ≤ 500 chars, `name` ≤ 60, `prefab` ≤ 64; ids match `[A-Za-z0-9_.-]`, 1–128 chars; `color` is `#rrggbb` — leave it out and the page colours a figure or prop by its name (same name, same colour; set pieces grey; an object added without a name stores its kind's default name, `scene3d.identity.defaultNames`, and is coloured by its `id`; the palette and rule are `CANVAS_CONTRACT.scene3d.identity`, the functions `scene3dIdentityColor` and — from a stored object — `scene3dDefaultColor` from `@scenemint/canvas-cli/contract`). Vocabularies, the 24 prefab footprints and 16 aliases, ranges and units are data in `CANVAS_CONTRACT.scene3d`.
- **Prefabs** (24, footprints in `CANVAS_CONTRACT.scene3d.prefabs`): `wall` `floor` `door` `window` `pillar` `stairs` `platform` `counter` `table` `desk` `chair` `stool` `bench` `sofa` `bed` `shelf` `cabinet` `screen` `lamp` `plant` `tree` `rock` `car` `streetlamp`.
- **Aliases** (16, resolved on write): `bar`→`counter` `nightstand`→`table` `armchair`→`sofa` `couch`→`sofa` `bookshelf`→`shelf` `rack`→`shelf` `wardrobe`→`cabinet` `fridge`→`cabinet` `tv`→`screen` `monitor`→`screen` `column`→`pillar` `step`→`platform` `stage`→`platform` `bush`→`plant` `truck`→`car` `lamppost`→`streetlamp`. Anything else (`cup`) is kept and drawn by `kind`: give `kind` yourself, or the batch is `invalid_request` at `.kind`; the CLI's `hint` (refused) or last `notes[]` line (drawn, `unknown_prefab`) names the closest words (0.17.0).

| `op`            | Fields (**required**)                                                                                                                                                                                                                                                                                                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_object`    | `id` **`role`** `kind` `prefab` `name` `transform {position?, rotation?, scale?}` `color` `bodyType`                                                                                                                                                                                                                           | New object. `kind` may be omitted when a known `prefab` (or alias) or `role:"figure"` implies it (explicit wins; an inferred one comes back as `applied[k].kind`). `role:"figure"` goes with `kind:"human"` and only with it; `bodyType` only on `human`. A known `prefab` (aliases resolve: `bar` → `counter`) supplies the default `scale`; a box / cylinder without `position` stands on the ground. An unknown `prefab` is kept and drawn by `kind`, with a `unknown_prefab` warning                                                                                                                                                                                                                                                                                                                                                                                                        |
| `transform`     | **`id`** `position` `rotation` `scale` `color` (at least one)                                                                                                                                                                                                                                                                  | Patches each group you give, per component (`{"rotation":{"y":60}}` leaves x / z alone); `color` (`#rrggbb`) recolours the object — the fix an `identity_color_clash` warning spells out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `remove`        | **`id`**                                                                                                                                                                                                                                                                                                                       | Deletes an object; references to it stay (and are reported)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `duplicate`     | **`id`** `newId`                                                                                                                                                                                                                                                                                                               | Deep copy, 0.5 m along +x, name + ` 副本`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `set_camera`    | **`id`** `name` `position` `target {x, y, z}` `fov` \| `focal` `active`                                                                                                                                                                                                                                                        | Patches that camera, or creates it from the default camera's start values (`applied[k].created:true`); `target` is a point only, never an object id; `active:true` (only `true`) makes it the active camera — the one a still uses when the scene has no shots                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `set_scene`     | `aspectRatio` `gridSize` (at least one)                                                                                                                                                                                                                                                                                        | Aspect ratio (`1:1` `16:9` `9:16` `4:3` `3:4`) and grid                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `set_figure`    | **`id`** `pose` `arms` `armL` `armR` `facing` `gaze` `seat` `lean` `heldL` `heldR` `bodyType` `offstage`                                                                                                                                                                                                                       | Figures only (`invalid_command` otherwise). `facing` / `gaze` take an object id or a point; `facing` turns the body toward it and overrides `rotation.y`. `offstage:true` (0.18.2): not on stage at the start — not drawn, checked or framed until an act `do:"@enter"`; `false` / `null` clears it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `set_axis`      | **`ends`**: `[id, id]` or `null`                                                                                                                                                                                                                                                                                               | The line of action; both ends the same id is `invalid_request`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `set_focus`     | **`id`** **`shape`**: `disc` `box` `ball` `stick` or `null`                                                                                                                                                                                                                                                                    | Marks a prop or set piece as the focus object (not a figure); a mark only — the object is drawn as before                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `add_shot`      | `id` `n` `title` `framing` `dur` `pace` `beat` `lens` `intent` `cam` **`look`** `fov` \| `focal` `to` `lookTo` `fovTo` \| `focalTo` `moveEase` `orbit {center, r, from, to, y?}` `moves [{who, from, to, t}]` `states [{who, from?, to?}]` `cuts []` `onAxis` `start` `via [{t, cam, look?, fov? \| focal?}]` `follow` `shake` | Appends a shot. Needs `fov` or `focal`, and `cam` or `orbit`. `n` defaults to the highest `n` + 1; `id` defaults to `shot-` + (highest `n` + 1) even when you give `n`. A shot with both `cam` and `orbit` is an orbit shot: `orbit` wins and `cam` is ignored. `to` / `lookTo` / `fovTo` move the camera over the shot; `orbit` circles `center` at radius `r` from `from` to `to` degrees, `y` the absolute camera height; `moves` offset objects over `t:[t0, t1]` (0–1) 0.17.0: `start` is the story second the shot begins (omitted = follows the edit: the previous shot's `start + dur`, echoed as `applied[k].start`); `via` (≤ 8, `0 < t < 1` increasing) are waypoints between `cam` and `to` — it needs `to` and cannot go with `orbit` (`invalid_request` at `via`); `follow:"<figure id>"` moves the camera with that figure; `shake` (`light` `medium` `heavy`) is handheld shake |
| `update_shot`   | **`id`** + any `add_shot` field                                                                                                                                                                                                                                                                                                | Patches a shot; `null` deletes a field; a shot left with neither `cam` nor `orbit` is `invalid_command`. Back from an orbit to a fixed camera: `cam` **and** `orbit: null` in the same action — a `cam` alone on an orbit shot changes nothing and no check flags it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `reorder_shots` | **`order`**                                                                                                                                                                                                                                                                                                                    | Every shot id exactly once, in the new order (`n` is not renumbered; reports such as `cuts[].from` / `to` and the summary speak in `n`, so renumber with `update_shot {n}` when they should read in order)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `remove_shot`   | **`id`**                                                                                                                                                                                                                                                                                                                       | Deletes a shot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `add_act`       | **`who`** **`at`** `id` `dur` `to` `via` `gait` `pose` `arms` `armL` `armR` `facing` `gaze` `hold` `hand` `gesture` `note` `do`                                                                                                                                                                                                | 0.17.0. A blocking act: from story second `at`, `who` walks (`to` an object or a point, `via` up to 8 points; points may omit `y` = on the ground), changes `pose`, turns (`facing`), looks (`gaze`), picks a prop up (`hold`, with `hand`) or puts it down (`"@drop"`, it falls onto the first surface below), plays a `gesture` (`point_at` needs `gaze` in the same act). A prop as `who` takes only `to` / `via` / `facing`. Omitted `dur` is derived (walk = path ÷ 1.4 m/s, run 3.5; turn 0.5 s; pose by the transition table; arms 0.4; gaze 0.3; hold / drop 0.5; gesture 1.5) and echoed as `applied[k].dur`. `id` defaults to one the page generates (`applied[k].id`). 0.18.2: `do:"@enter"` (figures only; with at most `to` — a point — and `facing`) makes the figure appear at `at`, `do:"@offstage"` (only `note` besides) makes it leave — see 6g                              |
| `update_act`    | **`id`** + any `add_act` field                                                                                                                                                                                                                                                                                                 | 0.17.0. Patches an act; `null` deletes a field. To put down / freeze the facing / look straight ahead write `"@drop"` / `"@keep"` / `"@none"`, never `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `remove_act`    | **`id`**                                                                                                                                                                                                                                                                                                                       | 0.17.0. Deletes an act (destructive, like `remove_shot`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

`seat` binds a seated figure to what it sits on: a chair/sofa/bed prefab (its actual seat surface, towards its front), anything drawn as a cylinder such as a stool (its top face; before renderer revision 4 a stool's sitter sank into it) or, since 0.16.4, a plain `box` / `cylinder` without a prefab (its top face). Since 0.18.0 the pelvis never sits further behind the edge of the sitting surface than the figure's shins reach (the ankle is 0.311 m × body depth × `scale.z` ahead of the pelvis, less 2 cm): a chair is unchanged, a sofa's sitter moves forward and a bed's sits on the edge at its foot, a stool's or a plain top face's only moves towards the side the figure faces when its shins would otherwise be inside — so a figure bound to a default `chair` / `stool` / `sofa` / `bed` is never blocked by its own seat (it still can be when it faces sideways on a sofa or a bed). Binding is optional (decision A83): a `pose:"sit"` figure without `seat` only gets the `seat_unbound` warning and is drawn at its own height, feet on its `y` — that is how to sit on the long side of a bed: stand the figure on the floor at that edge, back to the bed, then `pose:"sit"` (bound to the bed it sits on the edge at the bed's foot). `seat` on any other prefab (a table…) or on something that is not a box or cylinder is `invalid_support` (block). `heldL` / `heldR` bind a prop id to the respective hand. `lean` is torso pitch in degrees (-45..45), positive leaning forward (renderer revision 4 — earlier pages drew it backward); it applies to standing, sitting, kneeling and crouching figures, not to lying or prone ones. Set any of these four fields to `null` to clear a previous binding or lean. Furniture prefabs use identifiable parts (seat/back/legs, tabletops, mattresses and stairs), rather than a solid placeholder block. The self-check reports `body_penetration` (block) when any part of a figure's body — the torso (pelvis → waist → neck), the head, or either leg (hip → knee → ankle) — passes through a solid: a `box` (furniture by its parts, anything else as one block) or a `cylinder` (stools, pillars, lamps and plants are drawn as cylinders). Arms are not checked, things held do not count, the seat a figure sits on counts for its shins only, and standing on a tread, sitting on a seat or lying on a mattress is contact, not penetration. A figure that stands up from a chair has to step out of it (a `moves` entry), or its end still shows its legs through the seat; a figure seated backwards puts its thighs through the chair back. Two warnings (no block): `support_gap` — a standing figure's soles are more than 5 cm above (or into) the surface under its feet (the ground at y 0, a tread, a platform or furniture top): fix its `y`; `held_offset` — a held prop's stored position is more than 0.3 m from that hand (the renderer always draws it in the hand; compared in the stored scene and at the start of each shot only). One problem is one entry even when several frames have it; the message names the body parts, the furniture parts, the shots and frames. Since 0.18.2 (A102 ④, `SCENE3D.contact`) it also gives the **depth** — the shortest move that separates the deepest penetrating body segment from the furniture part, same geometry as the block (`人物 甲（a） 腿部穿入 椅子（chair） 的座面 0.03 m；…`; the foot below the ankle is not sampled, so a figure standing in a 0.2 m platform reads about 0.07 m; a depth that rounds to 0.00 reads `不足 0.01 m` and still blocks) — and what to change, often with a ready-to-send `fix`: **a seated figure bound to a seat follows the seat — changing the figure's own position does nothing.** Facing more than 25° (`SEAT_FACING_MAX_DEG`) away from the front of the chair / sofa / bed it sits on and penetrating it → 「他的朝向偏离 椅子（chair） 正面 40°（侧坐…）：把 椅子（chair） 转到 rotation.y = 40°…」 with `fix` `{op:"transform", id:<seat>, rotation:{y:<deg>}}` (turn the seat, or set the figure's `facing` to the seat's front); its legs in a floor slab because its seat sinks into the slab → `fix` lifting the seat onto the slab top; anything else (a table in front) → 「他坐着并绑了 X…：改 X 的位置 / 朝向 / 尺寸，或去掉他的 facing / lean」, no `fix`. The page never turns or lifts a seat for you. A penetration that only shows in scheduled frames (`add_act` walked the figure there) names the act — 「调度 walk-1（0.5 s 起走到 (3, 0, 0)）把他带进 台子（stage）：to 的 y 是 0（没写 y 就落在地面），写成 0.2 就站到 台子（stage） 顶面上（S01 结束…）」 — with `fix` `{op:"update_act", id, to, via?}` when the end / via point lies on what it entered and that top is at most 0.5 m high (`ACT_Y_MAX_M`) or it is a floor slab / platform / stairs; too high (a table) → move the act's `to` out of it; the path crossing it → add a `via` around it. An enter act (`do:"@enter"`) is named the same way — 「调度 c-in（3 s 进场，出现在 (x, y, z)）的落点在 X 的足迹里…：把这条调度的 to 挪到它外面」 (it takes no `via`: move its `to`); a figure off stage at the start whose enter act has no `to` appears on its stored spot — 「调度 c-in（3 s 进场，没写 to）把他放在存储的站位 (x, y, z)，那里穿进 X：…」 — and gets the standing suggestion for that stored spot, which it does not get when every entrance has a `to` (moving the stored spot would change nothing). The same act is named, with the same `y`, on that frame's `support_gap`: a floor slab's top is the support under a standing figure however deep the feet sink into it. Warning `sunk_in_floor`: a piece of furniture / a prop sunk into the floor slab under it that was not repaired (a human placed it, or this batch did not touch it), with `fix` lifting it onto the slab top.

`states` contains at most 20 figure entries `{who, from?, to?}`. Endpoint figure fields are pose, arms/armL/armR, facing/gaze, seat/lean/heldL/heldR; null clears a field. `cuts` is an ordered, flat list of 1..60 subshots, each with its own id, n, dur, beat, framing, cam/look/fov (or focal), movement and states. Durations must sum to the segment dur. Do not nest cuts. The segment start uses the first cut at 0, end uses the last at 1; intermediate cuts retain preceding endpoint state and movement for unchanged objects. Camera aiming and rendered figures use the same evaluated state. Fov is vertical degrees; focal uses a 36 mm long-edge sensor and the scene aspect ratio.

Script-to-video's product scenes — `kind` `scene-3d` with an id matching `CANVAS_CONTRACT.scene3d.embedded` (`new RegExp(idPattern, idFlags)`, e.g. `s3d-ep01-P02`, titled `ep01-P02导演台`) — have their card drawn and placed like any node since 0.18.1 (0.16.3–0.18.0 hid it), with an unstored dashed ownership line to each still and previz card it made (derived from `stillOf` / `previzOf`; not an edge, not in `mentionCandidates`) and 「出自 ep01-P02导演台 · S01 开始」 on those cards; by convention the card sits left of the scene's first triple in the same row or right above it, and when it (or one of its still / previz cards) overlaps another node `run-stills` / `run-shot-refs` add a `notes[]` line asking the product to rebase the canvas — never move it yourself. People see each shot's two stills above its video, titled `ep01-P02-S02开始站位` / `ep01-P02-S02结束站位`, open the director from a still's toolbar (a previz card's opens at the shot's start), and find the scene in the outline while a shot of it has no still. `ls` / `read` / `snapshot` list it as usual; its output is each shot's three references — the two stills (`run-stills`) and, since 0.18.0, a previz clip (`run --render video`): one `s3v-` card per shot titled `ep01-P02-S02运镜预演`, placed with that shot's two stills as a start / end / previz triple centred above its video (whichever lands first, the others line up with it), carrying `previzOf {sceneNodeId, shotId, sceneDigest}` (`stillOf`'s shape without a frame; no `sceneDigest` while the card shows another candidate than the one landed, `replaced: true` once its video was swapped) in `read` and in its `NODE/renders` row; a product previz is current by `sceneDigest` + renderer revision like the stills. Its length is the shot's `dur`; a shot under 2 s is rendered as is with a `notes[]` reminder (the product stretches it when attaching it as a reference). When the video column is too narrow for three cards the triple moves up to two rows up for free space, else overlaps right above the video — both with a `notes[]` line. The desk's previz for the scene lands the same card the same way. `run` without `--render video` (stills, sheets) is still `invalid_request` at `nodeId` (those cards would sit alone on the canvas) and `run-batch` skips it as `not_runnable`. Other 3D nodes keep their card. Character height sheets are `人物比例参考-…`. Still nodes record their renderer revision page-side (`stillOf.renderRev`, not part of the `read` / `ls --long` view; current renderer: 8 since 0.18.2 (7 in 0.18.1) — stills and previz drawn by an older renderer read as stale; run them again). Since 0.18.0 a product scene's stills are a bird's-eye overview (`CANVAS_CONTRACT.scene3d.overview`): a three-quarter overhead camera 30° to the viewer's right of the scene front (the active camera's target-to-position direction, `+z` for the default camera), 45° down, with a ground grid and no name labels; each shot's two stills pose the figures at its start and end. Since 0.18.1 the direction is one per scene but each shot is framed on its own figures and props only (start, end and each cut's start and end; in the shot = visible in its own camera or named by look / lookTo / follow; furniture and set pieces drawn, not framed) with a margin; every figure of the shot is kept whole in the frame first (feet and held objects included, at least 5 % of the frame height from every edge, `figureMarginRatio`), then the camera moves in along the same direction (re-centring in the image plane when needed) toward the tallest figure at a third of the frame height (`minFigureFraction`, a target, not a floor — a group too spread out to reach it stays whole and the reply's `notes[]` says 「镜 n：本镜人物分布宽，人偶约占画面高 X%」); one camera for a shot's start and end; stills and a product scene's previz are always 16:9, 1920 × 1080 (`aspectRatio`, `stillSize`, `previzSize`), whatever the scene's aspect. Since 0.18.2 (`overview.direction`) a room whose walls hide the figures gets, for the whole scene, the nearest of eight directions 45° apart from which no shot is blocked (a side with a door / window or no wall first among equals), else the camera moved into the room with the pitch raised up to 60°, else the default direction with the walls in front of the camera left out of the stills (`overview.cutaway`; shot stills and previz keep them); `notes[]` then opens with 「本场俯视方向：…」 (what changed and why). Other 3D nodes keep the shot camera and the scene aspect. Older generated pixels are refreshed on run-stills; a user-replaced image is retained unless force is explicitly requested.

`pose`: `stand` `sit` `kneel` `crouch` `lie` `prone`. `arms` / `armL` / `armR`: `down` `forward` `hold` `up` `cross` `back` `akimbo` `point`. `bodyType`: `standard` `tall` `short` `strong` `child`. `moveEase`: `linear` `out` (omitted = ease in and out). `gait`: `walk` `run`. `hand`: `right` `left`. `gesture`: `wave` `nod` `shake_head` `bow` `beckon` `point_at`. Shot `shake`: `light` `medium` `heavy`. Reserved words in acts: `"@drop"` (`hold`), `"@keep"` (`facing`), `"@none"` (`gaze`), `"@enter"` / `"@offstage"` (`do`, 0.18.2).

On an existing node, after a `read`:

<!-- prettier-ignore -->
```json
{"type": "scene3d_apply", "nodeId": "NODE-ID", "baseDigest": "SCENE-DIGEST-FROM-READ", "actions": [{"op": "transform", "id": "boss", "position": {"x": -0.9, "y": 0, "z": 0.9}}, {"op": "set_figure", "id": "boss", "pose": "sit"}]}
```

The reply's `scene3d[]` has one entry per `scene3d_apply` — `{command, nodeId, sceneDigest, applied[], checks}`, plus `timeline` when the scene has acts and `renders {stale[], fresh[]}` when the node has shot cards (0.17.0) — and `scene3dSummary` renders them as one line each. `checks` is `{health[], axis, cuts[]}` (plus `motion[]` when the scene has acts — `{level: "warn" | "info", code, message, path?}`, codes in `SCENE3D.checks.motionCodes`; reminders that never block, report them like `axis` / `cuts`, scene 6g): `health[]` entries are `{level: "block" | "warn", code, message, path?}` (a `block` stops a still of that shot; fix the data), `axis` says whether every shot keeps to one side of the line of action (`offside[]` lists the ones that do not), `cuts[]` judges each pair of neighbouring shots (`jump:true` = under 30° and will read as a jump cut; `exempt` = `moving` / `resize` / `subject` is why one under 30° does not). Report `axis` and `cuts` to the user as they are — they are shot-design findings, never something to silence by nudging a camera or flagging `onAxis:true` (SKILL.md, 自检立场). (0.17.0) When the batch added or updated shots, the entry also has `checks.framing[]` (`{level:"warn", code, shotId, objectId?, t?, message}`, codes in `SCENE3D.checks.framingCodes`; framing never blocks) and `framing[]` (per shot: subject, shot size, cut point, view, distance), both for those shots only; `scene3dSummary` prints them as `取景 镜n：…` and `镜n ⚠ <message>` lines. `read NODE-ID/checks` gives every shot's reminders; `read NODE-ID/framing` is the grid mode (per-object visible share, landmarks, a 41-point scan, and the only place `cam_too_close` / `foreground_fill` appear). Shape, vocabulary and range problems are `invalid_request` at `commands[i].actions[k].<field>`; problems that depend on the current scene (a missing `id`, `set_figure` on a non-figure, an `order` that is not a permutation, a limit) are `invalid_command`; a `nodeId` that is not a scene-3d node is `invalid_command`. A page older than this CLI answers `invalid_request` "Unknown or nested apply command" and the CLI adds a `hint` naming both remedies: ask the user to refresh the canvas page; if it still fails, the local daemon is the old one (a session that stayed connected through the upgrade) — `disconnect`, then `connect` again.

**Wrong:** `{"op":"transform","id":"boss","position":[1,0,2]}` → `invalid_request` "expected a point {x, y, z}" at `commands[0].actions[0].position`. **Wrong:** resending the batch that got `scene3d_conflict` (or the same actions with only the fresh `baseDigest` swapped in) — the scene changed under you; re-read and re-plan. **Wrong:** two `scene3d_apply` for one node in a batch → `invalid_request` at `commands[1].nodeId`.

## Runs, undo, and timelines

- Main `run-batch --nodes a,b,c [--group G] [--concurrency 1-200] [--rerun-succeeded] --approved` calls `run_nodes`. `--nodes` fills `approval.userApprovedNodeIds` with those IDs; `--group` needs the expanded member IDs supplied through `--json {"groupId":…,"approval":{"userApprovedNodeIds":[…]}}`; `read GROUP-ID` returns them as `memberIds`, which is the cheap way to build that list. Both `nodeIds` and `userApprovedNodeIds` are capped at **1000 entries** each (every id non-empty and ≤ 1024 chars), so a canvas larger than that has to be run in several batches. The page runs the batch in reference order with the concurrency cap and answers `{order,submitted:[{nodeId,taskId}],pending,skipped:[{nodeId,reason}]}` once the first wave is accepted; the rest continues on the page. Workers cannot invoke it. `run_nodes` takes only `nodeIds` / `groupId` / `concurrency` / `rerunSucceeded` / `clearCandidates` / `approval` (0.17.0); any other `--json` key is `invalid_request` with `path` and a `hint`. A batch renders 3D nodes as stills only — for 3D video or contact sheets run each node with `run NODE --shots … --render video|sheet`. A batch spends the account's generation balance — each submitted node is a chargeable attempt, so `--concurrency 200` means up to 200 chargeable submissions in flight; size the batch to what the user authorized. You may start a new batch while an earlier one is still running (so can the user) — batches do not block each other; the account allows 200 nodes in flight across all of them and anything beyond that waits in its own batch's queue until a slot frees. If any node fails with `kind: quota`, stop and tell the user: the page drops that batch's not-yet-submitted nodes and records `{kind:"batch", note:"quota_stop", nodeId:<the one node that was submitted and then hit quota>, nodeIds:[…the dropped ones, none of which was ever submitted]}` in `changes`, because every remaining node would fail the same way. Do not resubmit the batch; already-submitted nodes keep running.
- Seven `changes` notes exist and they are **not** interchangeable — read the `note`, never just the `kind`. Five of them only ever ride on `kind:"batch"`. `note:"undo_restored"` (0.17.0) rides on `kind:"update"` with `fields:[]`: an undo (`actor` says whose) emptied this node because a concurrent whole-node write left nothing to restore, and the page's undo guard put it straight back as it was — nothing was deleted or created, and that undo did not change the node. `note:"bulk_change"` is not a note anyone writes at all: it is ONE transaction that touched many nodes at once, reported as a merged row instead of one row per node — `nodeIds` lists the nodes that row covers and there are no `fields`. EDGES merge on the same rule and are the one row with no id list at all: this contract has no `edgeIds`, and edge ids only ever come from `snapshot`, so that row says `fields:["edges"]` and nothing else — read it as "one transaction changed a batch of wiring, go re-read the wiring". **`actor` is whoever ran it, `human` included**: this canvas's own automatic frame refit is `page`, a peer's transaction is `remote`, and a human's own multi-select delete or drag on this page is `human`. Merging never crosses an action, so one wide transaction gives you at most three rows — `kind:"add"`, `kind:"delete"` and `kind:"batch"` (the move/update noise) — and a deletion stays visible as a deletion no matter how many nodes it took. Keep branching on `kind`; just do not read one merged row as "only one thing changed", and re-read the ids you care about. It exists because a refit moves ten members plus their frame in one write, and at one row per node a collaborator landing twenty images pushed 200+ automatic rows through the 500-row buffer and evicted the human edits you came to read. Two of the batch notes are not about batches at all and carry `actor:"human"`: `note:"frame_strays"` (a human dragged a group frame, or pulled one of its grips, and the frame now covers nodes that are not its members (covers = their centres are inside it, the one stray test the whole product uses) — `nodeId` is the frame, `nodeIds` the loose nodes) and `note:"frame_escaped"` (same gesture, members whose centre ended up outside the frame). **Nothing was changed by either** — the canvas freezes membership for every frame gesture on purpose, and these entries exist so the state is visible instead of having to be re-derived from `snapshot` geometry. Do not act on them unprompted: absorbing a stray is `resize_group {absorbStrays:true}` and needs the user's word, because the frame is also the deletion unit. The remaining three are the page's own batch bookkeeping (`actor:"page"`). `note:"batch_lost"` means the previous page never submitted those nodes, so nothing was paid and they are still waiting to be run. `note:"run_timeout"` means one node outran the page's run limit and released its slot; the cloud task is untouched, so inspect the node before deciding. `note:"quota_stop"` is the one that must not be retried: the page deliberately abandoned the rest because the account is out of balance, so resending the same batch spends whatever balance later returns without asking the user again — the authorization you hold was for the earlier attempt. Read the two fields separately, never by array position: `nodeId` is the single node that **was submitted** and then failed on quota, and `nodeIds` are the ones dropped **before** submission, so they never ran. Report that split — the submitted one reached the gateway and its charge is settled there, which this page cannot see, so tell the user to check their own balance rather than asserting either way; the dropped ones definitely never ran. Then get a fresh decision after they top up.
- The `run-batch` reply carries `batchId`. `cancel-batch --batch BATCH-ID` (or without `--batch`: every batch of this session) drops the nodes not yet submitted; submitted ones keep running — cancel them one by one with `cancel NODE`. `cancel NODE` also works for a node still queued in your own batch. Workers cannot call either. A `--batch` id that is not one of this session's live batches is `batch_not_found` (it may simply have finished).
- Main `run NODE --approved` calls `run_node` with `{nodeId,approval:{userApprovedNodeIds:[nodeId]}}`. Both daemon and page reject a missing approval list or a target outside it. This records the Agent's declaration of prior user authorization; it is not a new UI confirmation token. It returns acceptance; inspect the node later for completion. **A rerun keeps history**: running a node that already has output does not discard its earlier candidates — the new result is appended to the same candidate group the ×N batches and the human picker use, becomes the primary (`outputUrl`), and every earlier take stays selectable through `resources` + `select_output`. Image and video candidates have no automatic eviction. Changing output type replaces the other type's candidate group. `run NODE --fresh --approved` (`clearCandidates: true`) is the explicit opt-in to discard the previous candidates of that type before the run lands; never send it by default. `run-batch --fresh` applies the same flag to every node in the batch. On a scene-3d node (0.17.0) the selector is `--shot SHOT-ID` (`shotId`), `--shots all` (`allShots:true`) or `--shots a,b` (`shotIds`, 1–60 distinct ids) — one of the three, `--shot` with `--shots` is a local `invalid_argument`; none = the first shot in the list (`shots[0]`, in `reorder_shots` order — not necessarily `n` 1), or the active camera when the scene has none. A shot the scene does not have is `invalid_request` at `shotId` / `shotIds` (the message lists the scene's shots); a selector on any other kind is `invalid_request`. `--render still|video|sheet` (default `still`; `video` and `sheet` need at least one shot) and `--frames 3|5|9` (`sheetFrames`, only with `--render sheet`, default 3). `--frame start|end` (`frame`, 0.16.2; `run NODE --shot SHOT-ID --frame end --approved`) picks a still's moment — `start` (default) the shot's opening, `end` its end (moves and camera move complete); an end still lands on its own `s3i-` card (title `… · 镜n · 结束站位`, `scene3d.frame:"end"`), the start card is untouched; any other value is `invalid_request` ("frame must be start or end"), and `frame` with `--render video` / `sheet` or on any kind but scene-3d is `invalid_request` at `frame`. Each shot lands on its own card below the 3D node — `s3i-` still, `s3v-` preview video, `s3c-` contact sheet — and the node's own `outputUrl` is never written. Rendering happens in the canvas page, so it is not a billed generation and needs no price question (`tiers.run.localKinds`), but it still takes `--approved` and the main session. Reply: `{ok, local:true, submitted:true, turnId, shotId?, outputs:[{nodeId:<card>, outputId, shotId, n, title, mediaType, output, url, posterUrl?, lastFrameUrl?, durationMs?, result:"created"|"rerendered"|"reused"}], renderedDigest, pending:[], failed:[], timings, notes?}`; `outputs[].title` is the `@{…}` label a downstream gen node sees (the same batch may `connect` the card and write that `@`). Shots not done within the page's 30 s window are in `pending[]` and keep rendering — `read NODE/renders` later, never resend `run`; a 3D `run` (one with `--shot` / `--shots` / `--render` / `--frames` / `--frame`) that reached the page but got no answer (tab closed, discarded or reloaded, timeout) comes back from the CLI as retryable `render_interrupted` instead of `unknown_outcome` — resend `error.next[0]` once the page is back; landed shots are reused. A bare `run NODE` cannot be told from a paid run and still gets `unknown_outcome`: `read NODE/renders` first. Per-shot failures are in `failed[]` (`render_interrupted` is retryable as `error.next[0]` says; a shot longer than 30 s fails for good); `ok:false` only when every shot failed. CLI-local: `--await SECONDS` (integer 0–240, default 0) is the **whole command's** wall-clock budget — while `pending[]` is non-empty the CLI reads `NODE/renders` every 3 s and merges landed rows into `outputs[]`; at the deadline it answers with what is left in `pending[]` and a `notes[]` line (180 is the suggested value for video). `--out-dir DIR` saves every output card's current media into the workspace directory through the page, like `download` (the CLI never fetches `outputs[].url` itself) (`path` per item; a failed item gets `pathError {code, message}` and the run stays `ok:true`). `run … --wait <number>` is a local `invalid_argument` whose `hint` points at `--await` (`--wait` is the boolean page-away wait). `clearCandidates` (`--fresh`) on a scene-3d node is `invalid_request`. See scenes 6f and 6h. `cancel NODE` can cancel runs initiated by this page's Agent bridge. On a scene-3d node it stops the still / preview batch that is still rendering: the shot in flight and the ones after it end in that `run`'s `failed[]` as `render_interrupted` (0.17.0; the daemon delivers `cancel` even while the `run` itself is still waiting). Follow the user's authorization and do not cancel another collaborator's unrelated work; the current bridge tracks ownership by the page bridge, not by individual task session. Workers cannot invoke run or cancel.
- **Still or blocking images — pick by what the user wants, not by the card name** (both carry 「结束站位」): `run` on a scene-3d node gives **one** `s3i-` still card per shot (`outputs[]`; wire it to a gen as a reference image; `--frame end` puts the shot's end moment on a second card titled `… · 镜n · 结束站位`). `run-stills` gives **two** separate image nodes per shot (start and end, `stills[]`) for that shot's video node. 「静帧」 / one picture per shot → `run`; 「站位图」 / start and end blocking for video nodes → `run-stills`.
- Main `run-stills NODE [--shots all|SHOT-ID,…] [--frames start|end|both] [--force] --approved` (0.16.2) calls `run_stills` with `{nodeId, shotIds?, frames?, force?, approval}`: every listed shot (default all, in shot-list order) × every listed frame (default both, start before end) is rendered by the page one by one and **lands in its own image node** — a `media-upload` titled `<3D node title>·镜<n>·开始站位` / `…·结束站位`, placed right of the 3D node (one row per shot, a column per frame; an occupied cell moves down to the next free row, never on top of another node; a second scene just below another is laid out in the free space to its own right), carrying `stillOf {sceneNodeId, shotId, frame, sceneDigest}`. The same (node, shot, frame) again refreshes that node's image in place — id, title, position, tags and edges unchanged, old history cleared (`created:false`); the 3D node's own still becomes the last one (the per-shot `s3i-` cards of `run` are a separate thing and are not touched). A copied still node (copy / paste / `duplicate_node`) is a plain image without `stillOf`; if two nodes still share a key, the lowest id (code-unit order) is the one used (refreshed, or left alone when up to date) and the rest come back in `duplicates`, untouched. The reply is `{ok, nodeId, sceneDigest, stills:[{shotId, frame, nodeId, url, created, sceneDigest}], failed:[{shotId, frame, message}], skipped:[{shotId, frame, reason, nodeId?}], orphans:[{nodeId, shotId, frame, orphan:true}], duplicates?, remaining?, checks?, stillsSummary}`. A still whose node already exists and was rendered from the current scene is not rendered again: it comes back in `skipped` with reason `up_to_date` and that `nodeId` (`force:true` / `--force` renders it anyway). A still whose picture a human or an Agent swapped (`stillOf.replaced`, decision A71: the node's own 替换文件, `upload --into`, `update_node` writing `outputUrl`, picking another history entry) is skipped with reason `replaced` and its `nodeId` — even after the scene changed, and it is not unfinished work (no `remaining`) — until `force:true` / `--force` renders it again in place and clears the mark (decision A71 as revised: the user asking for the stills again is the intent; there is no separate flag). Only a still already swapped when the call started is overwritten: one swapped while the call runs is left alone at landing, `--force` or not. At most 120 stills per call (`scene3d.limits.stillsPerRun`); the page answers within 90 s (`stillsBudgetMs`) — what it did not reach is `skipped` with reason `budget` or `page_away` and is listed again in `remaining:[{shotId, frame}]`: the same command again renders only those (the rest are `up_to_date`), until a reply carries no `remaining`. `cancelled` (the run was cancelled or the 3D node deleted) is not carried on. A failed render or upload is `failed` and the rest go on; a shot data health blocks is `failed` with "数据健康拦下…" and the reply carries `checks`; nothing is rolled back. `ok:false` (`run_failed`) only when not a single still landed and something is left undone; all `up_to_date` is `ok:true`. Not a billed generation, like `run` on a 3D node; still `--approved`; main only. A `cancel NODE` stops it (since 0.17.0 the daemon delivers `cancel` without waiting behind the running mutation; with a 0.16.2 daemon a same-session cancel queued behind it): the still in flight and the rest come back `cancelled`; a cancel that arrives after the reply answers `not_owned` ("多半已经出完了"). When the page goes away mid-run (reload, closed tab, leaving the canvas) the still in flight is aborted and what landed stays on the canvas: the page first sends the partial reply (the rest `page_away`, listed in `remaining`) and only then tells the daemon it is leaving; if that reply cannot get out in time the call ends `unknown_outcome`. Either way, check `status` first: a reload (or coming back to the canvas in the same tab) resumes the session and the same command again renders only the missing stills — the exception to "never resend after `unknown_outcome`"; a closed tab or a browser that went away cannot resume it, so `connect` again and send the same command in the new session (`status` can still read `connected` for about 45 s after a tab closed — the daemon's lease — and a command sent then only queues and comes back `page_away`). Still nodes of a deleted shot are kept and listed in `orphans`; `read` of such a node marks `stillOf.orphan`. `read` and `ls --long` carry every still node's `stillOf`.
- Main `run-shot-refs NODE [--shots all|SHOT-ID,…] [--force] --approved` (0.18.0) calls `run_shot_refs` with `{nodeId, shotIds?, force?, approval}` (`RUN_SHOT_REFS_FIELDS`; approval first, then the fields — the same shapes as `run_stills`, without `frames`): for every listed shot (default all, in shot-list order) the page makes the start still, the end still and the previz, in that order (`SCENE3D.shotRefParts`), one at a time. The stills are `run-stills`'s image nodes (`stillOf`, refreshed in place), the previz is `run --render video`'s `s3v-` card (on a product scene `epXX-PYY-SZZ运镜预演` in the start / end / previz triple, with `previzOf`). The reply is `{ok, nodeId, sceneDigest, shots:[{shotId, n, start:{nodeId, url}, end:{nodeId, url}, previz:{nodeId, url, durationS}, created:[part], skipped:[{part, reason, nodeId?}], failed:[{part, message}]}], remaining?:[{shotId, part}], orphans, duplicates?, checks?, notes?, shotRefsSummary}` (`start` / `end` / `previz` are `null` when neither made nor already there; `reason` is one of `SCENE3D.stillSkipReasons`). Up-to-date and swapped parts are skipped (`up_to_date` / `replaced`, with the node to wire) unless `force:true`; a failing part goes to its shot's `failed` and the rest carry on; a shot blocked by data health fails all three (`checks`, the video reading of the self-check); a shot over 30 s fails only its previz. The budget is per shot — 25 s for each still, 15 s + 250 ms a frame for the previz — capped at `SCENE3D.limits.shotRefsBudgetMs` (240 s), and the daemon and the CLI wait `shotRefsCallMs` (255 s) for this method only. What the budget or a departing page cut off is listed in `remaining`: send the same command again. `ok:false` (`run_failed`) only when nothing landed and something was left undone. `cancel NODE` stops it; `run` / `run-stills` on the same node meanwhile answer `already_running`. L2 with `billable:false`, main only; a page or daemon older than 0.18.0 refuses the method (`method_not_allowed` / `invalid_request`, with a `hint`).
- `run-tool NODE --kind KIND --approved` calls `run_tool`. A **local** kind — `CANVAS_CONTRACT.tiers["run-tool"].localKinds`, the same array as `CANVAS_CONTRACT.localTools.kinds`: `trim-audio` `trim-video` `capture-frame` `crop-image` `grid-split` `flip-image` `annotate-image` `asset-sheet` `scale-lineup` — runs entirely in the page, never reaches the gateway and is not a billed generation (`read` marks it `billable:false`); it still needs `--approved` (command shape, not a payment consent) and the main session, and it answers `local:true` with the new nodes instead of a `taskId`. Every other kind is L2 like `run`. `CANVAS_CONTRACT.localTools` carries each local tool's metadata limits and value sets (annotate text caps, `asset-sheet` panels — one picture per asset as NODE-ID, with the cells it holds — the character scale panel's `scaleRefs` caps, A30 field keys and the prop right-cell modes, `scale-lineup` item kinds and prop scale axes, row and image caps, height-ratio threshold, floor-shadow thresholds and 16:9 size); read them from there instead of copying numbers. Bad `metadata` is `invalid_request` before any work starts; scenes 6c and 6e show the argv.
- `undo --steps N`, `undo --turns N`, and corresponding `redo` operate on this Agent's own history. `document_reloaded` means the prior undo stack was discarded. Do not claim an undo happened when `undone` is zero.
- A `run` on a `scene-3d` node right after this Agent's own `scene3d_apply` on that node joins the apply's undo step: one `undo` reverts the scene change and the still rendered from it together, and `undoneOps` names the apply's turn. If anyone else wrote that node in between, the run stays its own step (undo reverts the still only). An undo can be partial (0.17.0, D-88): a node an undone step created that a later write outside the undo stack rewrote whole (a 3D re-render landing rewrites the downstream gen it feeds) stays on the canvas and is listed in `undoneOps[].left`; when that insertion was all the step held, the reply is `undone:0, reason:"all_skipped"` and names it in the top-level `left`. Tell the user it stayed and ask before `delete_node`.
- `timeline list` returns clips, `revision` and `layoutDigest`. Timeline JSON accepts `op`: list/set/append/remove/reorder/clear/trim/split/cut/restore, `clips:[{nodeId,inMs?,outMs?}]`, `index`, `clipIds`, `order`, `sort`: given/shot/position, `dedupeBySource`, `episode`, `clipId`, `inMs`, `outMs`, `reset`, `atMs`, `previousClips`, `baseRevision`, and `baseLayout` (op ↔ field pairing: §17a / §17b; an unknown field is rejected by the daemon).
- `set`, `remove`, `reorder`, `clear`, `split`, `cut`, and `restore` require the revision read from the current track; `append` and `trim` take it optionally (the revision covers membership and order, not trims). Preserve `previousClips` when planning to restore it. `timeline_conflict` or `timeline_busy` requires rereading; never overwrite a human's newer arrangement by dropping the revision. The revision checks known state; it is not a cross-peer lock.
- Because the revision ignores trims, `cut` (a timeline-time range) also **requires** `baseLayout` — the `layoutDigest` of the last reply, which covers every clip's in/out point — and `split`, `trim` and `restore` accept it optionally (checked when present). A human trimming an earlier clip moves every later position without changing the revision; the layout check turns that into `timeline_conflict` (`error.path: "baseLayout"`) whose reply carries the current clips and `layoutDigest`. Recompute the range from those clips before resending. `trim` and `restore` write in/out points by clip id, so the revision cannot stop them from overwriting a trim a human just made: after a human edit, `timeline list` first, merge the human's change into what you write (for `restore`, swap in the current values of the clips the human changed), and send that reply's `layoutDigest` as `baseLayout`. Every other op rejects `baseLayout`.
- Timeline clips refer to canvas nodes, never arbitrary media URLs. Timelines are not reverted by `undo`/`redo`; node undo can leave orphaned clip references for you to report.

## Project documents: `docs`

The project document library (doc@1, `docs/conventions/doc.md` in the monorepo) holds the text deliverables every agent shares — scripts, outlines, the global skeleton, character profiles, series bible, plot breakdowns, shot lists, shot-analysis ledgers / reports, uploaded novels. It belongs to the **project** (every canvas of the project sees the same library) and it is the **single source of truth**: there is no local mirror and no sync. Reading is reading the library; changing is an in-place update guarded by the version you read. The canvas panel (left rail → 文档库) shows the same documents in two sections, `reference` (参考资料) and `script` (剧本). The page performs every request with the signed-in user's own session, exactly like the panel, so permissions are the project's: a project viewer can read but every write is `read_only`.

| Command                                                                                                                          | Wire method                                              | Tier                |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------- |
| `docs ls [--section reference\|script --type TYPE --episode N --folder NAME --q TEXT --limit N --offset N]`                      | `documents_list`                                         | L0, workers allowed |
| `docs read DOC-ID [--if-version N] [--out FILE --overwrite]`                                                                     | `documents_get`                                          | L0, workers allowed |
| `docs ls --folders [--section reference\|script]`                                                                                | `documents_folders`                                      | L0, workers allowed |
| `docs read --folder NAME-OR-ID --out-dir DIR [--overwrite]`                                                                      | `documents_folders` + `documents_list` + `documents_get` | L0, workers allowed |
| `docs create --type TYPE (--file FILE \| --text TEXT) [--section S --episode N --folder NAME --title T --id DOC-ID --meta JSON]` | `documents_put` (no `id` unless `--id`)                  | L1, main only       |
| `docs update DOC-ID --expect-version N (--file FILE \| --text TEXT \| --patch DIFF) [--title T --meta JSON]`                     | `documents_put`                                          | L1, main only       |
| `docs delete DOC-ID --approved [--expect-version N]`                                                                             | `documents_delete`                                       | L3, main only       |

The two-word command is one key: `parseArgs` returns `command:"docs ls"`, and that string is the key in `CANVAS_CONTRACT.tiers` and in `help`. `docs` without a subcommand is `invalid_argument`. These commands take `--turn` / `--request-id` / `--wait` / `--wait-ms` but not `--json`; `--file` here is the **text file** (UTF-8, inside the session workspace, `.docx` is refused — upload Word files in the panel, which converts them to Markdown).

**Fields** (`CANVAS_CONTRACT.documents.fields`): `id`, `section` (`reference` | `script`), `folder` (uploaded novels: one folder per novel), `docType`, `series` (defaults to the project name), `episode`, `scene` (an anchor such as `1-2`; scenes are not separate documents), `title`, `format` (`markdown` | `srt` | `json`), `version` (+1 on every write, from 1), `contentSha` (the canvas `read` digest over the LF-normalized text), `contentUrl` (0.16.2: the link to the current version's text file on the CDN — every version is stored as one UTF-8 `.md` file; `null` while a document's text still sits in the old database column; anyone holding the link can open it, so never pass it on — read the text with `docs read`), `sourceAgent`, `source` (e.g. where a reverse-engineered script came from), `assetTags`, `derivedFrom` (`id@version` of the upstream document), `updatedAt`, `summary`. `docs read` adds `content`, the plain text with no header of any kind.

**`--type`** (`CANVAS_CONTRACT.documents.docTypes`, the panel's group order): `skeleton` 全局骨架, `outline` 剧情大纲, `characters` 人物档案, `bible` 剧本圣经, `breakdown` 剧情拆解, `script` 剧本, `asset-list` 资产清单, `extras` 群演人物库, `genre-strategy` 题材策略, `shotlist` 镜头表, `lap-ledger` 拉片台账, `lap-report` 拉片报告, `lap-outline` 拉片大纲, `novel` 小说, `note` 其他资料. The `script` section only takes `script`; a `script` may also sit in `reference` (a source script to be rewritten). Without `--section`, `script` goes to the script section and everything else to reference. A reverse-engineered script is `script` with `source` saying where it came from; the global skeleton is reference material, never a script.

**Ids** (at most 20 characters — a canvas copy is tagged `doc:<id>@<version>` and a node tag holds 30; the panel's two ways of copying a document onto the canvas are closed since 0.16.2, the cap stays): first segment lowercase ASCII, further `:`-separated segments letters (Chinese included), digits, `_`, `-`. Without `--id`, the library derives one: episode → `<type>:ep:NN` (`script:ep:05`); a one-per-project type (`skeleton`, `outline`, `characters`, `bible`, `breakdown`, `asset-list`, `extras`, `genre-strategy`, `lap-outline`) → the type itself; in a folder → `<type>:<key>:NNNN`; otherwise `<type>:<slug of the title>`, cut to fit the 20 characters. Only folder numbering moves on; a derived id that already holds the same document (same type and title) is `doc_conflict` ("already exists") — update that document instead of creating another one. A title-derived id that holds a **different** document (two long titles cut to the same id: "Character Profile - Protagonists" / "… - Antagonists" → `note:character-profi`) is `doc_conflict` with `suggestedId` ("already used by another document"): nothing is written, `error.next` is `docs create --id SUGGESTED-ID …`, and the document at `id` is not yours — never update it. `suggestedId` is the cut title plus a 4-character hash of the full title, so the same title always gets the same one. A `create` with an explicit `--id` that is taken is a plain `doc_conflict` naming the document there ("already used by "…""): read it; update it only if it is the one you meant, otherwise pick another `--id`.

**Versions.** `docs create` / `docs update` are L1 (not a billed generation, main only) but they are **not** in the canvas undo stack — `undo` cannot revert them. The server keeps every version's text; a rollback interface is not offered yet, so today the way back is another `docs update` with the text you read before changing it. Every write sends `expectVersion` (`--expect-version`; 0 for `create`). If the library's version differs, nothing is written and the reply is `doc_conflict` with `id` (the document the conflict is about), `currentVersion` (0 = gone or deleted), `currentSha` and `deleted` (true = soft-deleted: it cannot be changed, and its id is not reused — see **Deleted documents**); `error.next` points at `docs read` (for a deleted document it says what to do instead). Re-read, redo the change on that version's text, and resend with the new number — never resend old text with a bumped number. Omitted fields keep their values (`--patch` / `--file` / `--text` replace only the text, `--title` / `--meta` only those fields; `--meta` accepts `series`, `scene`, `format`, `sourceAgent`, `source`, `assetTags`, `derivedFrom`, `summary`, and `null` clears one). A write that changes neither text nor fields returns `unchanged:true` and keeps the version, so repeating the same `create`/`update` after a lost reply is harmless. A write that changes only fields (same text) still raises the version by one but stores no new copy of the text — `contentUrl` stays the same. When the text changes the server first stores it as a new file, then writes the version: if the file cannot be stored the reply is `upload_failed` (nothing was written), and a `doc_conflict` found after the file was stored leaves that file unused on the CDN — harmless. `upload_failed` and `content_unavailable` (the text file could not be fetched on read, or what came back was not this version's text — the server checks it against the version's `contentSha` and never hands you the wrong text) are the two retryable document errors (`retryable: true`): resend the same call a little later. `--patch` is applied by the CLI: it first reads the document, returns `doc_conflict` itself when the version already moved, applies the unified diff to that version's text (every hunk's old lines must be present; a hunk that does not match is `patch_failed`, exit 1 — re-read and rebuild the patch), then writes with the same version check.

**Deleted documents.** `docs delete` is a soft delete: the document leaves the panel and the listings, its text history stays, and its id stays with it. Changing it (`docs update`) is `doc_conflict` with `deleted:true`, `currentVersion` 0. A `docs create --id` naming a deleted document's id is `doc_conflict` with `deleted:true` ("was used before by "…", which has been deleted"): nothing is written and the deleted document is not revived — its history is not yours; pick another `--id`. Without `--id`, the library revives a deleted document only when the id it derives holds that same document (same type and episode, the same one-per-project type, or the same title), with its history continuing; a title-derived id held by a _different_ deleted document counts as taken (`suggestedId`, as above), and deleted documents at alternative ids are skipped — never revived. `error.next` for a deleted document says to tell the user before writing it back.

**Size.** One document's text holds at most 50,000 characters since 0.16.2 (the cap was much larger before; `CANVAS_CONTRACT.documents.contentMaxChars`, counted as JS string length after line endings are normalized to LF — a `\r\n` counts as one character, the way the library stores the text; the CLI, the daemon and the server all count it this way). `docs create` / `docs update` check the text before writing (for `--patch`, the text with the patch applied, right after the read): over the cap is `too_large` (exit 2) with `chars` and `limitChars` (`maxChars` too — its name before 0.16.2, the same number), and nothing is written. Split the text into several documents (for example one per episode), each under the cap. A whole novel is not one document: the user uploads it in the panel as a novel, which splits it by chapter. The page and the server enforce the same cap with the same code and fields: `too_large` with `chars` / `limitChars` (`CANVAS_CONTRACT.documents.errors.tooLarge`; the server answers HTTP 413). An older CLI pinned below 0.16.2 checks its old, larger cap locally and lets a longer text through; the page's own check refuses it before it reaches the server, with that `too_large`. It also refuses a text containing `\u0000` or a lone surrogate (half an emoji) with `invalid_request` whose `error.path` is `content` (or the field it sits in) and `error.position` the 1-based character where it sits, counted after line endings are normalized to LF; and a write that would push the project's current texts past 50 MB in total with `quota_exceeded` (HTTP 400, `CANVAS_CONTRACT.documents.errors.quotaExceeded`, since 0.16.2; nothing is written; `error.usedBytes` is the project's total before this write and `error.limitBytes` the cap — not retryable as-is: delete documents that are no longer needed, or shorten this one; edits that only change fields or shorten a text are always accepted).

**Refusals name the field.** A `docs` call refused for one of its parameters says which in `error.path`, wherever it was refused. The CLI's own checks (`invalid_argument`, exit 2, nothing sent) name the field the flag feeds: `id`, `expectVersion`, `ifVersion`, `docType`, `section`, `episode`, `folder`, `title`, `limit`, `offset`, `content` for `--file` / `--text` / `--patch` (a file that is not UTF-8 text, a `.docx`, a patch that does not parse), and `meta` / `meta.<key>` for `--meta` (`meta.episode`, `meta.projectId`: keys `--meta` cannot set). The daemon's and the page's checks and the server's validation (`invalid_request`) name the `documents_*` field: `title`, `sourceAgent`, `summary`, `content`, `assetTags[2]`… A text or field holding `\u0000` or half an emoji also carries `error.position` (above). Fix that one field and resend — resending as is fails the same way. A refusal about the call as a whole (`docs update` with nothing to change, flags that do not go together) carries no `path`.

**Folders.** An uploaded novel is one folder in the reference section, one document per chapter, with ids `<type>:<key>:NNNN` (`novel:k3x9:0001`); the folder's **id** is the shared `<type>:<key>` prefix (`novel:k3x9`, `CANVAS_CONTRACT.documents.folderIdPattern` — `null` for a folder whose documents carry explicit ids). `docs ls --folders` lists the folders of one section (reference unless `--section script`) through the read method `documents_folders {section?}` → `{ok, section, items:[{section, name, id, count, updatedAt}], table, hint}`; it cannot be combined with the document filters (`--type`, `--episode`, `--folder`, `--q`, `--limit`, `--offset` are `invalid_argument`). `docs read --folder NAME-OR-ID --out-dir DIR [--overwrite]` saves a whole folder in one call: it finds the folder by id or by name in either section (a name used in both is `invalid_argument` naming the ids; none is `doc_not_found`), lists its documents page by page in library order, reads each (four at a time), and only when every one was read writes one scratch file per document into `DIR` (created one level at a time inside the workspace) named `<seq>_<title>.<ext>` — `seq` zero-padded to at least three digits, characters a file name cannot hold replaced by `_`, `.md` / `.srt` / `.json` by format. An existing file there is `file_exists` (exit 2) with `files` listing them and nothing written, unless `--overwrite`. When it fails before writing anything (a document cannot be read, a name is taken), the folders it created for `DIR` are removed again — no empty folder is left behind; folders that were already there are never touched. It cannot take a document id or `--out`, and `--out-dir` only goes with `--folder`. Reply: `{ok, folder:{section, name, id, count}, outDir, files:[{path, id, title, version, contentSha, bytes}], note}` — like `--out`, these files are never synced back.

**Replies.** `docs ls` → `{ok, items:[document…], total, limit, offset, nextOffset, table}`. `docs read` → `{ok, document:{…fields, content}}`; with `--if-version N` (0.16.2: the version you already have; `documents_get.ifVersion`) and the document still at version N → `{ok, notModified:true, id, version, summary}` with no text and nothing written for `--out` (it cannot be combined with `--folder`); with `--out` → `{ok, path, bytes, document:{…fields}, note}` (the file is a scratch copy — `--overwrite` to replace an existing file; missing parent folders inside the workspace are created one level at a time, and a symlinked or file component stops it with `workspace_boundary` / `invalid_path`). `docs create` / `docs update` → `{ok, document, created, unchanged, summary}`. `docs delete` → `{ok, id, version, deleted:true, summary}`: a soft delete (the panel no longer shows it; the text history is kept server-side), which needs `--approved` — sent as `approval.userApprovedDocumentIds:[id]` — after the user agreed; without it the CLI refuses with `approval_required` before sending anything.

Not in the library: novel source text an agent would paste (the user uploads novels in the panel), per-shot prompts (they live on canvas nodes), the 3D shot table, Jianying projects (`export-jianying`), subtitle strips. The library is not in `doc-index`.

## Media and connections

`upload FILE` reads at most 25 MiB from the session workspace. `download NODE --out FILE` handles text or bounded binary chunks, at most 256 MiB, and publishes only a complete file. Existing files remain intact unless `--overwrite` is explicit. Missing parent folders of `--out` inside the workspace are created one level at a time (`download` and `inspect-media --out`, like `docs read --out`); a symlinked or file component stops it with `workspace_boundary` / `invalid_path`. Parent traversal, symlink paths, and hardlinked files are refused. JSON and text input files follow the same workspace rules.

`resources NODE` lists `resourceId`, `source` (current/candidate/image-history/video-history/reference/input; inputs also expose `slot`), `part` (media/poster/last-frame), `kind`, `current`, `available`, name and MIME. Candidate rows additionally carry `outputId`, `runId` (the batch id of a ×N run, else the gateway task id; `null` for an adopted outside image), `runIndex` (1-based "第 N 次", in landing order — every take of one ×N batch shares it), `gatewayTaskId`, `createdAt`, `promptSha` (the digest of the prompt it was generated with, same digest as `read`'s `promptSha`) and `promptChanged` (that digest is known and differs from the node's current prompt). Use them to tell takes apart when a node has been rerun several times. No URLs or media bodies are returned. Follow `nextOffset` even if a page is empty; offsets are opaque slots, not resource counts. IDs are scoped to the node and stable across reordering; changing a node during paging requires starting again. An unavailable local/sentinel URL cannot be downloaded through this browser connection.

`download NODE --resource RESOURCE-ID --out FILE` selects an exact listed resource; omit `--resource` for the current output. The same selector works with `inspect-media` and `frames`. `resource_not_found` means the ID is invalid for that node or the resource was removed; relist and choose explicitly. `inspect-media NODE --resource RESOURCE-ID --out FILE --probe` additionally runs installed `ffprobe`. Without `--out`, it reads metadata without downloading a body; `size:null` means unknown until download. Binary byte caches live at most ten minutes, bounded to 256 MiB and 256 entries, and each access first resolves the current node. `frames NODE --resource RESOURCE-ID --out-dir NEW-DIR --every 5 --count 12` downloads that video, runs installed `ffmpeg`, and returns sampled JPEG paths; maximum count is 100. The target directory must be new and its parent must exist. No shell command is constructed from media metadata. `download`/`inspect-media --out` also report `detectedMimeType` from the file's leading bytes; for audio, `videoReferenceCompatible` says whether a video model will accept it as reference audio (the provider sniffs bytes and allows only mp3 / wav — `Unsupported audio format: flac. Allowed formats: mp3, wav.` — so a `.mp3` name or `mimeType` proves nothing). Historical 人声分离 / 音频分离 / 环境音分离 results are FLAC and are refused by `run` before submit with the node named; until upstream emits mp3, the user must supply an mp3/wav version of that audio (re-encode outside the canvas and upload; renaming does not work).

### `export-jianying` — Jianying draft projects into the workspace or the user's Jianying draft folder

`export-jianying [--out-dir DIR | --draft-root ABSOLUTE-DIR [--approved]] [--episode EP (repeatable)] [--layout episodes|single] [--name NAME] [--dry-run] [--overwrite]` writes the timeline as Jianying (剪映专业版 5.9) draft projects — into the session workspace (default `产出/剪映工程/`), or with `--draft-root` straight into the user's Jianying draft folder — one complete draft folder per project (`<name>_EP01_<stamp>/`, `<name>_其他_<stamp>/`, or `<name>_<stamp>/` when no clip title carries `epNN`). There is no zip and no browser download. It is a local command (`CANVAS_CONTRACT.tiers`: L0, `local:true`, `timeoutTier:"long"`): it reads the timeline once through the read-only wire method `timeline_export` — workers may call it, `timeline` itself stays main-only — and does everything else on this machine. **Apart from `--draft-root` it writes only inside the workspace.**

- **`--draft-root` (straight into the user's Jianying draft folder).** A separate tier: `tiers["export-jianying"].flagTiers["draft-root"]` = L1, `mainOnly:true`, `methods:["jianying_roots_list","jianying_roots_touch"]`, `approvalWhen:"unregistered_root"`. Mutually exclusive with `--out-dir`; `--overwrite` is refused (it never overwrites anything there) and `--approved` is refused without it. A worker gets `worker_forbidden` before anything is sent. The folder is checked before the timeline is even read (`src/jianying/draft-root.mjs`): an absolute path shaped for this machine (drive letter / UNC on Windows, `/…` elsewhere) with no `.` / `..` segment; it must already exist and be a real directory (never created here — Jianying creates its draft folder); every level from the drive root down is `lstat`ed and none may be a symlink or junction; its `realpath` must equal the path given (case-insensitively on Windows / macOS — a volume mount point, a mapped network drive or an 8.3 short name shows up here); and it may not be a drive / UNC share / `/Volumes/<volume>` root, the home folder or one of its parents, or inside a system folder (`/usr`, `/etc`, `/var`, `/System`, `/Library`, … ; on Windows `%SystemRoot%`, `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%ProgramData%`). A refusal is `invalid_path` (exit 2) with `error.reason` ∈ `not_absolute` / `relative_segment` / `too_long` / `not_found` / `not_directory` / `symlink` / `realpath_changed` / `drive_root` / `home_dir` / `system_dir`. A folder that passes these checks but does not look like a Jianying draft root (no `root_meta_info.json` and no drafts in it yet — the same test as `jianying-roots`' `looksLikeDraftRoot`) is still written to, and the reply's `warnings` says so (the dry run too): have the user confirm it is the folder Jianying shows as its draft location. Then the allowlist: the user's registered Jianying draft folders (`jianying_roots_list`, compared with the page's `draftRootKey` — case- and slash-insensitive for Windows paths); a folder outside it needs `--approved`, the Agent's declaration that it read the full path to the user and the user agreed — without it the reply is `approval_required` (exit 2) with nothing downloaded or written (`--dry-run` is not refused; it answers `draftRootRegistered:false` and a warning). If the page is too old to list the folders, `--approved` still exports and without it the reply is `bridge_missing`; any other failure to list them (`worker_forbidden`, `unauthorized`, `jianying_roots_unavailable`, `page_away`, …) comes back as is, with or without `--approved`, and nothing is written. Projects are created directly under the folder (and assembled in `.<name>.partial/` there); the command creates only its own project and `.partial` folders, never overwrites, and deletes nothing it did not create — stale files are cleaned only inside its own `.partial` folder. Every write re-checks the folder the same way as the workspace (see Placement below), and a symlink or escape found mid-way is `draft_root_boundary` (exit 2). Media already exported into the workspace (`产出/剪映工程/`) with the same identity and remote size is hard-linked (copied across volumes, e.g. workspace on `C:`, draft folder on `D:` — the reply warns) instead of downloaded again; nothing is left in the workspace. On success the folder is remembered through `jianying_roots_touch` (its `lastUsedAt` refreshed; a new one is registered, dropping the least recently used when there are 5 — `warnings` names it); the page being away queues that write (5 s wait), and a failure only adds a warning. The reply adds `draftRootRegistered` (was it in the list before) and `remembered: {ok, added, evicted}` (or `{ok:false, code, queued?}`); `outDir` is `null` and `projects[].dir` is the project folder name.

- **One implementation with the page.** Splitting into projects, naming, every pre-flight gate (200 clips per project, container, separate audio, trim range, transitions), transitions / subtitle track / volume from clip data, asset file names and the host allowlist all come from `src/jianying/core.mjs`, which is generated from the page's own `apps/web/libs/jianying/*.ts` (`tools/canvas-cli-jianying-core.mjs`; a test rebuilds it and compares byte for byte). Given the same clips, time and ids, the folder it writes is byte-identical to the unzipped browser export with the same draft root.
- **Media.** Whole source files go into each project's `assets/video/`; clips keep only `source_timerange`, so every trimmed clip can be dragged back to full length in Jianying. Downloads go straight to the clips' own URLs, but only `https` URLs on the jianying export host allowlist (`cdn.echojoy.cn`, `file.echojoy.cn`, `*.myqcloud.com`, `*.tos-cn-beijing.volces.com`; no IP literals, no userinfo), every redirect hop re-checked (a hop down to plain `http` fails as a downgrade — "不允许降级到 http" — rather than as a host off the allowlist), no cookies or credentials — this is the one place the CLI fetches a URL itself instead of going through `media_info`. Four downloads run at once (`DIRECT_FETCH_CONCURRENCY`) with the page's retry policy (3 attempts, 1 s / 4 s back-off, no retry on 4xx); a download that stalls for 60 s is aborted and retried. Width / height / duration come from the file's own `moov` / `moof` boxes, computed the way the page's mediabunny probe computes them — no ffprobe needed. That box reader is wider than the page's probe: it also reads the video codec (the sample entry fourcc), and a codec the page's exporter does not handle — anything but H.264 / H.265 / VP8 / VP9 / AV1 / ProRes, e.g. MPEG-4 Part 2 (`mp4v`) in a `.mov`, which the export button fails on — is not refused: the project is written and `warnings` names the clip. Whether Jianying plays it is only known on the real app. A project holds at most 4 subtitle (text) tracks — overlapping subtitles go one track up, one line higher on screen each — so subtitles that would need a fifth track (more than 4 on screen at once) are left out of the draft and `warnings` says how many and where the earliest one sits on the timeline. Only a real export reports this: `--dry-run` downloads nothing, so it cannot measure the clips and does not check subtitle overlap.
- **Placement.** The draft JSON references media by the **absolute** path of the target folder (`draftRoot` in the reply = the absolute `--out-dir`, or the `--draft-root` folder). So the preferred hand-off is `--draft-root` — `jianying-roots`, the user picks a folder or gives a new one, export with `--draft-root` — and never to move a project folder: media that is moved, renamed or deleted opens offline. Setting Jianying's global draft location (全局设置 → 草稿位置) to a workspace `draftRoot` changes a global setting and may take the user's other drafts off the home screen, so it is no longer the recommended hand-off; copying a folder into Jianying's usual draft folder keeps the originals in place, but whether Jianying accepts a draft whose recorded root differs from where it sits is only known on the real app. A project is assembled in `.<name>.partial/` and renamed into place only when complete; `draft_meta_info.json` is written last. One asset used by several projects is downloaded once and hard-linked (copied where the file system cannot link — the reply warns). A hard-linked asset has a link count above 1, so the CLI's own `upload` refuses it (`workspace_boundary`, "Expected an independent regular file" — the same rule that keeps a hard link to a file outside the workspace from being uploaded); an asset used by one project only is an ordinary file after a first export, but a rerun that reuses an asset already in the out-dir (see below) hard-links it as well, so treat any asset under a project folder as possibly hard-linked. The assets came from canvas nodes, so use the node; to upload one anyway, copy it to a new independent file first. A rerun reuses any asset already in the out-dir with the same identity (the digest part of `NNN_<digest>.mp4`) and the same byte size as the remote (`HEAD`). An existing project folder of the same name is `file_exists` (exit 2) before any download; `--overwrite` writes into it and leaves unrelated files alone. `--out-dir` must be a relative path inside the workspace; `..`, absolute paths and symlinked components are `workspace_boundary` (a symlinked or non-directory component, and an existing project folder that is a symlink, carry `error.path` naming it). Every folder the command writes into — the project or `.partial` folder and its `assets/video/` — is checked the same way (the rule `download` uses) after it is created and again before each write: no symlink anywhere from the workspace root down, and its real path still inside the workspace. A symlink found there (for example an `assets` link planted in a `.partial` folder being resumed) stops the whole export with `workspace_boundary` and `error.path` naming it; nothing is written through it.
- **Reply.** `{ok, layout, outDir, draftRoot, draftRootRegistered?, projects:[{name, dir, absoluteDir, episode, clips, assets, bytes, status:"ok"|"partial", durationMs?, resumed?, overwritten?, failedNodeIds?, errors?}], downloadedBytes, reusedBytes, warnings, remembered?, note}` (`draftRootRegistered` / `remembered` only with `--draft-root`). A project whose media finally failed (or is not a readable MP4 / MOV) stays in its `.partial` folder with `status:"partial"`; the others are written normally, and the whole reply is `ok:false` with `error.code:"export_partial"`, `error.failedNodeIds` and `error.retry` — the argv that redoes only the unfinished projects, reusing what was already downloaded. `--dry-run` answers `{dryRun:true, projectCount, projects:[{name, dir, episode, clips, assets, bytes, exists, resumeFrom?}], totalBytes, downloadBytes, reusableBytes}` from `HEAD` requests without creating anything. Pre-flight refusals are `jianying_refused` with `error.reason` (the page's `JianyingRefusalReason`) and the page's own message; an old page without `timeline_export` is `bridge_missing` (refresh the page). **`ok:true` is not proof that Jianying opens the draft** — the user has to open it in Jianying and check.

#### Hosts: what to register for `export-jianying`

- **The output folder.** `产出/剪映工程/` (or whatever `--out-dir` names) is written only by this command. A product with a written file-boundary contract registers it there — for script-to-video that is `.pi/skills/lingying-rules/references/file-boundaries.md`, which today says `产出/` holds only `分镜/`. The product may also refuse the Agent's own write/edit tools under that folder (drafts are never hand-written). This package does not edit the product. With `--draft-root` the command writes outside the workspace, into the user's Jianying draft folder — the one CLI write that does; the product's file-boundary contract should say so.
- **Flags.** `--dry-run` is a boolean flag: a host that mirrors this CLI's boolean flag list (script-to-video's `CLI_BOOLEAN_FLAGS`) must list it, or `--dry-run` swallows the next token. `--approved` is already boolean; `--draft-root` takes a value (the absolute folder). `--episode` repeats. The command does not take `--turn` / `--request-id` / `--wait` (like `download`): a host that injects `--turn` must list it with the commands that do not (script-to-video's `NO_TURN`). `jianying-roots` does take `--turn` / `--request-id` / `--wait` / `--wait-ms` (it goes through `call()`), so it stays off `NO_TURN`.
- **Tier.** Read `tiers["export-jianying"].flagTiers["draft-root"]`: with `--draft-root` the command is L1 and main-only, and `--approved` is needed for a folder outside the user's registered list (the approval gate is the same shape as `run`'s — the model reads the full path to the user first). A host that keeps sub-agents away from `export-jianying` already covers it; `jianying-roots` is main-only too (`tiers["jianying-roots"].mainOnly`).
- **Timeout.** `timeoutTier:"long"`. A large export can still outrun any host timeout; a killed run leaves its `.partial` folders (in the workspace or in the draft folder) and the next identical call — the same `--draft-root` / `--approved` included — continues them. Tell the model to split big exports with `--episode`.

### `jianying-roots` — the user's registered Jianying draft folders

`jianying-roots` (L0 read, `mainOnly:true`, `timeoutTier:"short"`; takes only `--turn` / `--request-id` / `--wait` / `--wait-ms`) lists the Jianying draft folders the user has registered — at most 5, account-wide (the canvas settings dialog, 我的剪映草稿目录, edits the same list), most recently used first. They live in the user's settings on the server; the page reads them with its own sign-in through the main-only wire method `jianying_roots_list` (a worker gets `worker_forbidden` before anything is sent). Each row is then checked on this machine: `{path, label?, lastUsedAt, exists, looksLikeDraftRoot, rootMetaInfo?, drafts?, usable, reason?}` — `exists` is false with `reason:"other_platform"` for a path shaped for another OS (a `D:\…` on a Mac) and `not_found` / `not_directory` otherwise; `looksLikeDraftRoot` means the folder has Jianying's `root_meta_info.json` or already holds drafts (sub-folders with `draft_meta_info.json`; at most 500 are looked at); `usable` is whether `export-jianying --draft-root` would accept it (the same folder checks), with `reason` when not. The reply is `{ok, max:5, roots, table, hint}`; read `table` to the user. An old page without the method is `bridge_missing`; the page's own failures are `unauthorized` (the page's sign-in expired) or `jianying_roots_unavailable`.

The list changes in exactly three ways: the user edits it in the settings dialog (saving with 5 folders plus a new one drops the least recently used, named before saving); a successful export from the page's own export dialog remembers the folder it used; and a successful `export-jianying --draft-root` remembers its folder (`jianying_roots_touch {path, label?}` — main-only, not a command of its own). Remembering refreshes `lastUsedAt` of a folder already listed, or registers a new one and, at 5, drops the least recently used. It is atomic on the server (one transaction, the row locked), so two exports finishing together do not lose either folder.

`status` reports role, parent session (for workers), connection and workspace without exposing credentials. Main `disconnect`/`stop` stops the local daemon and removes its credential file and all worker files. Worker `disconnect`/`stop` revokes only that worker. Browser-side disconnect revokes the pairing and delegates; create a new main task session to reconnect. A closed or suspended page eventually expires its connection lease. Protocol 2 is required on both sides; update an incompatible CLI/page and create a fresh session.

Requests are never retried automatically. After delivery, a disconnect or timeout reports `unknown_outcome`; unsent work reports `outcome:not_sent`. A daemon keeps at most 256 results and 16 MiB of result data. It retains every mutation's request ID for the life of the session — that is what makes the no-replay guarantee — up to 10,000 of them; read IDs are kept only for the most recent 10,000, so a retried read may simply run again. When an old result has been evicted, `result_expired` preserves the no-replay guarantee. A full session returns `session_limit` and requires a new connection.

## Refresh and errors

CLI 0.5 pages resume the same session after a reload, any navigation back to the canvas in the same tab, or a lost poll, for up to ten minutes (`status.resumeExpiresAt` while `reconnecting`). Commands issued during the gap queue undelivered and are sent to the returning page; they fail as `not_sent` only on timeout or final disconnect. `status` returns `pageEpoch` after restoration; a higher epoch means refresh all read hashes/cursors/resource handles and do not expect earlier page-local undo history. The daemon retains the Agent identity, worker credentials and request ID tombstones and never replays commands. A request that was already delivered when the page went away reports `unknown_outcome`; the session continues, but inspect the canvas before any dependent mutation. A new tab opened after the old one was closed, or a new browser process, cannot resume it (the pairing credential lives only in that tab's session storage): pair again with `connect`. After a tab is closed, `status` can keep saying `connected` for up to about 45 s (the daemon's lease) before it turns `reconnecting`; a command sent then queues and comes back `page_away`.

Inspect `ok:false` before reading `nodes` or piping through a result parser. `reconnecting`/`not_connected` means no command was sent. A generation submit wait with no confirmed task ID is `unknown_outcome`, not proof that the task failed. Read its state and account task list; do not automatically rerun. The local bridge also guards active submits before a node has flipped to `running`. Use one `run` per host tool call with at least 130 seconds allowed, rather than a short-timeout loop over many nodes.

### `error.retryable` and `error.next`

Every canvas error from the page carries a boolean `error.retryable`, and some also carry `error.next`. Exit code 1 covers both a transient state and a refusal that will never clear, so branch on `retryable`, not on the exit code.

`retryable:true` means **reissuing this same command with this same payload can succeed once the other party finishes**. Exactly five codes are retryable, and all five are "something else is mid-flight or away, wait it out" rather than a failure:

| Code                 | What is in the way                                                                                  | What to do                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `already_running`    | Someone else already has this node running                                                          | Wait for its terminal status; do not resubmit                                                                                                                                                                     |
| `node_running`       | A text write lost to that node's in-flight run                                                      | Wait for the run to settle, then write again                                                                                                                                                                      |
| `timeline_busy`      | A human on the page is dragging/trimming a clip right now                                           | Wait a turn and resend                                                                                                                                                                                            |
| `collab_offline`     | The page is not synced with the collaboration server; nothing was written (`error.persisted:false`) | Wait 5 s and resend unchanged — `error.next[0].command` is that argv (without `--request-id`: the same id only fetches this failure again); if it keeps happening, ask the user to check the canvas tab is online |
| `render_interrupted` | A 3D render in the browser was cut off by a transient cause                                         | Resend the same `run` unchanged; shots that already landed are reused                                                                                                                                             |

`retryable:false` does **not** mean permanent failure. It means only that repeating _this_ call is pointless — most such errors clear once you re-read and send a corrected payload. Do not report a `retryable:false` error to the user as an unrecoverable system fault, and do not report a refused write as a submitted one.

Three `retryable:false` codes are worth calling out because they are the ones most often retried by mistake:

- `unknown_outcome` — **never re-send.** The operation may already have happened and only its confirmation was lost, so a retry can duplicate work and double-charge a paid generation. Read the node state and the account task list to find out what actually happened.
- `stale`, `timeline_conflict` and `scene3d_conflict` — the failed precondition (`expect` sha, `expectOutputId`, `baseRevision`, `baseLayout`, `baseDigest`) _is_ the error. Re-read, then send a **new** payload built on the fresh value. Replaying the old payload fails the same check. Never drop the precondition to force the write. For `scene3d_conflict` the new payload is a new plan: someone changed the scene, so decide the actions again against the scene you re-read — swapping the fresh `baseDigest` into the old actions would quietly undo their change.
- `read_only` — this session is a viewer, so no number of retries will ever help even though the message looks like a transient glitch. The only ways out are a human granting this session edit rights on the canvas, or pairing a canvas it can already edit.

`error.next` lists follow-ups as `{command, description}` when a concrete one exists — currently for `read_only`, `stale`, `resource_not_found`, `timeline_conflict`, `invalid_draft`, `doc_conflict`, and `scene3d_conflict`. Each `command` is a real CLI command line with uppercase placeholders (`NODE-ID`, `SESSION-ID`) to substitute before running; `description` says what to do with the reply. `next` is advisory and never exhaustive, so its absence is not a signal that nothing can be done — for a code with no `next`, the message and the code's own contract above are the guide. Where the real fix is a human action, `command` is a diagnostic that confirms the state (`read_only` points at `list-canvases`, whose reply carries the live `role` and `readOnly`) and the human action is stated in `description`.

`approval_required` deliberately carries no `next`. Authorization is the user's decision to make, so the reply will never hand back a ready-to-run `run --approved` or `run-batch --approved`: obtain the user's authorization, then fill `approval.userApprovedNodeIds` yourself.

### Error codes: canvas commands, the document library and Jianying folders

This table lists every code of the canvas bridge (`CANVAS_CONTRACT.bridgeErrors`) and of the two bridges that call the server with the page's own sign-in — the document library (`docs`) and the Jianying draft folders (`jianying-roots`). Other bridges have codes of their own, covered with their commands rather than here: `models` answers `model_catalog_unavailable` (see Discover generation models), and a page older than the bridge method a command needs answers `bridge_missing` — refresh the page (see that command's section). Media transfer (`download`, `inspect-media`) and pairing have connection-level codes too; when one comes back, read its message and check `status`.

| Code                         | What it means                                                                                                                                                                                                                                              | What to do                                                                                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `not_installed`              | The bridge handshake has not run on this page yet; every mutation is gated on it                                                                                                                                                                           | Not yours to fix by retrying the command — check `status`, and re-pair if the page never installed                                                                                                                                                                             |
| `canvas_not_found`           | No canvas with that id is mounted here — the paired canvas was closed or navigated away                                                                                                                                                                    | `status` / `list-canvases`; the user must reopen the canvas, then create a fresh session if it ended                                                                                                                                                                           |
| `read_only`                  | This session is a viewer, or the editor mounted read-only                                                                                                                                                                                                  | `list-canvases` for live `role`/`readOnly`; a human must grant edit rights. Never retry                                                                                                                                                                                        |
| `invalid_request`            | The request itself is malformed: missing/ill-typed field, a limit breached, a bad cursor                                                                                                                                                                   | `error.path` names the exact field (a `scene3d_apply` with several problems also carries `error.issues[]`, every one of them, 0.18.0); fix the payload                                                                                                                         |
| `invalid_command`            | The command engine rejected it (carries `path`, and `matches` for `edit_text`)                                                                                                                                                                             | Read the message — it names the engine code (`DUPLICATE_NODE_ID`, `CONNECT_REJECTED`, `EDGE_NOT_FOUND`…)                                                                                                                                                                       |
| `invalid_draft`              | A draft key this node kind does not have (carries `field` + `allowed`)                                                                                                                                                                                     | Rebuild the draft from `allowed`; the reply is the authoritative key list                                                                                                                                                                                                      |
| `too_large`                  | Over a hard cap: 25 MiB upload, 256 MiB media, a glob budget, a catalog page, a document over 50,000 characters (`chars` / `limitChars`)                                                                                                                   | Split the work or narrow the query; retrying identically cannot help                                                                                                                                                                                                           |
| `upload_unsupported`         | The import path cannot produce a durable file here (carries `reason`)                                                                                                                                                                                      | `upload_failed` may be transient; `no_importer` / `unsupported_mime` / `unsupported_image` / `no_durable_file` need a different file or page                                                                                                                                   |
| `unresolved_mention`         | A `@{label}` in a written prompt matched no ready candidate (carries `labels`) — **fails the whole apply**                                                                                                                                                 | Fix the _graph_, not the wording: create/wire/run the source, or copy the disambiguated `syntax` from `read`                                                                                                                                                                   |
| `node_not_found`             | The referenced node does not exist, or a group id for a batch does not                                                                                                                                                                                     | `ls` / `read` to find the real id; do not substitute a similar node                                                                                                                                                                                                            |
| `resource_not_found`         | A previously listed resource no longer belongs to this node                                                                                                                                                                                                | `resources NODE` again and pick a row whose `available` is true                                                                                                                                                                                                                |
| `not_owned`                  | `cancel` on a run this session did not submit — `tasks` shows it with `submitter.isMe:false` (a human, or another Agent)                                                                                                                                   | Do not force it; report who owns it (`tasks --node NODE-ID`). Cancelling someone else's run from here would resurrect the node                                                                                                                                                 |
| `run_failed`                 | The run pipeline refused or threw before the task was accepted (a 3D still blocked by its shot's data health carries `checks`)                                                                                                                             | Read the message; it is a real refusal, not a lost confirmation. Fix inputs before rerunning                                                                                                                                                                                   |
| `already_running`            | Someone else already has this node running (**retryable**)                                                                                                                                                                                                 | Wait for its terminal status; never resubmit — a second submit double-charges                                                                                                                                                                                                  |
| `approval_required`          | A run target is missing from `approval.userApprovedNodeIds`; **nothing was submitted**                                                                                                                                                                     | Get the user's authorization, then list every expanded node id yourself                                                                                                                                                                                                        |
| `node_running`               | A text write or an adopt on a node whose run is in flight (**retryable**)                                                                                                                                                                                  | Wait for the terminal status, then resend                                                                                                                                                                                                                                      |
| `batch_not_found`            | `cancel-batch --batch` named a batch that is finished or was never this session's                                                                                                                                                                          | Nothing to cancel; check the batch actually came from this session                                                                                                                                                                                                             |
| `stale`                      | `expect` / `expectOutputId` did not match (carries `currentSha` or `currentOutputId`)                                                                                                                                                                      | Re-read, incorporate the newer edit, send a **new** payload                                                                                                                                                                                                                    |
| `timeline_conflict`          | `baseRevision` or `baseLayout` (`cut` must send it; `split`/`trim`/`restore` may) no longer matches the track                                                                                                                                              | `timeline list`, merge onto those clips (recompute a `cut` range, keep a human's new trims), resend with fresh values                                                                                                                                                          |
| `timeline_busy`              | A human is dragging/trimming a clip right now (**retryable**)                                                                                                                                                                                              | Wait a turn and resend                                                                                                                                                                                                                                                         |
| `collab_offline`             | The page is not connected / synced to the collaboration server, so a write wrote nothing (**retryable**; reads are not gated)                                                                                                                              | Wait 5 s and resend unchanged; three in a row → ask the user to check the canvas tab is online. After a deploy, an old canvas tab is read-only: when the message says the tab is older than the canvas, ask the user to refresh it first — resending before that will not help |
| `render_interrupted`         | A browser-side 3D render was cut off by a transient cause — no frame progress, WebGL lost, a network error, the tab discarded (**retryable**)                                                                                                              | Resend the same `run` unchanged; shots that already landed are reused. A deterministic failure is `run_failed` instead                                                                                                                                                         |
| `scene3d_conflict`           | `scene3d_apply.baseDigest` is not the node's current `sceneDigest` — a human or another Agent changed the scene (carries `currentDigest`)                                                                                                                  | `read` the node, re-plan against the scene it returns, send a **new** batch with that `sceneDigest`; never resend the old one                                                                                                                                                  |
| `doc_conflict`               | `--expect-version` is not the library's version, or `create` hit an existing id                                                                                                                                                                            | `docs read`, redo the change on that version, resend; for `create`, update the existing one                                                                                                                                                                                    |
| `doc_not_found`              | No document with that id in this project's library, or it was deleted                                                                                                                                                                                      | `docs ls` to find the real id                                                                                                                                                                                                                                                  |
| `unknown_outcome`            | A submit was delivered but its result was never confirmed                                                                                                                                                                                                  | **Never re-send.** Inspect node state and the account task list before anything dependent                                                                                                                                                                                      |
| `unauthorized`               | The page's own sign-in expired or lacks the rights, so the server refused a request the page makes with it (document library, `jianying-roots`, `models`); the daemon also answers it when this session's credential is no longer valid (a revoked worker) | Ask the user to sign in again on the page, then resend once; a revoked worker's session is over (main may `delegate` a new one). Never loop                                                                                                                                    |
| `disconnected`               | The session is over: the user disconnected the page, main ran `stop`, or the page-refresh recovery window ran out. A call not yet sent gets it with `outcome:"not_sent"`; the page also returns it for a request cut off as it disconnected                | `status`; the user reopens the canvas, you `connect` a new session, check what landed (`read` / `docs read`), then resend there                                                                                                                                                |
| `tool_not_found`             | `run-tool --kind` names no tool this page knows (a typo, or a page older than the tool); the reply carries `tools`, what applies to this node now                                                                                                          | Pick a `kind` from `tools` and resend; do not guess a second spelling                                                                                                                                                                                                          |
| `tool_not_applicable`        | The tool exists but does not apply to this node (去字幕 on an audio node, an image editor on a node with no picture yet); carries `tools` too                                                                                                              | Use a kind from `tools` or another node; resending the same kind cannot help                                                                                                                                                                                                   |
| `quota_exceeded`             | A document write would push the project's current texts past 50 MB (carries `usedBytes` / `limitBytes`); nothing was written                                                                                                                               | Not retryable as-is: tell the user the project's documents are full — delete ones no longer needed, or shorten this one                                                                                                                                                        |
| `upload_failed`              | A document's new text could not be stored as a file (HTTP 502); nothing was written (**retryable**)                                                                                                                                                        | Resend the same call a little later; several times in a row → tell the user                                                                                                                                                                                                    |
| `content_unavailable`        | A document's text file could not be fetched, or what came back was not this version's text (HTTP 502) (**retryable**)                                                                                                                                      | Resend the same `docs read` / `docs update` a little later; the wrong text is never handed to you                                                                                                                                                                              |
| `documents_unavailable`      | Any other document-library failure (another HTTP status, a network error), not retryable as-is                                                                                                                                                             | Check `status` (the page signed in and connected), `docs read` to see whether a write landed, then decide; several in a row → tell the user                                                                                                                                    |
| `jianying_roots_unavailable` | The page could not read or update the user's registered Jianying draft folders (an HTTP status other than 400 / 401, or a network error); when listing them fails, `export-jianying --draft-root` writes nothing                                           | Check `status` (the page signed in and connected), then resend a little later; several in a row → tell the user                                                                                                                                                                |

## 不经宿主、直接跑二进制时

只在没有 `canvas_cli` 工具、自己在 shell 里跑 `scenemint-canvas` 时才看这一节。

- 每条命令末尾加 `--session ID`（`connect`、`help`、`skill-path` 三条不加，加了会被拒）。
- ID 来自 `scenemint-canvas connect --origin https://HOST --name "任务名" --workspace /绝对路径` 回复里的 `sessionId`；同一任务复用它，不要用别的任务的会话、不要读凭据文件。
- worker 用 `delegate --session MAIN-ID --name NAME --workspace 已存在目录` 回复的 worker `sessionId`；`revoke --delegate WORKER-ID --session MAIN-ID` 收回。
- 例：`scenemint-canvas ls / --long --session ID`、`scenemint-canvas apply --file edit.json --session ID`。
- 其它一切（顺序、`expect`、`@{}`、授权）与上文完全相同。
