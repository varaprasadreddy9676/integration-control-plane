import { useEffect } from 'react';
import type { FormInstance } from 'antd';

interface KeyboardShortcutsOptions {
  isCreate: boolean;
  isEditMode: boolean;
  form: FormInstance;
  onCancelEdit: () => void;
}

export const useIntegrationKeyboardShortcuts = ({
  isCreate,
  isEditMode,
  form,
  onCancelEdit
}: KeyboardShortcutsOptions) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTextInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const isContentEditable = target.isContentEditable;
      const isMonacoEditor = target.closest('.monaco-editor') !== null;

      // Check if a modal is open (Ant Design modals have .ant-modal-wrap)
      const isModalOpen = document.querySelector('.ant-modal-wrap') !== null;

      // Cmd/Ctrl+S to save (works everywhere except when modal is open)
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (!isModalOpen) {
          e.preventDefault();
          if (isCreate || isEditMode) {
            form.submit();
          }
        }
      }

      // Escape to cancel (only when NOT typing and NOT in Monaco editor)
      if (e.key === 'Escape') {
        // If modal is open, let Ant Design handle it
        if (isModalOpen) return;

        // Don't interfere when user is typing or editing code
        if (isTextInput || isContentEditable || isMonacoEditor) return;

        if (!isCreate && isEditMode) {
          // In edit mode, cancel editing
          onCancelEdit();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCreate, isEditMode, form, onCancelEdit]);
};
