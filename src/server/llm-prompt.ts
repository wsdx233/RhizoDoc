import type { LLMGeneratePayload } from '../shared/types.js';

export function buildInstructions({ searchToolsEnabled = false } = {}) {
  return [
    '你是一个严谨的中文知识图谱/文档研究助手。',
    '你的任务是为无限画布 DAG 生成一个新的节点（也可以是第一张根文档节点）。',
    '用户提问/生成要求是本次任务的最高优先级：必须先满足用户提问，再参考选中文本、来源节点和流程图上下文。',
    '如果用户明确要求标题或第一行内容，输出的第一行必须严格满足该要求。',
    '输出格式必须是纯文本，不要输出 JSON、XML、YAML、代码围栏或额外说明。',
    '第一行必须是节点纯文本短标题，尽量不超过 18 个汉字；不要加“标题：”前缀，也不要使用 Markdown 标题符号。',
    '从第二行开始是节点 Markdown 正文；服务端会按第一个换行把第一行拆为 title，其余内容拆为 content。',
    '正文必须是高质量 Markdown，可使用二级/三级标题、要点列表、引用、表格、代码块和 LaTeX 公式。',
    '公式只能使用双美元分隔符：行内公式写成 $$E = mc^2$$；块级公式使用独占行的 $$ 作为起止分隔符，公式内容放在中间。不要使用单个 $...$，也不要使用 \\(...\\) 或 \\[...\\]。',
    searchToolsEnabled ? [
      '',
      '【联网检索工具】',
      '你可以使用 grok_search、kimi_search、gemini_search 获取当前网页信息、技术文档、API 变化、来源支持的事实或读取 URL。',
      '当用户问题涉及当前信息、近期版本、新闻、价格、政策、技术文档/API 变化，或你不确定事实是否过期时，优先使用联网检索工具。',
      'grok_search 适合快速搜索当前网页信息并返回综合回答和来源链接；kimi_search 适合技术文档和较深入的页面抓取；gemini_search 适合 Gemini Web 搜索、读取指定 URL、获取带来源的回答。',
      '如果需要使用工具，先调用工具，不要把工具调用过程写进节点正文；工具完成后再输出最终节点文本。',
      '使用工具结果时不要编造来源；最终 Markdown 中应保留来源链接，引用应贴近对应段落。',
    ].join('\n') : '',
  ].filter(Boolean).join('\n');
}

export function buildLLMInput(payload: LLMGeneratePayload) {
  const userPrompt = payload.userPrompt?.trim() || '请详细解释并扩展成一个可读的知识节点。';
  const modeText = getModeText(payload.mode);

  return [
    '【用户提问 / 生成要求（最高优先级）】',
    userPrompt,
    '',
    '【任务模式】',
    modeText,
    payload.rootTitle ? `根文档标题：${payload.rootTitle}` : '',
    payload.parentTitle ? `来源节点标题：${payload.parentTitle}` : '',
    payload.selectedText ? `\n【用户选中的原文】\n${payload.selectedText}` : '',
    payload.parentContent ? `\n【来源节点 Markdown 内容】\n${payload.parentContent}` : '',
    payload.graphSummary ? `\n【当前流程图摘要】\n${payload.graphSummary}` : '',
    '',
    '【输出要求】',
    '请返回适合直接渲染为一个画布节点的纯文本：第一行是纯文本短标题，第二行起是中文 Markdown 正文。不要返回 JSON。',
    '再次确认：必须优先满足最上方的【用户提问 / 生成要求】；如果用户要求把标题/第一行设为某个值，第一行就输出那个值。',
    `用户提问复述：${userPrompt}`,
  ].filter((part) => part !== '').join('\n');
}

function getModeText(mode: LLMGeneratePayload['mode']) {
  return {
    selection: '基于用户选中的文本生成子节点。',
    node: '基于右键节点的完整内容生成一个新的子节点。',
    canvas: '在画布空白处生成一个独立新节点。',
    initial: '根据用户 Prompt 生成一个全新的根文档节点。',
    regenerate: '重新生成当前 AI 节点内容。',
  }[mode] || mode;
}
