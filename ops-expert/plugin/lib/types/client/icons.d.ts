/**
 * 跨宿主版本的图标解析（DSH-0.1.7-A1-01）。
 *
 * `@deepseek-ai/dsh-client-ui-primitives` 在 dsh-v0.1.7-alpha.1 删除了全部
 * `Icon*16` 命名导出，换成 `*Medium` / `*Regular` 两档。静态命名导入在新宿主上
 * 会拿到 `undefined`，渲染时触发 React #130，框架的 slot 级错误边界会把**整条
 * slot entry 卸载** —— 用户看到的是整块界面静默消失，只有一行压缩报错。
 *
 * 因此这里不做静态命名导入，而是在运行时按 `*16` → `*Medium` → `*Regular`
 * 的顺序从命名空间里取第一个存在的组件。这样同一份产物在旧宿主（0.1.3 ~ 0.1.6）
 * 与新宿主（0.1.7+ / 0.2.x）上都能渲染。
 *
 * 全部候选名都找不到时返回一个渲染 `null` 的占位组件：宁可少一个图标，
 * 也不要让整个 slot 崩掉。
 */
import type { ReactNode } from 'react';
/** 本插件用到的图标组件形状（primitives 的图标都接受可选 `size`）。 */
export type IconComponent = (props: {
    size?: number;
}) => ReactNode;
/** 「关闭」图标：`IconCloseOutline16` → `IconCloseOutlineMedium` → `IconCloseOutlineRegular`。 */
export declare const IconClose: IconComponent;
/** 「数据/文件」图标：`IconDataOutline16` → `IconDataOutlineMedium` → `IconDataOutlineRegular`。 */
export declare const IconData: IconComponent;
/** 「个性化/运维」图标：`IconPersonalizationOutline16` → `*Medium` → `*Regular`。 */
export declare const IconPersonalization: IconComponent;
//# sourceMappingURL=icons.d.ts.map