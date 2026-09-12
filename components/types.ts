import type { Dispatch, SetStateAction } from 'react';
import type { BootstrapData, ViewKey } from '@/lib/types';

export type ToastTone = 'success' | 'error' | 'info';

export type SharedViewProps = {
  data: BootstrapData;
  setData: Dispatch<SetStateAction<BootstrapData | null>>;
  activeCaseId: string;
  setActiveCaseId: (id: string) => void;
  navigate: (view: ViewKey) => void;
  notify: (message: string, tone?: ToastTone) => void;
};
