import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => ReactNode);
  className?: string;
  searchable?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  compact?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyField,
  onRowClick,
  emptyMessage = "אין נתונים",
  compact = false,
  searchable = false,
  searchPlaceholder = "חיפוש...",
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");

  const filteredData =
    searchable && search.trim()
      ? data.filter((row) => {
          const term = search.trim().toLowerCase();
          return columns.some((col) => {
            if (typeof col.accessor === "function") return false;
            const val = row[col.accessor];
            return val != null && String(val).toLowerCase().includes(term);
          });
        })
      : data;

  const cellPadding = compact ? "px-3 py-1.5" : "px-4 py-3";
  const headerPadding = compact ? "px-3 py-2" : "px-4 py-3";

  return (
    <div className="space-y-2">
      {searchable && (
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-md border border-input bg-background ps-9 pe-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={cn(
                    headerPadding,
                    "text-start font-medium text-muted-foreground",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className={cn(cellPadding, "text-center text-muted-foreground", !compact && "py-8")}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              filteredData.map((row) => (
                <tr
                  key={String(row[keyField])}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "border-t transition-colors hover:bg-muted/50",
                    onRowClick && "cursor-pointer",
                  )}
                >
                  {columns.map((col, i) => (
                    <td key={i} className={cn(cellPadding, col.className)}>
                      {typeof col.accessor === "function"
                        ? col.accessor(row)
                        : (row[col.accessor] as ReactNode)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
