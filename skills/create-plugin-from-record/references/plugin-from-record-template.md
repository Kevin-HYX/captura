# Plugin From Record 模板

使用 `$create-plugin-from-record` 把 Dynamic 和 Static Recorder 证据转换为 Ligentia Flow Package 时，按本模板组织输出。

## 1. SOP 模板

目标路径：

```text
plugins/<plugin-id>/docs/sop.md
plugins/<plugin-id>/docs/images/
```

推荐结构：

```md
# <Plugin Name> SOP

来源：
- Dynamic Record: `<path>`
- Static Record: `<path>`

状态：草案 / 已由人类确认 / 有未验证项

## 流程边界

- 起点：
- 终点：
- 不包含：
- 不可逆动作：

## 操作步骤

### Step 1: <动作标题>

- 动作：点击 / 输入 / 选择 / 读取 / 等待 / 人工确认
- 操作对象：对象类型、可见文本、label、selector 候选
- 引用数据：字段名或变量路径
- 页面读取：读取对象、读取时机、读取结果用途
- 页面变化：Dynamic transition / dom-change / loading / URL / title / iframe 线索
- Static 证据：Annotation 文件、target/context HTML、字段引用
- Dynamic 证据：eventId、unitRef、nearest screenshot delta
- 截图：`![说明](images/<file>.png)`
- 未验证项：
```

SOP 规则：

- 每节只描述一个人类可理解的操作或阶段。
- 用 Dynamic 证据判断顺序、时机、状态流转和页面变化。
- 用 Static 证据判断对象语义、selector 和字段绑定。
- 截图只使用 `images/` 下的相对路径。
- 没有证据证明时，不要声明 submit 成功或业务结果完成。

## 2. Sample Tables 模板

目标路径：

```text
plugins/<plugin-id>/docs/sample-tables.md
```

推荐结构：

```md
# <Plugin Name> Sample Tables and Data Design

## Import Tables

### Table: rows

| fieldKey | originalColumn | label | type | required | example | normalize | sourceNote |
|---|---|---|---|---|---|---|---|
| custPoNo | Cust PO No | Cust PO No | string | true | 10001731297 | trim | Static/Dynamic confirmed |

## Session Constants

| path | label | type | example | scope | source | note |
|---|---|---|---|---|---|---|
| global.vendor.email | Vendor Email | string | ops@example.com | global | manual | stable per vendor |

## Workflow Variables

| path | label | type | producedBy | consumedBy | note |
|---|---|---|---|---|---|
| workflow.product.longDescriptionPrefix | Product Long Description Prefix | string | page read | product.fill-editor | read before fill |

## WorkUnit Schema

| field | type | required | source | note |
|---|---|---|---|---|
| custPoNo | string | true | import.rows | selected launch row |
```

数据规则：

- Import fields 保留原始列名。
- WorkUnit fields 使用标准化 camelCase key，不写 `workUnit.` 前缀。
- `global.*` 表示跨 run 稳定值。
- `workflow.*` 表示单次 workflow run 范围内的值，或由页面读取 / Action 产出的值。

## 3. Plugin Design 模板

目标路径：

```text
plugins/<plugin-id>/docs/plugin-design.md
```

推荐结构：

```md
# <Plugin Name> Plugin Design

状态：草案 / 已确认 / 有未验证项

## Package and Flow

- pluginId:
- flowId:
- buyer:
- seller:
- platform:
- supportedHosts:
- source of truth: TypeScript code is first source for implementation details.

## Page States

| id | purpose | evidence | unverified |
|---|---|---|---|
| product.search.ready | Product search page is operable | Dynamic + Static refs | selector partially verified |

## Actions

### <action.id>

- title:
- purpose:
- repeatability: repeatable / nonRepeatable
- executionMode: pageOperation / pageRead / humanInteraction
- requires:
- readiness:
- execute intent:
- verify:
- risk:
- evidence:
- unverified:

## Steps

| stepId | kind | purpose | actions | activation | WorkUnit |
|---|---|---|---|---|---|
| product.filter-by-reference | operational | filter Product by PO | product.set-query-type, product.fill-reference | product.search.ready | current row |

## Automations

| automationId | level | activationStepId | launch | plan | WorkUnit injection | human boundary |
|---|---|---|---|---|---|---|
| product.prepare-current-workunit | L2 | product.filter-by-reference | currentRow | chain | currentBookingWorkUnit for each step | pause before save |

## Irreversible Boundaries

| action | risk | default behavior | required human approval |
|---|---|---|---|
| preview.submit | submit | blocked | yes |

## Open Issues

- 未验证：
- 需要真实登录后确认：
- 需要补录：
```

设计规则：

- 只记录 Action 和 workflow 层面的设计。
- 除非必须标记风险，否则不要逐个复制 selector 级代码细节。
- 如果设计文档与 TypeScript 冲突，以 TypeScript 作为实现事实源，并回写本文档作为记忆。

## 4. TypeScript 草案清单

生成当前 Ligentia plugin 文件：

```text
README.md
manifest.ts
index.ts
flow.ts
data-mapping.ts
selectors.ts
action-variable-usage.generated.ts
actions/index.ts
steps/index.ts
steps/activation.ts
docs/sample-tables.md
docs/sop.md
docs/images/
docs/plugin-design.md
sample/README.md
```

实现说明：

- 从 `sidebar-core/src/definition` 引入 `FlowPackageManifest`、`FlowDefinition`、`StepDefinition`、`ActionDefinition`、`DataResolverDefinition`、`WorkUnitSchemaDefinition` 等类型。
- 在 `data-mapping.ts` 中声明 import source、session input、workflow variables 和 WorkUnit schema。
- 在 `steps/activation.ts` 中声明 page state conditions 和 Step activation policies。
- Actions 保持小粒度，并且必须经过 verify gate。
- 除非人类明确反对，每个 Step 默认生成一个 L1 automation。
- 只有已确认 SOP 支持完整顺序时，才生成 L2 / L3 automations。
- 证据不足时，把 `locatorPolicy.verificationStatus` 标为 `unverified` 或 `partiallyVerified`。
