import { useEffect, useRef, useState } from "react";
import type { ThreadResponseItem, ThreadTab } from "../types";
import { THREAD_TABS_KEY } from "../constants";

type TabCacheEntry = {
  responses: ThreadResponseItem[];
  selectedResponse: number;
  scrollResponseNo?: number;
  newResponseStart?: number | null;
};

export function useNavigation() {
  const [threadTabs, setThreadTabs] = useState<ThreadTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(-1);
  const tabCacheRef = useRef<Map<string, TabCacheEntry>>(new Map());
  const closedTabsRef = useRef<{ threadUrl: string; title: string }[]>([]);
  const tabsRestoredRef = useRef(false);

  // Persist tab state to localStorage whenever tabs change (after initial restore).
  useEffect(() => {
    if (!tabsRestoredRef.current) return;
    try {
      localStorage.setItem(
        THREAD_TABS_KEY,
        JSON.stringify({ tabs: threadTabs, activeIndex: activeTabIndex }),
      );
    } catch { /* ignore */ }
  }, [threadTabs, activeTabIndex]);

  return {
    threadTabs, setThreadTabs,
    activeTabIndex, setActiveTabIndex,
    tabCacheRef,
    closedTabsRef,
    tabsRestoredRef,
  };
}
