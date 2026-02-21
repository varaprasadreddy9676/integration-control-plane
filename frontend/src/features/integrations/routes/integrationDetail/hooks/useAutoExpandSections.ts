import { useEffect } from 'react';

interface UseAutoExpandSectionsParams {
  isCreate: boolean;
  activePanels: string[];
  isMultiAction: boolean;
  sectionCompletion: Record<string, boolean>;
  setActivePanels: (panels: string[]) => void;
}

export const useAutoExpandSections = ({
  isCreate,
  activePanels,
  isMultiAction,
  sectionCompletion,
  setActivePanels
}: UseAutoExpandSectionsParams) => {
  // Disabled: Auto-expansion is disruptive in tabbed UI
  // Users should manually navigate between tabs
  // Tabs show completion indicators (green checkmarks) for guidance
  useEffect(() => {
    // Auto-expansion disabled for better UX with tabbed interface
  }, [isCreate, activePanels, isMultiAction, sectionCompletion, setActivePanels]);
};
