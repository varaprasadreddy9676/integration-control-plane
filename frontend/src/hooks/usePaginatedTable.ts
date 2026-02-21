import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TablePaginationConfig } from 'antd';

export interface UsePaginatedTableOptions {
  /**
   * Default page size
   * @default 25
   */
  defaultPageSize?: number;

  /**
   * Available page size options
   * @default ['10', '25', '50', '100']
   */
  pageSizeOptions?: string[];

  /**
   * Dependencies that should trigger page reset to 1
   * Pass filter values here so pagination resets when filters change
   */
  resetDeps?: any[];

  /**
   * Whether to sync pagination state with URL params
   * Enables bookmarkable pages
   * @default false
   */
  syncWithUrl?: boolean;

  /**
   * URL param name for page number
   * @default 'page'
   */
  pageParamName?: string;

  /**
   * URL param name for page size
   * @default 'pageSize'
   */
  pageSizeParamName?: string;

  /**
   * Callback fired when pagination is reset (page goes to 1)
   * Useful for clearing row selections or other cleanup
   */
  onReset?: () => void;
}

export interface UsePaginatedTableReturn {
  /**
   * Current page number (1-indexed)
   */
  currentPage: number;

  /**
   * Current page size
   */
  pageSize: number;

  /**
   * Set current page
   */
  setCurrentPage: (page: number) => void;

  /**
   * Set page size (also resets to page 1)
   */
  setPageSize: (size: number) => void;

  /**
   * Get pagination config for ModernTable/Ant Table
   * Pass total count from your API response
   */
  getPaginationConfig: (totalCount: number) => TablePaginationConfig;

  /**
   * Reset pagination to page 1 (useful for manual resets)
   */
  resetToFirstPage: () => void;
}

/**
 * Reusable hook for table pagination with automatic page reset on filter changes
 *
 * @example
 * ```tsx
 * const [selectedRowKeys, setSelectedRowKeys] = useState([]);
 *
 * const { currentPage, pageSize, getPaginationConfig } = usePaginatedTable({
 *   defaultPageSize: 25,
 *   resetDeps: [statusFilter, searchTerm], // Auto-reset when these change
 *   syncWithUrl: true, // Enable URL params
 *   onReset: () => setSelectedRowKeys([]) // Clear selection on reset
 * });
 *
 * const { data } = useQuery({
 *   queryKey: ['items', statusFilter, searchTerm, currentPage, pageSize],
 *   queryFn: () => getItems({ page: currentPage, limit: pageSize, status: statusFilter })
 * });
 *
 * <ModernTable
 *   dataSource={data?.data}
 *   pagination={getPaginationConfig(data?.pagination?.total || 0)}
 *   rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
 * />
 * ```
 */
export const usePaginatedTable = (options: UsePaginatedTableOptions = {}): UsePaginatedTableReturn => {
  const {
    defaultPageSize = 25,
    pageSizeOptions = ['10', '25', '50', '100'],
    resetDeps = [],
    syncWithUrl = false,
    pageParamName = 'page',
    pageSizeParamName = 'pageSize',
    onReset
  } = options;

  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize state from URL params if syncWithUrl is enabled
  const initialPage = syncWithUrl
    ? parseInt(searchParams.get(pageParamName) || '1', 10)
    : 1;
  const initialPageSize = syncWithUrl
    ? parseInt(searchParams.get(pageSizeParamName) || String(defaultPageSize), 10)
    : defaultPageSize;

  const [currentPage, setCurrentPageState] = useState(initialPage);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  // Sync state to URL params if enabled
  const setCurrentPage = (page: number) => {
    setCurrentPageState(page);
    if (syncWithUrl) {
      setSearchParams(prev => {
        const params = new URLSearchParams(prev);
        params.set(pageParamName, String(page));
        return params;
      }, { replace: true });
    }
  };

  const setPageSize = (size: number) => {
    setPageSizeState(size);
    setCurrentPageState(1); // Always reset to page 1 when page size changes
    onReset?.(); // Trigger reset callback
    if (syncWithUrl) {
      setSearchParams(prev => {
        const params = new URLSearchParams(prev);
        params.set(pageSizeParamName, String(size));
        params.set(pageParamName, '1');
        return params;
      }, { replace: true });
    }
  };

  const resetToFirstPage = () => {
    setCurrentPage(1);
  };

  // Auto-reset to page 1 when dependencies (filters) change
  useEffect(() => {
    if (resetDeps.length > 0) {
      setCurrentPage(1);
      onReset?.(); // Trigger reset callback
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  // Generate pagination config for Ant Table
  const getPaginationConfig = useMemo(() => {
    return (totalCount: number): TablePaginationConfig => ({
      current: currentPage,
      pageSize: pageSize,
      total: totalCount,
      showSizeChanger: true,
      showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items`,
      pageSizeOptions,
      onChange: (page, newPageSize) => {
        if (newPageSize !== pageSize) {
          setPageSize(newPageSize);
        } else {
          setCurrentPage(page);
        }
      },
      onShowSizeChange: (_, newSize) => {
        setPageSize(newSize);
      }
    });
  }, [currentPage, pageSize, pageSizeOptions]);

  return {
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
    getPaginationConfig,
    resetToFirstPage
  };
};
