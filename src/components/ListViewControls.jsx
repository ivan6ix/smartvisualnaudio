import { FiGrid, FiList, FiMoreVertical } from "react-icons/fi";
import { DENSITIES, LIST_VIEWS } from "../lib/listView";

const VIEW_LABELS = { cards: "Cards", table: "Table" };
const DENSITY_LABELS = { comfortable: "Comfortable", compact: "Compact", dense: "Dense" };

export function ListViewToolbar({ controls, children }) {
  return <div className="list-view-toolbar">{children}<ListViewControls {...controls} /></div>;
}

export function ListViewControls({ cardDensity, onCardDensity, onTableDensity, onView, tableDensity, view }) {
  const activeDensity = view === "cards" ? cardDensity : tableDensity;
  const setDensity = view === "cards" ? onCardDensity : onTableDensity;
  return (
    <div className="list-view-controls">
      <div className="list-view-segment" aria-label="View">
        <span>View:</span>
        {LIST_VIEWS.map((item) => (
          <button aria-pressed={view === item} className={view === item ? "active" : ""} key={item} onClick={() => onView(item)} type="button">
            {item === "cards" ? <FiGrid /> : <FiList />} {VIEW_LABELS[item]}
          </button>
        ))}
      </div>
      <div className="list-view-segment" aria-label={`${VIEW_LABELS[view]} density`}>
        <span>Density:</span>
        {DENSITIES.map((item) => (
          <button aria-pressed={activeDensity === item} className={activeDensity === item ? "active" : ""} key={item} onClick={() => setDensity(item)} type="button">
            {DENSITY_LABELS[item]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ListPagination({ count, page, pageSize, onPage }) {
  if (count <= pageSize) return null;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const safePage = Math.min(page, totalPages);
  return (
    <div className="list-view-pagination">
      <span>Showing {(safePage - 1) * pageSize + 1}-{Math.min(count, safePage * pageSize)} of {count}</span>
      <button disabled={safePage <= 1} onClick={() => onPage(safePage - 1)} type="button">Previous</button>
      <span>Page {safePage} of {totalPages}</span>
      <button disabled={safePage >= totalPages} onClick={() => onPage(safePage + 1)} type="button">Next</button>
    </div>
  );
}

export function ListCardGrid({ children, density }) {
  return <div className={`list-card-grid list-card-grid-${density}`}>{children}</div>;
}

export function ResponsiveTable({ children, density, className = "" }) {
  return <div className={`list-table-wrap list-table-${density} ${className}`}>{children}</div>;
}

export function RecordCardList({ columns, density, empty, renderActions, rows, titleKey }) {
  return (
    <>
      <ListCardGrid density={density}>
        {rows.map((row) => {
          const titleColumn = columns.find((column) => column.key === titleKey) || columns[0];
          const detailColumns = columns.filter((column) => column.key !== titleColumn.key);
          return (
            <article className="list-record-card" key={row.id}>
              <header className="record-card__header">
                <strong className="record-card__title">{titleColumn.render ? titleColumn.render(row) : row[titleColumn.key]}</strong>
                {renderActions ? <div className="list-record-actions record-card__actions">{renderActions(row)}</div> : null}
              </header>
              <dl className="record-card__body">
                {detailColumns.map((column) => (
                  <div className="record-card__field" key={column.key}>
                    <dt className="record-card__label">{column.label}</dt>
                    <dd className="record-card__value">{column.render ? column.render(row) : row[column.key]}</dd>
                  </div>
                ))}
              </dl>
            </article>
          );
        })}
      </ListCardGrid>
      {!rows.length ? empty : null}
    </>
  );
}

export function KebabButton({ label = "More actions", onClick }) {
  return (
    <button aria-label={label} className="list-kebab-button" onClick={onClick} title={label} type="button">
      <FiMoreVertical />
    </button>
  );
}
