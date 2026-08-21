---
name: create-plugin-from-record
description: 从一个或多个 Dynamic Record 和 Static Record 产物创建 Ligentia Flow Package / plugin。用于把 Captura 的 dynamic raw-first ZIP、Static Record ZIP 或已解包录制证据转成新 plugin，包括 SOP、sample table 数据设计、plugin design、Step/Action 设计、Automation 设计和 TypeScript 代码草案。
---

# Create Plugin From Record

## 概览

使用本 Skill 从录制证据创建 Ligentia Flow Package。工作流必须分阶段推进：先读取 Dynamic 和 Static record，再产出并确认 SOP，然后推导数据结构，设计 Step / Action 和 Automation，最后生成 TypeScript plugin 草案。

不要跳过确认关口。SOP 是第一层对齐材料；后续设计和代码必须跟随已确认的 SOP。

## 必读项目上下文

创建或更新 plugin 前，先读取相关项目规则：

1. 修改架构、workflow record、step design、目录结构或 plugin 边界时，读取 `.agent/context/BackgroundAndGoals.md`。
2. 读取 `.agent/principle/SidebarCoreDocument.md`。
3. 读取 `.agent/principle/plugin-development-guide.md`。
4. 读取 `docs/architecture/DirectoryStructure.md`。
5. 读取 `workflow-recorder/skills/dynamic-raw-reader/SKILL.md`，用于 Dynamic raw-first 输入。

需要详细输出模板时，读取 `references/plugin-from-record-template.md`。

## 输入处理

接受任意组合：

- Dynamic Record raw-first ZIP，包含 `recording.json`、`raw/events.ndjson` 和 `artifacts/*.png`。
- Static Record ZIP 或已解包 Static Record 目录，包含 `StaticSummary.md`、`AnnotationIndex.json`、`FieldReferenceIndex.json`、`ReferenceMap.json`、`StaticRecorderState.json`、`Annotation*/annotation.json`、截图和 HTML 证据。
- 用户补充的业务修正、规则说明、CSV / Excel 样例或人工字段描述。

写代码前，必须让用户选择或确认新的 plugin package 与 flow 身份：

- `buyer`
- `seller`
- `platform`
- `pluginId`
- `flowId`
- `supportedHosts`
- 起始页面或状态
- 结束页面或状态
- 是否包含真实 submit 或其它不可逆动作

如果记录材料中已经暗示某个值，可以给出建议，但必须标记为待人类确认。

## Dynamic Record 读取

使用现有 `dynamic-raw-reader`；不要创建第二套 Dynamic 解析器。

常用命令：

```powershell
python workflow-recorder/skills/dynamic-raw-reader/scripts/read_dynamic_raw.py <zip> --mode summary
python workflow-recorder/skills/dynamic-raw-reader/scripts/read_dynamic_raw.py <zip> --mode timeline
python workflow-recorder/skills/dynamic-raw-reader/scripts/read_dynamic_raw.py <zip> --mode sop --out <output-dir>
python workflow-recorder/skills/dynamic-raw-reader/scripts/read_dynamic_raw.py <zip> --mode debug
```

Dynamic 证据用于判断：

- 用户操作和 Action 顺序。
- 页面读取时机和可读数据机会。
- 页面跳转、DOM 变化、loading 信号和状态流转。
- iframe / unit 上下文。
- 按时间最近原则绑定的截图。

不要声称截图天然属于某个 action id；只能把截图作为最近时间证据。没有后续 raw event 或截图证明时，不要推断 submit 成功、booking 已创建或业务流程已完成。

## Static Record 读取

Static 证据用于判断：

- 人工批注文本和字段引用。
- 操作对象、对象 label 和 target profile。
- selector 与 locator 候选。
- DOM context、截图和页面级证据。
- 字段与数据绑定关系。

至少读取：

- `StaticSummary.md`
- `AnnotationIndex.json`
- `FieldReferenceIndex.json`
- `ReferenceMap.json`
- `Annotation*/annotation.json`
- 必要时读取被引用的截图和 HTML

未验证的 selector、readiness、数据绑定、submit 结果和业务结果必须标记为未验证。

## 输出工作流

### 1. SOP 对齐

第一份交付物是：

```text
plugins/<plugin-id>/docs/sop.md
plugins/<plugin-id>/docs/images/
```

SOP 必须包含：

- 每个有意义的用户操作或人工可观察阶段。
- 操作动作和操作对象。
- 引用的输入数据或页面读取数据。
- 页面状态变化、读取时机和 transition 证据。
- Dynamic 证据和 Static 证据引用。
- 使用 `docs/images/` 下路径的截图链接。
- 未解决或未验证项。

输出 SOP 后必须停下，请人类确认、对比或修正。收到反馈后先修订 SOP，再进入数据设计。

### 2. 数据结构设计

SOP 确认后，创建：

```text
plugins/<plugin-id>/docs/sample-tables.md
```

内容包括：

- import tables。
- 每个表字段的 field key、原始列名、label、类型、示例、必填、normalize 和来源说明。
- session constants / `global.*`。
- WorkUnit schema。
- `workflow.*` variables。
- 页面读取后应成为 workflow variable 的 outputs。

输出后必须停下，请人类确认，再进入 Step / Action 设计。

### 3. Step 与 Action 设计

数据结构确认后，创建或更新：

```text
plugins/<plugin-id>/docs/plugin-design.md
```

每个 Action 必须定义：

- action id 和 title。
- 目的。
- 需要的 WorkUnit 字段或 variables。
- readiness condition。
- execute 意图。
- verify 规则。
- repeatability。
- 不可逆风险。
- 证据引用和未验证项。

把 Actions 按业务阶段和页面状态分组为 Steps，不要按文件组织随意分组。

输出后必须停下，请人类确认，再进入 Automation 设计。

### 4. Automation 设计

把 Automation 设计写入 `docs/plugin-design.md`。

每个 Automation 必须定义：

- id、title、level：`L1` / `L2` / `L3`。
- activation step。
- launch selection。
- QuerySelector 和 WorkUnit 注入。
- plan kind 和精确 Step 顺序。
- pause points、human interaction actions 和不可逆边界。

输出后必须停下，请人类确认，再进入代码草案。

### 5. TypeScript Plugin 草案

设计确认后，按当前 Ligentia TypeScript Flow Package 结构生成 plugin 代码：

```text
plugins/<plugin-id>/
  README.md
  manifest.ts
  index.ts
  flow.ts
  data-mapping.ts
  action-variable-usage.generated.ts
  selectors.ts
  actions/
    index.ts
  steps/
    index.ts
    activation.ts
  docs/
    sample-tables.md
    sop.md
    images/
    plugin-design.md
  sample/
    README.md
```

不要把 Tampermonkey userscript 作为目标产物生成。

代码是实现细节的第一事实源。`docs/plugin-design.md` 是上层动作设计、业务边界和协作上下文的权威记忆，但应避免重复代码级实现细节。

## 安全规则

- 未验证的 selector、readiness、precondition、字段映射、WorkUnit 构造、outputs、verify 逻辑、上传、提交和不可逆结果必须明确标记。
- 不可逆动作默认设为 `nonRepeatable`，并要求人工确认或阻断。
- 不得绕过业务 UI 去修改前端 store、隐藏字段、API payload 或后端数据。
- 未经当前对话明确审批，不得登录、操作真实 booking 系统、点击最终 submit 或执行不可逆业务动作。
- 业务数据、截图、DOM、Cookie、凭证和门户证据都视为敏感项目材料。

## 完成标准

当新 plugin 具备以下内容时，本 Skill 执行完成：

1. 已确认的 `docs/sop.md`，且包含图片引用。
2. 已确认的 `docs/sample-tables.md`。
3. 已确认的 `docs/plugin-design.md`。
4. 与确认设计一致的 TypeScript plugin 草案。
5. 清楚标记的风险和未验证证据。
