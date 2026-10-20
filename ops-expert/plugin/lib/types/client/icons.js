import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
/** 名字找不到时的占位：渲染 null，不抛错，不连带卸载 slot。 */
const MissingIcon = () => null;
/**
 * 按候选名顺序解析一个图标组件。
 * @param names - 候选导出名，从最旧的宿主命名排到最新。
 * @returns 第一个存在的组件；都不存在时返回 {@link MissingIcon}。
 */
function resolveIcon(...names) {
    // 用索引访问而不是命名导入：目标宿主的类型表里可能没有这些名字，
    // 静态导入会在编译期就失败，而这里只是运行时查表。
    const table = primitives;
    for (const name of names) {
        const candidate = table[name];
        if (typeof candidate === 'function')
            return candidate;
    }
    return MissingIcon;
}
/** 「关闭」图标：`IconCloseOutline16` → `IconCloseOutlineMedium` → `IconCloseOutlineRegular`。 */
export const IconClose = resolveIcon('IconCloseOutline16', 'IconCloseOutlineMedium', 'IconCloseOutlineRegular');
/** 「数据/文件」图标：`IconDataOutline16` → `IconDataOutlineMedium` → `IconDataOutlineRegular`。 */
export const IconData = resolveIcon('IconDataOutline16', 'IconDataOutlineMedium', 'IconDataOutlineRegular');
/** 「个性化/运维」图标：`IconPersonalizationOutline16` → `*Medium` → `*Regular`。 */
export const IconPersonalization = resolveIcon('IconPersonalizationOutline16', 'IconPersonalizationOutlineMedium', 'IconPersonalizationOutlineRegular');
//# sourceMappingURL=icons.js.map