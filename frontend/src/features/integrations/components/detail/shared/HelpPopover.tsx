import { ReactNode } from 'react';
import { Popover } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { cssVar } from '../../../../../design-system/utils';

interface HelpPopoverProps {
  content: ReactNode;
  title?: string;
  placement?: 'top' | 'right' | 'bottom' | 'left' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'leftTop' | 'leftBottom' | 'rightTop' | 'rightBottom';
  trigger?: 'hover' | 'click' | 'focus';
  maxWidth?: number;
}

/**
 * HelpPopover - Reusable help icon with popover for progressive disclosure
 *
 * Usage:
 * <Form.Item
 *   label={
 *     <Space size={4}>
 *       Target URL
 *       <HelpPopover
 *         title="URL Requirements"
 *         content={<UrlRequirementsHelp />}
 *       />
 *     </Space>
 *   }
 * >
 *   <Input />
 * </Form.Item>
 */
export const HelpPopover = ({
  content,
  title,
  placement = 'right',
  trigger = 'click',
  maxWidth = 360
}: HelpPopoverProps) => {
  const colors = cssVar.legacy;

  return (
    <Popover
      content={
        <div style={{ maxWidth }}>
          {content}
        </div>
      }
      title={title}
      placement={placement}
      trigger={trigger}
      overlayStyle={{ maxWidth: maxWidth + 48 }} // Account for padding
    >
      <InfoCircleOutlined
        style={{
          color: colors.info[500],
          cursor: 'help',
          fontSize: 14
        }}
      />
    </Popover>
  );
};
