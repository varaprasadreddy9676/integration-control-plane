import { useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Skeleton, Table, Empty } from 'antd';
import type { TableProps, ColumnType } from 'antd/es/table';
import { Resizable } from 'react-resizable';
import type { ResizeCallbackData } from 'react-resizable';
import 'react-resizable/css/styles.css';
import { cssVar, useDesignTokens } from '../../design-system/utils';

interface ResizableColumnType<T> extends ColumnType<T> {
  resizable?: boolean;
}

const ResizableTitle = (props: any) => {
  const { onResize, width, ...restProps } = props;

  if (!width || !onResize) {
    return <th {...restProps} />;
  }

  return (
    <Resizable
      width={width}
      height={0}
      handle={
        <span
          className="react-resizable-handle"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            right: -5,
            bottom: 0,
            zIndex: 1,
            width: 10,
            height: '100%',
            cursor: 'col-resize',
            background: 'transparent'
          }}
        />
      }
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...restProps} />
    </Resizable>
  );
};

interface ModernTableProps<T> extends TableProps<T> {
  columns: ResizableColumnType<T>[];
  enableResize?: boolean;
  stickyHeader?: boolean;
  emptyState?: {
    icon?: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
  };
}

export function ModernTable<T extends object>({
  columns: initialColumns,
  enableResize = true,
  stickyHeader = true,
  emptyState,
  ...tableProps
}: ModernTableProps<T>) {
  const { token } = useDesignTokens();
  const [columns, setColumns] = useState(initialColumns);

  // Add a useEffect to update columns when initialColumns changes
  useEffect(() => {
    setColumns(initialColumns);
  }, [initialColumns]);
  
  const isLoading = typeof tableProps.loading === 'boolean'
    ? tableProps.loading
    : Boolean(tableProps.loading && (tableProps.loading as any).spinning);

  const paginationConfig = typeof tableProps.pagination === 'object' ? tableProps.pagination : undefined;
  const skeletonRowCount = typeof paginationConfig?.pageSize === 'number'
    ? paginationConfig.pageSize
    : 10;
  const skeletonRows = Array.from({ length: skeletonRowCount }, (_, index) => ({
    __skeleton: true,
    __skeletonKey: `skeleton-${index}`
  })) as any[];
  const rowKey = tableProps.rowKey;

  const handleResize = useCallback(
    (index: number) =>
      (_: any, { size }: ResizeCallbackData) => {
        setColumns((prev) => {
          const nextColumns = [...prev];
          nextColumns[index] = {
            ...nextColumns[index],
            width: size.width
          };
          return nextColumns;
        });
      },
    []
  );

  const mergedColumns = columns.map((col, index) => {
    const originalRender = col.render;
    const skeletonWidth = typeof col.width === 'number'
      ? Math.max(80, Math.min(160, Math.round(col.width * 0.6)))
      : 120;

    return {
      ...col,
      render: (value: any, record: any, renderIndex: number) => {
        if (record?.__skeleton) {
          return (
            <Skeleton.Input
              active
              size="small"
              style={{ width: skeletonWidth }}
            />
          );
        }
        return originalRender ? originalRender(value, record, renderIndex) : value;
      },
      onHeaderCell: (column: ResizableColumnType<T>) => ({
        width: column.width,
        onResize: enableResize && col.resizable !== false ? handleResize(index) : undefined
      })
    };
  });

  const effectiveRowKey = (() => {
    if (isLoading) {
      return (record: any) => {
        if (record?.__skeletonKey) return record.__skeletonKey;
        if (typeof rowKey === 'function') return rowKey(record);
        if (rowKey) return record[rowKey];
        return record?.key ?? record?.id ?? record?._id ?? undefined;
      };
    }

    if (rowKey) {
      return (record: any) => (typeof rowKey === 'function' ? rowKey(record) : record[rowKey]);
    }

    return undefined;
  })();

  const mergedLocale = (() => {
    if (!emptyState || isLoading) return tableProps.locale;

    const emptyText = (
      <div style={{ padding: '24px 8px' }}>
        <Empty
          image={emptyState.icon as any}
          description={
            <div>
              <div style={{ fontWeight: 600 }}>{emptyState.title}</div>
              {emptyState.description ? (
                <div style={{ marginTop: 8 }}>{emptyState.description}</div>
              ) : null}
            </div>
          }
        >
          {emptyState.action}
        </Empty>
      </div>
    );

    return {
      ...(tableProps.locale || {}),
      emptyText
    };
  })();

  return (
    <div
      style={{
        width: '100%',
        position: 'relative',
        overflow: 'auto'
      }}
    >
      <style>
        {`
          .modern-table-wrapper {
            overflow-x: auto;
            overflow-y: visible;
          }

          .modern-table-wrapper .ant-table {
            min-width: 100%;
          }

          .modern-table-wrapper .ant-table-thead > tr > th {
            background: linear-gradient(180deg, var(--color-bg-surface) 0%, var(--color-bg-base) 100%);
            font-weight: 600;
            font-size: 11px;
            color: var(--color-text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 2px solid var(--color-border-subtle);
            padding: 12px 16px;
            position: ${stickyHeader ? 'sticky' : 'relative'};
            top: ${stickyHeader ? '0' : 'auto'};
            z-index: ${stickyHeader ? '10' : 'auto'};
          }

          .modern-table-wrapper .ant-table-thead > tr > th::before {
            display: none;
          }

          .modern-table-wrapper .ant-table-tbody > tr {
            transition: all 150ms cubic-bezier(0.16, 1, 0.3, 1);
          }

          .modern-table-wrapper .ant-table-tbody > tr:hover {
            background: var(--color-row-hover) !important;
            box-shadow: 0 1px 3px rgba(59, 130, 246, 0.16);
            transform: translateY(-1px);
          }

          .modern-table-wrapper .ant-table-tbody > tr:nth-child(even) {
            background: var(--color-bg-base);
          }

          .modern-table-wrapper .ant-table-tbody > tr > td {
            padding: 12px 16px;
            border-bottom: 1px solid var(--color-border-subtle);
            font-size: 0.875rem;
            color: var(--color-text-primary);
          }

          .modern-table-wrapper .ant-table-tbody > tr.ant-table-row-selected > td {
            background: var(--color-row-selected) !important;
            color: var(--color-text-primary) !important;
          }

          .modern-table-wrapper .ant-table-tbody > tr.ant-table-row-selected:hover > td {
            background: var(--color-row-active) !important;
            color: var(--color-text-primary) !important;
          }

          .modern-table-wrapper .ant-table-column-sorter {
            color: var(--color-text-muted);
          }

          .modern-table-wrapper .ant-table-column-sorter-up.active,
          .modern-table-wrapper .ant-table-column-sorter-down.active {
            color: var(--color-primary-600);
          }

          .modern-table-wrapper .ant-table-pagination {
            margin: 16px 16px;
          }

          .modern-table-wrapper .ant-pagination-item-active {
            border-color: var(--color-primary-600);
            background: var(--color-primary-50);
          }

          .modern-table-wrapper .ant-pagination-item-active a {
            color: var(--color-text-primary);
            font-weight: 600;
          }

          .modern-table-wrapper .ant-empty-description {
            color: var(--color-text-muted);
          }

          /* Resizable handle styling */
          .modern-table-wrapper .react-resizable-handle {
            position: absolute;
            right: -5px;
            bottom: 0;
            z-index: 1;
            width: 10px;
            height: 100%;
            cursor: col-resize;
          }

          .modern-table-wrapper .react-resizable-handle:hover::after {
            content: '';
            position: absolute;
            right: 4px;
            top: 50%;
            transform: translateY(-50%);
            width: 2px;
            height: 60%;
            background: var(--color-primary-600);
            border-radius: 2px;
            box-shadow: 0 0 4px var(--color-primary-400);
          }

          /* Loading state */
          .modern-table-wrapper .ant-table-placeholder {
            background: ${cssVar.bg.surface};
          }

          /* Expandable row styling */
          .modern-table-wrapper .ant-table-expanded-row > td {
            padding: 0;
            background: var(--color-row-selected);
          }

          .modern-table-wrapper .ant-table-row-expand-icon {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            color: var(--color-text-secondary);
            background: ${cssVar.bg.surface};
            border: 1px solid ${cssVar.border.default};
            border-radius: ${token.borderRadiusSM}px;
            cursor: pointer;
            transition: all 0.2s ease;
            pointer-events: auto;
          }

          .modern-table-wrapper .ant-table-row-expand-icon:hover {
            color: var(--color-primary-600);
            border-color: var(--color-primary-600);
            background: var(--color-primary-50);
          }

          .modern-table-wrapper .ant-table-row-expand-icon::before,
          .modern-table-wrapper .ant-table-row-expand-icon::after {
            position: absolute;
            background: currentColor;
            transition: transform 0.2s ease;
            content: '';
            pointer-events: none;
          }

          .modern-table-wrapper .ant-table-row-expand-icon::before {
            width: 10px;
            height: 2px;
          }

          .modern-table-wrapper .ant-table-row-expand-icon::after {
            width: 2px;
            height: 10px;
          }

          .modern-table-wrapper .ant-table-row-expand-icon-collapsed::after {
            transform: rotate(0deg);
          }

          .modern-table-wrapper .ant-table-row-expand-icon-expanded::after {
            transform: rotate(90deg);
          }

          /* Selection column */
          .modern-table-wrapper .ant-table-selection-column {
            padding-left: 16px;
          }
        `}
      </style>
      <div className="modern-table-wrapper">
        <Table<T>
          {...tableProps}
          loading={isLoading ? false : tableProps.loading}
          columns={mergedColumns as ColumnType<T>[]}
          dataSource={isLoading ? (skeletonRows as T[]) : tableProps.dataSource}
          rowKey={effectiveRowKey as any}
          rowSelection={isLoading ? undefined : tableProps.rowSelection}
          expandable={isLoading ? undefined : tableProps.expandable}
          scroll={{ x: 'max-content', ...tableProps.scroll }}
          locale={mergedLocale}
          components={{
            header: {
              cell: ResizableTitle
            }
          }}
        />
      </div>
    </div>
  );
}
