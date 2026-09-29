# 场景 → 命令（先看这里）

本节把用户的一句话翻成 `canvas_cli` 的 argv。argv 用 JSON 数组写，原样复制即可。
下文所有大写字母的 `NODE-ID` / `SHA` / `MODEL-ID` 都是占位符，必须换成**上一条命令回复里**的真实值。

## 小节索引（先定位，再只读那一节）

本文件很长。**不要整读**：宿主的文件读取工具会在中途截断，而且不会告诉你缺的是哪半份 —— 拿半份手册当全份用，正是「这条命令不存在吧」这类错误判断的来源。先按用户那句话在下面的场景表里找到场景号（`## 1.` 一直到 `## 18.`，文档库是 `## 17d.`），照抄 argv；要查参数细节再按**标题原文**搜下半部分对应的一节。标题会改、行号更会改，所以这里只给标题，不给行号。

| 读哪一节（照这个标题原文搜）                              | 里面是什么                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `## 铁律（每条命令之前都过一遍）`                         | 发任何命令之前都成立的十条                                                                 |
| `## Main and delegated worker sessions`                   | 一个连接对一张画布；worker 能做什么、不能做什么                                            |
| `## Hard limits every call is checked against`            | 每条命令都会被检查的边界：一批多少条、一次读几条路径、上传多大                             |
| `` ## 命令卡住 / 页面刚升级：`page_away` ``               | 页面不在时谁排队、谁根本没发出去、怎么用同一个 `--request-id` 取结果                       |
| `## Find and read`                                        | `list-canvases` `ls` `read` `grep` `snapshot` `health` `tasks` `changes` 的完整参数        |
| ``## The document index: `doc-index` and business paths`` | 业务路径那张表怎么读、怎么写，以及为什么它删不得                                           |
| `## Discover generation models`                           | `models` 与 `inputSchema`：参数只能用它列出来的值                                          |
| `## Wire references and write prompt mentions`            | 连线与 `@{}` 的固定顺序                                                                    |
| `## Plain text nodes (no generation)`                     | 文字便签（不用 `run`）                                                                     |
| `## Apply batches`                                        | 一批 `apply` 的整批语义、`--turn`、`--file`                                                |
| `## The twenty-nine apply commands`                       | 29 条 apply 命令各自的字段；每条还有自己的三级小节，再往下找一层                           |
| `## Runs, undo, and timelines`                            | `run` `run-batch` `run-tool` `cancel` `cancel-batch` `undo` `redo` `operations` `timeline` |
| `## Media and connections`                                | `upload` `download` `inspect-media` `frames` `export-jianying` `jianying-roots`            |
| `` ## Project documents: `docs` ``                        | 文档库：`docs ls` `read` `create` `update` `delete` 的参数与回包                           |
| `## Refresh and errors`                                   | 错误码逐条对应的处置                                                                       |
| `## 不经宿主、直接跑二进制时`                             | 人在 shell 里排查用；模型不需要读                                                          |

## 铁律（每条命令之前都过一遍）

- argv 里**永远不要写 `--session`**：宿主自动注入。自己写 → 命令被拒（`SESSION_NOT_ALLOWED`），什么都没执行。
- **先 `ls` / `grep` 再 `read`，永远不要猜节点 id**。猜的 id 只会得到 `missing` 或 `node_not_found`。
- 写任何文字前**先 `read` 拿 `promptSha` / `contentSha` / `titleSha`**，写的时候放进 `expect`。不带 → 会覆盖用户刚改的内容。
- `@{标签}` 只能逐字复制 `read` 回复里 `mentionCandidates[].syntax` 的值。自己拼 → `unresolved_mention`，整批失败。
- **连线一批、写提示词另一批**，中间要等参考节点有输出。
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
- ❌ 错误：`["apply","--file","/tmp/edit.json"]` 或 `["apply","--file",".canvas/edit.json"]` → `workspace_boundary` / `file_not_found`。文件放在 workspace 里，写相对 workspace 的路径。

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

**本地免费工具（`billable:false`）**：`read` 的 `tools` 里带 `"billable":false` 的那几条（`trim-audio` 裁切音频、`trim-video` 裁切视频、`capture-frame` 截帧；图片节点上的 `crop-image` 裁剪、`grid-split` 多宫格、`flip-image` 翻转、`annotate-image` 标注（含文字 `kind:"text"`），以及资产参考图 `asset-sheet`、剧内比例总表 `scale-lineup` —— 这两件与标注文字见场景 6e）整件事在用户浏览器里做完，不经网关、**不扣费**，不需要向用户要钱的那次点头（CLI 仍要 `--approved`，那只是命令形状）。全集在契约 `CANVAS_CONTRACT.tiers["run-tool"].localKinds`。参数走 `--json` 的 `metadata`，回包不是 `taskId` 而是 `local:true` + 产物节点：

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
- `mode:"speech"` 再带 `turns:["Leah","Liam","Leah"]` + `speaker:"Liam"` = 多人同镜：按台词顺序把说话段对到人，只取 Liam 的那一句（`meta.alignment` = `exact` / `merged` 可信；`unreliable` = 段数对不上台词数，退回整体选窗，要让人在面板上确认）。浏览器里做不了说话人识别，靠的是台词顺序——`turns` 必须逐句照分镜正文的顺序写。
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
- ✅ 正确：分离出来的音频太长 → `read` 看到 `trim-audio` 带 `billable:false` → 直接 `--json '{"metadata":{"mode":"speech","targetMs":5000}}'`，不用再要点头（不花钱）。
- ❌ 错误：没 `--approved` 就发（`approval_required`，一次网络都不发就被挡）。
- ❌ 错误：把付费的 `run-tool` 当成免费的「看一眼」——除了 `billable:false` 那几条，每跑一次都是一次扣费，和 `run` 没区别。
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

三件都是本地免费工具（`billable:false`：浏览器里画完、不经网关、**不扣费**；CLI 仍要 `--approved`，只有主会话能发）。产物一律是源节点旁的新图片节点，源图不动。

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
["run-tool", "LIAM-SHEET-NODE", "--kind", "asset-sheet", "--approved", "--json", "{\"metadata\":{\"kind\":\"character\",\"heightCm\":178,\"scaleRefs\":[{\"nodeId\":\"AFU-UPLOAD-NODE\",\"heightCm\":170,\"label\":\"阿福\",\"userSheet\":true}],\"fields\":{\"name\":\"Liam\"}}}"]
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
["run-tool", "BAIYAN-SHEET-NODE", "--kind", "scale-lineup", "--approved", "--json", "{\"metadata\":{\"items\":[{\"nodeId\":\"BAIYAN-SHEET-NODE\",\"heightCm\":168,\"label\":\"白妍\"},{\"nodeId\":\"AFU-UPLOAD-NODE\",\"heightCm\":170,\"label\":\"阿福\",\"userSheet\":true},{\"nodeId\":\"LEDGER-UPLOAD-NODE\",\"sizeCm\":{\"l\":21,\"w\":0.2,\"h\":29.7},\"label\":\"旧账本\",\"kind\":\"prop\",\"userSheet\":true}]}}"]
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
- ❌ 错误：`cancel` 回 `not_owned` 后换个说法重试 → 那是别人的运行（`tasks` 里 `isMe:false`），取消不了；告诉用户。
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

`layout` 是 `row` / `column` / `grid`；`gap` 默认 48；`grid` 的 `columns` 默认 `ceil(√n)`；`anchor` 不写就用这批节点当前包围盒的左上角。

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
- `append` 带 `dedupeBySource:true` + `sort:"shot"` = **剪辑器的「一键导入」**：新片段并入各自那一集、整集按镜号（集-场-镜）重排，已在轨上的保留裁剪；此时不收 `index`。加 `episode` = 「一键导入本集」，不属于这一集的节点整批拒；不加 = 「全部导入」，每集各补各的，`unknown` 集保持原序。

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
| 读全文                | `docs read DOC-ID`                                                             | L0，worker 也能发        |
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

回读 `document.content`（正文，没有任何头信息）和 `document.version`（改的时候要带）、`document.contentSha`。只想存到 workspace 里慢慢看：`["docs", "read", "script:ep:03", "--out", "看/第3集.md"]`（`看/` 不在会自动建）—— **那只是临时阅读副本**，改它不会回到文档库。

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
- ❌ 错误：回 `too_large`（一篇正文最多 100 万字，`error.chars` 是这次的长度）就原样再发一次 → 拆成几篇（比如一集一篇）分别 `docs create`。
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

The first seven rows are enforced by the daemon **before** the request reaches the page (`src/policy.mjs`), so a batch that breaks one of them fails whole having never been delivered; from `read.paths` down they are the page's own gates and fail the same way, whole and with nothing written. Either way there is no partial effect, and none of them is negotiable by retrying.

| Where                                                   | Limit                                                                        | What a breach returns                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apply.commands`                                        | **1..1000** commands per batch                                               | `invalid_request` "apply requires 1..1000 commands"                                  |
| `apply.commands[].type`                                 | one of the twenty-nine names below                                           | `invalid_request` "Unknown or nested apply command"                                  |
| `apply.commands[].<key>`                                | only the fields that command declares                                        | `invalid_request` "Unexpected `<type>` field: `<key>`"                               |
| any command payload                                     | plain JSON, ≤ 40 levels deep, no `commands` / `__proto__` key inside         | `invalid_request` "Nested or unsafe command field"                                   |
| `run_nodes.nodeIds`                                     | **1..1000** non-empty strings, each ≤ 1024 chars                             | `invalid_request` "nodeIds must be 1..1000 non-empty strings"                        |
| `run_nodes` / `run_node` `approval.userApprovedNodeIds` | **1..1000** non-empty strings, each ≤ 1024 chars; no other key in `approval` | `approval_required`                                                                  |
| `run_nodes.concurrency`                                 | integer 1..200 (default 24)                                                  | `invalid_request`                                                                    |
| `read.paths`                                            | 1..20 paths                                                                  | `invalid_request` "paths 一次最多 20 个"                                             |
| `ls.limit` / `grep.limit`                               | 1..500 (defaults 200 / 100)                                                  | clamped, not an error                                                                |
| `resources.limit` / `resources.offset`                  | limit 1..200 (default 100); offset a nonnegative integer (default 0)         | `invalid_request` "resources requires limit 1..200 and a nonnegative integer offset" |
| `upload_asset.bytesBase64`                              | 25 MiB decoded (26,214,400 bytes)                                            | `too_large`                                                                          |
| `docs` document id                                      | ≤ 20 chars, `CANVAS_CONTRACT.documents.idPattern`                            | `invalid_argument` locally; `invalid_request` from the daemon / page                 |
| `docs create` / `docs update` text                      | ≤ 1,000,000 characters per document                                          | `invalid_request` "content must be a string of at most 1000000 characters"           |
| `docs ls --limit`                                       | 1..200 (default 50)                                                          | `invalid_argument` / `invalid_request`                                               |
| HTTP body                                               | 36 MiB                                                                       | transport-level rejection                                                            |

Clamping is the exception, not the rule: **only `ls.limit` and `grep.limit` are clamped into range.** Every other row above is a refusal, and `resources` in particular refuses rather than clamps — neither the CLI nor the daemon touches the number, so `--limit 500` on `resources` reaches the page and comes back `invalid_request`, not a page of 200.

## 命令卡住 / 页面刚升级：`page_away`

页面不在（用户刷新、升级、切走、浏览器重启）时守护进程进入 `reconnecting`，最多等它十分钟回来。命令不会在这段时间里静默挂着：

| 命令类型                                                                                                                                                                                                                       | 页面不在时                                                                                      | 你该做什么                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 只读（`ls` `read` `grep` `snapshot` `health` `tasks` `resources` `models` `inspect-media` `download` `docs ls` `docs read` `jianying-roots`）                                                                                  | ≤ 5 秒回 `page_away`，`queued:false`、`outcome:"not_sent"`，**没排队**                          | 等页面回来再发（先 `status` 看 `pageAway`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 写（完整清单：`apply` `tidy` `resize-group` `upload` `run` `run-batch` `run-tool` `cancel` `cancel-batch` `undo` `redo` `turn-end` `docs create` `docs update` `docs delete` `timeline`；timeline 只有 op 不是 list 时才排队） | 排队；`--wait-ms`（默认 30000）后回 `page_away`，`queued:true`、`outcome:"queued"`、`requestId` | **不要重发**。页面回来它会自动执行一次；用同一个 `--request-id` 再发一遍 = 取结果。`--wait` 一直等到恢复窗口结束（清单里的每一条都接 `--wait` / `--wait-ms`）。**宿主可能禁用 `--wait`**：这些命令本身收它，但把 CLI 包成工具的宿主有权拒（它自己的工具调用有超时，一个能阻塞十分钟的参数会把整轮对话挂死）。被宿主拒了就按宿主的话走，不要换着写法重试——发 `--wait-ms`（或什么都不加，默认 30000）拿到 `requestId`，然后轮 `["status"]` 看 `pageAway` / `queuedCommands`，页面回来后用**同一个** `--request-id` 再发一遍取结果 |

```json
["status"]
```

回读 `pageAway`（true = 页面不在）、`queuedCommands`（排队中的写命令数）、`pageLastSeenAt`（最后一次听到页面）、`resumeExpiresAt`（过了这个时间会话就结束）。

- ✅ 正确：`apply` 回 `page_away` + `queued:true` → 「画布页面暂时离线，这条修改已排队，请把画布切到前台，回来后会自动应用」→ 页面回来后 `["apply","--json","…同样的内容…","--request-id","同一个 id"]` 取结果。
- ❌ 错误：回 `page_away` 就换个 id 重发 `run` → 页面回来后同一个节点跑两次、付两次费。
- ❌ 错误：`resumeExpiresAt` 已过还在等 → 会话已结束（`not_connected`），让用户重新连接。

## Find and read

| Command         | JSON parameters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list-canvases` | `{}`; only the paired canvas, with its live `role` and `readOnly`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ls`            | `path`, `glob`, `kind[]`, `status[]`, `hasOutput`, `tag[]`, `long`, `limit` (1–500), `after`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `read`          | `paths` (1–20 node IDs or paths), optional `offset`, `limit` for one text field; a group returns `memberIds`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `resources`     | `nodeId`, optional `limit` (1–200), `offset` from `nextOffset`; all candidate/history/reference/current media                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `grep`          | `pattern`, `fixed`, `ignoreCase`, `fields[]` (+ `tags`), `path`, `glob`, `kind[]`, `status[]`, `tag[]`, `filesOnly`, `count`, `limit`, `offset`                                                                                                                                                                                                                                                                                                                                                                                                                |
| `snapshot`      | `maxNodes` (default 200, hard ceiling **2000**), `timeline`, `nodeIds[]`, `kinds[]`, `around:{nodeId,depth:1}`. A clamped reply carries `truncated:true` **and** `omittedNodes:N` — a health check over a partial list is a wrong answer, so raise `maxNodes` or narrow the selection. A group row adds `bounds`, `memberIds`, `membersBounds` (the members' rendered box) and `frameOversize:true` when the frame is more than 3× the area its members need. The reply carries **both** counters, `rev` and `seq` — see 「`rev` 和 `seq` 是两个计数器」 below |
| `health`        | `maxIssues` (default 100, at most 1000 rows of detail), `groupMinMembers` (defaults to the contract's `group_nodes.minMembers`). Read-only and idempotent. The scan is **the whole canvas** — `scanned:{nodes,groups,edges}` says how much it looked at, and it is NOT bounded by snapshot's node ceiling. `truncated:true` / `omittedIssues:N` are only ever about the `issues[]` **detail list**; `counts` stays complete. See 「11c. `health`」 below                                                                                                       |
| `changes`       | `sinceSeq` **and `sinceEpoch`** (both come from the previous reply; a `sinceSeq` sent without its `sinceEpoch` always answers `truncated`). Reply is `{seq, epoch, entries[], truncated?, truncatedReason?}`. **`truncated:true` invalidates the whole delta, `entries:[]` included** — see 「What `changes` can and cannot tell you」 below                                                                                                                                                                                                                   |
| `tasks`         | `nodeIds[]`, `status[]` (queued/running/succeeded/failed/cancelled), `submitter` (me/agent/human), `since` (ISO), `scope` (canvas/project/all), `limit` (1–500), `after`                                                                                                                                                                                                                                                                                                                                                                                       |
| `operations`    | `{}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

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

`models [query] --model-type video --limit 20 --offset 0` reads the signed-in user's catalog through the same `/api/gateway/models` route as the human model picker. JSON parameters are `modelType`, `modelId` (exact ID), `query` (case-insensitive ID/display-name substring), `offset`, and `limit` (1–100; default 20). Model types are `text`, `image`, `video`, `image_edit`, `video_edit`, and `audio_edit`. A catalog entry does not imply the canvas has a generic generation node for every model type: ordinary generation node modes are text/image/video; edit types belong to the existing specialized tools.

Results contain `models`, filtered `total`, `offset`, and `nextOffset` (null at the end). Each model has `id`, `displayName`, `modelType`, actual `inputSchema`, `schemaStatus`, and any published `protocol`/`featureTypes`. The schema is preserved verbatim, including `required`, `enum`, each enum's `default`, numeric constraints and `maxItems`; it is not a hand-written list of defaults. Read every constraint from it — models that look related do not share one (`MiniMax H3` takes `768p`/`2K` and up to 9 images, `MiniMax H3 Max` takes `480p`/`768p`/`1080p` and up to 12). A page is capped at 512 KiB and may contain fewer than `limit` entries; continue from `nextOffset`. Do not interpret a missing schema as an unconstrained model. `unauthorized` means the page needs a permitted account; `model_catalog_unavailable` means the catalog must be retried, not that no models exist.

A model whose schema cannot express all of its limits also carries `localConstraints`, and the result then carries `constraintNotice`. It holds the constraints the same generation form and `POST /api/tools/submit` enforce and supersedes the published schema wherever the two disagree: `aspects`, `resolutions`, `durationMin`/`durationMax`/`durationAuto` (the auto-length sentinel), `maxImages`/`maxVideos`/`maxAudios` (reference array lengths), and `omniTaskTypes` with the per-type `omniTaskTypeRules` for `metadata.omni_reference_task_type` (`forcedAspect`, `requiresAutoDuration`, `requiresVideo`, `requiresAnyReference`, `allowsFrames`). Its absence means the published schema is authoritative, never that the model is unconstrained.

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

| `kind`         | Accepted `draft` keys                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gen`          | `mode`, `source`, `outputType`, `prompt`, `modelId`, `aspectRatio`, `resolution`, `quality`, `outputFormat`, `background`, `promptExpansionMode`, `imageCount`, `negativePrompt`, `stylePresetId`, `userReferenceUrls`, `duration`, `generateAudio`, `returnLastFrame`, `omniReferenceTaskType`, `inputs`, `conversionSlots`, `fileName`, `mimeType`, `outputUrl`, `content`, `assetTags`, `assetTagColors` |
| `media-upload` | `mediaType`, `fileName`, `mimeType`, `outputUrl`, `assetTags`, `assetTagColors`                                                                                                                                                                                                                                                                                                                             |
| `scene-3d`     | `outputMode`, `assetTags`, `assetTagColors`                                                                                                                                                                                                                                                                                                                                                                 |
| `group`        | `assetTags`, `assetTagColors` _(only these — any other draft key on a group is `invalid_draft` with `allowed: ["assetTags","assetTagColors"]`)_                                                                                                                                                                                                                                                             |

The keys the mapping table above does not cover, and what they are:

- `mode` — `text` / `image` / `video`. Decides what the node will produce and which reference types its input port accepts.
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

| Field         | Meaning                                                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`          | false ⇒ nothing was written; read `error` and stop                                                                                                                                                                                                                                    |
| `created[]`   | `{command, id, kind}` for every id this batch minted, in command order                                                                                                                                                                                                                |
| `written[]`   | `{command, nodeId, field, sha, length, status}` for every text field written, one per (node, field)                                                                                                                                                                                   |
| `exports[]`   | one entry per `export_output`, in command order                                                                                                                                                                                                                                       |
| `skipped[]`   | `{command, nodeId, reason}` for every `group_nodes` / `add_to_group` id left out (`already_grouped` / `already_member` / `is_group` / `not_found`); absent when nothing was skipped                                                                                                   |
| `focused[]`   | one per `focus_node`: `{command, nodeId \| nodeIds \| all, framed, reason?}` — see `focus_node`                                                                                                                                                                                       |
| `selected[]`  | one per `select`: `{command, nodeIds, shown, reason?}`                                                                                                                                                                                                                                |
| `recovered[]` | one per `recover_deleted`: `{command, nodeIds, edgeIds, notFound?}`                                                                                                                                                                                                                   |
| `dissolved[]` | `{command, groupId}` for every `remove_from_group` that left the frame with fewer than 2 members, so the frame is gone                                                                                                                                                                |
| `tidied[]`    | `{command, moved, resized, strays[]}` for **every** `tidy` in the batch — the `scope` pass and the whole-canvas re-layout alike, and on **both** call paths (a plain `apply` batch containing a `tidy`, and the CLI's `tidy`). `strays[]` is only ever non-empty for the `scope` pass |
| `tidySummary` | the same entries rendered as one text line each, strays named — produced by the page, so it accompanies `tidied[]` on both paths. Quote it; it is the only form that survives a host compressing the reply into prose                                                                 |
| `rev`         | the document revision after the apply                                                                                                                                                                                                                                                 |
| `undoDepth`   | this Agent's undo depth afterwards                                                                                                                                                                                                                                                    |

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

## The twenty-nine apply commands

Exactly twenty-nine `type` values exist. Anything else is `invalid_request` before the page sees it.

`add_node` · `update_node` · `edit_text` · `move_node` · `connect` · `disconnect` · `delete_node` · `group_nodes` · `ungroup` · `add_to_group` · `remove_from_group` · `resize_group` · `set_viewport` · `arrange` · `align` · `tidy` · `duplicate_node` · `duplicate_nodes` · `select_output` · `delete_output` · `split_output` · `clear_output` · `reset_status` · `adopt_output` · `recover_deleted` · `focus_node` · `select` · `upload_asset` · `export_output`

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

**Bulk deletes need the user's go-ahead**, on the editor's own line (`needsBulkDeleteConfirm`): when the batch's `delete_node`s remove **more than 5** nodes in total, or any group that has members, every `delete_node` target must be listed in `approval.userApprovedNodeIds` — `apply --approved` fills it with the batch's targets. Without it the batch is `approval_required` and nothing is deleted. Like `run --approved` it declares an authorization you already hold; never add it before the user said yes.

Everything a `delete_node` removes is snapshotted into the page's 最近删除 buffer (the same one the human's Delete key fills) once the batch commits, so `recover_deleted` can put it back after the undo stack is gone.

```json
{ "type": "delete_node", "nodeId": "NODE-ID" }
```

**Wrong:** `{"type":"delete_node","nodeId":"GROUP-ID"}` intending to remove only the frame — you just deleted every node inside it. And `nodeId:"doc-index"` deletes the whole business path map; see the index section before you type it.

### `group_nodes`

**Required** `nodeIds[]`. **Optional** `title`, `id`.

Needs **at least one node that exists, is not already in a group, and is not a group itself**. One survivor is enough — a frame around a single node is a legitimate thing to build (a scene with one shot, a product with one still). The frame is fitted around the members with 28 px padding and members become parent-relative.

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

**Required** `nodeIds[]` (non-empty, **unique**), `layout` (`row` | `column` | `grid`). **Optional** `gap` (non-negative; default **48**), `columns` (grid only, ≥ 1; default `ceil(sqrt(n))`), `anchor:{x,y}` (default the nodes' current bounding-box top-left).

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

## Runs, undo, and timelines

- Main `run-batch --nodes a,b,c [--group G] [--concurrency 1-200] [--rerun-succeeded] --approved` calls `run_nodes`. `--nodes` fills `approval.userApprovedNodeIds` with those IDs; `--group` needs the expanded member IDs supplied through `--json {"groupId":…,"approval":{"userApprovedNodeIds":[…]}}`; `read GROUP-ID` returns them as `memberIds`, which is the cheap way to build that list. Both `nodeIds` and `userApprovedNodeIds` are capped at **1000 entries** each (every id non-empty and ≤ 1024 chars), so a canvas larger than that has to be run in several batches. The page runs the batch in reference order with the concurrency cap and answers `{order,submitted:[{nodeId,taskId}],pending,skipped:[{nodeId,reason}]}` once the first wave is accepted; the rest continues on the page. Workers cannot invoke it. A batch spends the account's generation balance — each submitted node is a chargeable attempt, so `--concurrency 200` means up to 200 chargeable submissions in flight; size the batch to what the user authorized. You may start a new batch while an earlier one is still running (so can the user) — batches do not block each other; the account allows 200 nodes in flight across all of them and anything beyond that waits in its own batch's queue until a slot frees. If any node fails with `kind: quota`, stop and tell the user: the page drops that batch's not-yet-submitted nodes and records `{kind:"batch", note:"quota_stop", nodeId:<the one node that was submitted and then hit quota>, nodeIds:[…the dropped ones, none of which was ever submitted]}` in `changes`, because every remaining node would fail the same way. Do not resubmit the batch; already-submitted nodes keep running.
- Six `changes` notes exist and they are **not** interchangeable — read the `note`, never just the `kind`. Five of them only ever ride on `kind:"batch"`. The sixth, `note:"bulk_change"`, is not a note anyone writes at all: it is ONE transaction that touched many nodes at once, reported as a merged row instead of one row per node — `nodeIds` lists the nodes that row covers and there are no `fields`. EDGES merge on the same rule and are the one row with no id list at all: this contract has no `edgeIds`, and edge ids only ever come from `snapshot`, so that row says `fields:["edges"]` and nothing else — read it as "one transaction changed a batch of wiring, go re-read the wiring". **`actor` is whoever ran it, `human` included**: this canvas's own automatic frame refit is `page`, a peer's transaction is `remote`, and a human's own multi-select delete or drag on this page is `human`. Merging never crosses an action, so one wide transaction gives you at most three rows — `kind:"add"`, `kind:"delete"` and `kind:"batch"` (the move/update noise) — and a deletion stays visible as a deletion no matter how many nodes it took. Keep branching on `kind`; just do not read one merged row as "only one thing changed", and re-read the ids you care about. It exists because a refit moves ten members plus their frame in one write, and at one row per node a collaborator landing twenty images pushed 200+ automatic rows through the 500-row buffer and evicted the human edits you came to read. Two of the batch notes are not about batches at all and carry `actor:"human"`: `note:"frame_strays"` (a human dragged a group frame, or pulled one of its grips, and the frame now covers nodes that are not its members (covers = their centres are inside it, the one stray test the whole product uses) — `nodeId` is the frame, `nodeIds` the loose nodes) and `note:"frame_escaped"` (same gesture, members whose centre ended up outside the frame). **Nothing was changed by either** — the canvas freezes membership for every frame gesture on purpose, and these entries exist so the state is visible instead of having to be re-derived from `snapshot` geometry. Do not act on them unprompted: absorbing a stray is `resize_group {absorbStrays:true}` and needs the user's word, because the frame is also the deletion unit. The remaining three are the page's own batch bookkeeping (`actor:"page"`). `note:"batch_lost"` means the previous page never submitted those nodes, so nothing was paid and they are still waiting to be run. `note:"run_timeout"` means one node outran the page's run limit and released its slot; the cloud task is untouched, so inspect the node before deciding. `note:"quota_stop"` is the one that must not be retried: the page deliberately abandoned the rest because the account is out of balance, so resending the same batch spends whatever balance later returns without asking the user again — the authorization you hold was for the earlier attempt. Read the two fields separately, never by array position: `nodeId` is the single node that **was submitted** and then failed on quota, and `nodeIds` are the ones dropped **before** submission, so they never ran. Report that split — the submitted one reached the gateway and its charge is settled there, which this page cannot see, so tell the user to check their own balance rather than asserting either way; the dropped ones definitely never ran. Then get a fresh decision after they top up.
- The `run-batch` reply carries `batchId`. `cancel-batch --batch BATCH-ID` (or without `--batch`: every batch of this session) drops the nodes not yet submitted; submitted ones keep running — cancel them one by one with `cancel NODE`. `cancel NODE` also works for a node still queued in your own batch. Workers cannot call either. A `--batch` id that is not one of this session's live batches is `batch_not_found` (it may simply have finished).
- Main `run NODE --approved` calls `run_node` with `{nodeId,approval:{userApprovedNodeIds:[nodeId]}}`. Both daemon and page reject a missing approval list or a target outside it. This records the Agent's declaration of prior user authorization; it is not a new UI confirmation token. It returns acceptance; inspect the node later for completion. **A rerun keeps history**: running a node that already has output does not discard its earlier candidates — the new result is appended to the same candidate group the ×N batches and the human picker use, becomes the primary (`outputUrl`), and every earlier take stays selectable through `resources` + `select_output`. Image and video candidates have no automatic eviction. Changing output type replaces the other type's candidate group. `run NODE --fresh --approved` (`clearCandidates: true`) is the explicit opt-in to discard the previous candidates of that type before the run lands; never send it by default. `run-batch --fresh` applies the same flag to every node in the batch. `cancel NODE` can cancel runs initiated by this page's Agent bridge. Follow the user's authorization and do not cancel another collaborator's unrelated work; the current bridge tracks ownership by the page bridge, not by individual task session. Workers cannot invoke run or cancel.
- `run-tool NODE --kind KIND --approved` calls `run_tool`. A **local** kind — `CANVAS_CONTRACT.tiers["run-tool"].localKinds`, the same array as `CANVAS_CONTRACT.localTools.kinds`: `trim-audio` `trim-video` `capture-frame` `crop-image` `grid-split` `flip-image` `annotate-image` `asset-sheet` `scale-lineup` — runs entirely in the page, never reaches the gateway and never charges (`read` marks it `billable:false`); it still needs `--approved` (command shape, not a payment consent) and the main session, and it answers `local:true` with the new nodes instead of a `taskId`. Every other kind is L2 like `run`. `CANVAS_CONTRACT.localTools` carries each local tool's metadata limits and value sets (annotate text caps, `asset-sheet` panels — one picture per asset as NODE-ID, with the cells it holds — the character scale panel's `scaleRefs` caps, A30 field keys and the prop right-cell modes, `scale-lineup` item kinds and prop scale axes, row and image caps, height-ratio threshold, floor-shadow thresholds and 16:9 size); read them from there instead of copying numbers. Bad `metadata` is `invalid_request` before any work starts; scenes 6c and 6e show the argv.
- `undo --steps N`, `undo --turns N`, and corresponding `redo` operate on this Agent's own history. `document_reloaded` means the prior undo stack was discarded. Do not claim an undo happened when `undone` is zero.
- `timeline list` returns clips, `revision` and `layoutDigest`. Timeline JSON accepts `op`: list/set/append/remove/reorder/clear/trim/split/cut/restore, `clips:[{nodeId,inMs?,outMs?}]`, `index`, `clipIds`, `order`, `sort`: given/shot/position, `dedupeBySource`, `episode`, `clipId`, `inMs`, `outMs`, `reset`, `atMs`, `previousClips`, `baseRevision`, and `baseLayout` (op ↔ field pairing: §17a / §17b; an unknown field is rejected by the daemon).
- `set`, `remove`, `reorder`, `clear`, `split`, `cut`, and `restore` require the revision read from the current track; `append` and `trim` take it optionally (the revision covers membership and order, not trims). Preserve `previousClips` when planning to restore it. `timeline_conflict` or `timeline_busy` requires rereading; never overwrite a human's newer arrangement by dropping the revision. The revision checks known state; it is not a cross-peer lock.
- Because the revision ignores trims, `cut` (a timeline-time range) also **requires** `baseLayout` — the `layoutDigest` of the last reply, which covers every clip's in/out point — and `split`, `trim` and `restore` accept it optionally (checked when present). A human trimming an earlier clip moves every later position without changing the revision; the layout check turns that into `timeline_conflict` (`error.path: "baseLayout"`) whose reply carries the current clips and `layoutDigest`. Recompute the range from those clips before resending. `trim` and `restore` write in/out points by clip id, so the revision cannot stop them from overwriting a trim a human just made: after a human edit, `timeline list` first, merge the human's change into what you write (for `restore`, swap in the current values of the clips the human changed), and send that reply's `layoutDigest` as `baseLayout`. Every other op rejects `baseLayout`.
- Timeline clips refer to canvas nodes, never arbitrary media URLs. Timelines are not reverted by `undo`/`redo`; node undo can leave orphaned clip references for you to report.

## Project documents: `docs`

The project document library (doc@1, `docs/conventions/doc.md` in the monorepo) holds the text deliverables every agent shares — scripts, outlines, the global skeleton, character profiles, series bible, plot breakdowns, shot lists, shot-analysis ledgers / reports, uploaded novels. It belongs to the **project** (every canvas of the project sees the same library) and it is the **single source of truth**: there is no local mirror and no sync. Reading is reading the library; changing is an in-place update guarded by the version you read. The canvas panel (left rail → 文档库) shows the same documents in two sections, `reference` (参考资料) and `script` (剧本). The page performs every request with the signed-in user's own session, exactly like the panel, so permissions are the project's: a project viewer can read but every write is `read_only`.

| Command                                                                                                                          | Wire method                                              | Tier                |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------- |
| `docs ls [--section reference\|script --type TYPE --episode N --folder NAME --q TEXT --limit N --offset N]`                      | `documents_list`                                         | L0, workers allowed |
| `docs read DOC-ID [--out FILE --overwrite]`                                                                                      | `documents_get`                                          | L0, workers allowed |
| `docs ls --folders [--section reference\|script]`                                                                                | `documents_folders`                                      | L0, workers allowed |
| `docs read --folder NAME-OR-ID --out-dir DIR [--overwrite]`                                                                      | `documents_folders` + `documents_list` + `documents_get` | L0, workers allowed |
| `docs create --type TYPE (--file FILE \| --text TEXT) [--section S --episode N --folder NAME --title T --id DOC-ID --meta JSON]` | `documents_put` (no `id` unless `--id`)                  | L1, main only       |
| `docs update DOC-ID --expect-version N (--file FILE \| --text TEXT \| --patch DIFF) [--title T --meta JSON]`                     | `documents_put`                                          | L1, main only       |
| `docs delete DOC-ID --approved [--expect-version N]`                                                                             | `documents_delete`                                       | L3, main only       |

The two-word command is one key: `parseArgs` returns `command:"docs ls"`, and that string is the key in `CANVAS_CONTRACT.tiers` and in `help`. `docs` without a subcommand is `invalid_argument`. These commands take `--turn` / `--request-id` / `--wait` / `--wait-ms` but not `--json`; `--file` here is the **text file** (UTF-8, inside the session workspace, `.docx` is refused — upload Word files in the panel, which converts them to Markdown).

**Fields** (`CANVAS_CONTRACT.documents.fields`): `id`, `section` (`reference` | `script`), `folder` (uploaded novels: one folder per novel), `docType`, `series` (defaults to the project name), `episode`, `scene` (an anchor such as `1-2`; scenes are not separate documents), `title`, `format` (`markdown` | `srt` | `json`), `version` (+1 on every write, from 1), `contentSha` (the canvas `read` digest over the LF-normalized text), `sourceAgent`, `source` (e.g. where a reverse-engineered script came from), `assetTags`, `derivedFrom` (`id@version` of the upstream document), `updatedAt`, `summary`. `docs read` adds `content`, the plain text with no header of any kind.

**`--type`** (`CANVAS_CONTRACT.documents.docTypes`, the panel's group order): `skeleton` 全局骨架, `outline` 剧情大纲, `characters` 人物档案, `bible` 剧本圣经, `breakdown` 剧情拆解, `script` 剧本, `asset-list` 资产清单, `extras` 群演人物库, `genre-strategy` 题材策略, `shotlist` 镜头表, `lap-ledger` 拉片台账, `lap-report` 拉片报告, `lap-outline` 拉片大纲, `novel` 小说, `note` 其他资料. The `script` section only takes `script`; a `script` may also sit in `reference` (a source script to be rewritten). Without `--section`, `script` goes to the script section and everything else to reference. A reverse-engineered script is `script` with `source` saying where it came from; the global skeleton is reference material, never a script.

**Ids** (at most 20 characters — a canvas copy is tagged `doc:<id>@<version>`, and a node tag holds 30): first segment lowercase ASCII, further `:`-separated segments letters (Chinese included), digits, `_`, `-`. Without `--id`, the library derives one: episode → `<type>:ep:NN` (`script:ep:05`); a one-per-project type (`skeleton`, `outline`, `characters`, `bible`, `breakdown`, `asset-list`, `extras`, `genre-strategy`, `lap-outline`) → the type itself; in a folder → `<type>:<key>:NNNN`; otherwise `<type>:<slug of the title>`, cut to fit the 20 characters. Only folder numbering moves on; a derived id that already holds the same document (same type and title) is `doc_conflict` ("already exists") — update that document instead of creating another one. A title-derived id that holds a **different** document (two long titles cut to the same id: "Character Profile - Protagonists" / "… - Antagonists" → `note:character-profi`) is `doc_conflict` with `suggestedId` ("already used by another document"): nothing is written, `error.next` is `docs create --id SUGGESTED-ID …`, and the document at `id` is not yours — never update it. `suggestedId` is the cut title plus a 4-character hash of the full title, so the same title always gets the same one. A `create` with an explicit `--id` that is taken is a plain `doc_conflict` naming the document there ("already used by "…""): read it; update it only if it is the one you meant, otherwise pick another `--id`.

**Versions.** `docs create` / `docs update` are L1 (free, main only) but they are **not** in the canvas undo stack — `undo` cannot revert them. The server keeps every version's text; a rollback interface is not offered yet, so today the way back is another `docs update` with the text you read before changing it. Every write sends `expectVersion` (`--expect-version`; 0 for `create`). If the library's version differs, nothing is written and the reply is `doc_conflict` with `id` (the document the conflict is about), `currentVersion` (0 = gone or deleted), `currentSha` and `deleted` (true = soft-deleted: it cannot be changed, and its id is not reused — see **Deleted documents**); `error.next` points at `docs read` (for a deleted document it says what to do instead). Re-read, redo the change on that version's text, and resend with the new number — never resend old text with a bumped number. Omitted fields keep their values (`--patch` / `--file` / `--text` replace only the text, `--title` / `--meta` only those fields; `--meta` accepts `series`, `scene`, `format`, `sourceAgent`, `source`, `assetTags`, `derivedFrom`, `summary`, and `null` clears one). A write that changes neither text nor fields returns `unchanged:true` and keeps the version, so repeating the same `create`/`update` after a lost reply is harmless. `--patch` is applied by the CLI: it first reads the document, returns `doc_conflict` itself when the version already moved, applies the unified diff to that version's text (every hunk's old lines must be present; a hunk that does not match is `patch_failed`, exit 1 — re-read and rebuild the patch), then writes with the same version check.

**Deleted documents.** `docs delete` is a soft delete: the document leaves the panel and the listings, its text history stays, and its id stays with it. Changing it (`docs update`) is `doc_conflict` with `deleted:true`, `currentVersion` 0. A `docs create --id` naming a deleted document's id is `doc_conflict` with `deleted:true` ("was used before by "…", which has been deleted"): nothing is written and the deleted document is not revived — its history is not yours; pick another `--id`. Without `--id`, the library revives a deleted document only when the id it derives holds that same document (same type and episode, the same one-per-project type, or the same title), with its history continuing; a title-derived id held by a _different_ deleted document counts as taken (`suggestedId`, as above), and deleted documents at alternative ids are skipped — never revived. `error.next` for a deleted document says to tell the user before writing it back.

**Size.** One document's text holds at most 1,000,000 characters (`CANVAS_CONTRACT.documents.contentMaxChars`, counted as JS string length after line endings are normalized to LF — a `\r\n` counts as one character, the way the library stores the text; the CLI, the daemon and the server all count it this way). `docs create` / `docs update` check the text before writing (for `--patch`, the text with the patch applied, right after the read): over the cap is `too_large` (exit 2) with `chars` and `maxChars`, and nothing is written. Split the text into several documents (for example one per episode), each under the cap. A whole novel is not one document: the user uploads it in the panel as a novel, which splits it by chapter.

**Folders.** An uploaded novel is one folder in the reference section, one document per chapter, with ids `<type>:<key>:NNNN` (`novel:k3x9:0001`); the folder's **id** is the shared `<type>:<key>` prefix (`novel:k3x9`, `CANVAS_CONTRACT.documents.folderIdPattern` — `null` for a folder whose documents carry explicit ids). `docs ls --folders` lists the folders of one section (reference unless `--section script`) through the read method `documents_folders {section?}` → `{ok, section, items:[{section, name, id, count, updatedAt}], table, hint}`; it cannot be combined with the document filters (`--type`, `--episode`, `--folder`, `--q`, `--limit`, `--offset` are `invalid_argument`). `docs read --folder NAME-OR-ID --out-dir DIR [--overwrite]` saves a whole folder in one call: it finds the folder by id or by name in either section (a name used in both is `invalid_argument` naming the ids; none is `doc_not_found`), lists its documents page by page in library order, reads each (four at a time), and only when every one was read writes one scratch file per document into `DIR` (created one level at a time inside the workspace) named `<seq>_<title>.<ext>` — `seq` zero-padded to at least three digits, characters a file name cannot hold replaced by `_`, `.md` / `.srt` / `.json` by format. An existing file there is `file_exists` (exit 2) with `files` listing them and nothing written, unless `--overwrite`. When it fails before writing anything (a document cannot be read, a name is taken), the folders it created for `DIR` are removed again — no empty folder is left behind; folders that were already there are never touched. It cannot take a document id or `--out`, and `--out-dir` only goes with `--folder`. Reply: `{ok, folder:{section, name, id, count}, outDir, files:[{path, id, title, version, contentSha, bytes}], note}` — like `--out`, these files are never synced back.

**Replies.** `docs ls` → `{ok, items:[document…], total, limit, offset, nextOffset, table}`. `docs read` → `{ok, document:{…fields, content}}`; with `--out` → `{ok, path, bytes, document:{…fields}, note}` (the file is a scratch copy — `--overwrite` to replace an existing file; missing parent folders inside the workspace are created one level at a time, and a symlinked or file component stops it with `workspace_boundary` / `invalid_path`). `docs create` / `docs update` → `{ok, document, created, unchanged, summary}`. `docs delete` → `{ok, id, version, deleted:true, summary}`: a soft delete (the panel no longer shows it; the text history is kept server-side), which needs `--approved` — sent as `approval.userApprovedDocumentIds:[id]` — after the user agreed; without it the CLI refuses with `approval_required` before sending anything.

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

CLI 0.5 pages resume the same session after a reload, any navigation back to the canvas in the same tab, or a lost poll, for up to ten minutes (`status.resumeExpiresAt` while `reconnecting`). Commands issued during the gap queue undelivered and are sent to the returning page; they fail as `not_sent` only on timeout or final disconnect. `status` returns `pageEpoch` after restoration; a higher epoch means refresh all read hashes/cursors/resource handles and do not expect earlier page-local undo history. The daemon retains the Agent identity, worker credentials and request ID tombstones and never replays commands. A request that was already delivered when the page went away reports `unknown_outcome`; the session continues, but inspect the canvas before any dependent mutation. Closing the tab for longer than the window ends the session.

Inspect `ok:false` before reading `nodes` or piping through a result parser. `reconnecting`/`not_connected` means no command was sent. A generation submit wait with no confirmed task ID is `unknown_outcome`, not proof that the task failed. Read its state and account task list; do not automatically rerun. The local bridge also guards active submits before a node has flipped to `running`. Use one `run` per host tool call with at least 130 seconds allowed, rather than a short-timeout loop over many nodes.

### `error.retryable` and `error.next`

Every canvas error from the page carries a boolean `error.retryable`, and some also carry `error.next`. Exit code 1 covers both a transient state and a refusal that will never clear, so branch on `retryable`, not on the exit code.

`retryable:true` means **reissuing this same command with this same payload can succeed once the other party finishes**. Exactly three codes are retryable, and all three are "something else is mid-flight, wait it out" rather than a failure:

| Code              | What is in the way                                        | What to do                                    |
| ----------------- | --------------------------------------------------------- | --------------------------------------------- |
| `already_running` | Someone else already has this node running                | Wait for its terminal status; do not resubmit |
| `node_running`    | A text write lost to that node's in-flight run            | Wait for the run to settle, then write again  |
| `timeline_busy`   | A human on the page is dragging/trimming a clip right now | Wait a turn and resend                        |

`retryable:false` does **not** mean permanent failure. It means only that repeating _this_ call is pointless — most such errors clear once you re-read and send a corrected payload. Do not report a `retryable:false` error to the user as an unrecoverable system fault, and do not report a refused write as a submitted one.

Three `retryable:false` codes are worth calling out because they are the ones most often retried by mistake:

- `unknown_outcome` — **never re-send.** The operation may already have happened and only its confirmation was lost, so a retry can duplicate work and double-charge a paid generation. Read the node state and the account task list to find out what actually happened.
- `stale` and `timeline_conflict` — the failed precondition (`expect` sha, `expectOutputId`, `baseRevision`, `baseLayout`) _is_ the error. Re-read, then send a **new** payload built on the fresh value. Replaying the old payload fails the same check. Never drop the precondition to force the write.
- `read_only` — this session is a viewer, so no number of retries will ever help even though the message looks like a transient glitch. The only ways out are a human granting this session edit rights on the canvas, or pairing a canvas it can already edit.

`error.next` lists follow-ups as `{command, description}` when a concrete one exists — currently for `read_only`, `stale`, `resource_not_found`, `timeline_conflict`, `invalid_draft`, and `doc_conflict`. Each `command` is a real CLI command line with uppercase placeholders (`NODE-ID`, `SESSION-ID`) to substitute before running; `description` says what to do with the reply. `next` is advisory and never exhaustive, so its absence is not a signal that nothing can be done — for a code with no `next`, the message and the code's own contract above are the guide. Where the real fix is a human action, `command` is a diagnostic that confirms the state (`read_only` points at `list-canvases`, whose reply carries the live `role` and `readOnly`) and the human action is stated in `description`.

`approval_required` deliberately carries no `next`. Authorization is the user's decision to make, so the reply will never hand back a ready-to-run `run --approved` or `run-batch --approved`: obtain the user's authorization, then fill `approval.userApprovedNodeIds` yourself.

### Every error code the page can return

| Code                 | It means                                                                                                                 | Do this                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `not_installed`      | The bridge handshake has not run on this page yet; every mutation is gated on it                                         | Not yours to fix by retrying the command — check `status`, and re-pair if the page never installed                                           |
| `canvas_not_found`   | No canvas with that id is mounted here — the paired canvas was closed or navigated away                                  | `status` / `list-canvases`; the user must reopen the canvas, then create a fresh session if it ended                                         |
| `read_only`          | This session is a viewer, or the editor mounted read-only                                                                | `list-canvases` for live `role`/`readOnly`; a human must grant edit rights. Never retry                                                      |
| `invalid_request`    | The request itself is malformed: missing/ill-typed field, a limit breached, a bad cursor                                 | `error.path` names the exact field; fix the payload                                                                                          |
| `invalid_command`    | The command engine rejected it (carries `path`, and `matches` for `edit_text`)                                           | Read the message — it names the engine code (`DUPLICATE_NODE_ID`, `CONNECT_REJECTED`, `EDGE_NOT_FOUND`…)                                     |
| `invalid_draft`      | A draft key this node kind does not have (carries `field` + `allowed`)                                                   | Rebuild the draft from `allowed`; the reply is the authoritative key list                                                                    |
| `too_large`          | Over a hard cap: 25 MiB upload, 256 MiB media, a glob budget, a catalog page, a document of 1,000,000 characters         | Split the work or narrow the query; retrying identically cannot help                                                                         |
| `upload_unsupported` | The import path cannot produce a durable file here (carries `reason`)                                                    | `upload_failed` may be transient; `no_importer` / `unsupported_mime` / `unsupported_image` / `no_durable_file` need a different file or page |
| `unresolved_mention` | A `@{label}` in a written prompt matched no ready candidate (carries `labels`) — **fails the whole apply**               | Fix the _graph_, not the wording: create/wire/run the source, or copy the disambiguated `syntax` from `read`                                 |
| `node_not_found`     | The referenced node does not exist, or a group id for a batch does not                                                   | `ls` / `read` to find the real id; do not substitute a similar node                                                                          |
| `resource_not_found` | A previously listed resource no longer belongs to this node                                                              | `resources NODE` again and pick a row whose `available` is true                                                                              |
| `not_owned`          | `cancel` on a run this session did not submit — `tasks` shows it with `submitter.isMe:false` (a human, or another Agent) | Do not force it; report who owns it (`tasks --node NODE-ID`). Cancelling someone else's run from here would resurrect the node               |
| `run_failed`         | The run pipeline refused or threw before the task was accepted                                                           | Read the message; it is a real refusal, not a lost confirmation. Fix inputs before rerunning                                                 |
| `already_running`    | Someone else already has this node running (**retryable**)                                                               | Wait for its terminal status; never resubmit — a second submit double-charges                                                                |
| `approval_required`  | A run target is missing from `approval.userApprovedNodeIds`; **nothing was submitted**                                   | Get the user's authorization, then list every expanded node id yourself                                                                      |
| `node_running`       | A text write or an adopt on a node whose run is in flight (**retryable**)                                                | Wait for the terminal status, then resend                                                                                                    |
| `batch_not_found`    | `cancel-batch --batch` named a batch that is finished or was never this session's                                        | Nothing to cancel; check the batch actually came from this session                                                                           |
| `stale`              | `expect` / `expectOutputId` did not match (carries `currentSha` or `currentOutputId`)                                    | Re-read, incorporate the newer edit, send a **new** payload                                                                                  |
| `timeline_conflict`  | `baseRevision` or `baseLayout` (`cut` must send it; `split`/`trim`/`restore` may) no longer matches the track            | `timeline list`, merge onto those clips (recompute a `cut` range, keep a human's new trims), resend with fresh values                        |
| `timeline_busy`      | A human is dragging/trimming a clip right now (**retryable**)                                                            | Wait a turn and resend                                                                                                                       |
| `doc_conflict`       | `--expect-version` is not the library's version, or `create` hit an existing id                                          | `docs read`, redo the change on that version, resend; for `create`, update the existing one                                                  |
| `doc_not_found`      | No document with that id in this project's library, or it was deleted                                                    | `docs ls` to find the real id                                                                                                                |
| `unknown_outcome`    | A submit was delivered but its result was never confirmed                                                                | **Never re-send.** Inspect node state and the account task list before anything dependent                                                    |

The daemon can also refuse a request before it ever reaches the page, with codes that are not in the list above: `worker_forbidden` (a worker called a main-only method, embedded `upload_asset` / `export_output` / `delete_output` / `clear_output` / `recover_deleted` in a batch, or sent `apply` with `approval`), `method_not_allowed`, `invalid_role`, `invalid_argument` (a CLI flag this command does not read), `not_connected` / `reconnecting` (no command was sent at all), `result_expired`, and `session_limit`.

## 不经宿主、直接跑二进制时

只在没有 `canvas_cli` 工具、自己在 shell 里跑 `scenemint-canvas` 时才看这一节。

- 每条命令末尾加 `--session ID`（`connect`、`help`、`skill-path` 三条不加，加了会被拒）。
- ID 来自 `scenemint-canvas connect --origin https://HOST --name "任务名" --workspace /绝对路径` 回复里的 `sessionId`；同一任务复用它，不要用别的任务的会话、不要读凭据文件。
- worker 用 `delegate --session MAIN-ID --name NAME --workspace 已存在目录` 回复的 worker `sessionId`；`revoke --delegate WORKER-ID --session MAIN-ID` 收回。
- 例：`scenemint-canvas ls / --long --session ID`、`scenemint-canvas apply --file edit.json --session ID`。
- 其它一切（顺序、`expect`、`@{}`、授权）与上文完全相同。
