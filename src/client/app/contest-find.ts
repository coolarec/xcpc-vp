export interface FindInputSnapshot {
  value: string;
  start: number;
  end: number;
}

/** Filter only the edited span. Previously pasted Chinese must survive later typing/deletion. */
export function filterFindInput(before: FindInputSnapshot, value: string, caret: number) {
  let prefix = 0;
  const prefixLimit = Math.min(before.start, before.value.length, value.length);
  while (prefix < prefixLimit && before.value[prefix] === value[prefix]) prefix++;
  let suffix = 0;
  const suffixLimit = Math.min(before.value.length - before.end, value.length - prefix);
  while (suffix < suffixLimit && before.value[before.value.length - suffix - 1] === value[value.length - suffix - 1]) suffix++;
  const insertedEnd = value.length - suffix;
  const inserted = value.slice(prefix, insertedEnd);
  const clean = inserted.replace(/[^\x00-\x7f]/g, '');
  const removedBeforeCaret = value.slice(prefix, Math.max(prefix, Math.min(caret, insertedEnd))).replace(/[\x00-\x7f]/g, '').length;
  return {
    value: value.slice(0, prefix) + clean + value.slice(insertedEnd),
    caret: Math.max(0, caret - removedBeforeCaret),
  };
}

const EXCLUDED = 'script,style,noscript,textarea,input,select,option,[hidden],[aria-hidden="true"],[data-contest-find]';
const BLOCKS = 'td,th,p,li,h1,h2,h3,h4,h5,h6,button,label,section,article,main,body';

/** Build ranges across inline spans, but never join unrelated table cells / block content. */
export function findTextRanges(doc: Document, query: string): Range[] {
  if (!query || !doc.body) return [];
  const needle = query.toLowerCase();
  const groups = new Map<Element, { text: string; nodes: Array<{ node: Text; start: number }> }>();
  const walker = doc.createTreeWalker(doc.body, 4);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!node.textContent || !parent || parent.closest(EXCLUDED)) continue;
    const block = parent.closest(BLOCKS) || parent;
    let group = groups.get(block);
    if (!group) { group = { text: '', nodes: [] }; groups.set(block, group); }
    group.nodes.push({ node: node as Text, start: group.text.length });
    group.text += node.textContent;
  }
  const matches: Range[] = [];
  for (const group of groups.values()) {
    // Regex matches retain offsets into the original text, including non-ASCII case folding.
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(group.text))) {
      const start = match.index;
      const end = start + match[0].length;
      const first = group.nodes.find(item => item.start + item.node.length > start)!;
      const last = group.nodes.find(item => item.start + item.node.length >= end)!;
      const range = doc.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      const element = first.node.parentElement!;
      if (!range.getClientRects().length || doc.defaultView?.getComputedStyle(element).visibility === 'hidden') continue;
      matches.push(range);
    }
  }
  return matches;
}

/** Same small utility on both documents; no dependency on either scoreboard's presentation. */
export function installContestFind(doc: Document = document) {
  const win = doc.defaultView!;
  const toolbar = doc.createElement('div');
  toolbar.id = 'vp-page-find';
  toolbar.dataset.contestFind = '';
  toolbar.hidden = true;
  toolbar.setAttribute('role', 'search');
  toolbar.setAttribute('aria-label', 'Find on page');
  const input = doc.createElement('input');
  input.type = 'text';
  input.setAttribute('aria-label', 'Find on page');
  input.placeholder = 'Find on page';
  input.title = 'English input only. Paste Chinese text to search.';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  const count = doc.createElement('span');
  count.className = 'vp-find-count';
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');
  const previous = makeButton('Previous match', '↑');
  const next = makeButton('Next match', '↓');
  const close = makeButton('Close find', '×');
  toolbar.append(input, count, previous, next, close);
  doc.body.append(toolbar);

  let composing = false;
  let baseline: FindInputSnapshot = { value: '', start: 0, end: 0 };
  let beforeComposition = baseline;
  let ranges: Range[] = [];
  let current = -1;
  let returnFocus: Element | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const css = (win as any).CSS;
  const HighlightConstructor = (win as any).Highlight;
  const registry = css?.highlights;
  const supportsHighlights = !!registry && !!HighlightConstructor;

  function makeButton(label: string, text: string) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = text;
    return button;
  }
  function snapshot(): FindInputSnapshot {
    return { value: input.value, start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length };
  }
  function clearHighlights() {
    if (supportsHighlights) { registry.delete('vp-find-matches'); registry.delete('vp-find-current'); }
  }
  function paint(scroll: boolean) {
    clearHighlights();
    count.textContent = `${current >= 0 ? current + 1 : 0}/${ranges.length}`;
    previous.disabled = next.disabled = !ranges.length;
    if (supportsHighlights) {
      const all = new HighlightConstructor();
      for (const range of ranges) all.add(range);
      registry.set('vp-find-matches', all);
      if (current >= 0) {
        const active = new HighlightConstructor(ranges[current]);
        active.priority = 1;
        registry.set('vp-find-current', active);
      }
    }
    if (scroll && current >= 0) {
      const range = ranges[current];
      range.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
      if (!supportsHighlights) {
        const selection = win.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }
  function search(scroll = true) {
    clearTimeout(searchTimer);
    ranges = findTextRanges(doc, input.value);
    current = ranges.length ? Math.max(0, Math.min(current, ranges.length - 1)) : -1;
    paint(scroll);
  }
  function edited() {
    baseline = snapshot();
    current = -1;
    search();
  }
  function sanitize(before: FindInputSnapshot) {
    const filtered = filterFindInput(before, input.value, input.selectionStart ?? input.value.length);
    if (filtered.value !== input.value) {
      input.value = filtered.value;
      input.setSelectionRange(filtered.caret, filtered.caret);
    }
    edited();
  }
  function open() {
    if (toolbar.hidden) returnFocus = doc.activeElement;
    toolbar.hidden = false;
    input.focus();
    input.select();
    baseline = snapshot();
    search();
  }
  function dismiss() {
    toolbar.hidden = true;
    clearTimeout(searchTimer);
    clearHighlights();
    if (!supportsHighlights && ranges[current] && win.getSelection()?.toString() === ranges[current].toString()) win.getSelection()?.removeAllRanges();
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function move(direction: number) {
    if (!ranges.length) return;
    current = (current + direction + ranges.length) % ranges.length;
    paint(true);
  }
  function onKey(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopImmediatePropagation(); open();
    } else if (!toolbar.hidden && event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); dismiss();
    } else if (!toolbar.hidden && (event.key === 'F3' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') || event.key === 'Enter' && event.target === input)) {
      event.preventDefault(); event.stopImmediatePropagation(); move(event.shiftKey ? -1 : 1);
    }
  }
  function beforeInput(event: InputEvent) {
    if (!composing && !event.isComposing) baseline = snapshot();
  }
  function onInput(event: InputEvent) {
    if (composing || event.isComposing) return;
    sanitize(baseline);
  }
  function onPaste(event: ClipboardEvent) {
    if (!event.clipboardData) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' ');
    input.setRangeText(text, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
    edited();
  }
  function compositionStart() { composing = true; beforeComposition = snapshot(); }
  function compositionEnd() { composing = false; sanitize(beforeComposition); }
  const onPrevious = () => move(-1);
  const onNext = () => move(1);
  doc.addEventListener('keydown', onKey, true);
  input.addEventListener('beforeinput', beforeInput);
  input.addEventListener('input', onInput);
  input.addEventListener('paste', onPaste);
  input.addEventListener('compositionstart', compositionStart);
  input.addEventListener('compositionend', compositionEnd);
  previous.addEventListener('click', onPrevious);
  next.addEventListener('click', onNext);
  close.addEventListener('click', dismiss);
  const observer = new MutationObserver(records => {
    if (toolbar.hidden || !input.value || records.every(record => toolbar.contains(record.target))) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => search(false), 100);
  });
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-hidden'] });
  count.textContent = '0/0';
  return () => {
    clearTimeout(searchTimer);
    observer.disconnect();
    clearHighlights();
    doc.removeEventListener('keydown', onKey, true);
    toolbar.remove();
  };
}
