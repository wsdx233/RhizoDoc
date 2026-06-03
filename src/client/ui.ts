export type ProgressCardOptions = {
  title?: string;
  sourceLabel?: string;
  sourceText?: string;
  prompt?: string;
  stage?: string;
  summary?: string;
};

export type ProgressCardUpdate = ProgressCardOptions & {
  done?: boolean;
  error?: boolean;
};

let progressIdCount = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function createProgressCard(
  progressStack: HTMLElement,
  { title, sourceLabel = '批注', sourceText = '', prompt = '', stage = '准备中', summary = '' }: ProgressCardOptions = {},
): string {
  const id = `progress-${progressIdCount++}`;
  const card = document.createElement('article');
  card.id = id;
  card.className = 'progress-card';
  card.innerHTML = `
    <div class="progress-icon"><span class="material-symbols-outlined">progress_activity</span></div>
    <div class="progress-body">
      <div class="progress-title-row"><span class="progress-title"></span><span class="progress-stage"></span></div>
      <div class="progress-line"><span class="progress-label source-label"></span><span class="progress-value source-value"></span></div>
      <div class="progress-line"><span class="progress-label">提问</span><span class="progress-value prompt-value"></span></div>
      <div class="progress-line"><span class="progress-label">摘要</span><span class="progress-value summary-value"></span></div>
    </div>
  `;
  progressStack.appendChild(card);
  updateProgressCard(id, { title, sourceLabel, sourceText, prompt, stage, summary });
  return id;
}

export function updateProgressCard(
  id: string | null | undefined,
  { title, sourceLabel, sourceText, prompt, stage, summary, done = false, error = false }: ProgressCardUpdate = {},
) {
  if (!id) return;
  const card = document.getElementById(id);
  if (!card) return;

  setText(card, '.progress-title', title, 'AI 生成');
  setText(card, '.progress-stage', stage, '');
  setText(card, '.source-label', sourceLabel, '上下文');
  setText(card, '.source-value', sourceText, '—');
  setText(card, '.prompt-value', prompt, '默认扩展提示');
  setText(card, '.summary-value', summary, '—');

  if (done || error) {
    card.classList.toggle('done', done && !error);
    card.classList.toggle('error', error);
    const icon = card.querySelector('.progress-icon .material-symbols-outlined');
    if (icon) icon.textContent = error ? 'error' : 'check_circle';
    setTimeout(() => {
      card.style.opacity = '0';
      card.style.transform = 'translateX(-16px)';
      setTimeout(() => card.remove(), 260);
    }, error ? 6200 : 3800);
  }
}

export function showToast(toast: HTMLElement, message: unknown) {
  toast.textContent = String(message || '');
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function setText(root: Element, selector: string, value: string | undefined, fallback: string) {
  if (value === undefined) return;
  const target = root.querySelector(selector);
  if (target) target.textContent = value || fallback;
}
