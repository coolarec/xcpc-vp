import type * as srk from '@algoux/standard-ranklist';
import type { CSSProperties } from 'vue';

export interface StyledRanklistRendererProps {
  data: srk.Ranklist;
  name: string;
  id?: string;
  srkUrl?: string;
  meta?: {
    viewCnt?: number;
  };
  showFooter?: boolean;
  showFilter?: boolean;
  showProgress?: boolean;
  isLive?: boolean;
  progressTimeDelta?: number;
  enableTimeTravel?: boolean;
  replayElapsedMs?: number;
  ccpc26Mode?: boolean;
  fitProblemColumns?: boolean;
  languages?: readonly string[];
  tableClass?: string;
  tableStyle?: CSSProperties;
}
