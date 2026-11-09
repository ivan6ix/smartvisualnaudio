import { useLayoutEffect, useRef, useState } from "react";
import { getScrollLimitHeight, SCROLL_LIST_LIMIT } from "../lib/listView";

// Shows the first `limit` items of a list and lets the rest scroll inside it. The height is measured from the
// real items, so it fits any row height, density or card layout, and is measured again when items change.
export default function ScrollAfterItems({ as: Tag = "div", children, className = "", itemSelector, limit = SCROLL_LIST_LIMIT, ...props }) {
  const ref = useRef(null);
  const [maxHeight, setMaxHeight] = useState(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    function measure() {
      const top = element.getBoundingClientRect().top - element.scrollTop;
      const bottoms = [...element.querySelectorAll(itemSelector)].map((item) => item.getBoundingClientRect().bottom - top);
      setMaxHeight(getScrollLimitHeight(bottoms, limit));
    }
    measure();
    const resize = window.ResizeObserver ? new window.ResizeObserver(measure) : null;
    resize?.observe(element);
    const mutations = window.MutationObserver ? new window.MutationObserver(measure) : null;
    mutations?.observe(element, { childList: true, subtree: true });
    return () => {
      resize?.disconnect();
      mutations?.disconnect();
    };
  }, [itemSelector, limit]);

  return (
    <Tag
      className={`${className} ${maxHeight ? "scroll-after-items" : ""}`.trim()}
      ref={ref}
      style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined}
      {...props}
    >
      {children}
    </Tag>
  );
}
