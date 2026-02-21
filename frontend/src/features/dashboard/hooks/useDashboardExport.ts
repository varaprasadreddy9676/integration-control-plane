import { useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { message } from 'antd';

export type ExportFormat = 'png' | 'pdf';

export interface ExportOptions {
  /** Element to capture (defaults to full dashboard) */
  element?: HTMLElement;
  /** Filename without extension */
  filename?: string;
  /** Image quality (0-1, defaults to 0.95) */
  quality?: number;
  /** Background color for PDF (defaults to white) */
  backgroundColor?: string;
}

/**
 * Modular dashboard export hook
 * Can be used for manual exports or programmatically for email sending
 *
 * @example
 * const { exportDashboard, isExporting } = useDashboardExport();
 *
 * // Manual export
 * await exportDashboard('png', { filename: 'dashboard-report' });
 *
 * // For email (get blob instead of download)
 * const blob = await exportDashboard('pdf', { download: false });
 */
export const useDashboardExport = () => {
  const [isExporting, setIsExporting] = useState(false);

  /**
   * Export dashboard as PNG or PDF
   * @param format - Export format ('png' or 'pdf')
   * @param options - Export options
   * @param download - Whether to trigger download (default: true)
   * @returns Blob if download is false, void otherwise
   */
  const exportDashboard = async (
    format: ExportFormat,
    options: ExportOptions = {},
    download: boolean = true
  ): Promise<Blob | void> => {
    setIsExporting(true);

    try {
      const {
        element,
        filename = `dashboard-${new Date().toISOString().split('T')[0]}`,
        quality = 0.95,
        backgroundColor = '#ffffff'
      } = options;

      // Get the element to capture (default to dashboard container)
      const targetElement = element || document.querySelector('[data-dashboard-container]') as HTMLElement;

      if (!targetElement) {
        throw new Error('Dashboard container not found');
      }

      // Show loading message
      const loadingMessage = message.loading(`Generating ${format.toUpperCase()}...`, 0);

      // Capture the element as canvas
      const canvas = await html2canvas(targetElement, {
        backgroundColor,
        scale: 2, // Higher resolution
        useCORS: true,
        logging: false,
        allowTaint: true,
        windowWidth: targetElement.scrollWidth,
        windowHeight: targetElement.scrollHeight
      });

      loadingMessage();

      if (format === 'png') {
        // Export as PNG
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to generate PNG'));
              }
            },
            'image/png',
            quality
          );
        });

        if (download) {
          // Trigger download
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${filename}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);

          message.success('Dashboard exported as PNG');
        } else {
          return blob;
        }
      } else if (format === 'pdf') {
        // Export as PDF
        const imgData = canvas.toDataURL('image/png', quality);

        // Calculate PDF dimensions (A4 portrait)
        const pdfWidth = 210; // mm (A4 width)
        const pdfHeight = 297; // mm (A4 height)

        // Calculate image dimensions to fit within PDF
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;
        const ratio = imgWidth / imgHeight;

        let finalWidth = pdfWidth - 20; // 10mm margin on each side
        let finalHeight = finalWidth / ratio;

        // If height exceeds page, scale down
        if (finalHeight > pdfHeight - 20) {
          finalHeight = pdfHeight - 20;
          finalWidth = finalHeight * ratio;
        }

        const pdf = new jsPDF({
          orientation: finalHeight > finalWidth ? 'portrait' : 'landscape',
          unit: 'mm',
          format: 'a4'
        });

        // Add image to PDF (centered)
        const xOffset = (pdf.internal.pageSize.getWidth() - finalWidth) / 2;
        const yOffset = 10; // Top margin

        pdf.addImage(imgData, 'PNG', xOffset, yOffset, finalWidth, finalHeight);

        if (download) {
          // Trigger download
          pdf.save(`${filename}.pdf`);
          message.success('Dashboard exported as PDF');
        } else {
          // Return blob for email sending
          const blob = pdf.output('blob');
          return blob;
        }
      }
    } catch (error) {
      console.error('Export failed:', error);
      message.error(`Failed to export dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    } finally {
      setIsExporting(false);
    }
  };

  return {
    exportDashboard,
    isExporting
  };
};
