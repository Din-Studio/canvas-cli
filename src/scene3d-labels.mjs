/**
 * 跳切豁免在人话里的叫法（键 = `SCENE3D.checks.cutExemptions`）。契约把它原样挂在
 * `SCENE3D.checks.cutExemptionLabels` 上发布（页面自检的 message 从契约取），`scene3d-text.mjs` 的
 * 摘要也用它 —— 同一份。
 *
 * 单独成模块是为了依赖只朝一个方向：契约在画布首包里，它若从 `scene3d-text.mjs` 取值（或那边
 * import 契约），打包器会把摘要函数一起打进首包（实测 +0.7 KiB）；两边都从这里取就不会。
 */
export const SCENE3D_CUT_EXEMPTION_LABELS = {
  moving: "运动镜",
  resize: "景别跨档",
  subject: "换主体",
};
