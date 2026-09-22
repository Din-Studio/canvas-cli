# 场景 → 命令（先看这里）

本节把用户的一句话翻成 `canvas_cli` 的 argv。argv 用 JSON 数组写，原样复制即可。
下文所有大写字母的 `NODE-ID` / `SHA` / `MODEL-ID` 都是占位符，必须换成**上一条命令回复里**的真实值。

## 铁律（每条命令之前都过一遍）

- argv 里**永远不要写 `--session`**：宿主自动注入。自己写 → 命令被拒（`SESSION_NOT_ALLOWED`），什么都没执行。
- **先 `ls` / `grep` 再 `read`，永远不要猜节点 id**。猜的 id 只会得到 `missing` 或 `node_not_found`。
- 写任何文字前**先 `read` 拿 `promptSha` / `contentSha` / `titleSha`**，写的时候放进 `expect`。不带 → 会覆盖用户刚改的内容。
- `@{标签}` 只能逐字复制 `read` 回复里 `mentionCandidates[].syntax` 的值。自己拼 → `unresolved_mention`，整批失败。
- **连线一批、写提示词另一批**，中间要等参考节点有输出。
- **`run` / `run-batch` 之前必须把节点清单念给用户、得到用户同意**。每个节点 = 一次付费生成。
- 文件路径只能写会话 workspace 里的相对路径（`--file edit.json`、`--out out/a.png`）。写别处 → `workspace_boundary` / `file_not_found`。
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

**做完要核对回包。** `focus_node` 是唯一一条「效果不在文档里」的命令，所以 `ok:true` 不代表用户的画面动了。读 `focused[0].framed`：`true` 才可以说「已经定位过去了」；`false` 时 `reason:"unmeasured"`（页面还没量到这个节点，多半在视野外）或 `"no_camera"`（这个宿主没有画布相机，永远定位不了）——两种都要改口，把节点名和 `path` 报给用户让他自己找，别谎称已经定位。

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

回读 `revision` 与 `clips[]`（每条带 clip id、来源节点、起止）。`op` 六个：`list` / `set` / `append` / `remove` / `reorder` / `clear`；只有 `list` 是只读，其余都是写命令、会排队。写的时候把 `baseRevision` 填成刚读到的那个数：

<!-- prettier-ignore -->
```json
["timeline", "--json", "{\"op\":\"append\",\"clips\":[{\"nodeId\":\"NODE-ID\"}],\"baseRevision\":REVISION}"]
```

`timeline_conflict` = 有人在你之前改了，重新 `list` 再决定；`timeline_busy` = 有人正在页面上拖，等一轮再来。想能还原就先把 `list` 回来的 `clips[]` 记下来（`previousClips`）。

- ✅ 正确：`["timeline","list"]` → 拿 `revision` → 带着它写 → 写完再 `list` 确认。
- ❌ 错误：不带 `baseRevision` 直接写 → 覆盖用户刚剪的那一刀。
- ❌ 错误：`changes` 里看到 `fields:["timeline"]` 且没有 `nodeId`（人重剪了时间线）还拿着旧的 `baseRevision` 写 → `timeline_conflict`。先 `list`。
- ❌ 错误：worker 身份发 `timeline` → 主 Agent 才能发。
- ❌ 错误：想「删掉某一段视频节点」就去改时间线 → 那是节点的事（场景 11），时间线只管成片怎么拼。

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
| `apply.commands[].type`                                 | one of the twenty names below                                                | `invalid_request` "Unknown or nested apply command"                                  |
| `apply.commands[].<key>`                                | only the fields that command declares                                        | `invalid_request` "Unexpected `<type>` field: `<key>`"                               |
| any command payload                                     | plain JSON, ≤ 40 levels deep, no `commands` / `__proto__` key inside         | `invalid_request` "Nested or unsafe command field"                                   |
| `run_nodes.nodeIds`                                     | **1..1000** non-empty strings, each ≤ 1024 chars                             | `invalid_request` "nodeIds must be 1..1000 non-empty strings"                        |
| `run_nodes` / `run_node` `approval.userApprovedNodeIds` | **1..1000** non-empty strings, each ≤ 1024 chars; no other key in `approval` | `approval_required`                                                                  |
| `run_nodes.concurrency`                                 | integer 1..200 (default 24)                                                  | `invalid_request`                                                                    |
| `read.paths`                                            | 1..20 paths                                                                  | `invalid_request` "paths 一次最多 20 个"                                             |
| `ls.limit` / `grep.limit`                               | 1..500 (defaults 200 / 100)                                                  | clamped, not an error                                                                |
| `resources.limit` / `resources.offset`                  | limit 1..200 (default 100); offset a nonnegative integer (default 0)         | `invalid_request` "resources requires limit 1..200 and a nonnegative integer offset" |
| `upload_asset.bytesBase64`                              | 25 MiB decoded (26,214,400 bytes)                                            | `too_large`                                                                          |
| HTTP body                                               | 36 MiB                                                                       | transport-level rejection                                                            |

Clamping is the exception, not the rule: **only `ls.limit` and `grep.limit` are clamped into range.** Every other row above is a refusal, and `resources` in particular refuses rather than clamps — neither the CLI nor the daemon touches the number, so `--limit 500` on `resources` reaches the page and comes back `invalid_request`, not a page of 200.

## 命令卡住 / 页面刚升级：`page_away`

页面不在（用户刷新、升级、切走、浏览器重启）时守护进程进入 `reconnecting`，最多等它十分钟回来。命令不会在这段时间里静默挂着：

| 命令类型                                                                                                                                                                  | 页面不在时                                                                                      | 你该做什么                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 只读（`ls` `read` `grep` `snapshot` `health` `tasks` `resources` `models` `inspect-media` `download`）                                                                    | ≤ 5 秒回 `page_away`，`queued:false`、`outcome:"not_sent"`，**没排队**                          | 等页面回来再发（先 `status` 看 `pageAway`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 写（完整清单：`apply` `tidy` `resize-group` `upload` `run` `run-batch` `cancel` `cancel-batch` `undo` `redo` `turn-end` `timeline`；timeline 只有 op 不是 list 时才排队） | 排队；`--wait-ms`（默认 30000）后回 `page_away`，`queued:true`、`outcome:"queued"`、`requestId` | **不要重发**。页面回来它会自动执行一次；用同一个 `--request-id` 再发一遍 = 取结果。`--wait` 一直等到恢复窗口结束（这十二条都接 `--wait` / `--wait-ms`）。**宿主可能禁用 `--wait`**：这十二条命令本身收它，但把 CLI 包成工具的宿主有权拒（它自己的工具调用有超时，一个能阻塞十分钟的参数会把整轮对话挂死）。被宿主拒了就按宿主的话走，不要换着写法重试——发 `--wait-ms`（或什么都不加，默认 30000）拿到 `requestId`，然后轮 `["status"]` 看 `pageAway` / `queuedCommands`，页面回来后用**同一个** `--request-id` 再发一遍取结果 |

```json
["status"]
```

回读 `pageAway`（true = 页面不在）、`queuedCommands`（排队中的写命令数）、`pageLastSeenAt`（最后一次听到页面）、`resumeExpiresAt`（过了这个时间会话就结束）。

- ✅ 正确：`apply` 回 `page_away` + `queued:true` → 「画布页面暂时离线，这条修改已排队，请把画布切到前台，回来后会自动应用」→ 页面回来后 `["apply","--json","…同样的内容…","--request-id","同一个 id"]` 取结果。
- ❌ 错误：回 `page_away` 就换个 id 重发 `run` → 页面回来后同一个节点跑两次、付两次费。
- ❌ 错误：`resumeExpiresAt` 已过还在等 → 会话已结束（`not_connected`），让用户重新连接。

## Main and delegated worker sessions

One connection = one canvas. To work on another canvas, `connect` and pair again, then check `status.canvasId` before reading or writing. Disconnecting one connection leaves the others alone.

A host that keeps a session across its own restarts must not trust its file: `connect --session ID` (with the usual `--origin/--name/--workspace`) reuses the session only when the daemon process is alive and the page is `connected` or has been away less than 60 s (`reused:true`, no new code), and otherwise retires it and mints a fresh one in the same call (`reused:false`, `replaced:{sessionId,reason}`, a new `connectionCode` to paste). `status` on a dead daemon answers `connection_failed` with `daemonPid` and `daemonAlive:false`.

A worker session is created by the host (`delegate`, see the last section for the raw form) and shares the paired canvas, main identity and undo history; its file boundary is its own workspace. Workers may read / search / inspect / download node media and make ordinary `apply` edits. They cannot `upload_asset` / `export_output`, run / cancel, undo / redo, inspect operations or timelines, delegate, or revoke. A delivered operation may still finish after revocation (`unknown_outcome`); revocation is not rollback.

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
| `skipped[]`   | `{command, nodeId, reason}` for every `group_nodes` id left out (`already_grouped` / `is_group` / `not_found`); absent when nothing was skipped                                                                                                                                       |
| `tidied[]`    | `{command, moved, resized, strays[]}` for **every** `tidy` in the batch — the `scope` pass and the whole-canvas re-layout alike, and on **both** call paths (a plain `apply` batch containing a `tidy`, and the CLI's `tidy`). `strays[]` is only ever non-empty for the `scope` pass |
| `tidySummary` | the same entries rendered as one text line each, strays named — produced by the page, so it accompanies `tidied[]` on both paths. Quote it; it is the only form that survives a host compressing the reply into prose                                                                 |
| `rev`         | the document revision after the apply                                                                                                                                                                                                                                                 |
| `undoDepth`   | this Agent's undo depth afterwards                                                                                                                                                                                                                                                    |

`created[]` is the general contract for **"the id you could not have known in advance"**, and `kind` names what the id _is_, not always a node kind:

| Command                   | `created[]` entries                     | `kind`                       |
| ------------------------- | --------------------------------------- | ---------------------------- |
| `add_node`                | one, whether you supplied `id` or not   | the kind you asked for       |
| `add_node` on `doc-index` | one, id `doc-index`                     | the kind you passed (echoed) |
| `upload_asset`            | one, the new media node                 | `media-upload`               |
| `group_nodes`             | one, the new group                      | `group`                      |
| `duplicate_node`          | one per copy, in creation order         | the source's kind            |
| `connect`                 | one, **the new edge's id**              | `edge`                       |
| `adopt_output`            | one, **the new candidate's `outputId`** | `output`                     |
| everything else           | none                                    | —                            |

**`connect`'s entry is the only place an `edgeId` is ever handed to you at creation time, and `disconnect` needs an `edgeId`.** `read` returns edges as `edges.in:[{from,handle}]` / `edges.out:[{to,handle}]` — no ids at all. The only other source is `snapshot`, whose top-level `edges:[{id,source,target,targetHandle}]` is always the whole graph's edge list, never filtered or truncated even when the node list is. So: capture `created[].id` when you connect, or take a `snapshot` and match on `source`/`target`/`targetHandle`. Never construct an edge id.

Note what `created[]` does _not_ report: `duplicate_node` also clones the source's **incoming edges** with fresh ids, and those ids are not returned. Snapshot the duplicate if you need to disconnect one of them.

`apply.written[]` returns the text hashes actually written. A stale hash or failed string match requires reading the current node and revising the change. Do not remove the precondition simply to force a write. Use draft fields supported by the node/model; `invalid_draft` provides allowed fields.

`expect` is compared against the text this page currently holds, and it is checked and written inside one synchronous update, so nothing on this page can slip between them. It is not a distributed lock: a collaborator's edit that has not reached this page yet is invisible to the check, and a node is written as a whole value, so the later of two concurrent writes wins the whole node. Treat `expect` as "the text I read is still the text here", not as a guarantee that no one else is editing.

`title` is one authoritative field on every node kind, groups included. `group_nodes{title}` and `add_node{title}` write it, `update_node{title}` and `edit_text{field:"title"}` change it, and `ls`, `read` and `snapshot` return exactly that stored string — never a per-kind placeholder. A stored title is **trimmed and clipped to 60 characters**, so a longer one reads back shortened and its `titleSha` is the digest of the shortened form. A group nobody named reads back as `""`: the caption the canvas shows for an unnamed group ("Group name", localized) is UI placeholder text that is not stored, so do not treat it as text to match. An `add_node` that omits `title` is different — the engine stores a real numbered default ("图片生成 1", "文本生成 2", by kind and mode), and that string is what you will read back. `titleSha` always hashes the string the same row displays, so a title copied out of `read` matches `edit_text.oldString` and `expect.titleSha`. A `group_nodes` reply lists the written title in `apply.written[]`.

## The twenty apply commands

Exactly twenty `type` values exist. Anything else is `invalid_request` before the page sees it.

`add_node` · `update_node` · `edit_text` · `move_node` · `connect` · `disconnect` · `delete_node` · `group_nodes` · `ungroup` · `resize_group` · `set_viewport` · `arrange` · `align` · `tidy` · `duplicate_node` · `select_output` · `adopt_output` · `focus_node` · `upload_asset` · `export_output`

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

**Deleting a group cascades**: the frame _and every member_, plus every edge touching any of them, go together in one command. There is no confirmation and `created[]` says nothing about what left. To dissolve a frame while keeping its contents, use `ungroup`.

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

**Wrong:** `{"type":"duplicate_node","nodeId":"GROUP-ID"}` → `invalid_command` "duplicate_node cannot copy a group; duplicate its members". **A group cannot be duplicated at all** — duplicate the members and `group_nodes` the copies. `count: 50` → `invalid_request` "expected 1..20".

### `select_output`

**Required** `nodeId`, `outputId`. **Optional** `expectOutputId` (the current candidate's id, or `null` for none).

`select_output` adopts an existing candidate and propagates its output to connected nodes through the human picker path. Candidate `resources` rows expose `outputId`; use that field, not a resource ID or URL. Carry the current adopted candidate in `expectOutputId` to detect a human's intervening selection. A mismatch fails atomically with `stale` and `currentOutputId`; a removed candidate returns `resource_not_found`. Which candidate is "current" has two writable representations — the adopted pointer and the output the node actually displays — and they can disagree, because picking an image out of a node's history rewrites the displayed one without moving the pointer. When they disagree there is no single current candidate, so a supplied `expectOutputId` fails `stale` naming both rather than letting the precondition pass against a pointer the user is not looking at. Omitting `expectOutputId` still adopts, which is how you repair such a node: **whenever `select_output` (or any verb that adopts) returns ok, the pointer and the displayed output agree again** — that postcondition, not "which one is the truth", is the thing to re-read and rely on. It is an ordinary Agent-owned undo step, but whole-node Yjs writes from later collaborators can supersede individual nodes within that step. Re-read the resulting choice and references after undo.

<!-- prettier-ignore -->
```json
{"type": "select_output", "nodeId": "NODE-ID", "outputId": "OUTPUT-ID-FROM-RESOURCES", "expectOutputId": "CURRENT-OUTPUT-ID-FROM-RESOURCES"}
```

**Wrong:** passing a `resourceId` (the `r1:candidate:…` form) where `outputId` belongs → `resource_not_found` at `commands[0].outputId`. Downloading a candidate does not adopt it; only this command does.

### `adopt_output`

**Required** `nodeId`, `url` (https, on one of the trusted media hosts: `cdn.echojoy.cn`, `file.echojoy.cn`, `*.myqcloud.com`, `*.tos-cn-beijing.volces.com`).

`adopt_output` registers an image that came from outside the node — a file the user dropped onto the canvas, another node's output — as one of that node's own candidates and makes it the primary, running the same code a finished generation runs. Like a rerun, it appends: the node's earlier image candidates stay in the group (the adopted row has `runId: null` and no `promptSha` in `resources`). Use it when the user names an existing picture as a node's result ("this one is the reference sheet for that character"), not to invent an output the node never had. The target must be a `gen` node in image mode, must hold no video candidate at all (adopting an image would discard the node's video candidates, so that is refused with `invalid_command` — judged on the candidate list, not on what the node currently displays), and must not be running. `url` must be https on a trusted media host, so copy it from `snapshot` or `ls --long` (those URLs already qualify), and `upload` a local file first rather than passing a local path. Only a node's current primary output has a URL in those replies; `resources` returns identities and metadata, never URLs, so to adopt another node's alternative take, first `select_output` it into that node's primary and read the URL back. The reply's `created[]` carries `{kind:"output", id}` with the new candidate's `outputId` — hold it for a later `select_output` or `expectOutputId`. The candidate's recorded prompt is deliberately left empty: the image was not generated from this node's prompt, and the node's own prompt text is not copied onto it. Adopting the same URL twice adds no second candidate, and re-adopting what is already the node's current output changes nothing at all (no undo step). To choose between takes the node produced itself, use `select_output`.

```json
{ "type": "adopt_output", "nodeId": "NODE-ID", "url": "https://HOST/PATH-FROM-SNAPSHOT.png" }
```

**Wrong:** a `blob:` / `data:` / `file:` / plain `http:` URL, or an https URL on any other host → `invalid_request` "expected an https URL on cdn.echojoy.cn, file.echojoy.cn, *.myqcloud.com, *.tos-cn-beijing.volces.com"; nothing could download such a candidate later. Adopting onto a node that holds a video candidate → `invalid_command`; delete the video takes on the canvas first or pick another node. Adopting onto a running node → `node_running` (retryable once it settles).

### `focus_node`

**Required** `nodeId`. **Optional** `fill` — a number in **(0, 1]**, default **0.5** — the fraction of the visible pane the node should cover.

This is the command that actually **moves the human's camera on the open page**, with a 320 ms animation, without asking. It is non-mutating and not undoable, and it does not sync to other collaborators. Use it sparingly and only when the user asked to be shown something.

It works on a **group** exactly as on a node — pass the group id and the whole frame is brought into view. Do not expand, ungroup or enumerate members first.

**Did it actually happen? Read `focused[]`, not `ok`.** This is the one command whose effect is not in the document: the batch it rides along with commits either way, so `ok:true` proves only that the write landed. The reply carries `focused:[{command,nodeId,framed,reason?}]` — one entry per `focus_node` in the batch, **always present when the batch held one**, including when nothing moved.

| `focused[i]`                           | What to tell the user                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `framed: true`                         | 「已经帮你定位到 X 了」 — the camera animated there.                                                                                                                                                                                       |
| `framed: false`, `reason:"unmeasured"` | The page has no geometry for that node yet (off-screen in a big canvas, or you created it in this same batch). Say you could not move their view and name the node / its path so they can find it; a retry after it is on screen can work. |
| `framed: false`, `reason:"no_camera"`  | This host has no canvas camera at all — **no** `focus_node` will ever work here. Stop trying; report the node by name and path instead.                                                                                                    |

```json
{ "type": "focus_node", "nodeId": "NODE-ID", "fill": 0.6 }
```

**Wrong:** `"fill": 0` or `"fill": 1.5` → `invalid_request` "expected number in (0, 1]" at `commands[0].fill`. Telling the user "你现在看到它了" on the strength of `ok:true` alone — that is the field above's whole reason for existing.

### `upload_asset`

**Required** `path`, `fileName`, `mimeType`, `bytesBase64`. **Optional** `position`, `title`, `id`.

Do not build this command by hand: `scenemint-canvas upload FILE` constructs it from a workspace file, which is the only way the bytes get read. Uploads run **before** the transaction, so a failed upload rejects the whole batch with nothing written. Payload cap is 25 MiB decoded. The new node lands `succeeded` with the imported media, and `position` defaults to free space to the right of everything else.

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
- `undo --steps N`, `undo --turns N`, and corresponding `redo` operate on this Agent's own history. `document_reloaded` means the prior undo stack was discarded. Do not claim an undo happened when `undone` is zero.
- `timeline list` returns clips and `revision`. Timeline JSON accepts `op`: list/set/append/remove/reorder/clear, `clips:[{nodeId,inMs?,outMs?}]`, `index`, `clipIds`, `order`, `sort`: given/shot/position, and `baseRevision`.
- `set`, `remove`, `reorder`, and `clear` require the revision read from the current track. Preserve `previousClips` when planning to restore it. `timeline_conflict` or `timeline_busy` requires rereading; never overwrite a human's newer arrangement by dropping the revision. The revision checks known state; it is not a cross-peer lock.
- Timeline clips refer to canvas nodes, never arbitrary media URLs. Timelines are not reverted by `undo`/`redo`; node undo can leave orphaned clip references for you to report.

## Media and connections

`upload FILE` reads at most 25 MiB from the session workspace. `download NODE --out FILE` handles text or bounded binary chunks, at most 256 MiB, and publishes only a complete file. Existing files remain intact unless `--overwrite` is explicit. Parent traversal, symlink paths, and hardlinked files are refused. JSON and text input files follow the same workspace rules.

`resources NODE` lists `resourceId`, `source` (current/candidate/image-history/video-history/reference/input; inputs also expose `slot`), `part` (media/poster/last-frame), `kind`, `current`, `available`, name and MIME. Candidate rows additionally carry `outputId`, `runId` (the batch id of a ×N run, else the gateway task id; `null` for an adopted outside image), `runIndex` (1-based "第 N 次", in landing order — every take of one ×N batch shares it), `gatewayTaskId`, `createdAt`, `promptSha` (the digest of the prompt it was generated with, same digest as `read`'s `promptSha`) and `promptChanged` (that digest is known and differs from the node's current prompt). Use them to tell takes apart when a node has been rerun several times. No URLs or media bodies are returned. Follow `nextOffset` even if a page is empty; offsets are opaque slots, not resource counts. IDs are scoped to the node and stable across reordering; changing a node during paging requires starting again. An unavailable local/sentinel URL cannot be downloaded through this browser connection.

`download NODE --resource RESOURCE-ID --out FILE` selects an exact listed resource; omit `--resource` for the current output. The same selector works with `inspect-media` and `frames`. `resource_not_found` means the ID is invalid for that node or the resource was removed; relist and choose explicitly. `inspect-media NODE --resource RESOURCE-ID --out FILE --probe` additionally runs installed `ffprobe`. Without `--out`, it reads metadata without downloading a body; `size:null` means unknown until download. Binary byte caches live at most ten minutes, bounded to 256 MiB and 256 entries, and each access first resolves the current node. `frames NODE --resource RESOURCE-ID --out-dir NEW-DIR --every 5 --count 12` downloads that video, runs installed `ffmpeg`, and returns sampled JPEG paths; maximum count is 100. The target directory must be new and its parent must exist. No shell command is constructed from media metadata. `download`/`inspect-media --out` also report `detectedMimeType` from the file's leading bytes; for audio, `videoReferenceCompatible` says whether a video model will accept it as reference audio (the provider sniffs bytes and allows only mp3 / wav — `Unsupported audio format: flac. Allowed formats: mp3, wav.` — so a `.mp3` name or `mimeType` proves nothing). Historical 人声分离 / 音频分离 / 环境音分离 results are FLAC and are refused by `run` before submit with the node named; until upstream emits mp3, the user must supply an mp3/wav version of that audio (re-encode outside the canvas and upload; renaming does not work).

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
- `stale` and `timeline_conflict` — the failed precondition (`expect` sha, `expectOutputId`, `baseRevision`) _is_ the error. Re-read, then send a **new** payload built on the fresh value. Replaying the old payload fails the same check. Never drop the precondition to force the write.
- `read_only` — this session is a viewer, so no number of retries will ever help even though the message looks like a transient glitch. The only ways out are a human granting this session edit rights on the canvas, or pairing a canvas it can already edit.

`error.next` lists follow-ups as `{command, description}` when a concrete one exists — currently for `read_only`, `stale`, `resource_not_found`, `timeline_conflict`, and `invalid_draft`. Each `command` is a real CLI command line with uppercase placeholders (`NODE-ID`, `SESSION-ID`) to substitute before running; `description` says what to do with the reply. `next` is advisory and never exhaustive, so its absence is not a signal that nothing can be done — for a code with no `next`, the message and the code's own contract above are the guide. Where the real fix is a human action, `command` is a diagnostic that confirms the state (`read_only` points at `list-canvases`, whose reply carries the live `role` and `readOnly`) and the human action is stated in `description`.

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
| `too_large`          | Over a hard cap: 25 MiB upload, 256 MiB media, a glob budget, a catalog page                                             | Split the work or narrow the query; retrying identically cannot help                                                                         |
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
| `timeline_conflict`  | `baseRevision` no longer matches the track                                                                               | `timeline list`, merge onto those clips, resend with the fresh revision                                                                      |
| `timeline_busy`      | A human is dragging/trimming a clip right now (**retryable**)                                                            | Wait a turn and resend                                                                                                                       |
| `unknown_outcome`    | A submit was delivered but its result was never confirmed                                                                | **Never re-send.** Inspect node state and the account task list before anything dependent                                                    |

The daemon can also refuse a request before it ever reaches the page, with codes that are not in the list above: `worker_forbidden` (a worker called a main-only method, or embedded `upload_asset` / `export_output` in a batch), `method_not_allowed`, `invalid_role`, `invalid_argument` (a CLI flag this command does not read), `not_connected` / `reconnecting` (no command was sent at all), `result_expired`, and `session_limit`.

## 不经宿主、直接跑二进制时

只在没有 `canvas_cli` 工具、自己在 shell 里跑 `scenemint-canvas` 时才看这一节。

- 每条命令末尾加 `--session ID`（`connect`、`help`、`skill-path` 三条不加，加了会被拒）。
- ID 来自 `scenemint-canvas connect --origin https://HOST --name "任务名" --workspace /绝对路径` 回复里的 `sessionId`；同一任务复用它，不要用别的任务的会话、不要读凭据文件。
- worker 用 `delegate --session MAIN-ID --name NAME --workspace 已存在目录` 回复的 worker `sessionId`；`revoke --delegate WORKER-ID --session MAIN-ID` 收回。
- 例：`scenemint-canvas ls / --long --session ID`、`scenemint-canvas apply --file edit.json --session ID`。
- 其它一切（顺序、`expect`、`@{}`、授权）与上文完全相同。
