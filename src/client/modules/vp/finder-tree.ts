import { CollectionItemType, type IApiCollectionItem } from '@/services/ranklist-api/types';

export interface FinderContest {
  key: string;
  name: string;
  path: string[];
}
export interface FinderNode {
  id: string;
  label: string;
  kind: 'folder' | 'contest';
  count: number;
  children: FinderNode[];
  contest?: FinderContest;
}
export interface FinderColumn { title: string; nodes: FinderNode[] }

export function flattenFinderContests(items: IApiCollectionItem[], path: string[] = []): FinderContest[] {
  return items.flatMap(item => {
    if (item.type === CollectionItemType.Directory) return flattenFinderContests(item.children || [], [...path, item.name]);
    return [{ key: item.uniqueKey, name: item.name, path }];
  });
}

export function buildFinderTree(items: IApiCollectionItem[], search = ''): FinderNode[] {
  const query = search.trim().toLocaleLowerCase();
  const visit = (item: IApiCollectionItem, path: string[], ids: string[]): FinderNode | undefined => {
    if (item.type === CollectionItemType.Directory) {
      const children = (item.children || []).map(child => visit(child, [...path, item.name], [...ids, item.uniqueKey])).filter((node): node is FinderNode => !!node);
      if (query && !children.length) return undefined;
      return {
        id: `folder:${JSON.stringify([...ids, item.uniqueKey])}`, label: item.name,
        kind: 'folder', count: children.reduce((sum, child) => sum + child.count, 0), children,
      };
    }
    const contest = flattenFinderContests([item], path)[0];
    if (query && !`${path.join(' ')} ${contest.name} ${contest.key}`.toLocaleLowerCase().includes(query)) return undefined;
    return { id: `contest:${contest.key}`, label: item.name, kind: 'contest', count: 1, children: [], contest };
  };
  return items.map(item => visit(item, [], [])).filter((node): node is FinderNode => !!node);
}

export function findFinderContestPath(nodes: FinderNode[], key: string): string[] | undefined {
  for (const node of nodes) {
    if (node.contest?.key === key) return [node.id];
    const nested = findFinderContestPath(node.children, key);
    if (nested) return [node.id, ...nested];
  }
}

export function getFinderColumns(nodes: FinderNode[], path: string[]): FinderColumn[] {
  const columns: FinderColumn[] = [];
  let current = nodes;
  let title = '赛事';
  for (let depth = 0; ; depth++) {
    columns.push({ title, nodes: current });
    const selected = current.find(node => node.id === path[depth]);
    if (!selected || selected.kind === 'contest') break;
    current = selected.children;
    title = selected.label;
  }
  return columns;
}

export function selectedFinderNodes(nodes: FinderNode[], path: string[]): FinderNode[] {
  const result: FinderNode[] = [];
  let current = nodes;
  for (const id of path) {
    const node = current.find(item => item.id === id);
    if (!node) break;
    result.push(node); current = node.children;
  }
  return result;
}

export function getFinderScope(nodes: FinderNode[], path: string[]): FinderContest[] {
  const selection = selectedFinderNodes(nodes, path);
  const last = selection[selection.length - 1];
  const parent = selection[selection.length - 2];
  const current = last?.kind === 'folder' ? last.children : parent?.children || nodes;
  const collect = (list: FinderNode[]): FinderContest[] => list.flatMap(node => node.contest ? [node.contest] : collect(node.children));
  return collect(current);
}
