import { forwardRef } from "react";
import { FiArchive, FiRefreshCw, FiSearch, FiShield } from "react-icons/fi";

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

export function Card({ children, className = "" }) {
  return <section className={`card ${className}`}>{children}</section>;
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

export function Table({ columns, rows, renderActions }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}{renderActions ? <th>Actions</th> : null}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}
              {renderActions ? <td className="actions">{renderActions(row)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <EmptyState /> : null}
    </div>
  );
}

export function QuickAction({ icon: Icon = FiRefreshCw, children, onClick }) {
  return <button className="quick-action" onClick={onClick}><Icon />{children}</button>;
}
