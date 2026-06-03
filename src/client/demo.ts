export function demoDocument() {
  return `# RhizoDoc 使用说明

这是一个可交互的 Markdown 文档节点。你可以：

1. **选中一段文字**，在浮层中输入要求，然后让 LLM 生成解释节点。
2. **右键任何节点**，选择“LLM 生成新节点”，根据整张卡片继续扩展。
3. **右键空白画布**，也可以让 LLM 在当前位置创建一个独立新节点。
4. 节点内容会按 Markdown 渲染，包括列表、表格、代码块高亮、LaTeX 公式和引用。
5. 顶部按钮支持保存 / 加载流程图 JSON，也支持保存到 Node 服务端。

## Markdown 增强示例

- 行内公式：$E=mc^2$
- 块级公式：

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

~~~js
const answer = [1, 2, 3].map((n) => n ** 2);
console.log(answer);
~~~

> 后端复用 pi 的模型注册表、凭据和默认模型设置。请在 pi 中用 \`/model\`、\`/settings\` 或 \`~/.pi/agent/settings.json\` 选择模型。

## 可以尝试选中这句话

“把复杂文档拆成可追溯的知识节点，可以让分析过程更像一张可演化的研究地图。”
`;
}
