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
      const height = getScrollLimitHeight(bottoms, limit);
      // A sideways scrollbar (a wide table) takes room at the bottom: add it so the last counted item is not hidden.
      const style = window.getComputedStyle(element);
      const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
      const scrollbar = Math.max(0, element.offsetHeight - element.clientHeight - borders);
      setMaxHeight(height === null ? null : height + scrollbar);
    }
    // The items and everything above them (a header row) are watched too: once the list is capped its own size
    // stops changing, but a row can still grow (a title wrapping after fonts load, live counts changing), and the
    // cap must follow it.
    const resize = window.ResizeObserver ? new window.ResizeObserver(measure) : null;
    function observeAll() {
      if (!resize) return;
      resize.disconnect();
      resize.observe(element);
      new Set([...element.children, ...element.querySelectorAll(itemSelector)]).forEach((item) => resize.observe(item));
    }
    measure();
    observeAll();
    const mutations = window.MutationObserver ? new window.MutationObserver(() => {
      observeAll();
      measure();
    }) : null;
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
