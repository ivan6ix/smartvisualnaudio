import { forwardRef, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiArchive, FiMoreVertical, FiRefreshCw, FiSearch, FiShield } from "react-icons/fi";

export function Button({ children, variant = "dark", className = "", ...props }) {
  return <button className={`btn ${variant === "light" ? "btn-light" : ""} ${className}`} {...props}>{children}</button>;
}

export const Field = forwardRef(function Field({ label, error, className = "", ...props }, ref) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      <input ref={ref} {...props} />
      {error ? <small>{error}</small> : null}
    </label>
  );
});

export const TextArea = forwardRef(function TextArea({ label, error, ...props }, ref) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea ref={ref} {...props} />
      {error ? <small>{error}</small> : null}
    </label>
  );
});

export const SelectField = forwardRef(function SelectField({ label, children, ...props }, ref) {
  return (
    <label className="field">
      <span>{label}</span>
      <select ref={ref} {...props}>{children}</select>
    </label>
  );
});

export function Card({ children, className = "", ...props }) {
  return <section className={`card ${className}`} {...props}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </div>
  );
}

export function StatCard({ label, value, icon: Icon = FiShield }) {
  return (
    <Card className="stat-card">
      <Icon />
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </Card>
  );
}

export function Badge({ children, tone = "neutral" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function SearchBox({ value, onChange, placeholder = "Search" }) {
  return (
    <div className="search-box">
      <FiSearch />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function EmptyState({ title = "No records found", description = "Try adjusting your search or filters." }) {
  return <div className="empty-state"><FiArchive /><strong>{title}</strong><span>{description}</span></div>;
}

export function SkeletonBlock({ className = "" }) {
  return <div className={`skeleton-block ${className}`} />;
}

// Inline stand-in for a single number (KPI or stat value) while it loads.
export function SkeletonValue({ className = "" }) {
  return <span className={`skeleton-block skeleton-value ${className}`} role="status" aria-label="Loading" />;
}

export function HeaderSkeleton() {
  return (
    <div className="skeleton-header" aria-hidden="true">
      <SkeletonBlock className="skeleton-title" />
      <SkeletonBlock className="skeleton-subtitle" />
    </div>
  );
}

export function PageSkeleton({ cards = 4, rows = 5 }) {
  return (
    <main className="app-shell page-skeleton" aria-busy="true">
      <HeaderSkeleton />
      <div className="stats-grid">
        {Array.from({ length: cards }).map((_, index) => <SkeletonBlock key={index} className="skeleton-stat-card" />)}
      </div>
      <Card className="skeleton-table-card">
        <SkeletonBlock className="skeleton-toolbar" />
        {Array.from({ length: rows }).map((_, index) => <SkeletonBlock key={index} className="skeleton-row" />)}
      </Card>
    </main>
  );
}

const SKELETON_DEFAULT_COUNTS = { cards: 4, records: 4, stats: 4, table: 5 };
const SKELETON_WIDTHS = ["82%", "64%", "74%", "58%", "70%", "88%"];

function skeletonWidth(index, offset = 0) {
  return SKELETON_WIDTHS[(index + offset) % SKELETON_WIDTHS.length];
}

// First-load placeholder shaped like the list it stands in for. Pages render it only while no data exists yet.
export function ListSkeleton({ variant = "table", count, columns = 4, header = true, label = "Loading...", className = "" }) {
  const total = count ?? SKELETON_DEFAULT_COUNTS[variant] ?? 4;
  const items = Array.from({ length: total }, (_, index) => index);
  const cells = Array.from({ length: columns }, (_, index) => index);

  return (
    <div className={`list-skeleton list-skeleton--${variant} ${className}`} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {variant === "table" ? (
        <div className="list-skeleton__table" aria-hidden="true" style={{ "--skeleton-template": columns > 1 ? `minmax(0, 2fr) repeat(${columns - 1}, minmax(0, 1fr))` : "minmax(0, 1fr)" }}>
          {header ? (
            <div className="list-skeleton__row list-skeleton__row--head">
              {cells.map((cell) => <SkeletonBlock key={cell} className="skeleton-line skeleton-line--sm" />)}
            </div>
          ) : null}
          {items.map((item) => (
            <div className="list-skeleton__row" key={item}>
              {cells.map((cell) => (
                <span className="list-skeleton__cell" key={cell} style={{ width: skeletonWidth(item, cell) }}>
                  <SkeletonBlock className={cell === columns - 1 && columns > 2 ? "skeleton-pill" : "skeleton-line"} />
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {variant === "cards" ? items.map((item) => (
        <div className="list-skeleton__card" key={item} aria-hidden="true">
          <SkeletonBlock className="skeleton-line skeleton-line--lg" />
          <SkeletonBlock className="skeleton-line" />
          <SkeletonBlock className="skeleton-line skeleton-line--short" />
          <SkeletonBlock className="skeleton-pill list-skeleton__action" />
        </div>
      )) : null}
      {variant === "records" ? items.map((item) => (
        <div className="list-skeleton__record" key={item} aria-hidden="true">
          <div className="list-skeleton__record-header">
            <SkeletonBlock className="skeleton-line skeleton-line--lg" />
          </div>
          <div className="list-skeleton__record-body">
            {cells.map((cell) => (
              <span className="list-skeleton__field" key={cell}>
                <SkeletonBlock className="skeleton-line skeleton-line--sm skeleton-line--short" />
                <SkeletonBlock className="skeleton-line" />
              </span>
            ))}
          </div>
        </div>
      )) : null}
      {variant === "stats" ? items.map((item) => (
        <div className="list-skeleton__stat" key={item} aria-hidden="true">
          <SkeletonBlock className="skeleton-icon" />
          <SkeletonBlock className="skeleton-line skeleton-line--xl skeleton-line--short" />
          <SkeletonBlock className="skeleton-line skeleton-line--sm" />
        </div>
      )) : null}
    </div>
  );
}

export function Table({ columns, rows, renderActions, emptyTitle, emptyDescription, className = "" }) {
  return (
    <div className={`table-wrap ${className}`}>
      <table>
        {columns.some((column) => column.width) || renderActions?.width ? (
          <colgroup>
            {columns.map((column) => <col key={column.key} style={column.width ? { width: column.width } : undefined} />)}
            {renderActions ? <col style={renderActions.width ? { width: renderActions.width } : undefined} /> : null}
          </colgroup>
        ) : null}
        <thead>
          <tr>{columns.map((column) => <th className={column.className || undefined} key={column.key}>{column.label}</th>)}{renderActions ? <th className="actions-heading">Actions</th> : null}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => <td className={column.className || undefined} key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}
              {renderActions ? <td className="actions">{renderActions(row)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <EmptyState title={emptyTitle} description={emptyDescription} /> : null}
    </div>
  );
}

export function RowActionMenu({ actions = [], label = "More actions", menuId, openMenuId, rowId, setOpenMenuId }) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const resolvedMenuId = menuId || rowId;
  const isOpen = openMenuId === resolvedMenuId;
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const availableActions = actions.filter(Boolean);

  useEffect(() => {
    if (!isOpen) return undefined;

    function closeMenu() {
      setOpenMenuId("");
    }

    function handlePointerDown(event) {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      closeMenu();
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") closeMenu();
    }

    function updateMenuPosition() {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) return;
      const menuWidth = menuRef.current?.offsetWidth || 190;
      const menuHeight = menuRef.current?.offsetHeight || 160;
      const gap = 6;
      const edge = 12;
      const spaceBelow = window.innerHeight - triggerRect.bottom;
      const openUp = spaceBelow < menuHeight + gap && triggerRect.top > spaceBelow;
      const left = Math.min(Math.max(edge, triggerRect.right - menuWidth), window.innerWidth - menuWidth - edge);
      const top = openUp
        ? Math.max(edge, triggerRect.top - menuHeight - gap)
        : Math.min(triggerRect.bottom + gap, window.innerHeight - menuHeight - edge);
      setMenuPosition({ left, top });
    }

    updateMenuPosition();
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, setOpenMenuId]);

  function toggleMenu() {
    setOpenMenuId(isOpen ? "" : resolvedMenuId);
  }

  function runAction(action) {
    if (action.disabled) return;
    setOpenMenuId("");
    action.onClick();
  }

  return (
    <span className="row-action-menu">
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className="row-action-menu-trigger"
        disabled={!availableActions.length}
        onClick={toggleMenu}
        ref={triggerRef}
        title={label}
        type="button"
      >
        <FiMoreVertical />
      </button>
      {isOpen ? createPortal(
        <div
          className="row-action-menu-popover"
          ref={menuRef}
          role="menu"
          style={{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }}
        >
          {availableActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                className={action.danger ? "danger" : ""}
                disabled={action.disabled}
                key={action.label}
                onClick={() => runAction(action)}
                role="menuitem"
                type="button"
              >
                {Icon ? <Icon /> : null}
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </span>
  );
}

export function QuickAction({ icon: Icon = FiRefreshCw, children, onClick }) {
  return <button className="quick-action" onClick={onClick}><Icon />{children}</button>;
}
