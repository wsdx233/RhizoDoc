import { fetchJson, postJson } from './api.js';
import type { RhizoDomRefs } from './dom.js';
import { escapeHtml, formatBytes } from './utils.js';
import type { FlowListResponse, SaveFlowResponse } from '../shared/types.js';

type ServerFlowsControllerOptions = {
  dom: RhizoDomRefs;
  state: any;
  graph: any;
  showToast: (message: string) => void;
};

export function createServerFlowsController(options: ServerFlowsControllerOptions) {
  const { dom, state, graph, showToast } = options;

  async function save() {
    if (state.nodes.length === 0) {
      showToast('当前没有可保存的流程图');
      return;
    }
    const name = prompt('请输入服务端保存名称：', state.flowName || '未命名流程图');
    if (!name) return;
    try {
      const data = await postJson<SaveFlowResponse>('/api/flows', { name, flow: graph.exportFlow() });
      state.flowName = data.name || name;
      graph.updateFlowName();
      showToast(`已保存到服务端：${state.flowName}`);
    } catch (error) {
      showToast(`服务端保存失败：${error.message}`);
    }
  }

  async function open() {
    dom.flowsModal.classList.remove('hidden');
    await refresh();
  }

  function close() {
    dom.flowsModal.classList.add('hidden');
  }

  async function refresh() {
    dom.serverFlowList.innerHTML = '<p class="muted">正在读取...</p>';
    try {
      const data = await fetchJson<FlowListResponse>('/api/flows');
      const flows = data.flows || [];
      if (flows.length === 0) {
        dom.serverFlowList.innerHTML = '<p class="muted">服务端还没有保存的流程图。</p>';
        return;
      }

      dom.serverFlowList.innerHTML = '';
      for (const flow of flows) {
        const item = document.createElement('div');
        item.className = 'flow-item';
        item.innerHTML = `
          <div><strong></strong><small></small></div>
          <div class="flow-actions">
            <button class="md-btn ghost flow-load"><span class="material-symbols-outlined">open_in_new</span>加载</button>
            <button class="md-btn ghost flow-delete"><span class="material-symbols-outlined">delete</span>删除</button>
          </div>
        `;
        item.querySelector('strong')!.textContent = flow.name;
        item.querySelector('small')!.textContent = `${formatBytes(flow.size)} · ${new Date(flow.updatedAt).toLocaleString()}`;
        item.querySelector('.flow-load')!.addEventListener('click', async () => {
          if (!graph.confirmReplaceGraph()) return;
          const res = await fetch(`/api/flows/${encodeURIComponent(flow.name)}`);
          const json = await res.json();
          if (!res.ok) {
            showToast(json.error || '加载失败');
            return;
          }
          graph.loadFlow(json);
        });
        item.querySelector('.flow-delete')!.addEventListener('click', async () => {
          if (!confirm(`确定删除服务端流程图「${flow.name}」吗？`)) return;
          const res = await fetch(`/api/flows/${encodeURIComponent(flow.name)}`, { method: 'DELETE' });
          if (!res.ok) showToast('删除失败');
          await refresh();
        });
        dom.serverFlowList.appendChild(item);
      }
    } catch (error) {
      dom.serverFlowList.innerHTML = `<p class="muted">读取失败：${escapeHtml(error.message)}</p>`;
    }
  }

  return {
    save,
    open,
    close,
    refresh,
  };
}
